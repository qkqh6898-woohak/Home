import { lineChart, barChart } from './charts.js';

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const state = { data: null, tab: 'today', region: store.get('region', 'dunsan'), range: store.get('range', 36) };

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
const eok = v => `${v.toFixed(2)}억`;
const pct = (v, d = 1) => `${v.toFixed(d)}%`;
const num = v => Math.round(v).toLocaleString('ko-KR');
const signed = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const sampleTag = key => state.data.sources[key]?.sample ? h('span', { class: 'tag' }, '샘플') : null;
const card = (title, sub, ...kids) => h('section', { class: 'card' }, h('h2', null, title), sub ? h('p', { class: 'sub' }, sub) : null, ...kids);

// ------------------------------------------------------------ 오늘
function renderToday() {
  const d = state.data, s = d.score, el = $('#tab-today');
  const icon = { go: '✓', search: '→', wait: '!', hold: '×' }[s.verdict.key];
  const bands = [['보류', 0, 40], ['관망', 40, 55], ['탐색', 55, 70], ['적극 검토', 70, 101]];
  const factors = [...s.factors].sort((a, b) => b.score - a.score);
  el.replaceChildren(
    card('오늘의 판단', `${d.today} 기준 · 후보 생활권 6곳 평균`,
      h('div', { class: 'hero' },
        h('div', { class: 'score' }, String(s.final), h('small', null, '/100')),
        h('div', null, h('div', { class: 'verdict' }, h('span', { class: `dot ${s.verdict.key}`, 'aria-hidden': 'true' }, icon), s.verdict.label))),
      h('div', { class: 'meter', role: 'img', 'aria-label': `100점 중 ${s.final}점` }, h('i', { style: `width:${s.final}%` })),
      h('div', { class: 'scale' }, bands.map(([name, lo, hi]) => h('span', { class: s.final >= lo && s.final < hi ? 'on' : '' }, name))),
      h('p', { class: 'rowtext', style: 'margin-top:12px' }, s.verdict.text),
      h('div', { class: 'split' },
        h('span', null, '시장 점수 ', h('b', null, String(s.market))),
        h('span', null, '마감 가산 ', h('b', null, `+${s.bonus}`)),
        h('span', null, '사택 만료까지 ', h('b', null, `${d.deadline.months_left}개월`))),
      s.bonus === 0 ? h('p', { class: 'small muted', style: 'margin-top:6px' }, '마감 가산은 만료 30개월 전부터 붙기 시작합니다. 마감이 가까울수록 확실한 입주를 우선하도록 점수를 올립니다.') : null),

    card('판단 근거', '점수가 높을수록 매수에 유리한 신호입니다',
      h('ul', { class: 'rows' }, factors.map(f => {
        const dir = f.score >= 60 ? 'up' : f.score < 45 ? 'down' : 'flat';
        return h('li', null,
          h('div', { class: 'rowhead' },
            h('span', { class: 'name' }, h('span', { class: `arrow ${dir}`, 'aria-hidden': 'true' }, { up: '▲', down: '▼', flat: '–' }[dir]), f.name,
              h('span', { class: 'muted small' }, ` 비중 ${f.weight}%`)),
            h('span', { class: 'val' }, `${f.score}점`)),
          h('p', { class: 'rowtext' }, f.text));
      }))),

    card('매수 경로별 점수', null,
      h('ul', { class: 'rows' }, d.routes.map(r => h('li', null,
        h('div', { class: 'rowhead' }, h('span', { class: 'name' }, r.name), h('span', { class: 'val' }, `${r.score}점`)),
        h('div', { class: 'mini' }, h('i', { style: `width:${r.score}%` })),
        h('p', { class: 'rowtext' }, r.note))))),

    card('늦어도 이때까지', `${d.deadline.label} 입주에서 거꾸로 계산한 일정 (가정값)`,
      h('div', { class: 'tablewrap' }, h('table', { class: 'tl' },
        h('thead', null, h('tr', null, h('th', null, '경로'), h('th', null, '할 일'), h('th', null, '기한'), h('th', null, '남은 기간'))),
        h('tbody', null, d.timeline.map(t => h('tr', null,
          h('td', null, t.route), h('td', null, t.step), h('td', null, t.by),
          h('td', null, t.months_left > 0 ? `${t.months_left}개월` : '지남')))))),
      h('p', { class: 'note' }, '일반 매매는 계약부터 입주까지 3개월, 경매는 낙찰 후 잔금과 명도에 6개월, 신축 청약은 분양부터 입주까지 30개월로 잡았습니다.')),
  );
}

