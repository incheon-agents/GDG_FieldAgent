/**
 * "인천이니?" 챗봇 화면.
 *
 * 코스는 더 이상 예시가 아닙니다. "강제 코스"는 curator.html과 **같은 엔진**을 씁니다.
 *   1) POST /api/recommend — 좌표 기반 코스 탐색 + 영업시간 + 날씨 + Gemini 문구
 *   2) 실패하면 같은 로직을 브라우저에서 직접 실행 (lib/recommend.js)
 * 그래서 네트워크가 끊겨도, /api 가 없는 정적 호스팅에서도 실제 장소와 시간이 나옵니다.
 *
 * 동행자(people)는 아직 가상 인물 데모입니다. 화면에 그렇게 표시합니다.
 */

import { LANDMARKS } from './lib/places.js';
import { recommendLocally } from './lib/recommend.js';

const API_TIMEOUT_MS = 7000;

/** 챗 화면은 이동수단을 묻지 않는다. 인천 시내 기준 가장 무난한 기본값. */
const TRANSPORT = 'transit';
const TRANSPORT_LABEL = { walk: '도보', transit: '대중교통', car: '차량' };
const STATE_LABEL = { open: '영업 중', closing_soon: '곧 마감', always: '상시 개방' };

/** 예시 동행자. 실제 주변인 조회가 아니라 화면 구성을 보여주기 위한 가상 인물. */
const DEMO_COMPANIONS = [
  ['민지 · 인천 로컬', '한식 좋아해요 · 2명 · 15:00까지'],
  ['준 · 인천 여행 중', '시장 먹거리 탐방 · 1명 · 16:00까지'],
  ['소라 · 인천 로컬', '밥 먹고 가볍게 산책 · 2명 · 17:00까지']
];

/** 분위기 카드. 고르면 그 목적(purpose)으로 실제 코스를 짠다. */
const MOODS = [
  ['시장 한 바퀴', '먹거리 구경과 가벼운 한 끼', 'solo_meal'],
  ['골목 걷기', '산책하다 만나는 오래된 거리', 'walk'],
  ['커피 한 잔의 여유', '조용히 앉아 있을 곳', 'quiet_cafe'],
  ['사진 남기기', '한 장 건지고 오는 코스', 'photo']
];

const LIFE_TOPICS = [
  ['🚇 대중교통', '출발지와 목적지를 정하고 지도 앱에서 최신 시간표를 확인해줘. 이 데모는 실시간 도착 정보를 제공하지 않아.'],
  ['🪑 쉬어갈 곳', '공원 쉼터나 공공시설부터 찾아보자. 벤치 위치·이용 가능 여부는 아직 연결하지 않았어.'],
  ['🚻 화장실 찾기', '역사나 공공시설의 안내 표지를 확인해봐. 개방 여부와 이용시간은 현장에서 확인이 필요해.']
];

const log = document.querySelector('#messages');
let chosen = LANDMARKS[0].label;
/** 분위기 카드나 자유 입력에서 넘어온 목적. 코스 요청에 실어 보낸다. */
let purpose = 'walk';

/* ------------------------------------------------------------ 말풍선 조립 */

