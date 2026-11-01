// How consistently areas line up across the referendum questions: a matrix of
// correlations between questions, and each area's spread around its usual lean.

import { weightedCorrelation } from './fits.js';

const YES_NO_QUESTIONS = 9; // Q10 has no Yes option, so it stays out of the spread
const MIN_VALID = 50; // below this, one or two ballots can swing an area's spread

// shares[q][i]: option 1 proportion on question q + 1 in area i, or null if no valid ballots.
export function questionProfile({ shares, provinceShares, valid, weights }) {
  const nQuestions = shares.length;
  const nAreas = weights.length;

  const matrix = shares.map((a) => shares.map((b) => {
    const points = [];
    for (let i = 0; i < nAreas; i++) {
      if (a[i] !== null && b[i] !== null) points.push({ x: a[i], y: b[i], weight: weights[i] });
    }
    return weightedCorrelation(points);
  }));

  const areas = weights.map((_, i) => {
    const gaps = [];
    for (let q = 0; q < YES_NO_QUESTIONS; q++) {
      if (shares[q][i] === null) return null;
      gaps.push(100 * (shares[q][i] - provinceShares[q]));
    }
    const lean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((sum, g) => sum + (g - lean) ** 2, 0) / gaps.length);
    const fewBallots = Math.min(...valid.slice(0, YES_NO_QUESTIONS).map((v) => v[i])) < MIN_VALID;
    return { lean, spread, fewBallots };
  });

  const pairs = [];
  for (let a = 0; a < YES_NO_QUESTIONS; a++) {
    for (let b = a + 1; b < YES_NO_QUESTIONS; b++) pairs.push({ a, b, r: matrix[a][b] });
  }
  const mapped = areas.filter((area) => area && !area.fewBallots).map((area) => area.spread).sort((x, y) => x - y);

  return {
    nQuestions,
    matrix,
    areas,
    meanR: pairs.reduce((sum, p) => sum + p.r, 0) / pairs.length,
    lowestPair: pairs.reduce((low, p) => (p.r < low.r ? p : low)),
    medianSpread: mapped[Math.floor(mapped.length / 2)],
    nMapped: mapped.length,
    nSkipped: areas.length - mapped.length,
    minValid: MIN_VALID,
  };
}

// The correlations sit in a narrow band, so shading runs from the lowest to the
// highest absolute r in this matrix, in blue for positive and red for negative.
function cellStyle(r, low, high) {
  const t = high > low ? (Math.abs(r) - low) / (high - low) : 1;
  const [from, to] = r >= 0 ? [[225, 234, 248], [37, 76, 160]] : [[250, 228, 226], [165, 40, 40]];
  const rgb = from.map((c, i) => Math.round(c + t * (to[i] - c)));
  return `background:rgb(${rgb.join(',')});color:${t > 0.55 ? '#fff' : '#1f1f1d'}`;
}

export function renderMatrix(table, readout, { matrix, nQuestions }, titles) {
  const off = matrix.flatMap((row, a) => row.filter((_, b) => a !== b)).map(Math.abs);
  const low = Math.min(...off);
  const high = Math.max(...off);
  const label = (q) => `Q${q + 1}`;
  const name = (q) => `Q${q + 1}: ${titles[q + 1]}`;
  const describe = (a, b) => `${name(a)} and ${name(b)}: r = ${matrix[a][b].toFixed(3)}`;

  const head = Array.from({ length: nQuestions }, (_, q) => `<th scope="col" title="${name(q)}">${label(q)}</th>`).join('');
  const rows = matrix.map((row, a) => `<tr><th scope="row" title="${name(a)}">${label(a)}</th>${row.map((r, b) => (a === b
    ? '<td class="matrix-self">–</td>'
    : `<td style="${cellStyle(r, low, high)}" data-a="${a}" data-b="${b}" title="${describe(a, b)}">${r.toFixed(2).replace('0.', '.')}</td>`)).join('')}</tr>`).join('');
  table.innerHTML = `<thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody>`;

  table.onmouseover = (event) => {
    const { a, b } = event.target.dataset ?? {};
    if (a !== undefined) readout.textContent = describe(Number(a), Number(b));
  };
}
