// 의존성 없는 SVG 차트. 선 차트는 십자선 툴팁, 막대 차트는 막대별 툴팁을 가진다.
const NS = 'http://www.w3.org/2000/svg';
const tip = () => document.getElementById('tooltip');

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

function showTip(x, y, label, rows) {
  const t = tip();
  t.replaceChildren();
  h('div', 'tt-label', label, t);
  rows.forEach(r => {
    const row = h('div', 'tt-row', null, t);
    if (r.color) { const k = h('i', 'key' + (r.box ? ' box' : ''), null, row); k.style[r.box ? 'background' : 'borderColor'] = r.color; }
    if (r.name) h('span', null, r.name, row);
    h('b', null, r.value, row);
  });
  t.hidden = false;
  const w = t.offsetWidth, ht = t.offsetHeight;
  let left = x + 14;
  if (left + w > innerWidth - 8) left = x - w - 14;
  t.style.left = Math.max(8, left) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - ht - 8, y - ht - 12)) + 'px';
}
function hideTip() { tip().hidden = true; }

function xLabels(svg, labels, xAt, y, width) {
  // 연도가 바뀌는 지점과 양 끝만 표시한다
  const n = labels.length;
  const picks = new Set([0, n - 1]);
  labels.forEach((l, i) => { if (/-01$/.test(l)) picks.add(i); });
  let lastX = -99;
  [...picks].sort((a, b) => a - b).forEach(i => {
    const x = xAt(i);
    if (x - lastX < 46 && i !== n - 1) return;
    if (i === n - 1 && x - lastX < 46) return;
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    const t = svgEl('text', { x, y, 'text-anchor': anchor }, svg);
    t.textContent = shortLabel(labels[i]);
    lastX = x;
  });
}
function shortLabel(l) {
  const m = /^(\d{4})-(\d{2})$/.exec(l);
  return m ? `${m[1].slice(2)}.${m[2]}` : l;
}

function tableView(container, cfg) {
  const d = h('details', 'tableview', null, container);
  h('summary', null, '표로 보기', d);
  const wrap = h('div', 'tablewrap', null, d);
  const table = h('table', null, null, wrap);
  const head = h('tr', null, null, h('thead', null, null, table));
  h('th', null, cfg.xName || '시점', head);
  cfg.series.forEach(s => h('th', null, s.name, head));
  const body = h('tbody', null, null, table);
  for (let i = cfg.labels.length - 1; i >= 0; i--) {
    const tr = h('tr', null, null, body);
    h('td', null, cfg.labels[i], tr);
    cfg.series.forEach(s => h('td', null, cfg.fmt(s.values[i]), tr));
  }
}

function legend(container, series, box) {
  if (series.length < 2) return;
  const l = h('div', 'legend', null, container);
  series.forEach(s => {
    const item = h('span', null, null, l);
    const k = h('i', 'key' + (box ? ' box' : ''), null, item);
    k.style[box ? 'background' : 'borderColor'] = s.color;
    item.appendChild(document.createTextNode(s.name));
  });
}