/** 모든 텍스트는 textContent로만 넣는다. 모델이 쓴 문구가 섞이므로 innerHTML은 쓰지 않는다. */
function message(text, fromUser = false) {
  const row = document.createElement('div');
  row.className = `message${fromUser ? ' user' : ''}`;

  if (!fromUser) {
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = '✳';
    row.append(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  bubble.append(paragraph);

  row.append(bubble);
  log.append(row);
  return bubble;
}

function action(parent, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action';
  button.textContent = label;
  button.addEventListener('click', () => onClick(button));
  parent.append(button);
  return button;
}

function linkAction(parent, label, href) {
  const link = document.createElement('a');
  link.className = 'action link-action';
  link.target = '_blank';
  link.rel = 'noopener';
  link.href = href;
  link.textContent = label;
  parent.append(link);
  return link;
}

function note(parent, text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'note';
  paragraph.textContent = text;
  parent.append(paragraph);
}

function item(parent, title, detail) {
  const wrap = document.createElement('div');
  wrap.className = 'item';

  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = detail;

  wrap.append(heading, body);
  parent.append(wrap);
  return wrap;
}

function labelledSelect(text, ariaLabel, options, value) {
  const label = document.createElement('label');
  label.textContent = text;

  const select = document.createElement('select');
  select.setAttribute('aria-label', ariaLabel);
  for (const [optionLabel, optionValue] of options) select.add(new Option(optionLabel, optionValue));
  select.value = value;

  label.append(select);
  return { label, select };
}

function reveal() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  log.lastElementChild?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------ 코스 (실제) */

function welcome() {
  log.replaceChildren();
  message('안녕, 인천이니? 👋\n나는 네 인천 로컬 친구야. 어디 갈지 고민 중이라면 위에서 골라봐. 오늘의 인천은 내가 맡을게!');
}

function course() {
  const bubble = message('결정하기 귀찮은 날이지? 😎\n출발 위치와 남은 시간만 알려줘. 오늘 코스는 내가 정해줄게.');

  const place = labelledSelect(
    '어디서 출발해?', '출발 위치',
    LANDMARKS.map(mark => [mark.label, mark.label]),
    chosen
  );
  const time = labelledSelect(
    '얼마나 놀 수 있어?', '가용 시간',
    [60, 90, 120, 240].map(n => [`${n}분`, String(n)]),
    '90'
  );
  bubble.append(place.label, time.label);

  action(bubble, '✦ 고민 끝! 코스 강제 배정', async button => {
    chosen = place.select.value;
    const minutes = Number(time.select.value);
    const landmark = LANDMARKS.find(mark => mark.label === chosen) ?? LANDMARKS[0];

    button.disabled = true;
    button.textContent = '코스 짜는 중…';
    message(`${chosen}에서 ${minutes}분! 코스 정해줘.`, true);
    reveal();

    const result = await requestCourse(landmark, minutes);
    button.textContent = '✓ 코스 받았어';
    renderCourse(result, landmark, minutes);
    reveal();
  });

  reveal();
}

/** 서버 → 실패 시 브라우저 로컬 계산. 둘 다 같은 lib/recommend.js 를 쓴다. */
async function requestCourse(landmark, minutes) {
  const [lat, lng] = landmark.coord;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ lat, lng, minutes, transport: TRANSPORT, purpose })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[chat] /api/recommend 실패, 로컬 계산으로 대체:', err.message);
    return {
      ...recommendLocally({ coord: landmark.coord, transport: TRANSPORT, minutes, purpose }),
      degraded: true
    };
  } finally {
    clearTimeout(timer);
  }
}

function renderCourse(result, landmark, minutes) {
  const course = result.course;

  if (!course || course.stops.length === 0) {
    const bubble = message(`${landmark.label}에서 ${minutes}분으로는 갈 만한 코스를 못 찾았어. 😥\n시간을 늘리거나 다른 출발지를 골라볼래?`);
    note(bubble, '이동시간과 영업시간을 실제로 계산하기 때문에, 안 되는 건 안 된다고 말해주는 거야.');
    return;
  }

  const bubble = message('오늘은 이 순서로 가자. 고민은 여기서 끝!');
  if (result.isRaining) note(bubble, '지금 비가 와서 실내 위주로 골랐어.');

  course.stops.forEach((stop, index) => {
    const card = item(
      bubble,
      `${String(index + 1).padStart(2, '0')} · ${stop.name}`,
      legLine(stop, index === 0)
    );
    const reason = document.createElement('p');
    reason.textContent = stop.reason;
    card.append(reason);
  });

  linkAction(bubble, `${course.stops[0].name}으로 출발하기 →`, course.stops[0].map);

  const slack = course.slackMin > 5 ? `여유 ${course.slackMin}분` : '시간 딱 맞음';
  note(bubble, `${course.stops.length}곳 · 총 ${course.totalMin}분 · ${slack} · ${sourceLabel(result)}`);

  const others = result.otherCourses ?? [];
  if (others.length > 0) {
    note(bubble, `다른 코스: ${others.map(c => c.stops.map(s => s.name).join(' → ')).join(' / ')}`);
  }

  action(bubble, '마음에 들어 · 코스 담기', button => {
    button.textContent = '✓ 이번 대화에 담았어';
    button.disabled = true;
  });
}

