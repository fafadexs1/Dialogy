type WifiObservation = {
  channel: number;
  band: '2.4' | '5';
  signal: number | null;
};

type ParsedWifiScan = {
  observations: WifiObservation[];
  source: string;
  updatedAt: string | null;
  plainText: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonTextPayloads(output: Record<string, unknown>): unknown[] {
  const content = Array.isArray(output.content) ? output.content : [];
  return content.flatMap((item) => {
    const record = asRecord(item);
    const text = typeof item === 'string'
      ? item
      : record?.type === 'text' && typeof record.text === 'string'
        ? record.text
        : '';
    if (!text.trim()) return [];
    try {
      return [JSON.parse(text)];
    } catch {
      return [];
    }
  });
}

function extractPlainTextPayloads(output: Record<string, unknown>): string {
  const content = Array.isArray(output.content) ? output.content : [];
  return content.flatMap((item) => {
    const record = asRecord(item);
    const text = typeof item === 'string'
      ? item
      : record?.type === 'text' && typeof record.text === 'string'
        ? record.text
        : '';
    if (!text.trim()) return [];
    try {
      JSON.parse(text);
      return [];
    } catch {
      return [text.trim()];
    }
  }).join('\n');
}

function collectNetworkRecords(value: unknown, records: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      if (
        record
        && ('channel' in record || 'canal' in record)
        && ('signal' in record || 'rssi' in record || 'ssid' in record || 'bssid' in record)
      ) {
        records.push(record);
      } else {
        collectNetworkRecords(item, records);
      }
    }
    return records;
  }
  const record = asRecord(value);
  if (!record) return records;
  for (const nested of Object.values(record)) collectNetworkRecords(nested, records);
  return records;
}

function numericValue(value: unknown): number | null {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWifiScan(outputValue: unknown): ParsedWifiScan {
  const output = asRecord(outputValue) || {};
  const payloads = [
    output.structuredContent,
    ...parseJsonTextPayloads(output),
  ].filter((value) => value != null);
  const root = asRecord(payloads[0]);
  const source = String(root?.source || '').trim();
  const updatedAt = typeof root?.updated_at === 'string' ? root.updated_at : null;
  const plainText = extractPlainTextPayloads(output);
  const records = payloads.flatMap((payload) => collectNetworkRecords(payload));
  const observations = records.flatMap((record): WifiObservation[] => {
    const channel = numericValue(record.channel ?? record.canal);
    if (channel == null || channel <= 0 || channel > 196) return [];
    const rawBand = String(record.band || record.banda || '').toLowerCase();
    const band: WifiObservation['band'] = (
      rawBand.includes('2.4') || (!rawBand.includes('5') && channel <= 14)
    ) ? '2.4' : '5';
    return [{
      channel,
      band,
      signal: numericValue(record.signal ?? record.rssi),
    }];
  });
  return { observations, source, updatedAt, plainText };
}

function observationWeight(observation: WifiObservation): number {
  if (observation.signal == null) return 1;
  return Math.max(1, Math.min(70, 100 + observation.signal));
}

function channelScore(
  candidate: number,
  observations: WifiObservation[],
  overlapWidth: number,
): number {
  return observations.reduce((score, observation) => {
    const distance = Math.abs(candidate - observation.channel);
    if (distance > overlapWidth) return score;
    const overlap = (overlapWidth + 1 - distance) / (overlapWidth + 1);
    return score + observationWeight(observation) * overlap;
  }, 0);
}

function leastCongestedChannel(
  candidates: number[],
  observations: WifiObservation[],
  overlapWidth: number,
): number | null {
  if (candidates.length === 0) return null;
  return [...candidates]
    .map((channel) => ({
      channel,
      score: channelScore(channel, observations, overlapWidth),
    }))
    .sort((left, right) => left.score - right.score || left.channel - right.channel)[0]?.channel ?? null;
}

function busiestChannels(observations: WifiObservation[]): string {
  const counts = new Map<number, number>();
  for (const observation of observations) {
    counts.set(observation.channel, (counts.get(observation.channel) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, 3)
    .map(([channel, count]) => `${channel} (${count})`)
    .join(', ');
}

export function buildWifiChannelAnalysisResponse(
  output: unknown,
  options: { isCached?: boolean } = {},
): string | null {
  const parsed = parseWifiScan(output);
  const wifi24 = parsed.observations.filter((observation) => observation.band === '2.4');
  const wifi5 = parsed.observations.filter((observation) => observation.band === '5');
  const isCached = Boolean(options.isCached)
    || /(?:^|[_\s-])cache(?:d)?(?:$|[_\s-])/i.test(parsed.source);
  const sourceLabel = isCached ? 'o ultimo scan salvo em cache' : 'um scan do ambiente Wi-Fi';

  if (parsed.observations.length === 0) {
    if (
      /\b(canal|channel)\s*\d+/i.test(parsed.plainText)
      && /\b(redes?|wifi|wi-fi|interfer\w*|sinal|vizinh\w*|proxim\w*)\b/i.test(parsed.plainText)
    ) {
      const trustedToolSummary = parsed.plainText.replace(/\s+/g, ' ').trim().slice(0, 1600);
      return [
        trustedToolSummary,
        /\bnenhuma configuracao foi alterada\b/i.test(trustedToolSummary)
          ? ''
          : 'Nenhuma configuracao foi alterada.',
      ].filter(Boolean).join('\n');
    }
    return [
      `Analisei ${sourceLabel}, mas nenhuma rede vizinha com canal identificavel foi encontrada.`,
      'Recomendacao: mantenha a selecao de canal em automatico e repita o scan quando o roteador estiver acessivel.',
      'Nenhuma configuracao foi alterada.',
    ].join('\n');
  }

  const best24 = leastCongestedChannel([1, 6, 11], wifi24, 4);
  const observed5Channels = [...new Set(wifi5.map((observation) => observation.channel))];
  const common5Candidates = [36, 40, 44, 48, 149, 153, 157, 161];
  const best5 = leastCongestedChannel(
    common5Candidates.filter((channel) => observed5Channels.length === 0 || !observed5Channels.includes(channel)),
    wifi5,
    1,
  ) ?? leastCongestedChannel(common5Candidates, wifi5, 1);

  const lines = [
    `Analisei ${sourceLabel}: ${wifi24.length} rede(s) em 2.4 GHz e ${wifi5.length} em 5 GHz.`,
  ];
  if (wifi24.length > 0) {
    lines.push(`2.4 GHz: canais mais ocupados no scan: ${busiestChannels(wifi24)}.`);
  }
  if (best24 != null) {
    lines.push(`Melhor candidato em 2.4 GHz entre 1, 6 e 11: canal ${best24}.`);
  }
  if (wifi5.length > 0) {
    lines.push(`5 GHz: canais observados com mais redes: ${busiestChannels(wifi5)}.`);
  }
  if (best5 != null) {
    lines.push(`Melhor candidato inicial em 5 GHz: canal ${best5}, sujeito aos canais permitidos pelo roteador e pela regiao.`);
  }
  if (isCached && parsed.updatedAt) {
    lines.push('O resultado e de cache; confirme com um novo scan ao vivo antes de aplicar uma mudanca.');
  }
  lines.push('Nenhuma configuracao foi alterada.');
  return lines.join('\n');
}
