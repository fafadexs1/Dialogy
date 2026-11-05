import { ConnectorDefinitionSchema, type ConnectorDefinition } from './connector-contract';
import { isRecord } from './data-values';

/** Tokenizer only: no shell, environment expansion, file access or command execution. */
function commandTokens(text: string): string[] {
  if (text.length > 100000) throw new Error('O comando excede 100 KB.');
  const tokens: string[] = [];
  let current = '', quote = '', active = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\' && quote !== "'") { if (text[i + 1] === '\r' || text[i + 1] === '\n') { if (text[++i] === '\r' && text[i + 1] === '\n') i++; continue; } current += text[++i] || ''; active = true; continue; }
    if (quote) { if (char === quote) quote = ''; else current += char; active = true; continue; }
    if (char === '"' || char === "'") { quote = char; active = true; continue; }
    if (/\s/.test(char)) { if (active) tokens.push(current); current = ''; active = false; }
    else { current += char; active = true; }
  }
  if (quote) throw new Error('O comando contém aspas não fechadas.');
  if (active) tokens.push(current);
  return tokens;
}

export function importCurl(text: string): { definition: ConnectorDefinition; warnings: string[] } {
  const tokens = commandTokens(text);
  if (!['curl', 'curl.exe'].includes(tokens.shift() || '')) throw new Error('Cole um comando cURL.');
  let method = '', url = '', body: unknown, bodyType = 'none';
  const headers: Record<string, string> = {}, warnings: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const argument = () => { const value = tokens[++i]; if (value === undefined) throw new Error(`Valor ausente para ${token}.`); return value; };
    if (['-X', '--request'].includes(token)) method = argument().toUpperCase();
    else if (['-H', '--header'].includes(token)) {
      const raw = argument(), colon = raw.indexOf(':');
      if (colon < 1) throw new Error('Header inválido.');
      const key = raw.slice(0, colon).trim(), value = raw.slice(colon + 1).trim();
      if (/authorization|cookie|api.?key|token|secret/i.test(key)) warnings.push(`Autenticação ${key} removida. Vincule uma credencial.`);
      else headers[key] = value;
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(token)) {
      const raw = argument();
      if (raw.startsWith('@')) throw new Error('Arquivos locais não são lidos. Configure uma referência privada no formulário.');
      try { body = JSON.parse(raw); bodyType = 'json'; } catch { body = raw; bodyType = 'raw'; }
    } else if (token === '--url') url = argument();
    else if (['--compressed', '--silent', '-s', '--show-error', '-S', '--location', '-L'].includes(token)) { if (token === '-L' || token === '--location') warnings.push('Redirecionamentos não serão seguidos.'); }
    else if (token.startsWith('-')) throw new Error(`A opção ${token} precisa ser configurada manualmente.`);
    else if (!url && token.startsWith('https://')) url = token;
    else throw new Error('O comando contém argumentos não suportados.');
  }
  const parsed = new URL(url);
  if (parsed.username || parsed.password) throw new Error('Remova usuário e senha da URL e use uma credencial.');
  for (const key of [...parsed.searchParams.keys()]) if (/token|key|secret|password|signature/i.test(key)) { parsed.searchParams.delete(key); warnings.push(`Parâmetro de autenticação ${key} removido.`); }
  return { definition: ConnectorDefinitionSchema.parse({ name: parsed.hostname, description: 'Importado de cURL; revise antes de publicar.', approval: ['GET', 'HEAD'].includes(method || 'GET') && body === undefined ? 'automatic' : 'required', http: { method: method || (body === undefined ? 'GET' : 'POST'), url: parsed.toString(), headers, body, bodyType, credentialRequired: warnings.some(warning => warning.includes('Autenticação') || warning.includes('autenticação')) } }), warnings };
}

export function importOpenApi(value: unknown): Array<{ operationId: string; definition: ConnectorDefinition }> {
  if (!isRecord(value) || !String(value.openapi).startsWith('3.') || !isRecord(value.paths)) throw new Error('Importe uma especificação OpenAPI 3 em JSON.');
  if (JSON.stringify(value).length > 1_000_000) throw new Error('A especificação excede 1 MB.');
  const resolve = (schema: unknown, depth = 0): unknown => {
    if (depth > 12) throw new Error('A especificação contém referências recursivas ou profundas demais.');
    if (Array.isArray(schema)) return schema.map(entry => resolve(entry, depth + 1));
    if (!isRecord(schema)) return schema;
    if (schema.$ref) {
      if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) throw new Error('Referências externas não são carregadas.');
      let current: unknown = value;
      for (const key of schema.$ref.slice(2).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))) { if (!isRecord(current) || !Object.hasOwn(current, key)) throw new Error('Referência OpenAPI não encontrada.'); current = current[key]; }
      return resolve(current, depth + 1);
    }
    return Object.fromEntries(Object.entries(schema).map(([key, child]) => [key, resolve(child, depth + 1)]));
  };
  const result: Array<{ operationId: string; definition: ConnectorDefinition }> = [];
  for (const [path, pathItem] of Object.entries(value.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method) || !isRecord(operation)) continue;
      const servers = operation.servers || pathItem.servers || value.servers;
      const server = Array.isArray(servers) && isRecord(servers[0]) ? String(servers[0].url || '') : '';
      if (!server.startsWith('https://') || /[{}]/.test(server)) throw new Error('Informe um servidor HTTPS fixo na especificação.');
      const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map(entry => resolve(entry)).filter(isRecord);
      const properties: Record<string, unknown> = {}, required: string[] = [], query: Record<string, string> = {}, headers: Record<string, string> = {};
      let mappedPath = path;
      for (const parameter of parameters) {
        const name = String(parameter.name || '');
        if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error('Renomeie parâmetros com caracteres especiais antes de importar.');
        properties[name] = resolve(parameter.schema || { type: 'string' });
        if (parameter.required) required.push(name);
        if (parameter.in === 'path') mappedPath = mappedPath.replaceAll(`{${name}}`, `{{arguments.${name}}}`);
        if (parameter.in === 'query') query[name] = `{{arguments.${name}}}`;
        if (parameter.in === 'header' && !/authorization|cookie|key|token/i.test(name)) headers[name] = `{{arguments.${name}}}`;
      }
      const request = resolve(operation.requestBody);
      const content = isRecord(request) && isRecord(request.content) ? request.content : {};
      const json = isRecord(content['application/json']) ? content['application/json'] : null;
      if (isRecord(request) && Object.keys(content).length && !json) throw new Error('Importação automática de corpo disponível para JSON. Configure outros formatos no formulário.');
      if (json) { properties.body = resolve(json.schema || { type: 'object' }); if (request && isRecord(request) && request.required) required.push('body'); }
      const operationId = String(operation.operationId || `${method}_${path.replace(/\W+/g, '_')}`);
      result.push({ operationId, definition: ConnectorDefinitionSchema.parse({ name: String(operation.summary || operationId), description: String(operation.description || '').slice(0, 2000), inputSchema: { type: 'object', properties, required, additionalProperties: false }, approval: ['get', 'head'].includes(method) ? 'automatic' : 'required', http: { method: method.toUpperCase(), url: `${server.replace(/\/$/, '')}/${mappedPath.replace(/^\//, '')}`, query, headers, bodyType: json ? 'json' : 'none', ...(json ? { body: '{{arguments.body}}' } : {}), credentialRequired: Array.isArray(operation.security || value.security) && ((operation.security || value.security) as unknown[]).length > 0 } }) });
      if (result.length > 100) throw new Error('Importe até 100 operações por vez.');
    }
  }
  return result;
}
