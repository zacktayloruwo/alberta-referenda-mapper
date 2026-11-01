import { parquetReadObjects } from './vendor/hyparquet/src/index.js';
import { createScatter } from './scatter.js';
import { renderAdvanceChart } from './advance.js';
import { questionProfile, renderMatrix } from './correlation.js';
import { linearFit, loessFit, weightedCorrelation } from './fits.js';

const TITLES = {
  1: 'Provincial control over immigration',
  2: 'Limit programs by immigration status',
  3: '12-month residency for social supports',
  4: 'Health and education fees for non-permanent residents',
  5: 'Proof of citizenship to vote',
  6: 'Provinces select superior court justices',
  7: 'Abolish the Senate',
  8: 'Opt out of federal programs with funding',
  9: 'Provincial laws take priority over federal laws',
  10: 'Remain in Canada or start separation process',
};
const SHORT_LABELS = { 10: ['Remain in Canada', 'Start separation process'] };

// ColorBrewer BrBG: colorblind-safe, and avoids party colours. Breaks are the
// share for option 1, with the change of hue at 50%.
const BREAKS = [30, 40, 45, 50, 55, 60, 70];
const COLORS = ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e'];
const NO_BALLOTS = '#bdbcb7';
// ColorBrewer Purples for spread, darker meaning less consistent. Divisions pool
// far more ballots than voting areas, so their spreads are much narrower.
const SPREAD_COLORS = ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'];
const SPREAD_BREAKS = { va: [2, 3, 4, 6], ed: [0.75, 1, 1.5, 2] };
const LINEAR_COLOR = '#1f1f1d';
const LOESS_COLOR = '#d6246e';

const num = new Intl.NumberFormat('en-CA');
const el = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (share) => (share === null ? '–' : `${(share * 100).toFixed(1)}%`);

const FIELDS = ['option_1', 'option_2', 'valid_ballots', 'rejected_ballots'];
const BY_TYPE_FIELDS = ['election_day_option_1', 'election_day_valid', 'advance_option_1', 'advance_valid', 'special_option_1', 'special_valid', 'election_day_cast', 'advance_cast', 'special_cast', 'all_cast'];
const LEVELS = {
  va: { url: 'data/voting_areas.parquet', meta: ['ed_number', 'ed_name', 'voting_area', 'voting_place', 'pooled_location', 'electors', 'area_km2'], weight: 0.25, stroke: '#ffffff' },
  ed: { url: 'data/electoral_divisions.parquet', meta: ['ed_number', 'ed_name', 'electors', 'area_km2'], weight: 0.8, stroke: '#ffffff' },
};

const map = L.map('map', { preferCanvas: true, minZoom: 4 }).setView([54.5, -114.5], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

const scatter = createScatter(el('scatter'), {
  onHover: (i) => hover(state.level, i),
  onClick: (i) => {
    const layer = LEVELS[state.level].layers[i];
    map.fitBounds(layer.getBounds(), { maxZoom: 14 });
    hover(state.level, i);
  },
});

const state = { question: 10, level: 'va', ballotType: 'all', mapMode: 'share', profiles: {}, profile: null, labels: {}, questions: [], totals: {} };

// WKB MULTIPOLYGON -> Leaflet [lat, lng] rings.
function wkbToLatLngs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const header = () => {
    const little = view.getUint8(pos) === 1;
    const type = view.getUint32(pos + 1, little);
    pos += 5;
    return { little, type };
  };
  const { little, type } = header();
  if (type !== 6) throw new Error(`Expected MULTIPOLYGON, got WKB type ${type}`);
  const uint = () => { const v = view.getUint32(pos, little); pos += 4; return v; };
  const polygons = [];
  const nPolygons = uint();
  for (let p = 0; p < nPolygons; p++) {
    header();
    const rings = [];
    const nRings = uint();
    for (let r = 0; r < nRings; r++) {
      const ring = new Array(uint());
      for (let i = 0; i < ring.length; i++) {
        const lng = view.getFloat64(pos, little);
        const lat = view.getFloat64(pos + 8, little);
        pos += 16;
        ring[i] = [lat, lng];
      }
      rings.push(ring);
    }
    polygons.push(rings);
  }
  return polygons;
}

const colorFor = (share) => {
  if (share === null) return NO_BALLOTS;
  const i = BREAKS.findIndex((b) => share * 100 < b);
  return COLORS[i === -1 ? COLORS.length - 1 : i];
};

