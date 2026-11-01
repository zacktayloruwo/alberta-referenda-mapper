// Dot chart comparing the vote share in advance, Election Day and special votes by division.

const ELECTION_DAY_COLOR = '#3b5bdb';
const ADVANCE_COLOR = '#d6246e';
const SPECIAL_COLOR = '#c77700';
const TICK_STEP = 10; // percent of valid ballots

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const formatGap = (gap) => `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${Math.abs(gap).toFixed(1)}`;

export function renderAdvanceChart(container, summary, { rows, results, label, onHover, onLeave, onClick }) {
  const divisions = rows.map((row, i) => {
    const r = results[i];
    const electionDay = (100 * r.electionDayOption1) / r.electionDayValid;
    const advance = (100 * r.advanceOption1) / r.advanceValid;
    const special = (100 * r.specialOption1) / r.specialValid;
    return { i, name: row.ed_name, electionDay, advance, special, gap: advance - electionDay };
  }).sort((a, b) => b.gap - a.gap);

  const total = (field) => results.reduce((sum, r) => sum + r[field], 0);
  const provinceShare = (option1, valid) => (100 * total(option1)) / total(valid);
  const nAdvanceHigher = divisions.filter((d) => d.gap > 0).length;
  const count = new Intl.NumberFormat('en-CA');
  const stat = (type, option1, valid, cast) => `
    <div>
      <b>${provinceShare(option1, valid).toFixed(1)}%</b>
      <span>${escapeHtml(label)}, ${type}, Alberta</span>
      <span class="stat-cast">${count.format(total(cast))} cast (${((100 * total(cast)) / total('allCast')).toFixed(1)}% of ballots)</span>
    </div>`;
  summary.innerHTML = `
    ${stat('special ballots', 'specialOption1', 'specialValid', 'specialCast')}
    ${stat('advance votes', 'advanceOption1', 'advanceValid', 'advanceCast')}
    ${stat('Election Day votes', 'electionDayOption1', 'electionDayValid', 'electionDayCast')}
    <div><b>${nAdvanceHigher} of ${divisions.length}</b><span>divisions where ${escapeHtml(label)} was higher in advance votes</span></div>`;

  const values = divisions.flatMap((d) => [d.electionDay, d.advance, d.special]);
  const low = Math.floor(Math.min(...values) / TICK_STEP) * TICK_STEP;
  const high = Math.ceil(Math.max(...values) / TICK_STEP) * TICK_STEP;
  const length = (value) => `${(value / (high - low)) * 100}%`;
  const x = (value) => length(value - low);
  const ticks = [];
  for (let t = low; t <= high; t += TICK_STEP) ticks.push(`<span style="left:${x(t)}">${t}%</span>`);
  const midpoint = low < 50 && high > 50 ? `<i class="dumbbell-mid" style="left:${x(50)}"></i>` : '';

  container.style.setProperty('--tick-spacing', length(TICK_STEP));
  container.innerHTML = `
    <div class="dumbbell-axis">
      <span>Division</span>
      <div class="dumbbell-ticks">${ticks.join('')}</div>
      <span class="num" title="Advance share minus Election Day share, in percentage points">Gap</span>
    </div>
    <div class="dumbbell-rows"></div>`;

  const list = container.querySelector('.dumbbell-rows');
  list.append(...divisions.map((d) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dumbbell-row';
    row.setAttribute('aria-label', `${d.name}: ${label} ${d.electionDay.toFixed(1)}% in Election Day votes, ${d.advance.toFixed(1)}% in advance votes, ${d.special.toFixed(1)}% in special ballots. Zoom to division.`);
    row.innerHTML = `
      <span class="dumbbell-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
      <span class="dumbbell-track">
        ${midpoint}
        <i class="dumbbell-dot" style="left:${x(d.electionDay)};background:#fff;border-color:${ELECTION_DAY_COLOR}" title="Election Day: ${d.electionDay.toFixed(1)}%"></i>
        <i class="dumbbell-dot" style="left:${x(d.advance)};background:${ADVANCE_COLOR};border-color:${ADVANCE_COLOR}" title="Advance: ${d.advance.toFixed(1)}%"></i>
        <i class="dumbbell-dot dumbbell-diamond" style="left:${x(d.special)};background:${SPECIAL_COLOR};border-color:${SPECIAL_COLOR}" title="Special ballots: ${d.special.toFixed(1)}%"></i>
      </span>
      <span class="num">${formatGap(d.gap)}</span>`;
    row.addEventListener('mouseenter', () => onHover(d.i));
    row.addEventListener('focus', () => onHover(d.i));
    row.addEventListener('mouseleave', onLeave);
    row.addEventListener('blur', onLeave);
    row.addEventListener('click', () => onClick(d.i));
    return row;
  }));
}
