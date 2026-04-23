import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as ts from "typescript";

const cwd = process.cwd();
const appRoot = path.join(cwd, "src", "app");
const componentsRoot = path.join(cwd, "src", "components");
const messagePath = path.join(cwd, "src", "i18n", "messages", "en-US.json");
const defaultLocalePath = path.join(cwd, "src", "i18n", "messages", "pt-BR.json");

const allowObjectProps = new Set([
  "title",
  "description",
  "label",
  "placeholder",
  "helperText",
  "emptyText",
  "subtitle",
  "text",
  "successMessage",
  "errorMessage",
  "header",
]);

const allowAttrNames = new Set(["placeholder", "title", "aria-label", "alt", "label"]);
const disallowAttrNames = new Set(["className", "id", "htmlFor", "href", "src", "value", "key", "variant"]);
const portuguesePattern =
  /(nao|não|voce|você|selecione|salvar|excluir|encerrar|mensagem|conversa|contato|instancia|instância|carregando|erro|sucesso|configuracao|configuração|fatura|campanha|workspace|perfil|senha|equipe|whatsapp|instagram|facebook|convite|plano|integracao|integração|relatorio|relatório|fechar|abrir|buscar|vitrine|pedido|entrega|descricao|descrição|titulo|título|subtitulo|subtítulo|publicar|cancelar|voltar|proximo|próximo|anterior|todos|nenhum|agora|cliente|contatos|mensagens|conectado|desconectar|gerenciar|criar|novo|nova|atendimento|atalho|fila|template|conectar|dados|notificacoes|notificações|membros|seguranca|segurança|cobranca|cobrança|idioma|integracoes|integrações|privacidade|termos|convite|bot|agente)/i;
const tokenPattern = /\{\{[^}]+\}\}|\{[A-Za-z0-9_]+\}|%s/g;

const isDryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
const concurrency = 8;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function flattenMessages(messages, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(messages)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenMessages(value, nextKey, out);
      continue;
    }

    if (typeof value === "string") {
      out.set(nextKey, value);
    }
  }

  return out;
}

async function listSourceFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}api${path.sep}`)) {
        continue;
      }

      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function likelyUiString(value) {
  const text = normalizeWhitespace(value);
  if (text.length < 2 || text.length > 240) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(text)) return false;
  if (text.startsWith("/") || text.startsWith(".")) return false;
  if (/^[,)]/.test(text)) return false;
  if (text.startsWith("**")) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/(process\.env|const |=>|useState|useRef|return |<|>|\[\[|@dialogy|@s\.whatsapp\.net|existing code)/i.test(text)) {
    return false;
  }
  if (/^(&copy;|&quot;|[%@#|✓✗•]|['"`([{])/.test(text)) return false;
  if (/[{}]/.test(text) && !tokenPattern.test(text)) return false;
  if (
    /^(absolute|relative|fixed|sticky|flex|grid|inline|block|hidden|rounded|border|bg-|text-|hover:|focus:|sm:|md:|lg:|xl:|2xl:|animate-|tracking-|uppercase|lowercase)/.test(
      text
    )
  ) {
    return false;
  }
  if (/^[A-Za-z0-9_.-]+$/.test(text) && !portuguesePattern.test(text)) return false;
  if (/[À-ÿ]/.test(text)) return true;
  return portuguesePattern.test(text);
}

function getPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    return node.text;
  }

  return null;
}

function shouldKeepString(node) {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return false;
  }

  if (ts.isJsxAttribute(parent)) {
    const attrName = parent.name.text;
    if (disallowAttrNames.has(attrName)) {
      return false;
    }

    return allowAttrNames.has(attrName);
  }

  if (ts.isPropertyAssignment(parent)) {
    const propName = getPropertyName(parent.name);
    return propName ? allowObjectProps.has(propName) : false;
  }

  if (ts.isCallExpression(parent) && parent.expression.getText().includes("toast")) {
    return true;
  }

  if (
    ts.isConditionalExpression(parent) ||
    ts.isBinaryExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isReturnStatement(parent) ||
    ts.isJsxExpression(parent)
  ) {
    let current = node.parent;
    while (current) {
      if (ts.isJsxAttribute(current)) {
        const attrName = current.name.text;
        return !disallowAttrNames.has(attrName);
      }

      if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) {
        return true;
      }

      if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
        break;
      }

      current = current.parent;
    }
  }

  return false;
}

