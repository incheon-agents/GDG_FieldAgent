/**
 * POST /api/recommend — Vercel 서버리스 함수.
 *
 * 역할
 *  1) 결정론적 로직으로 "지금 갈 수 있는" 후보를 먼저 추린다.
 *  2) Vercel AI Gateway 경유 Gemini에 "어느 코스를 고를지 + 뭐라고 설명할지"만 맡긴다.
 *  3) 키가 없거나 호출이 실패하면 1)의 결과를 그대로 돌려준다.
 *
 * 장소를 모델이 만들어내게 하면 존재하지 않는 가게와 깨진 지도 링크가 나온다.
 * 후보 집합을 서버가 고정하고 id 화이트리스트로 검증하는 이유가 이것.
 */

import { buildCourses, toCoursePayload, describeCourse, recommendLocally } from '../lib/recommend.js';
import { PURPOSES } from '../lib/places.js';

const MODEL_TIMEOUT_MS = 4500;
const WEATHER_TIMEOUT_MS = 1500;
const MAX_NOTE_LEN = 160;
const PURPOSE_IDS = new Set(PURPOSES.map(p => p.id));
const TRANSPORTS = new Set(['walk', 'transit', 'car']);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let input;
  try {
    input = parseInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: 'invalid_input', detail: err.message });
  }

  const isRaining = await fetchIsRaining(input.coord);
  const courses = buildCourses({ ...input, isRaining }, 3);

  if (courses.length === 0) {
    return res.status(200).json({ ...recommendLocally({ ...input, isRaining }), isRaining });
  }

  const routed = await askGemini({ input, courses, isRaining });
  const result = routed ?? localResult(courses);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...result, isRaining });
}

function localResult(courses) {
  const [best, ...rest] = courses;
  return {
    source: 'local',
    course: toCoursePayload(best),
    otherCourses: rest.map(toCoursePayload),
    note: describeCourse(best)
  };
}

/* ---------------------------------------------------------------- 입력 */

function parseInput(body) {
  const raw = typeof body === 'string' ? JSON.parse(body) : (body ?? {});
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('lat/lng required');
  // 인천 광역 범위를 크게 벗어나면 이 데이터셋으로 답할 수 없다.
  if (lat < 36.8 || lat > 38.2 || lng < 126.0 || lng > 127.3) throw new Error('out_of_service_area');

  const minutes = Number(raw.minutes);
  if (!Number.isFinite(minutes) || minutes < 20 || minutes > 480) throw new Error('minutes out of range');

  const transport = TRANSPORTS.has(raw.transport) ? raw.transport : 'transit';
  const purpose = PURPOSE_IDS.has(raw.purpose) ? raw.purpose : 'walk';
  const note = typeof raw.note === 'string' ? raw.note.slice(0, MAX_NOTE_LEN).trim() : '';

  return { coord: [lat, lng], minutes, transport, purpose, note };
}

/* ---------------------------------------------------------------- 날씨 */

/** Open-Meteo는 키가 필요 없다. 실패하면 그냥 날씨를 모르는 상태로 진행. */
async function fetchIsRaining([lat, lng]) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=precipitation,weather_code&timezone=Asia%2FSeoul`;
  try {
    const json = await fetchJson(url, { timeoutMs: WEATHER_TIMEOUT_MS });
    const cur = json?.current ?? {};
    const code = Number(cur.weather_code);
    // WMO code 51~67(이슬비·비), 80~82(소나기), 95~99(뇌우)
    const rainyCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    return Number(cur.precipitation) > 0 || rainyCode;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ AI Gateway */

/**
 * Vercel AI Gateway의 OpenAI 호환 Chat Completions 엔드포인트로 Gemini를 호출한다.
 *
 * Vercel에 배포되면 `VERCEL_OIDC_TOKEN`이 자동으로 주입되므로 키를 따로 두지 않아도 되고,
 * 로컬이나 다른 호스트에서는 `AI_GATEWAY_API_KEY`를 쓴다. 둘 다 없으면 호출을 건너뛴다.
 *
 * 공식 SDK(`ai` + `@ai-sdk/openai-compatible`) 대신 fetch를 쓰는 이유는
 * 이 저장소가 의존성 0개이고, 여기서 쓰는 건 문서화된 Chat Completions 한 번의 호출뿐이라
 * SDK가 주는 이점(스트리밍, 툴 콜, 멀티 프로바이더 추상화)이 하나도 필요 없기 때문이다.
 * 스트리밍이나 툴 콜이 필요해지는 시점에 SDK로 갈아타면 된다.
 */
const GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1';
const DEFAULT_MODEL = 'google/gemini-3.8-flash';

async function askGemini({ input, courses, isRaining }) {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const body = {
    model,
    temperature: 0.7,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ input, courses, isRaining }) }
    ]
  };

  try {
    const json = await fetchJson(`${GATEWAY_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      timeoutMs: MODEL_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });

    const content = json?.choices?.[0]?.message?.content;
    const parsed = parseJsonLoosely(content);
    if (!parsed) return null;

    return applyModelChoice(parsed, courses, model);
  } catch (err) {
    console.error('[ai-gateway] gemini call failed:', err.message);
    return null;
  }
}

