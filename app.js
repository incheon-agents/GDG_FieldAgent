/**
 * 브라우저 진입점.
 *
 * /api/recommend 가 있으면 거기(= RunYourAI 라우터 경유)로 묻고,
 * 없거나 실패하면 같은 로직의 로컬 계산으로 조용히 떨어진다.
 * GitHub Pages처럼 함수가 없는 환경에서도 앱이 그대로 동작하는 이유.
 */

import { LANDMARKS, PURPOSES } from './lib/places.js';
import { recommendLocally } from './lib/recommend.js';

const API_TIMEOUT_MS = 7000;

const state = {
  coord: LANDMARKS[0].coord,
  locationLabel: LANDMARKS[0].label,
  fromGps: false,
  minutes: 90,
  transport: 'transit',
  purpose: 'solo_meal',
  note: ''
};

const $ = sel => document.querySelector(sel);
const els = {
  landmark: $('#landmark'),
  locate: $('#locate'),
  locateState: $('#locateState'),
  locationReadout: $('#locationReadout'),
  timeRange: $('#timeRange'),
  transport: $('#transport'),
  purposes: $('#purposes'),
  observation: $('#observation'),
  count: $('#count'),
  recommend: $('#recommend'),
  recommendLabel: $('#recommendLabel'),
  results: $('#results'),
  resultBadge: $('#resultBadge'),
  primaryCard: $('#primaryCard'),
  courseSteps: $('#courseSteps'),
  courseSummary: $('#courseSummary'),
  altTitle: $('#altTitle'),
  alternatives: $('#alternatives'),
  agentNote: $('#agentNote'),
  status: $('#status')
};

/* ------------------------------------------------------------------ 초기화 */

function initLandmarks() {
  for (const mark of LANDMARKS) {
    const opt = document.createElement('option');
    opt.value = mark.id;
    opt.textContent = mark.label;
    els.landmark.append(opt);
  }
  els.landmark.addEventListener('change', () => {
    const mark = LANDMARKS.find(m => m.id === els.landmark.value);
    if (!mark) return;
    state.coord = mark.coord;
    state.locationLabel = mark.label;
    state.fromGps = false;
    renderLocation();
  });
}

function initPurposes() {
  for (const purpose of PURPOSES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mood';
    btn.dataset.purpose = purpose.id;
    btn.setAttribute('aria-pressed', String(purpose.id === state.purpose));
    if (purpose.id === state.purpose) btn.classList.add('selected');

    const emoji = document.createElement('b');
    emoji.textContent = purpose.emoji;
    btn.append(emoji, document.createTextNode(` ${purpose.label}`));
    els.purposes.append(btn);
  }
  els.purposes.addEventListener('click', event => {
    const btn = event.target.closest('.mood');
    if (!btn) return;
    selectWithin(els.purposes, '.mood', btn);
    state.purpose = btn.dataset.purpose;
  });
}

function initControls() {
  els.timeRange.addEventListener('click', event => {
    const btn = event.target.closest('.chip');
    if (!btn) return;
    selectWithin(els.timeRange, '.chip', btn);
    state.minutes = Number(btn.dataset.time);
  });

  els.transport.addEventListener('change', () => { state.transport = els.transport.value; });

  els.observation.addEventListener('input', () => {
    state.note = els.observation.value;
    els.count.textContent = String(els.observation.value.length);
  });

  els.locate.addEventListener('click', requestGeolocation);
  els.recommend.addEventListener('click', run);
}

/** 같은 그룹 안에서 선택 상태를 하나만 유지한다. */
function selectWithin(container, selector, target) {
  for (const el of container.querySelectorAll(selector)) {
    const on = el === target;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-pressed', String(on));
  }
}

/* ------------------------------------------------------------------ 위치 */

function requestGeolocation() {
  if (!navigator.geolocation) {
    els.locateState.textContent = '미지원';
    return;
  }
  els.locateState.textContent = '확인 중…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.coord = [pos.coords.latitude, pos.coords.longitude];
      state.locationLabel = '현재 위치';
      state.fromGps = true;
      els.locateState.textContent = 'ON';
      renderLocation();
    },
    err => {
      els.locateState.textContent = err.code === err.PERMISSION_DENIED ? '거부됨' : '실패';
      renderLocation();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
  );
}