function extractStringsFromSource(filePath, source) {
  const found = new Set();
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = normalizeWhitespace(node.getText(sourceFile));
      if (likelyUiString(text)) {
        found.add(text);
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && shouldKeepString(node)) {
      const text = normalizeWhitespace(node.text);
      if (likelyUiString(text)) {
        found.add(text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

async function collectCandidateStrings() {
  const files = [...(await listSourceFiles(appRoot)), ...(await listSourceFiles(componentsRoot))];
  const found = new Set();

  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    for (const item of extractStringsFromSource(filePath, source)) {
      found.add(item);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function applyFlatAliases(defaultMessages, targetMessages) {
  const defaultFlat = flattenMessages(defaultMessages);
  const targetFlat = flattenMessages(targetMessages);
  const aliases = [];

  for (const [key, ptValue] of defaultFlat.entries()) {
    const translatedValue = targetFlat.get(key);
    if (typeof ptValue !== "string" || typeof translatedValue !== "string") {
      continue;
    }

    const currentValue = targetMessages[ptValue];
    if (currentValue === translatedValue) {
      continue;
    }

    if (currentValue === undefined || currentValue === ptValue) {
      aliases.push([ptValue, translatedValue]);
    }
  }

  for (const [source, translated] of aliases.sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))) {
    targetMessages[source] = translated;
  }

  return aliases.length;
}

function protectTokens(input) {
  const tokens = [];
  const text = input.replace(tokenPattern, (match) => {
    const placeholder = `__DIALOGY_TOKEN_${tokens.length}__`;
    tokens.push([placeholder, match]);
    return placeholder;
  });

  return { text, tokens };
}

function restoreTokens(input, tokens) {
  return tokens.reduce((result, [placeholder, original]) => result.replaceAll(placeholder, original), input);
}

async function translateString(input, attempt = 1) {
  const { text, tokens } = protectTokens(input);
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=pt&tl=en&dt=t&q=" +
    encodeURIComponent(text);
  const response = await fetch(url, {
    headers: {
      "user-agent": "DialogyI18nSync/1.0",
    },
  });

  if (!response.ok) {
    if (attempt >= 3) {
      throw new Error(`Translation failed with status ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    return translateString(input, attempt + 1);
  }

  const payload = await response.json();
  const translated = Array.isArray(payload?.[0]) ? payload[0].map((part) => part?.[0] ?? "").join("") : "";
  const restored = restoreTokens(translated || input, tokens).trim();
  return restored || input;
}

async function translateMissingStrings(strings) {
  const results = new Map();
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= strings.length) {
        return;
      }

      const source = strings[currentIndex];
      try {
        const translated = await translateString(source);
        results.set(source, translated);
      } catch (error) {
        console.error(`failed to translate: ${source}`);
        console.error(error instanceof Error ? error.message : error);
        results.set(source, source);
      }

      completed += 1;
      if (completed % 50 === 0 || completed === strings.length) {
        console.log(`translated ${completed}/${strings.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, strings.length) }, () => worker()));
  return results;
}

async function main() {
  const [defaultMessages, targetMessages] = await Promise.all([readJson(defaultLocalePath), readJson(messagePath)]);
  const aliasCount = applyFlatAliases(defaultMessages, targetMessages);
  const candidates = await collectCandidateStrings();
  const keysToTranslate = candidates.filter((candidate) => {
    const existing = targetMessages[candidate];
    if (existing === undefined) {
      return true;
    }

    if (existing !== candidate) {
      return false;
    }

    return /[À-ÿ]/.test(candidate) || portuguesePattern.test(candidate);
  });

  const queue = limit ? keysToTranslate.slice(0, limit) : keysToTranslate;

  console.log(`aliases applied: ${aliasCount}`);
  console.log(`candidate strings: ${candidates.length}`);
  console.log(`pending english translations: ${queue.length}`);

  if (isDryRun) {
    console.log(queue.slice(0, 200).join("\n"));
    return;
  }

  if (queue.length > 0) {
    const translatedEntries = await translateMissingStrings(queue);
    for (const source of queue) {
      targetMessages[source] = translatedEntries.get(source) ?? source;
    }
  }

  await fs.writeFile(messagePath, `${JSON.stringify(targetMessages, null, 2)}\n`, "utf8");
  console.log(`updated ${path.relative(cwd, messagePath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
