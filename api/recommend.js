/**
 * POST /api/recommend — Vercel 서버리스 함수.
 *
 * 역할
 *  1) 결정론적 로직으로 "지금 갈 수 있는" 후보를 먼저 추린다.
 *  2) RunYourAI 라우터에 순위 결정과 문구 작성만 맡긴다. (장소 생성은 맡기지 않는다)
 *  3) 키가 없거나 호출이 실패하면 1)의 결과를 그대로 돌려준다.
 *
 * 장소를 모델이 만들어내게 하면 존재하지 않는 가게와 깨진 지도 링크가 나온다.
 * 후보 집합을 서버가 고정하고 id 화이트리스트로 검증하는 이유가 이것.
 */

import { rankPlaces, toPick, recommendLocally } from '../lib/recommend.js';
import { PURPOSES } from '../lib/places.js';

const ROUTER_TIMEOUT_MS = 4500;
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
  const candidates = rankPlaces({ ...input, isRaining }, 5);

  if (candidates.length === 0) {
    return res.status(200).json({ ...recommendLocally({ ...input, isRaining }), isRaining });
  }

  const routed = await routeWithRunYourAI({ input, candidates, isRaining });
  const result = routed ?? {
    source: 'local',
    picks: candidates.slice(0, 3).map(toPick),
    note: '남은 시간과 이동수단으로 갈 수 있는 곳만 추린 뒤, 지금 출발하기 좋은 순서로 골랐어요.'
  };

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...result, isRaining });
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

/* ---------------------------------------------------------------- 라우터 */

async function routeWithRunYourAI({ input, candidates, isRaining }) {
  const apiKey = process.env.RUNYOURAI_API_KEY;
  const baseUrl = process.env.RUNYOURAI_BASE_URL;
  const model = process.env.RUNYOURAI_MODEL;
  if (!apiKey || !baseUrl || !model) return null;

  const allowed = new Set(candidates.map(c => c.place.id));
  const body = {
    model,
    temperature: 0.7,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ input, candidates, isRaining }) }
    ]
  };

  try {
    const json = await fetchJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      timeoutMs: ROUTER_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    const content = json?.choices?.[0]?.message?.content;
    const parsed = parseJsonLoosely(content);
    if (!parsed) return null;

    const picks = buildPicks(parsed, candidates, allowed);
    if (picks.length === 0) return null;

    return { source: 'router', model, picks, note: cleanText(parsed.note, 180) || null };
  } catch (err) {
    console.error('[runyourai] routing failed:', err.message);
    return null;
  }
}

const SYSTEM_PROMPT = [
  '너는 인천에서 오래 산 사람이다. 친구가 "지금 인천인데 어디 가면 좋아?"라고 전화로 물어본 상황이다.',
  '',
  '규칙:',
  '- 반드시 주어진 후보 목록 안에서만 고른다. 목록에 없는 장소는 절대 언급하지 않는다.',
  '- 남은 시간, 이동시간, 영업 상태, 날씨, 친구가 남긴 현장 메모를 근거로 고른다.',
  '- 추천 이유는 한 문장. 관광 안내문이 아니라 아는 사람이 말해주듯 구체적으로 쓴다.',
  '  ("지금 비 오니까 지붕 있는 시장 쪽이 낫고" 처럼 현재 조건을 짚어준다)',
  '- 과장하거나 모르는 사실(메뉴, 가격, 대기시간)을 지어내지 않는다.',
  '',
  '반드시 아래 JSON만 출력한다:',
  '{"topId":"후보 id","altIds":["후보 id","후보 id"],"reasons":{"후보 id":"한 문장 이유"},"note":"전체 선택을 요약하는 한 문장"}'
].join('\n');

function buildUserPrompt({ input, candidates, isRaining }) {
  const purposeLabel = PURPOSES.find(p => p.id === input.purpose)?.label ?? input.purpose;
  const transportLabel = { walk: '도보', transit: '대중교통', car: '차량' }[input.transport];

  const lines = candidates.map(c => {
    const state = { open: '영업 중', closing_soon: '곧 마감', always: '상시 개방' }[c.state] ?? c.state;
    return `- id=${c.place.id} | ${c.place.name} (${c.place.type}) | ${transportLabel} ${c.travelMin}분 | ` +
      `권장 체류 ${c.place.stayIdeal}분 | ${state} | ${c.place.indoor ? '실내' : '실외'} | 기본설명: ${c.place.reason}`;
  });

  return [
    `상황: 남은 시간 ${input.minutes}분, 이동수단 ${transportLabel}, 목적 "${purposeLabel}", 현재 날씨 ${isRaining ? '비' : '비 안 옴'}`,
    input.note ? `친구가 남긴 현장 메모: "${input.note}"` : '현장 메모 없음',
    '',
    '후보:',
    ...lines
  ].join('\n');
}

/* ------------------------------------------------- 모델 출력 검증 */

function buildPicks(parsed, candidates, allowed) {
  const byId = new Map(candidates.map(c => [c.place.id, c]));
  const ids = [parsed.topId, ...(Array.isArray(parsed.altIds) ? parsed.altIds : [])]
    .filter(id => typeof id === 'string' && allowed.has(id));

  const unique = [...new Set(ids)].slice(0, 3);
  if (unique.length === 0) return [];

  // 모델이 후보를 덜 골랐으면 결정론적 순위로 채운다.
  for (const c of candidates) {
    if (unique.length >= 3) break;
    if (!unique.includes(c.place.id)) unique.push(c.place.id);
  }

  const reasons = parsed.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {};
  return unique.map(id => {
    const pick = toPick(byId.get(id));
    return { ...pick, reason: cleanText(reasons[id], 200) || pick.reason };
  });
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
