// Line fits for the scatterplot. Both expect points sorted by x.

const GRID_SIZE = 60;

const xRange = (points) => [points[0].x, points.at(-1).x];

// Weighted least squares, using each point's `weight`.
export function linearFit(points) {
  const total = points.reduce((sum, p) => sum + p.weight, 0);
  const mx = points.reduce((sum, p) => sum + p.weight * p.x, 0) / total;
  const my = points.reduce((sum, p) => sum + p.weight * p.y, 0) / total;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += p.weight * (p.x - mx) * (p.y - my);
    sxx += p.weight * (p.x - mx) ** 2;
  }
  const slope = sxy / sxx;
  return xRange(points).map((x) => ({ x, y: my + slope * (x - mx) }));
}

// Quadratic fit at x0, weighted by tricube distance and `weight`; x is centred on x0, so the intercept is the fitted value.
function localQuadratic(points, x0, bandwidth) {
  const s = [0, 0, 0, 0, 0];
  const t = [0, 0, 0];
  for (const p of points) {
    const d = p.x - x0;
    const u = Math.abs(d) / bandwidth;
    if (u >= 1) continue;
    const w = p.weight * (1 - u ** 3) ** 3;
    let power = w;
    for (let k = 0; k < 5; k++) {
      s[k] += power;
      if (k < 3) t[k] += power * p.y;
      power *= d;
    }
  }
  const m = [[s[0], s[1], s[2], t[0]], [s[1], s[2], s[3], t[1]], [s[2], s[3], s[4], t[2]]];
  for (let col = 2; col >= 1; col--) {
    for (let row = col - 1; row >= 0; row--) {
      const factor = m[row][col] / m[col][col];
      for (let k = 0; k < 4; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return m[0][3] / m[0][0];
}

// Loess with R's defaults: span 0.75, degree 2, tricube weights, no robustness
// iterations. Tricube weights are multiplied by each point's `weight`. Evaluated
// directly on a grid rather than through R's interpolation.
export function loessFit(points, span = 0.75) {
  const n = points.length;
  const q = Math.floor(n * span + 1e-5);
  const [lo, hi] = xRange(points);
  return Array.from({ length: GRID_SIZE }, (_, g) => {
    const x0 = lo + (g / (GRID_SIZE - 1)) * (hi - lo);
    // Slide the q-point window until it holds the nearest neighbours of x0.
    let start = 0;
    while (start + q < n && x0 - points[start].x > points[start + q].x - x0) start++;
    const bandwidth = Math.max(x0 - points[start].x, points[start + q - 1].x - x0);
    return { x: x0, y: localQuadratic(points, x0, bandwidth) };
  });
}

export function weightedCorrelation(points) {
  const total = points.reduce((sum, p) => sum + p.weight, 0);
  const mx = points.reduce((sum, p) => sum + p.weight * p.x, 0) / total;
  const my = points.reduce((sum, p) => sum + p.weight * p.y, 0) / total;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += p.weight * (p.x - mx) * (p.y - my);
    sxx += p.weight * (p.x - mx) ** 2;
    syy += p.weight * (p.y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
