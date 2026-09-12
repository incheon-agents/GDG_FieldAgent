/**
 * "인천이니?" 챗봇 UI 데모.
 *
 * 이 화면은 대화 흐름과 화면 구성을 보여주는 UI 데모입니다.
 * 코스·인물·시간은 아래 상수에 박혀 있는 예시이며, 실제 거리·영업시간 계산은
 * `lib/recommend.js`의 코스 탐색 엔진이 담당합니다 (curator.html).
 * 이 데모를 실제 엔진에 연결하려면 course()에서 POST /api/recommend 를 호출하면 됩니다.
 */

import { LANDMARKS } from './lib/places.js';

/** 출발지별 예시 동선. 키는 LANDMARKS의 label과 정확히 일치해야 한다. */
const DEMO_ROUTES = {
  '인천역 · 차이나타운': ['차이나타운 골목 산책', '신포시장 먹거리 구경', '개항장 거리'],
  '동인천역 · 개항로': ['개항로 골목 산책', '동인천 로컬 식당', '배다리 책방 거리'],
  '월미도': ['문화의 거리 산책', '바다 앞 식사', '월미도 바다 구경'],
  '송도 · 인천대입구역': ['센트럴파크 산책', '송도 식사 시간', '한옥마을 주변 구경'],
  '구월동 · 인천시청역': ['중앙공원 산책', '구월동 식사 시간', '로데오 거리'],
  '부평역': ['문화의 거리', '부평시장 먹거리 구경', '평리단길 산책'],
  '소래포구': ['소래포구 산책', '시장 먹거리 구경', '포구 전망 구경'],
  '인천공항 T1': ['터미널 실내 산책', '터미널 식사 시간', '실내 휴식']
};

/** 예시 동행자. 실제 주변인 조회가 아니라 화면 구성을 보여주기 위한 가상 인물. */
const DEMO_COMPANIONS = [
  ['민지 · 인천 로컬', '한식 좋아해요 · 2명 · 15:00까지'],
  ['준 · 인천 여행 중', '시장 먹거리 탐방 · 1명 · 16:00까지'],
  ['소라 · 인천 로컬', '밥 먹고 가볍게 산책 · 2명 · 17:00까지']
];

const DEMO_MOODS = [
  ['시장 한 바퀴', '신포시장 · 먹거리 구경과 가벼운 한 끼'],
  ['골목 식당 찾기', '개항로 · 산책하다 만나는 작은 식당'],
  ['커피 한 잔의 여유', '평리단길 · 개성 있는 카페 탐방']
];

const LIFE_TOPICS = [
  ['🚇 대중교통', '출발지와 목적지를 정하고 지도 앱에서 최신 시간표를 확인해줘. 이 데모는 실시간 도착 정보를 제공하지 않아.'],
  ['🪑 쉬어갈 곳', '공원 쉼터나 공공시설부터 찾아보자. 벤치 위치·이용 가능 여부는 아직 연결하지 않았어.'],
  ['🚻 화장실 찾기', '역사나 공공시설의 안내 표지를 확인해봐. 개방 여부와 이용시간은 현장에서 확인이 필요해.']
];

/** 예시 코스의 총 이동시간(분). 실제 계산이 아니라 눈대중용 상수. */
const DEMO_TRAVEL_MIN = 15;

const log = document.querySelector('#messages');
let chosen = LANDMARKS[0].label;

/* ------------------------------------------------------------ 말풍선 조립 */

/** 모든 텍스트는 textContent로만 넣는다. innerHTML은 쓰지 않는다. */
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

/* ------------------------------------------------------------ 대화 흐름 */

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

  action(bubble, '✦ 고민 끝! 코스 강제 배정', () => {
    chosen = place.select.value;
    const minutes = Number(time.select.value);

    message(`${chosen}에서 ${minutes}분! 코스 정해줘.`, true);
    renderDemoCourse(chosen, minutes);
    reveal();
  });

  reveal();
}

function renderDemoCourse(from, minutes) {
  const out = message('오늘은 이 순서로 가자. 고민은 여기서 끝!');
  const stops = DEMO_ROUTES[from] ?? DEMO_ROUTES[LANDMARKS[0].label];

  // 이동시간을 뺀 나머지를 세 곳에 고르게 나누고, 나머지는 마지막 장소가 흡수한다.
  const share = Math.floor((minutes - DEMO_TRAVEL_MIN) / stops.length);
  const lastShare = minutes - DEMO_TRAVEL_MIN - share * (stops.length - 1);

  stops.forEach((stop, index) => {
    const isLast = index === stops.length - 1;
    const stay = isLast ? lastShare : share;
    const leg = isLast ? '' : ` · 다음 이동 예시 ${index === 0 ? 7 : 8}분`;
    item(out, `${String(index + 1).padStart(2, '0')} · ${stop}`, `${stay}분 머무르기${leg}`);
  });

  note(out, `총 ${minutes}분 (이동 예시 ${DEMO_TRAVEL_MIN}분 포함). 시연용 동선이며 거리·영업시간·이동시간은 검증되지 않았어요.`);
  action(out, '마음에 들어 · 코스 담기', button => {
    button.textContent = '✓ 이번 대화에 담았어';
    button.disabled = true;
  });
}

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

function food() {
  const bubble = message('프랜차이즈 대신, 골목의 한 끼. 이런 분위기는 어때?');

  for (const [name, detail] of DEMO_MOODS) {
    const card = item(bubble, name, detail);
    action(card, '이 분위기로 이야기하기', () => {
      message(`${name} 느낌이 좋아!`, true);
      message('좋아! 강제 코스에서 출발 위치와 시간을 골라줘. 이 데모는 분위기 탐색용이라 실제 매장과 비체인 여부는 아직 연결하지 않았어.');
      reveal();
    });
  }

  note(bubble, '지역 탐색 예시 · 실제 매장 추천/체인 여부 검증 전');
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
  [/맛집|밥|음식|카페/, food],
  [/교통|화장실|벤치|버스|지하철/, life],
  [/코스|시간|추천/, course]
];

for (const button of document.querySelectorAll('[data-guide]')) {
  button.addEventListener('click', () => GUIDES[button.dataset.guide]?.());
}

document.querySelector('#reset').addEventListener('click', welcome);

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

  message('나는 지금 UI 데모 모드야. 자유로운 AI 답변은 아직 연결 전이지만, 위의 네 가지 가이드는 직접 눌러볼 수 있어. 먼저 강제 코스로 오늘 동선을 정해볼까?');
  reveal();
});

welcome();