function legLine(stop, isFirst) {
  const leg = isFirst ? `${TRANSPORT_LABEL[TRANSPORT]} ${stop.travelMin}분` : `앞 코스에서 ${stop.travelMin}분`;
  const state = STATE_LABEL[stop.openState];
  return `${leg} · ${stop.arrivalAt} 도착 · ${stop.stayMin}분 머물기${state ? ` · ${state}` : ''}`;
}

function sourceLabel(result) {
  if (result.source === 'model') return 'Gemini가 고른 코스';
  return result.degraded ? '오프라인 계산' : '자동 계산';
}

/* ------------------------------------------------------------ 데모 영역 */

function people() {
  const bubble = message('혼자 먹기 아쉬울 때, 같이 한 끼 어때? 🍚');
  note(bubble, '아래는 가상 인물입니다. 거리·인원·시간은 예시이며 실제 주변인 조회가 아닙니다.');

  for (const [name, detail] of DEMO_COMPANIONS) {
    const card = item(bubble, name, detail);
    action(card, '같이 먹자고 해보기', button => {
      button.textContent = '✓ 데모 신청 완료';
      button.disabled = true;
      message(`${name.split(' · ')[0]}님에게 식사 동행을 신청했어 — 시연용 확인이야. 실제 메시지는 전송되지 않아. 공개된 식당에서 만나고 개인 연락처는 공유하지 않는 게 좋아.`);
      reveal();
    });
  }

  reveal();
}

/** 분위기를 고르면 그 목적으로 실제 코스 폼을 연다. */
function food() {
  const bubble = message('어떤 하루가 좋아? 고르면 그 느낌으로 코스를 짤게.');

  for (const [name, detail, moodPurpose] of MOODS) {
    const card = item(bubble, name, detail);
    action(card, '이 느낌으로 코스 짜줘', () => {
      purpose = moodPurpose;
      message(`${name} 느낌이 좋아!`, true);
      course();
    });
  }

  reveal();
}

function life() {
  const bubble = message('이동할 때도, 잠깐 쉬어갈 때도 도와줄게. 무엇이 필요해?');

  for (const [topic, answer] of LIFE_TOPICS) {
    action(bubble, topic, () => {
      message(topic, true);
      message(answer);
      reveal();
    });
  }

  reveal();
}

/* ------------------------------------------------------------ 입력 처리 */

const GUIDES = { course, people, food, life };

/** 자유 입력은 키워드로 가이드에 연결한다. 실제 자연어 이해가 아니다. */
const KEYWORD_ROUTES = [
  [/같이|동행|친구/, people],
  [/맛집|밥|음식|카페|혼밥/, food],
  [/교통|화장실|벤치|버스|지하철/, life],
  [/코스|시간|추천|어디/, course]
];

for (const button of document.querySelectorAll('[data-guide]')) {
  button.addEventListener('click', () => GUIDES[button.dataset.guide]?.());
}

document.querySelector('#reset').addEventListener('click', () => {
  purpose = 'walk';
  welcome();
});

document.querySelector('#composer').addEventListener('submit', event => {
  event.preventDefault();

  const input = document.querySelector('#question');
  const text = input.value.trim();
  if (!text) return;

  message(text, true);
  input.value = '';

  const matched = KEYWORD_ROUTES.find(([pattern]) => pattern.test(text));
  if (matched) {
    matched[1]();
    return;
  }

  message('자유로운 대화는 아직 연결 전이야. 대신 위의 네 가지 가이드는 진짜로 동작해 — 강제 코스는 실제 이동시간과 영업시간을 계산해서 짜줄게.');
  reveal();
});

welcome();