function renderLocation() {
  const [lat, lng] = state.coord;
  els.locationReadout.textContent = state.fromGps
    ? `현재 위치 기준 (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    : `${state.locationLabel} 기준`;
}

/* ------------------------------------------------------------------ 실행 */

async function run() {
  setBusy(true);
  showStatus('지금 조건에 맞는 곳을 고르는 중…');

  let result;
  try {
    result = await askServer();
  } catch (err) {
    console.warn('[recommend] 서버 응답 실패, 로컬 계산으로 대체:', err.message);
    result = recommendLocally({
      coord: state.coord,
      transport: state.transport,
      minutes: state.minutes,
      purpose: state.purpose
    });
    result.degraded = true;
  }

  setBusy(false);
  render(result);
}

async function askServer() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        lat: state.coord[0],
        lng: state.coord[1],
        minutes: state.minutes,
        transport: state.transport,
        purpose: state.purpose,
        note: state.note.trim()
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function setBusy(busy) {
  els.recommend.disabled = busy;
  els.recommendLabel.textContent = busy ? '고르는 중…' : '코스 짜줘';
}

function showStatus(text) {
  els.status.textContent = text;
  els.status.hidden = !text;
}

/* ------------------------------------------------------------------ 렌더 */

function render(result) {
  const course = result.course;
  if (!course || course.stops.length === 0) {
    els.results.hidden = true;
    showStatus(result.note ?? '지금 조건으로는 짤 수 있는 코스가 없어요.');
    return;
  }
  showStatus('');

  const [first, ...rest] = course.stops;
  const others = result.otherCourses ?? [];

  els.resultBadge.textContent = badgeFor(result);
  els.primaryCard.replaceChildren(...primaryNodes(first, course.stops.length));
  els.courseSteps.replaceChildren(...rest.map((stop, i) => stepNode(stop, i + 2)));
  els.courseSummary.textContent = summaryFor(course);
  els.altTitle.hidden = others.length === 0;
  els.alternatives.replaceChildren(...others.map(alternativeNode));
  els.agentNote.textContent = noteFor(result);

  els.results.hidden = false;
  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function badgeFor(result) {
  if (result.source === 'router') return 'AGENT COURSE · LIVE';
  return result.degraded ? 'AGENT COURSE · OFFLINE' : 'AGENT COURSE';
}

function summaryFor(course) {
  const total = `총 ${course.totalMin}분`;
  const slack = course.slackMin > 5 ? ` · 여유 ${course.slackMin}분` : ' · 시간 딱 맞음';
  return `${course.stops.length}곳 · ${total}${slack}`;
}

function noteFor(result) {
  const parts = [];
  if (result.isRaining) parts.push('지금 비가 와서 실내 위주로 봤어요.');
  if (result.note) parts.push(result.note);
  // 메모는 라우터를 거칠 때만 실제로 반영된다. 로컬 폴백에서 "반영했다"고 말하지 않는다.
  if (result.source === 'router' && state.note.trim()) {
    parts.push(`메모 “${state.note.trim()}”도 반영했어요.`);
  } else if (state.note.trim()) {
    parts.push('(오프라인 모드라 현장 메모는 이번 추천에 반영되지 않았어요.)');
  }
  return parts.join(' ');
}

const STATE_LABEL = {
  open: '영업 중',
  closing_soon: '곧 마감',
  always: '상시 개방'
};

/** 모델이 만든 문자열이 섞이므로 innerHTML을 쓰지 않는다. */
function primaryNodes(stop, stopCount) {
  const badge = el('div', 'place-type', `1코스 / 총 ${stopCount}곳 · ${stop.type}`);
  const name = el('h3', null, stop.name);
  const meta = el('div', 'place-meta', metaLine(stop, true));
  const reason = el('div', 'reason', stop.reason);

  const link = document.createElement('a');
  link.className = 'navigate';
  link.target = '_blank';
  link.rel = 'noopener';
  link.href = stop.map;
  link.textContent = '여기부터 출발하기 →';

  return [badge, name, meta, reason, link];
}

function stepNode(stop, order) {
  const item = el('li', 'course-step');
  const head = el('div', 'course-step-head');
  head.append(el('span', 'course-step-order', `${order}코스`), el('strong', null, stop.name));

  item.append(head, el('div', 'course-step-meta', metaLine(stop, false)), el('p', 'course-step-reason', stop.reason));
  return item;
}

function alternativeNode(course) {
  const wrap = el('div', 'alternative');
  const left = el('div');
  left.append(
    el('strong', null, course.stops.map(s => s.name).join(' → ')),
    el('small', null, `${course.stops.length}곳 · 총 ${course.totalMin}분 · 첫 이동 ${course.stops[0].travelMin}분`)
  );
  wrap.append(left);
  return wrap;
}

function metaLine(stop, isFirst) {
  const transport = { walk: '도보', transit: '대중교통', car: '차량' }[state.transport];
  const openLabel = STATE_LABEL[stop.openState] ?? '';
  const leg = isFirst ? `${transport} ${stop.travelMin}분` : `앞 코스에서 ${stop.travelMin}분`;
  return `${leg} · ${stop.arrivalAt} 도착 · ${stop.stayMin}분 머물기${openLabel ? ` · ${openLabel}` : ''}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ 부트 */

initLandmarks();
initPurposes();
initControls();
renderLocation();