async function loadLevel(key) {
  const level = LEVELS[key];
  level.file = await (await fetch(level.url)).arrayBuffer();
  const rows = await parquetReadObjects({
    file: level.file,
    columns: [...level.meta, 'geometry'],
    utf8: false,
  });
  level.rows = rows;
  level.layers = rows.map((row, i) => {
    const layer = L.polygon(wkbToLatLngs(row.geometry), {
      weight: level.weight, color: level.stroke, fillOpacity: 0.82, smoothFactor: 0.5,
    });
    layer.on('mouseover', () => { hover(key, i); layer.setStyle({ weight: 2, color: '#1f1f1d' }); layer.bringToFront(); });
    layer.on('mouseout', () => layer.setStyle({ weight: level.weight, color: level.stroke }));
    layer.on('click', () => hover(key, i));
    delete row.geometry;
    return layer;
  });
  level.group = L.featureGroup(level.layers);
  // Division outlines stay visible above the voting areas for orientation.
  if (key === 'ed') {
    state.outlines = L.featureGroup(rows.map((_, i) => L.polygon(level.layers[i].getLatLngs(), {
      interactive: false, fill: false, weight: 1, color: '#55544f', opacity: 0.7,
    })));
  }
}

async function loadResults(key, question) {
  const level = LEVELS[key];
  level.cache ??= {};
  if (!level.cache[question]) {
    const q = `q${String(question).padStart(2, '0')}`;
    const columns = FIELDS.map((f) => `${q}_${f}`);
    const byType = key === 'ed' ? BY_TYPE_FIELDS.map((f) => `${q}_${f}`) : [];
    const rows = await parquetReadObjects({ file: level.file, columns: [...columns, ...byType] });
    level.cache[question] = rows.map((r) => {
      const [option1, option2, valid, rejected] = columns.map((c) => Number(r[c]));
      const [
        electionDayOption1, electionDayValid, advanceOption1, advanceValid, specialOption1, specialValid,
        electionDayCast, advanceCast, specialCast, allCast,
      ] = byType.map((c) => Number(r[c]));
      return {
        option1, option2, valid, rejected, electionDayOption1, electionDayValid, advanceOption1, advanceValid,
        specialOption1, specialValid, electionDayCast, advanceCast, specialCast, allCast,
        share: valid > 0 ? option1 / valid : null,
      };
    });
  }
  return level.cache[question];
}

const BALLOT_TYPES = {
  all: { option1: 'option1', valid: 'valid', cast: 'allCast', name: 'all ballots' },
  advance: { option1: 'advanceOption1', valid: 'advanceValid', cast: 'advanceCast', name: 'advance ballots' },
  electionDay: { option1: 'electionDayOption1', valid: 'electionDayValid', cast: 'electionDayCast', name: 'Election Day ballots' },
  special: { option1: 'specialOption1', valid: 'specialValid', cast: 'specialCast', name: 'special ballots' },
};

// The ballot buttons apply only to the division view, which has every type.
const activeBallots = (key) => (key === 'ed' ? state.ballotType : 'all');

function shareFor(r, ballots) {
  const type = BALLOT_TYPES[ballots];
  return r[type.valid] > 0 ? r[type.option1] / r[type.valid] : null;
}

const density = (row) => Number(row.electors) / row.area_km2;
const formatDensity = (d) => (d < 10 ? d.toFixed(2) : num.format(Math.round(d)));

// Radius runs 2:1 across the middle 96% of elector counts on a square-root
// scale, so outliers don't shrink every other dot.
function addRadii(units, minRadius) {
  const sorted = units.map((p) => p.weight).sort((a, b) => a - b);
  const low = Math.sqrt(sorted[Math.floor(0.02 * (sorted.length - 1))]);
  const high = Math.sqrt(sorted[Math.ceil(0.98 * (sorted.length - 1))]);
  units.forEach((p) => {
    const t = Math.min(1, Math.max(0, (Math.sqrt(p.weight) - low) / (high - low)));
    p.radius = minRadius * (1 + t);
  });
}

