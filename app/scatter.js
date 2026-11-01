// Canvas scatterplot of vote share against elector density on a log10 x axis.

const MARGIN = { top: 10, right: 12, bottom: 38, left: 50 };
const X_MIN = -3; // 0.001 electors per km²
const X_MAX = 5; // 100,000 electors per km²
const HIT_RADIUS = 10;
const INK = '#1f1f1d';
const MUTED = '#63625d';
const GRID = '#e7e6e1';
const DOT_RGB = '53, 151, 143'; // #35978f, from the Yes side of the map ramp

const tickLabel = (power) => (power < 0 ? (10 ** power).toFixed(-power) : new Intl.NumberFormat('en-CA').format(10 ** power));

export function createScatter(canvas, { onHover, onClick }) {
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  let points = [];
  let fits = [];
  let yLabel = '';
  let dotAlpha = 0.25;
  let highlighted = null;
  let width = 0;
  let height = 0;

  const xScale = (logDensity) => MARGIN.left + ((logDensity - X_MIN) / (X_MAX - X_MIN)) * (width - MARGIN.left - MARGIN.right);
  const yScale = (share) => MARGIN.top + (1 - share) * (height - MARGIN.top - MARGIN.bottom);

  function drawBase() {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width) return; // the card is closed; the ResizeObserver redraws on open
    canvas.width = base.width = width * dpr;
    canvas.height = base.height = height * dpr;
    const c = base.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    c.font = '11px system-ui, sans-serif';
    c.lineWidth = 1;

    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const pct of [0, 25, 50, 75, 100]) {
      const y = yScale(pct / 100);
      c.strokeStyle = pct === 50 ? MUTED : GRID;
      c.beginPath();
      c.moveTo(MARGIN.left, y);
      c.lineTo(width - MARGIN.right, y);
      c.stroke();
      c.fillStyle = MUTED;
      c.fillText(`${pct}%`, MARGIN.left - 5, y);
    }

    c.textAlign = 'center';
    c.textBaseline = 'top';
    // Every second power of ten keeps the labels apart in the narrow panel.
    for (let power = X_MIN + 1; power <= X_MAX; power += 2) {
      c.fillStyle = MUTED;
      c.fillText(tickLabel(power), xScale(power), height - MARGIN.bottom + 5);
    }
    c.fillStyle = INK;
    c.fillText('Electors per km² (log scale)', (MARGIN.left + width - MARGIN.right) / 2, height - 14);

    c.save();
    c.translate(8, (MARGIN.top + height - MARGIN.bottom) / 2);
    c.rotate(-Math.PI / 2);
    c.textBaseline = 'middle';
    c.fillText(yLabel, 0, 0);
    c.restore();

    c.fillStyle = `rgba(${DOT_RGB}, ${dotAlpha})`;
    // Largest first, so big dots don't cover small ones.
    for (const p of [...points].sort((a, b) => b.radius - a.radius)) {
      c.beginPath();
      c.arc(xScale(p.x), yScale(p.y), p.radius, 0, 2 * Math.PI);
      c.fill();
    }

    // A white casing keeps each line legible where the dots are densest.
    c.lineJoin = 'round';
    for (const fit of fits) {
      const path = new Path2D();
      fit.points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](xScale(p.x), yScale(p.y)));
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4.5;
      c.stroke(path);
      c.strokeStyle = fit.color;
      c.lineWidth = 2.5;
      c.stroke(path);
    }
    draw();
  }

  function draw() {
    if (!base.width) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = points.find((point) => point.i === highlighted);
    if (p) {
      ctx.beginPath();
      ctx.arc(xScale(p.x), yScale(p.y), 5, 0, 2 * Math.PI);
      ctx.fillStyle = INK;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }

  function nearest(event) {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let best = null;
    let bestDistance = HIT_RADIUS ** 2;
    for (const p of points) {
      const distance = (xScale(p.x) - mx) ** 2 + (yScale(p.y) - my) ** 2;
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
    return best;
  }

  canvas.addEventListener('mousemove', (event) => {
    const p = nearest(event);
    canvas.style.cursor = p ? 'pointer' : 'default';
    if (p && p.i !== highlighted) onHover(p.i);
  });
  canvas.addEventListener('click', (event) => {
    const p = nearest(event);
    if (p) onClick(p.i);
  });
  new ResizeObserver(() => drawBase()).observe(canvas);

  return {
    update(next) {
      ({ points, fits, yLabel, dotAlpha } = next);
      highlighted = null;
      drawBase();
    },
    highlight(i) {
      highlighted = i;
      draw();
    },
  };
}