const SYSTEM_PROMPT = [
  '너는 인천에서 오래 산 사람이다. 친구가 전화로 "나 인천 놀러왔는데, 가볼 만한 데 코스 좀 짜줘"라고 물어본 상황이다.',
  '',
  '이미 시간·이동·영업시간 계산이 끝난 코스 후보 몇 개를 준다. 너는 그중 하나를 고르고 말로 설명하면 된다.',
  '',
  '규칙:',
  '- 반드시 주어진 코스 후보 중 하나를 courseId로 고른다. 코스를 새로 만들거나 장소를 바꾸지 않는다.',
  '- 목록에 없는 장소는 절대 언급하지 않는다.',
  '- 각 장소마다 한 문장씩, 왜 이 순서로 여기를 가는지 쓴다.',
  '  관광 안내문이 아니라 아는 사람이 말해주듯 현재 조건을 짚어준다.',
  '  ("지금 비 오니까 지붕 있는 쪽부터 돌고", "여긴 6시에 닫으니까 먼저 들르는 게 나아")',
  '- 친구가 남긴 현장 메모가 있으면 그걸 반영해서 고른다.',
  '- 모르는 사실(메뉴, 가격, 대기시간, 영업시간)을 지어내지 않는다.',
  '',
  '반드시 아래 JSON만 출력한다:',
  '{"courseId":"코스 id","reasons":{"장소 id":"한 문장"},"note":"이 코스를 왜 이렇게 짰는지 한 문장"}'
].join('\n');

const STATE_LABEL = { open: '영업 중', closing_soon: '곧 마감', always: '상시 개방' };
const TRANSPORT_LABEL = { walk: '도보', transit: '대중교통', car: '차량' };

function buildUserPrompt({ input, courses, isRaining }) {
  const purposeLabel = PURPOSES.find(p => p.id === input.purpose)?.label ?? input.purpose;
  const transportLabel = TRANSPORT_LABEL[input.transport];

  const blocks = courses.map(course => {
    const stops = course.stops.map((s, i) =>
      `  ${i + 1}. id=${s.place.id} | ${s.place.name} (${s.place.type}) | ` +
      `이동 ${s.travelMin}분 → ${formatClockFromStop(s)} 도착 | 체류 ${s.stayMin}분 | ` +
      `${STATE_LABEL[s.state] ?? s.state} | ${s.place.indoor ? '실내' : '실외'} | 기본설명: ${s.place.reason}`
    );
    return [`[코스 id=${course.id}] 총 ${course.totalMin}분, 여유 ${course.slackMin}분`, ...stops].join('\n');
  });

  return [
    `상황: 남은 시간 ${input.minutes}분, 이동수단 ${transportLabel}, 목적 "${purposeLabel}", 현재 날씨 ${isRaining ? '비' : '비 안 옴'}`,
    input.note ? `친구가 남긴 현장 메모: "${input.note}"` : '현장 메모 없음',
    '',
    '코스 후보:',
    ...blocks
  ].join('\n');
}

const formatClockFromStop = s => {
  const m = ((s.arrivalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/* ------------------------------------------------- 모델 출력 검증 */

/**
 * 모델은 "어떤 코스를 고를지"와 "뭐라고 설명할지"만 정한다.
 * 코스 자체는 서버가 만든 것 중에서만 나올 수 있으므로,
 * 존재하지 않는 장소나 시간이 안 맞는 동선이 응답에 섞일 여지가 없다.
 */
function applyModelChoice(parsed, courses, model) {
  const chosen = courses.find(c => c.id === parsed.courseId);
  if (!chosen) return null;

  const reasons = parsed.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {};
  const payload = toCoursePayload(chosen);
  payload.stops = payload.stops.map(stop => ({
    ...stop,
    reason: cleanText(reasons[stop.id], 200) || stop.reason
  }));

  return {
    source: 'model',
    model,
    course: payload,
    otherCourses: courses.filter(c => c.id !== chosen.id).map(toCoursePayload),
    note: cleanText(parsed.note, 180) || describeCourse(chosen)
  };
}

/** 모델이 만든 문자열은 제어문자를 걷어내고 길이를 제한한다. 렌더링은 textContent로 한다. */
function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** 코드펜스나 앞뒤 설명이 붙어 와도 첫 JSON 객체를 건져낸다. */
function parseJsonLoosely(content) {
  if (typeof content !== 'string') return null;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- 유틸 */

async function fetchJson(url, { timeoutMs, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 기본값은 동일 출처만 허용(헤더 없음).
 * GitHub Pages에서 Vercel 함수를 호출하는 전환 기간에만 ALLOWED_ORIGIN을 설정한다.
 */
function applyCors(req, res) {
  const allowList = (process.env.ALLOWED_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowList.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