// ------------------------------------------------------------ 그래프
function chartCard(title, sub, sourceKey, draw) {
  const box = h('div');
  const c = h('section', { class: 'card' }, h('h2', null, title, sourceKey ? sampleTag(sourceKey) : null), sub ? h('p', { class: 'sub' }, sub) : null, box);
  c._draw = () => draw(box);
  return c;
}
function renderCharts() {
  const d = state.data, el = $('#tab-charts');
  const r = d.regions.find(x => x.id === state.region) || d.regions[0];
  const cut = a => a.slice(-state.range);
  const months = cut(d.months);
  const idx = a => { const b = a[0]; return a.map(v => +(v / b * 100).toFixed(1)); };
  const one = (name, values) => [{ name, color: COLORS[0], values }];

  const filters = h('div', { class: 'filters' },
    h('div', { class: 'chips', role: 'group', 'aria-label': '기간' }, [[12, '최근 1년'], [36, '최근 3년']].map(([v, name]) =>
      h('button', { class: 'chip', 'aria-pressed': String(state.range === v), onclick: () => { state.range = v; store.set('range', v); renderCharts(); } }, name))),
    h('div', { class: 'chips', role: 'group', 'aria-label': '생활권' }, d.regions.map(x =>
      h('button', { class: 'chip', 'aria-pressed': String(x.id === r.id), onclick: () => { state.region = x.id; store.set('region', x.id); renderCharts(); } }, x.name))));

  const cards = [
    chartCard(`${r.name} 84㎡ 매매가`, '월별 중위 가격', 'price', b => lineChart(b, {
      labels: months, series: one('매매가', cut(r.series.price84)), fmt: eok, tick: v => `${v}억`, label: `${r.name} 84㎡ 매매가 추이` })),
    chartCard(`${r.name} 거래량`, '월별 아파트 매매 건수', 'price', b => barChart(b, {
      labels: months, series: one('거래량', cut(r.series.volume)), fmt: v => `${num(v)}건`, label: `${r.name} 거래량` })),
    chartCard(`${r.name} 전세가율`, '매매가 대비 전세가 비율', 'jeonse', b => lineChart(b, {
      labels: months, series: one('전세가율', cut(r.series.jeonse_ratio)), fmt: pct, tick: v => `${v}%`, label: `${r.name} 전세가율` })),
    chartCard('생활권별 84㎡ 매매가', '후보 6곳 비교', 'price', b => lineChart(b, {
      labels: months, height: 230, series: d.regions.map((x, i) => ({ name: x.name, color: COLORS[i], values: cut(x.series.price84) })),
      fmt: eok, tick: v => `${v}억`, label: '생활권별 84㎡ 매매가 비교' })),
    chartCard('대출 금리와 기준금리', '주택담보대출 금리(신규), 한국은행 기준금리', 'rate', b => lineChart(b, {
      labels: months, series: [{ name: '주담대 금리', color: COLORS[0], values: cut(d.city.mortgage_rate) }, { name: '기준금리', color: COLORS[1], values: cut(d.city.base_rate) }],
      fmt: v => pct(v, 2), tick: v => `${v}%`, label: '대출 금리와 기준금리' })),
    chartCard('대전 아파트 경매 진행 건수', '월별', 'auction', b => barChart(b, {
      labels: months, series: one('경매 건수', cut(d.city.auction_count)), fmt: v => `${num(v)}건`, label: '대전 아파트 경매 진행 건수' })),
    chartCard('대전 아파트 낙찰가율', '감정가 대비 낙찰가', 'auction', b => lineChart(b, {
      labels: months, series: one('낙찰가율', cut(d.city.auction_bid_ratio)), fmt: pct, tick: v => `${v}%`, label: '대전 아파트 낙찰가율' })),
    chartCard('연체율과 경매 건수의 차이', `${months[0]}을 100으로 맞춘 지수. 경매만 빠르게 늘면 연체율 통계가 실제보다 낮게 보이는 신호일 수 있습니다`, 'delinquency', b => lineChart(b, {
      labels: months, series: [{ name: '경매 건수', color: COLORS[0], values: idx(cut(d.city.auction_count)) }, { name: '연체율', color: COLORS[1], values: idx(cut(d.city.delinquency)) }],
      fmt: v => v.toFixed(0), label: '연체율과 경매 건수 지수 비교' })),
    chartCard('대전 미분양', '월별 미분양 주택 수', 'supply', b => lineChart(b, {
      labels: months, series: one('미분양', cut(d.city.unsold)), fmt: v => `${num(v)}호`, tick: num, zero: true, label: '대전 미분양 추이' })),
    chartCard('대전 입주 예정 물량', '연도별 아파트 입주 예정 세대수', 'supply', b => barChart(b, {
      labels: Object.keys(d.supply), series: one('입주 예정', Object.values(d.supply)), fmt: num, tick: num, allLabels: true, valueLabels: true, xName: '연도', label: '연도별 입주 예정 물량' })),
    chartCard('시장 점수 추이', '후보 생활권 평균, 마감 가산 제외', null, b => lineChart(b, {
      labels: months, series: one('시장 점수', cut(d.score_history)), fmt: v => `${v.toFixed(0)}점`, label: '시장 점수 추이' })),
  ];
  el.replaceChildren(filters, ...cards);
  cards.forEach(c => c._draw());
}