function renderScatter(key, question, results, ballots) {
  const level = LEVELS[key];
  const [label1] = state.labels[question];
  const units = level.rows
    .map((row, i) => ({ i, x: Math.log10(density(row)), y: shareFor(results[i], ballots), weight: Number(row.electors) }))
    .filter((p) => p.y !== null)
    .sort((a, b) => a.x - b.x);

  addRadii(units, key === 'va' ? 1.5 : 2.8);

  scatter.update({
    points: units,
    fits: [
      { points: linearFit(units), color: LINEAR_COLOR },
      { points: loessFit(units), color: LOESS_COLOR },
    ],
    yLabel: `${label1} (% of valid ${ballots === 'all' ? 'ballots' : BALLOT_TYPES[ballots].name})`,
    dotAlpha: key === 'va' ? 0.3 : 0.55,
  });

  const r = weightedCorrelation(units);
  const dropped = level.rows.length - units.length;
  const unitName = key === 'va' ? 'voting areas' : 'electoral divisions';
  el('scatter-note').textContent = `${num.format(units.length)} ${unitName}${dropped ? ` (${dropped} with no ballots left out)` : ''}. `
    + `Larger dots have more electors. Both lines and the correlation with log density (r = ${r.toFixed(2)}) are weighted by electors. Loess: span 0.75, degree 2. `
    + 'Density is electors on the list divided by total land and water area in the boundary.';
}

function hover(key, i) {
  const level = LEVELS[key];
  const row = level.rows[i];
  const r = level.cache[state.question][i];
  const [label1, label2] = state.labels[state.question];
  const place = key === 'va'
    ? `<div class="muted">${row.pooled_location ? 'Pooled location: voting areas' : 'Voting area'} ${escapeHtml(row.voting_area)}, ${escapeHtml(row.voting_place)}</div>`
    : '';
  const pctOf = (n) => (r.valid > 0 ? ` (${pct(n / r.valid)})` : '');
  el('detail').innerHTML = `
    <h2>${escapeHtml(row.ed_number)} ${escapeHtml(row.ed_name)}</h2>${place}
    <dl>
      <dt>${escapeHtml(label1)}</dt><dd>${num.format(r.option1)}${pctOf(r.option1)}</dd>
      <dt>${escapeHtml(label2)}</dt><dd>${num.format(r.option2)}${pctOf(r.option2)}</dd>
      <dt>Valid ballots</dt><dd>${num.format(r.valid)}</dd>
      <dt>Rejected ballots</dt><dd>${num.format(r.rejected)}</dd>
      <dt>Electors</dt><dd>${num.format(Number(row.electors))}</dd>
      <dt>Electors per km²</dt><dd>${formatDensity(density(row))}</dd>
      ${key === 'ed' ? ['special', 'advance', 'electionDay'].map((type) => {
    const selected = key === state.level && state.ballotType === type ? ' class="selected"' : '';
    return `<dt${selected}>${escapeHtml(label1)}, ${BALLOT_TYPES[type].name}</dt><dd${selected}>${pct(shareFor(r, type))}</dd>`;
  }).join('') : ''}
      ${state.profile && key === state.level && state.profile.areas[i] ? `<dt>Usual lean vs Alberta, Q1–Q9</dt><dd>${state.profile.areas[i].lean > 0 ? '+' : ''}${state.profile.areas[i].lean.toFixed(1)} pts</dd>
      <dt>Spread around that lean</dt><dd>${state.profile.areas[i].spread.toFixed(1)} pts</dd>` : ''}
    </dl>`;
  if (key === state.level) scatter.highlight(i);
}

function spreadColor(key, area) {
  if (!area || area.fewBallots) return NO_BALLOTS;
  const i = SPREAD_BREAKS[key].findIndex((b) => area.spread < b);
  return SPREAD_COLORS[i === -1 ? SPREAD_COLORS.length - 1 : i];
}

function renderSpreadLegend(key) {
  const breaks = SPREAD_BREAKS[key];
  const swatches = SPREAD_COLORS.map((c) => `<i style="background:${c}"></i>`).join('');
  const ticks = [`<${breaks[0]}`, ...breaks.slice(1).map((b, i) => `${breaks[i]}–${b}`), `${breaks.at(-1)}+`]
    .map((t) => `<span>${t}</span>`).join('');
  const emptyLabel = key === 'va' ? 'Too few ballots to judge' : 'No ballots reported';
  el('legend').innerHTML = `
    <div class="legend-title"><span>◀ More consistent</span><span>Less consistent ▶</span></div>
    <div class="legend-bar legend-spread">${swatches}</div>
    <div class="legend-ticks legend-spread">${ticks}</div>
    <div class="note" style="margin:2px 0 0">Spread across Q1–Q9 (percentage points)</div>
    <div class="legend-empty"><i></i>${emptyLabel}</div>`;
}

