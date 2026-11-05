// Agreement between two raters on the gold dataset (docs/GOLD-DATASET-rotulagem.md).
//   node scripts/gold-agreement.cjs rater-a/transferred.jsonl rater-b/transferred.jsonl
// Reads local files only. Prints ids and counts, never message text.
const fs = require('node:fs');

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.error('Uso: node scripts/gold-agreement.cjs <rater-a.jsonl> <rater-b.jsonl>'); process.exit(1); }

const load = (file) => new Map(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
  const row = JSON.parse(line); return [row.conversationId, row];
}));
const A = load(fileA); const B = load(fileB);
const DECISIONS = ['continue', 'handoff', 'close'];

// Missing decision = continue. Returns one label per customer turn, plus the reason or basis for non-continue labels.
function labels(row) {
  const byTurn = new Map((row.gold?.decisions || []).map((item) => [item.turn, item]));
  return row.turns.filter((turn) => turn.role === 'customer').map((turn) => {
    const item = byTurn.get(turn.idx);
    return { idx: turn.idx, decision: item?.decision || 'continue', detail: item?.reason || item?.closeBasis || null };
  });
}

const ids = [...A.keys()].filter((id) => B.has(id));
const missing = [...A.keys()].length - ids.length;
const confusion = Object.fromEntries(DECISIONS.map((x) => [x, Object.fromEntries(DECISIONS.map((y) => [y, 0]))]));
const disagreements = []; let total = 0; let same = 0; let unlabelled = 0; let sameDetail = 0; let nonContinueBoth = 0;

for (const id of ids) {
  const a = A.get(id); const b = B.get(id);
  if (!a.gold?.rater || !b.gold?.rater) { unlabelled += 1; continue; }
  const la = labels(a); const lb = labels(b);
  la.forEach((item, index) => {
    const other = lb[index]; if (!other) return;
    total += 1; confusion[item.decision][other.decision] += 1;
    if (item.decision === other.decision) {
      same += 1;
      if (item.decision !== 'continue') { nonContinueBoth += 1; if (item.detail === other.detail) sameDetail += 1; }
    } else disagreements.push({ conversationId: id, turn: item.idx, a: item.decision, b: other.decision });
  });
}

const observed = total ? same / total : 0;
const rowSum = DECISIONS.map((x) => DECISIONS.reduce((sum, y) => sum + confusion[x][y], 0));
const colSum = DECISIONS.map((y) => DECISIONS.reduce((sum, x) => sum + confusion[x][y], 0));
const expected = total ? DECISIONS.reduce((sum, _, i) => sum + (rowSum[i] / total) * (colSum[i] / total), 0) : 0;
const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);

console.log(JSON.stringify({
  conversationsCompared: ids.length, notInBoth: missing, notLabelledByBoth: unlabelled,
  customerTurns: total, observedAgreement: Number(observed.toFixed(4)), cohenKappa: Number(kappa.toFixed(4)),
  reasonAgreementWhenBothActed: nonContinueBoth ? Number((sameDetail / nonContinueBoth).toFixed(4)) : null,
  confusion_rowA_colB: confusion,
  note: total && kappa < 0.6 ? 'Kappa abaixo de 0,6: ajuste o guia antes de seguir.' : undefined,
}, null, 2));
if (disagreements.length) console.log(JSON.stringify({ disagreements: disagreements.slice(0, 50), total: disagreements.length }));