// ------------------------------------------------------------ 지역
function renderRegions() {
  const d = state.data, el = $('#tab-regions');
  const budget = { in: '예산 범위 안', under: '예산보다 낮음', over: '예산 초과' };
  el.replaceChildren(
    h('p', { class: 'note' }, `대덕연구단지까지 자가용 통근 30분 이내로 잡은 후보입니다. 통근 시간은 추정값이고, 예산은 ${d.budget.min}억~${d.budget.max}억 기준입니다. 카드를 누르면 그래프 화면의 생활권이 바뀝니다.`),
    ...d.regions.map(r => h('button', {
      class: 'card region', 'aria-pressed': String(r.id === state.region),
      onclick: () => { state.region = r.id; store.set('region', r.id); renderRegions(); },
    },
      h('div', { class: 'rowhead' },
        h('span', { class: 'name' }, r.name, h('span', { class: `badge ${r.budget}` }, budget[r.budget]), sampleTag('price')),
        h('span', { class: 'val' }, `${r.score}점`)),
      h('p', { class: 'rowtext' }, `${r.area} · 통근 약 ${r.commute}분`),
      h('dl', { class: 'stats' },
        h('div', null, h('dt', null, '84㎡ 매매가'), h('dd', null, eok(r.price))),
        h('div', null, h('dt', null, '6개월 변동'), h('dd', null, signed(r.chg6))),
        h('div', null, h('dt', null, '전세가율'), h('dd', null, pct(r.jeonse))),
        h('div', null, h('dt', null, '월 거래량'), h('dd', null, `${num(r.volume)}건`))))));
}