export function lineChart(container, cfg) {
  container.replaceChildren();
  container.classList.add('chart');
  legend(container, cfg.series);
  const W = container.clientWidth || 320, H = cfg.height || 190;
  const endLabels = cfg.series.length <= 2;
  const m = { l: 42, r: endLabels ? 50 : 12, t: 12, b: 22 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': cfg.label || '' }, container);
  const all = cfg.series.flatMap(s => s.values);
  const { lo, hi, ticks } = niceTicks(cfg.zero ? 0 : Math.min(...all), Math.max(...all));
  const n = cfg.labels.length;
  const xAt = i => m.l + (W - m.l - m.r) * (n === 1 ? 0.5 : i / (n - 1));
  const yAt = v => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));

  ticks.forEach(v => {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: yAt(v), y2: yAt(v), stroke: v === lo ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
    svgEl('text', { x: m.l - 6, y: yAt(v) + 4, 'text-anchor': 'end' }, svg).textContent = cfg.tick ? cfg.tick(v) : v;
  });
  xLabels(svg, cfg.labels, xAt, H - 5, W);

  const ends = [];
  cfg.series.forEach(s => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('');
    if (cfg.series.length === 1) {
      svgEl('path', { d: `${d}L${xAt(n - 1)},${yAt(lo)}L${xAt(0)},${yAt(lo)}Z`, fill: s.color, opacity: 0.10 }, svg);
    }
    svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const ex = xAt(n - 1), ey = yAt(s.values[n - 1]);
    svgEl('circle', { cx: ex, cy: ey, r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    ends.push({ y: ey, text: cfg.fmt(s.values[n - 1]) });
  });
  if (endLabels) {
    const clash = ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14;
    if (clash) { const up = ends[0].y < ends[1].y ? 0 : 1; ends[up].y -= 7; ends[1 - up].y += 7; }
    ends.forEach(e => { svgEl('text', { x: W - m.r + 8, y: e.y + 4, class: 'endlabel' }, svg).textContent = e.text; });
  }

  const cross = svgEl('line', { y1: m.t, y2: H - m.b, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dots = cfg.series.map(s => svgEl('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit = svgEl('rect', { x: m.l, y: 0, width: W - m.l - m.r + 8, height: H, fill: 'transparent', tabindex: 0 }, svg);
  const at = i => {
    cross.setAttribute('x1', xAt(i)); cross.setAttribute('x2', xAt(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', xAt(i)); d.setAttribute('cy', yAt(cfg.series[k].values[i])); d.setAttribute('visibility', 'visible'); });
    const box = svg.getBoundingClientRect();
    showTip(box.left + xAt(i) * box.width / W, box.top + yAt(Math.max(...cfg.series.map(s => s.values[i]))) * box.height / H,
      cfg.labels[i], cfg.series.map(s => ({ color: s.color, name: cfg.series.length > 1 ? s.name : '', value: cfg.fmt(s.values[i]) })));
  };
  const off = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTip(); };
  let cur = n - 1;
  hit.addEventListener('pointermove', ev => {
    const box = svg.getBoundingClientRect();
    const x = (ev.clientX - box.left) * W / box.width;
    cur = Math.max(0, Math.min(n - 1, Math.round((x - m.l) / (W - m.l - m.r) * (n - 1))));
    at(cur);
  });
  hit.addEventListener('pointerdown', ev => hit.dispatchEvent(new PointerEvent('pointermove', ev)));
  hit.addEventListener('pointerleave', off);
  hit.addEventListener('blur', off);
  hit.addEventListener('focus', () => at(cur));
  hit.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') cur = Math.max(0, cur - 1);
    else if (ev.key === 'ArrowRight') cur = Math.min(n - 1, cur + 1);
    else return;
    ev.preventDefault(); at(cur);
  });
  tableView(container, cfg);
}

export function barChart(container, cfg) {
  container.replaceChildren();
  container.classList.add('chart');
  const s = cfg.series[0];
  const W = container.clientWidth || 320, H = cfg.height || 170;
  const m = { l: 42, r: 12, t: cfg.valueLabels ? 20 : 12, b: 22 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': cfg.label || '' }, container);
  const { hi, ticks } = niceTicks(0, Math.max(...s.values));
  const n = cfg.labels.length;
  const band = (W - m.l - m.r) / n;
  const bw = Math.max(2, Math.min(24, band - 2));
  const yAt = v => m.t + (H - m.t - m.b) * (1 - v / hi);
  ticks.forEach(v => {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: yAt(v), y2: yAt(v), stroke: v === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
    svgEl('text', { x: m.l - 6, y: yAt(v) + 4, 'text-anchor': 'end' }, svg).textContent = cfg.tick ? cfg.tick(v) : v;
  });
  const cx = i => m.l + band * (i + 0.5);
  if (cfg.allLabels) {
    cfg.labels.forEach((l, i) => { svgEl('text', { x: cx(i), y: H - 5, 'text-anchor': 'middle' }, svg).textContent = l; });
  } else {
    xLabels(svg, cfg.labels, cx, H - 5, W);
  }
  const bars = s.values.map((v, i) => {
    const x = cx(i) - bw / 2, y = yAt(v), base = yAt(0), r = Math.min(4, bw / 2, Math.max(0, base - y));
    const d = `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z`;
    const p = svgEl('path', { d, fill: s.color }, svg);
    if (cfg.valueLabels) svgEl('text', { x: cx(i), y: y - 6, 'text-anchor': 'middle', class: 'endlabel' }, svg).textContent = cfg.fmt(v);
    return p;
  });
  let cur = n - 1;
  const at = i => {
    bars.forEach((b, k) => b.setAttribute('opacity', k === i ? 1 : 0.45));
    const box = svg.getBoundingClientRect();
    showTip(box.left + cx(i) * box.width / W, box.top + yAt(s.values[i]) * box.height / H, cfg.labels[i],
      [{ color: s.color, box: true, name: '', value: cfg.fmt(s.values[i]) }]);
  };
  const off = () => { bars.forEach(b => b.setAttribute('opacity', 1)); hideTip(); };
  const hit = svgEl('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent', tabindex: 0 }, svg);
  hit.addEventListener('pointermove', ev => {
    const box = svg.getBoundingClientRect();
    cur = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - box.left) * W / box.width - m.l) / band)));
    at(cur);
  });
  hit.addEventListener('pointerdown', ev => hit.dispatchEvent(new PointerEvent('pointermove', ev)));
  hit.addEventListener('pointerleave', off);
  hit.addEventListener('blur', off);
  hit.addEventListener('focus', () => at(cur));
  hit.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') cur = Math.max(0, cur - 1);
    else if (ev.key === 'ArrowRight') cur = Math.min(n - 1, cur + 1);
    else return;
    ev.preventDefault(); at(cur);
  });
  tableView(container, cfg);
}

addEventListener('scroll', hideTip, { passive: true });