async function loadProfile(key, ballots) {
  const cacheKey = `${key}:${ballots}`;
  if (!state.profiles[cacheKey]) {
    const type = BALLOT_TYPES[ballots];
    const all = await Promise.all(state.questions.map((q) => loadResults(key, q.question)));
    const total = (rows, field) => rows.reduce((sum, r) => sum + r[field], 0);
    state.profiles[cacheKey] = questionProfile({
      shares: all.map((rows) => rows.map((r) => shareFor(r, ballots))),
      provinceShares: all.map((rows) => total(rows, type.option1) / total(rows, type.valid)),
      valid: all.map((rows) => rows.map((r) => r[type.valid])),
      weights: LEVELS[key].rows.map((row) => Number(row.electors)),
    });
  }
  return state.profiles[cacheKey];
}

function renderCorrelation(key, ballots, profile) {
  const { a, b, r } = profile.lowestPair;
  const units = key === 'va' ? 'voting areas (Election Day ballots)' : `electoral divisions (${BALLOT_TYPES[ballots].name})`;
  el('correlation-units').textContent = units;
  el('correlation-summary').innerHTML = `
    <div><b>${profile.meanR.toFixed(2)}</b><span>Average correlation among the Yes/No questions (Q1–Q9)</span></div>
    <div><b>${profile.medianSpread.toFixed(1)} pts</b><span>Typical spread around an area's usual lean, Q1–Q9</span></div>`;
  renderMatrix(el('correlation-matrix'), el('correlation-readout'), profile, TITLES);
  const skipped = profile.nSkipped
    ? ` ${num.format(profile.nSkipped)} areas with fewer than ${profile.minValid} valid ballots on a question are left grey, because a few ballots can swing them.`
    : '';
  el('correlation-note').textContent = `The lowest correlation among Q1–Q9 is Q${a + 1} and Q${b + 1} (r = ${r.toFixed(3)}). `
    + 'On the map, consistency compares each area with Alberta on each of Q1–Q9. An area\'s lean is its average gap from the provincial share, and its spread is how much those gaps vary. '
    + `A spread near 0 means the area sat the same distance from Alberta on every question.${skipped} Q10 is left out because it has no Yes option.`;
}

function renderLegend(question) {
  const [label1, label2] = state.labels[question];
  const swatches = COLORS.map((c) => `<i style="background:${c}"></i>`).join('');
  // Ticks describe each bin as the share for the option on that side of 50%.
  const ticks = ['70+', '60–70', '55–60', '50–55', '50–55', '55–60', '60–70', '70+']
    .map((t) => `<span>${t}</span>`).join('');
  el('legend').innerHTML = `
    <div class="legend-title"><span>◀ ${escapeHtml(label2)} leads</span><span>${escapeHtml(label1)} leads ▶</span></div>
    <div class="legend-bar">${swatches}</div>
    <div class="legend-ticks">${ticks}</div>
    <div class="note" style="margin:2px 0 0">Winning side's share of valid ballots (%)</div>
    <div class="legend-empty"><i></i>No ballots reported</div>`;
}