// ------------------------------------------------------------ 자금
const MONEY_DEFAULT = { income: 9000, cash: 30000, other: 0, rate: null, years: 30, ltv: 70, dsr: 40, stress: 1.5 };
function renderMoney() {
  const d = state.data, el = $('#tab-money');
  const saved = store.get('money', {});
  const v = { ...MONEY_DEFAULT, rate: d.city.mortgage_rate.at(-1), ...saved };
  const fields = [
    ['income', '연소득 (만원)'], ['cash', '자기자본 (만원)'], ['other', '기존 대출 연 상환액 (만원)'], ['rate', '대출 금리 (%)'],
    ['years', '만기 (년)'], ['ltv', 'LTV 한도 (%)'], ['dsr', 'DSR 한도 (%)'], ['stress', '스트레스 가산금리 (%p)'],
  ];
  const out = h('div');
  const calc = () => {
    const n = v.years * 12;
    const factor = rate => { const m = rate / 100 / 12; return m > 0 ? m / (1 - Math.pow(1 + m, -n)) : 1 / n; };
    const yearly = Math.max(0, v.income * v.dsr / 100 - v.other);
    const byDsr = yearly / 12 / factor(v.rate + v.stress);
    const rows = [6, 7, 8, 9, 10].map(p => {
      const price = p * 10000;
      const limit = Math.min(price * v.ltv / 100, byDsr);
      const need = Math.max(0, price - v.cash);
      const loan = Math.min(need, limit);
      return { p, limit, need, gap: need - limit, pay: loan * factor(v.rate) };
    });
    const man = x => `${(x / 10000).toFixed(2)}억`;
    out.replaceChildren(
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ['매매가', '대출 한도', '필요 대출', '월 상환액', '판정'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(r => h('tr', null,
          h('td', null, `${r.p}억`), h('td', null, man(r.limit)), h('td', null, man(r.need)), h('td', null, `${num(r.pay)}만`),
          h('td', { class: r.gap <= 0 ? 'ok' : 'no' }, r.gap <= 0 ? '✓ 가능' : `× ${man(r.gap)} 부족`)))))),
      h('p', { class: 'note' }, `DSR 기준 대출 한도는 약 ${man(byDsr)}입니다. 대출 한도는 LTV 한도와 DSR 한도 중 작은 쪽입니다.`));
  };
  const form = h('div', { class: 'form' }, fields.map(([k, label]) => h('label', null, label,
    h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: v[k], oninput: e => {
      const x = parseFloat(e.target.value);
      if (!Number.isFinite(x) || x < 0 || (k === 'years' && x < 1)) return;
      v[k] = x; saved[k] = x; store.set('money', saved); calc();
    } }))));
  el.replaceChildren(
    card('내 자금으로 살 수 있는 가격', '입력한 값은 이 기기에만 저장되고 밖으로 전송되지 않습니다', form),
    card('가격대별 계산 결과', '원리금 균등 상환 기준', out),
    card('계산할 때 알아 둘 점', null, h('ul', { class: 'note' },
      h('li', null, '처음 채워진 값은 예시입니다. 본인 조건으로 바꿔서 쓰세요.'),
      h('li', null, 'LTV, DSR, 스트레스 금리는 정책에 따라 바뀝니다. 생애최초 구입자는 LTV 우대나 정책대출 대상일 수 있으니 은행에서 최신 기준을 확인하세요.'),
      h('li', null, '취득세, 중개보수, 이사비 같은 부대 비용은 포함하지 않았습니다.'))));
  calc();
}

