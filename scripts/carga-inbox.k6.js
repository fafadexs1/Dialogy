/**
 * Teste de carga do Dialogy — perfil medido, nao inventado.
 *
 * Por agente conectado, por minuto (numeros observados em producao):
 *   2x  POST /api/users/online-status        heartbeat de presenca
 *   1x  GET  /api/users/online/{workspace}   lista de agentes online
 *   2x  GET  /api/build-id                   watcher de versao
 *   +   navegacao de inbox
 *
 * Uso (sem instalar k6):
 *   npx tsx scripts/gerar-sessoes-carga.ts --workspace <uuid> --agentes 600 > sessoes.json
 *   docker run --rm -i -v "${PWD}:/w" -w /w grafana/k6 run \
 *     -e BASE_URL=http://host.docker.internal:9045 \
 *     -e WORKSPACE_ID=<uuid> \
 *     scripts/carga-inbox.k6.js
 *
 * O teste FALHA sozinho se os thresholds estourarem — nao precisa interpretar
 * grafico para saber se passou.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9045';
const WORKSPACE_ID = __ENV.WORKSPACE_ID;
const ARQUIVO_SESSOES = __ENV.SESSOES || 'sessoes.json';

const sessoes = new SharedArray('sessoes', () => JSON.parse(open(ARQUIVO_SESSOES)).sessoes);

const latenciaHeartbeat = new Trend('dialogy_heartbeat_ms', true);
const latenciaOnline = new Trend('dialogy_agentes_online_ms', true);
const naoAutorizado = new Counter('dialogy_401');
const erros = new Rate('dialogy_erros');

export const options = {
  scenarios: {
    agentes: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // aquecimento
        { duration: '2m', target: 50 },   // patamar de referencia
        { duration: '2m', target: 400 },  // rampa ate o alvo
        { duration: '5m', target: 400 },  // patamar do alvo — a medicao que importa
        { duration: '2m', target: 600 },  // alem do alvo, para achar o teto
        { duration: '3m', target: 600 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Presenca e caminho de fundo: se ela passa de 1s, o pool esta sofrendo.
    dialogy_heartbeat_ms: ['p(95)<1000'],
    dialogy_agentes_online_ms: ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    dialogy_401: ['count<1'], // qualquer 401 significa sessao mal gerada
  },
};

function sessaoDoVU() {
  return sessoes[(__VU - 1) % sessoes.length];
}

function cabecalhos(sessao) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${sessao.cookieName}=${sessao.cookieValue}`,
    },
    tags: { name: 'dialogy' },
  };
}

export default function () {
  const sessao = sessaoDoVU();
  const cfg = cabecalhos(sessao);

  // 1) Heartbeat de presenca.
  const hb = http.post(
    `${BASE_URL}/api/users/online-status`,
    JSON.stringify({
      workspaceId: WORKSPACE_ID,
      isOnline: true,
      tabId: sessao.tabId,
      source: 'heartbeat',
    }),
    cfg,
  );
  latenciaHeartbeat.add(hb.timings.duration);
  if (hb.status === 401) naoAutorizado.add(1);
  erros.add(hb.status >= 400);
  check(hb, { 'heartbeat ok': (r) => r.status === 200 });

  sleep(1);

  // 2) Lista de agentes online — o caminho que o cache de 5s protege.
  const online = http.get(`${BASE_URL}/api/users/online/${WORKSPACE_ID}`, cfg);
  latenciaOnline.add(online.timings.duration);
  if (online.status === 401) naoAutorizado.add(1);
  erros.add(online.status >= 400);
  check(online, { 'agentes online ok': (r) => r.status === 200 });

  sleep(1);

  // 3) Watcher de versao — barato, mas conta como requisicao no event loop.
  const build = http.get(`${BASE_URL}/api/build-id`, cfg);
  erros.add(build.status >= 400);

  // O ciclo real do agente e de 30s entre heartbeats; comprimimos para 28s de
  // espera para manter a proporcao das rotas sem inflar artificialmente a carga.
  sleep(28);
}

export function handleSummary(data) {
  const m = data.metrics;
  const linha = (nome, metrica) =>
    metrica ? `  ${nome}: p95=${metrica.values['p(95)']?.toFixed(0)}ms  media=${metrica.values.avg?.toFixed(0)}ms\n` : '';

  return {
    stdout:
      '\n=== RESUMO ===\n' +
      linha('heartbeat', m.dialogy_heartbeat_ms) +
      linha('agentes online', m.dialogy_agentes_online_ms) +
      `  requisicoes: ${m.http_reqs?.values.count ?? 0}\n` +
      `  falhas: ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)}%\n` +
      `  401s: ${m.dialogy_401?.values.count ?? 0}\n` +
      '\nColete o pool em paralelo:\n' +
      '  curl -H "Authorization: Bearer $DIALOGY_INTERNAL_SECRET" $BASE_URL/api/internal/pool-stats\n' +
      'Enquanto pool.waiting for 0, o gargalo nao e o pool.\n',
  };
}