function renderTable(question, results, ballots) {
  const eds = LEVELS.ed.rows
    .map((row, i) => ({ row, i, share: shareFor(results[i], ballots) }))
    .sort((a, b) => b.share - a.share);
  el('ed-table-option').textContent = `${state.labels[question][0]}${ballots === 'all' ? '' : `, ${BALLOT_TYPES[ballots].name}`}`;
  const tbody = document.querySelector('#ed-table tbody');
  tbody.replaceChildren(...eds.map(({ row, i, share }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.ed_name)}</td><td class="num">${pct(share)}</td>`;
    tr.addEventListener('click', () => {
      map.fitBounds(LEVELS.ed.layers[i].getBounds());
      hover('ed', i);
    });
    return tr;
  }));
}

// A newer render supersedes one still waiting on parquet decoding.
let renderId = 0;

async function render() {
  const id = ++renderId;
  const { question, level: key } = state;
  const level = LEVELS[key];
  const edResults = await loadResults('ed', question);
  const results = await loadResults(key, question);
  const ballots = activeBallots(key);
  const profile = el('correlation-card').hidden ? null : await loadProfile(key, ballots);
  if (id !== renderId) return;
  state.profile = profile;
  el('ballot-filter').hidden = key !== 'ed';

  const byConsistency = state.mapMode === 'consistency' && state.profile;
  level.layers.forEach((layer, i) => layer.setStyle({
    fillColor: byConsistency ? spreadColor(key, state.profile.areas[i]) : colorFor(shareFor(results[i], ballots)),
  }));
  Object.entries(LEVELS).forEach(([k, l]) => { if (k !== key) l.group.remove(); });
  level.group.addTo(map);
  if (key === 'va') state.outlines.addTo(map).bringToFront(); else state.outlines.remove();

  const q = state.questions.find((x) => x.question === question);
  const [label1, label2] = state.labels[question];
  const sum = (rows, f) => rows.reduce((total, r) => total + r[f], 0);
  const valid = sum(edResults, 'valid');
  const option1 = sum(edResults, 'option1');
  const option2 = sum(edResults, 'option2');

  el('wording').textContent = q.text;
  el('province').innerHTML = `
    <div><b>${pct(option1 / valid)}</b><span>${escapeHtml(label1)}, Alberta (${num.format(option1)})</span></div>
    <div><b>${pct(option2 / valid)}</b><span>${escapeHtml(label2)}, Alberta (${num.format(option2)})</span></div>`;
  el('coverage').textContent = key === 'va'
    ? `Election Day ballots only: ${pct(sum(results, 'valid') / valid)} of this question's valid ballots. Advance, mobile and special ballots aren't reported by voting area, so local shares can differ from the full result.`
    : coverageNote(edResults, ballots);
  if (byConsistency) renderSpreadLegend(key); else renderLegend(question);
  if (byConsistency) el('coverage').textContent += ' The map shows consistency across Q1–Q9, so changing the question doesn\'t recolour it. Spread is how much an area\'s gap from the provincial share varies from question to question.';
  if (profile) renderCorrelation(key, ballots, profile);
  renderTable(question, edResults, ballots);
  renderScatter(key, question, results, ballots);
  el('advance-note').textContent = `${label1} as a share of valid ballots in each division's special ballots, advance votes and Election Day votes. Rows are sorted by the gap in percentage points between advance and Election Day votes (advance minus Election Day), so a positive gap means ${label1} did better in advance votes. Special ballots aren't part of the gap, and mobile ballots aren't shown, so the proportions of ballots cast don't add up to 100%. Ballots cast follow Elections Alberta's turnout count, which includes rejected and declined ballots but not spoiled ones. Hover over a row to outline it on the map, or click to zoom.`;
  renderAdvanceChart(el('advance-chart'), el('advance-summary'), {
    rows: LEVELS.ed.rows,
    results: edResults,
    label: label1,
    onHover: (i) => {
      hover('ed', i);
      state.edHighlight.setLatLngs(LEVELS.ed.layers[i].getLatLngs()).addTo(map);
    },
    onLeave: () => state.edHighlight.remove(),
    onClick: (i) => map.fitBounds(LEVELS.ed.layers[i].getBounds()),
  });
  el('detail').innerHTML = '<span class="muted">Hover over the map for local results.</span>';
}

function initCards() {
  const buttons = [...document.querySelectorAll('.card-buttons button')];
  const open = (id) => {
    const wasOpen = !el('correlation-card').hidden;
    buttons.forEach((button) => {
      const isOpen = button.dataset.card === id;
      button.setAttribute('aria-pressed', isOpen);
      el(button.dataset.card).hidden = !isOpen;
    });
    if (!id) state.edHighlight?.remove();
    if (id && window.matchMedia('(max-width: 760px)').matches) el(id).scrollIntoView({ block: 'start' });
    const isOpen = id === 'correlation-card';
    if (wasOpen && !isOpen) {
      setConsistencyMap(false);
    }
    if (wasOpen !== isOpen) render();
  };
  buttons.forEach((button) => {
    button.addEventListener('click', () => open(button.getAttribute('aria-pressed') === 'true' ? null : button.dataset.card));
  });
  document.querySelectorAll('.card-close').forEach((button) => button.addEventListener('click', () => open(null)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') open(null); });
}

const PANEL_DEFAULT = 360;
const PANEL_MIN = 280;
const PANEL_STORAGE_KEY = 'panel-width';
const MAP_MIN = 320;

function initPanelHandle() {
  const handle = el('panel-handle');
  let width = PANEL_DEFAULT;

  const setWidth = (next) => {
    const max = Math.max(PANEL_MIN, window.innerWidth - MAP_MIN);
    width = Math.round(Math.min(max, Math.max(PANEL_MIN, next)));
    document.documentElement.style.setProperty('--panel-width', `${width}px`);
    handle.setAttribute('aria-valuemin', PANEL_MIN);
    handle.setAttribute('aria-valuemax', max);
    handle.setAttribute('aria-valuenow', width);
  };
  const remember = () => {
    try { localStorage.setItem(PANEL_STORAGE_KEY, width); } catch { /* width just won't persist */ }
  };

  let saved = null;
  try { saved = Number(localStorage.getItem(PANEL_STORAGE_KEY)); } catch { /* use the default */ }
  setWidth(saved || PANEL_DEFAULT);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-panel');
  });
  handle.addEventListener('pointermove', (event) => {
    if (handle.hasPointerCapture(event.pointerId)) setWidth(event.clientX);
  });
  handle.addEventListener('lostpointercapture', () => {
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing-panel');
    remember();
  });
  handle.addEventListener('dblclick', () => { setWidth(PANEL_DEFAULT); remember(); });
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 50 : 10;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: PANEL_MIN, End: Infinity }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setWidth(next);
    remember();
  });
  window.addEventListener('resize', () => setWidth(width));
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(el('map'));
}