// ------------------------------------------------------------ 더보기
const GLOSSARY = [
  ['유찰', '경매에서 입찰자가 없어 팔리지 않은 것. 다음 회차에는 최저 가격이 보통 20~30% 낮아집니다.'],
  ['낙찰가율', '감정가 대비 낙찰된 가격의 비율. 낮을수록 시세보다 싸게 팔렸다는 뜻입니다.'],
  ['임의경매', '담보대출을 갚지 못해 금융기관이 담보를 경매에 넘긴 것.'],
  ['임의취소(무잉여 기각)', '경매로 팔아도 앞선 채권자 몫과 비용을 빼면 남는 돈이 없어 경매가 취소되는 것.'],
  ['말소기준권리', '낙찰되면 지워지는 권리와 낙찰자가 떠안는 권리를 가르는 기준이 되는 권리.'],
  ['대항력', '집주인이 바뀌어도 세입자가 계속 살거나 보증금을 돌려받을 때까지 버틸 수 있는 권리.'],
  ['명도', '낙찰받은 집에 살던 사람을 내보내고 집을 넘겨받는 일.'],
  ['전세가율', '매매가 대비 전세가의 비율. 높을수록 실수요가 가격을 받쳐 준다고 봅니다.'],
  ['LTV', '집값 대비 대출 가능 비율.'],
  ['DSR', '연소득 대비 모든 대출의 연간 원리금 상환액 비율.'],
  ['스트레스 DSR', '금리가 오를 경우를 가정해 가산금리를 더한 뒤 대출 한도를 계산하는 방식.'],
  ['연체율', '전체 대출 중 원리금을 제때 갚지 못한 대출의 비율.'],
  ['대환대출', '새 대출을 받아 기존 대출을 갚는 것. 연체 직전 대출을 대환하면 통계상 연체로 잡히지 않습니다.'],
  ['NPL(부실채권)', '3개월 이상 연체된 대출 채권. 할인율이 클수록 담보 가치가 낮게 평가된다는 뜻입니다.'],
  ['브릿지론', '개발 사업 초기에 인허가와 토지 매입 자금을 마련하려고 빌리는 고금리 단기 대출.'],
  ['본PF', '인허가 후 착공 단계에서 시공사 보증과 분양 대금을 담보로 받는 대규모 사업 대출.'],
  ['책임준공', '시공사가 정해진 기한까지 공사를 끝내겠다고 금융기관에 약속하는 것.'],
  ['미분양', '분양했지만 팔리지 않은 주택. 준공 후에도 남으면 준공 후 미분양이라고 합니다.'],
  ['렌트프리', '상가 임대차 계약에서 일정 기간 임대료를 받지 않는 조건.'],
];
function renderMore() {
  const d = state.data, el = $('#tab-more');
  el.replaceChildren(
    card('대전 부동산 뉴스', '최근 일주일', d.news.length
      ? h('ul', { class: 'rows news' }, d.news.map(n => h('li', null,
          h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, n.title),
          h('p', { class: 'rowtext' }, `${n.source} · ${n.date}`))))
      : h('p', { class: 'note' }, '아직 수집된 뉴스가 없습니다. 매일 아침 자동 수집 때 채워집니다.')),
    card('데이터 상태', `마지막 갱신 ${d.generated_at}`,
      h('ul', { class: 'rows' }, Object.values(d.sources).map(s => h('li', null, h('div', { class: 'rowhead' },
        h('span', null, h('span', { class: 'name' }, s.name), h('span', { class: 'muted small' }, ` ${s.provider}`)),
        h('span', { class: `state ${s.sample ? 'sample' : 'real'}` }, s.sample ? '샘플' : '실제'))))),
      h('p', { class: 'note' }, '샘플로 표시된 항목은 API 키를 등록하면 실제 데이터로 바뀝니다. 데이터는 매일 아침 자동으로 갱신되고, 앱은 열 때마다 최신 버전을 받아 옵니다.')),
    card('휴대폰에 설치', null,
      h('h3', null, '아이폰 (Safari)'), h('ol', { class: 'steps' }, h('li', null, '아래쪽 공유 버튼을 누릅니다'), h('li', null, '"홈 화면에 추가"를 누릅니다')),
      h('h3', null, '안드로이드 (Chrome)'), h('ol', { class: 'steps' }, h('li', null, '오른쪽 위 메뉴(⋮)를 누릅니다'), h('li', null, '"앱 설치" 또는 "홈 화면에 추가"를 누릅니다'))),
    card('점수 계산 방식', null,
      h('ul', { class: 'note' },
        h('li', null, '지표 7개를 각각 0~100점으로 바꾼 뒤 비중대로 더한 값이 시장 점수입니다.'),
        h('li', null, d.score.factors.map(f => `${f.name} ${f.weight}%`).join(', ')),
        h('li', null, '70점 이상 적극 검토, 55점 이상 매물 탐색, 40점 이상 관망, 그 아래는 보류입니다.'),
        h('li', null, '사택 만료 30개월 전부터는 마감 가산이 붙어 점수가 85점을 향해 올라갑니다.'))),
    card('용어 사전', null, h('dl', { class: 'gloss' }, GLOSSARY.flatMap(([t, x]) => [h('dt', null, t), h('dd', null, x)]))),
  );
}

// ------------------------------------------------------------ 공통
const RENDER = { today: renderToday, charts: renderCharts, regions: renderRegions, money: renderMoney, more: renderMore };
function show(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== `tab-${tab}`; });
  document.querySelectorAll('.tabs button').forEach(b => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (state.data) RENDER[tab]();
  scrollTo(0, 0);
}
function renderShell() {
  const d = state.data;
  $('#updated').textContent = `${d.generated_at} 갱신`;
  const dd = $('#dday');
  dd.textContent = `사택 만료 D-${d.deadline.days_left.toLocaleString('ko-KR')}`;
  dd.hidden = false;
  $('#sampleBanner').hidden = !d.sample;
}
async function load() {
  try {
    const res = await fetch('data/data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (state.data && state.data.generated_at === data.generated_at) return;
    state.data = data;
    renderShell();
    RENDER[state.tab]();
  } catch (e) {
    if (!state.data) $('#updated').textContent = '데이터를 불러오지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.';
  }
}

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
let resizeTimer, lastWidth = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.data && state.tab === 'charts') renderCharts(); }, 150);
});

// 자동 업데이트: 화면으로 돌아올 때마다 데이터와 앱 버전을 다시 확인한다
let swReg = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  load();
  swReg?.update().catch(() => {});
});
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
}
load();