function coverageNote(edResults, ballots) {
  if (ballots === 'all') return 'All ballots: Election Day, advance, mobile and special.';
  const total = (field) => edResults.reduce((sum, r) => sum + r[field], 0);
  const type = BALLOT_TYPES[ballots];
  return `The map shows ${type.name} only: ${pct(total(type.cast) / total('allCast'))} of ballots cast on this question. The Alberta totals above still count all ballots.`;
}

function initBallotFilter() {
  const buttons = [...document.querySelectorAll('#ballot-filter button')];
  buttons.forEach((button) => button.addEventListener('click', () => {
    state.ballotType = button.dataset.ballots;
    buttons.forEach((b) => b.setAttribute('aria-pressed', b === button));
    render();
  }));
}

function setConsistencyMap(on) {
  state.mapMode = on ? 'consistency' : 'share';
  el('consistency-toggle').setAttribute('aria-pressed', on);
  if (window.matchMedia('(max-width: 760px)').matches) return;
  // The open card covers the map's left side, so fit Alberta into the space beside it.
  if (on) {
    state.viewBeforeConsistency = { center: map.getCenter(), zoom: map.getZoom() };
    const paddingLeft = el('correlation-card').offsetWidth + 24;
    map.fitBounds(LEVELS.ed.group.getBounds(), { paddingTopLeft: [paddingLeft, 12], paddingBottomRight: [12, 12] });
  } else if (state.viewBeforeConsistency) {
    map.setView(state.viewBeforeConsistency.center, state.viewBeforeConsistency.zoom);
    state.viewBeforeConsistency = null;
  }
}

function initConsistencyToggle() {
  el('consistency-toggle').addEventListener('click', () => {
    setConsistencyMap(state.mapMode !== 'consistency');
    render();
  });
}

async function main() {
  initPanelHandle();
  initConsistencyToggle();
  initCards();
  initBallotFilter();

  const qFile = await (await fetch('data/questions.parquet')).arrayBuffer();
  state.questions = (await parquetReadObjects({ file: qFile }))
    .map((q) => ({ ...q, question: Number(q.question) }))
    .sort((a, b) => a.question - b.question);
  for (const q of state.questions) {
    state.labels[q.question] = SHORT_LABELS[q.question] ?? [q.option_1_label, q.option_2_label];
    const opt = new Option(`Q${q.question}: ${TITLES[q.question]}`, q.question);
    el('question').add(opt);
  }
  el('question').value = state.question;

  await Promise.all([loadLevel('ed'), loadLevel('va')]);
  map.fitBounds(LEVELS.ed.group.getBounds());
  state.edHighlight = L.polygon([], { interactive: false, fill: false, weight: 3, color: '#1f1f1d' });

  // Each city's extent comes from its electoral divisions, e.g. "Calgary-Bow".
  document.querySelectorAll('.zoom-buttons button').forEach((button) => {
    const layers = LEVELS.ed.layers.filter((_, i) => LEVELS.ed.rows[i].ed_name.startsWith(`${button.dataset.city}-`));
    const bounds = L.featureGroup(layers).getBounds();
    button.addEventListener('click', () => map.fitBounds(bounds));
    button.disabled = false;
  });

  el('question').addEventListener('change', (e) => { state.question = Number(e.target.value); render(); });
  el('level').addEventListener('change', (e) => { state.level = e.target.value; render(); });
  await render();
}

main().catch((err) => {
  console.error(err);
  el('detail').innerHTML = `<span class="error">Could not load the map data: ${escapeHtml(err.message)}</span>`;
});
