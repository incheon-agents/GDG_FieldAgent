/**
 * 순수 추천 로직. 브라우저와 서버리스 함수가 같은 코드를 씁니다.
 *
 * 라우터(LLM) 호출이 실패하거나 키가 없을 때 이 결과가 그대로 노출되므로,
 * 여기서 나오는 결과만으로도 제품이 성립해야 합니다.
 */

import { PLACES, PLACE_BY_ID } from './places.js';

/** 이동수단별 유효 속도(km/h)와 고정 오버헤드(분). 대기·환승·주차를 포함한 체감값. */
const TRANSPORT = {
  walk:    { speedKmh: 4.5,  overheadMin: 0,  maxKm: 3 },
  transit: { speedKmh: 16,   overheadMin: 8,  maxKm: 40 },
  car:     { speedKmh: 24,   overheadMin: 6,  maxKm: 60 }
};

/** 직선거리를 실제 경로로 환산하는 보정 계수. */
const DETOUR = 1.3;

export function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 좌표 두 점 사이의 예상 이동시간(분). 외부 경로 API로 교체 가능한 지점. */
export function estimateTravelMin(from, to, transport) {
  const cfg = TRANSPORT[transport] ?? TRANSPORT.transit;
  const km = haversineKm(from, to) * DETOUR;
  if (km > cfg.maxKm) return Infinity;
  return Math.round((km / cfg.speedKmh) * 60 + cfg.overheadMin);
}

/** 서버가 UTC여도 한국 시간 기준으로 계산하기 위한 헬퍼. */
export function nowInSeoul(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value ?? '';
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get('hour')) % 24;
  return { day: days[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}

const toMin = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * 도착 시점 기준 영업 상태.
 * 'open' | 'closing_soon' | 'closed' | 'always'
 */
export function openState(place, arrivalMin, day) {
  if (!place.hours) return 'always';
  if (place.hours.closedDays?.includes(day)) return 'closed';
  const open = toMin(place.hours.open);
  const close = toMin(place.hours.close);
  if (arrivalMin < open || arrivalMin >= close) return 'closed';
  if (close - arrivalMin < place.stayMin) return 'closing_soon';
  return 'open';
}

/**
 * 후보를 점수 순으로 반환한다.
 *
 * @param {object} input
 * @param {[number,number]} input.coord   현재 위치
 * @param {string} input.transport        walk | transit | car
 * @param {number} input.minutes          남은 시간(분)
 * @param {string} input.purpose          PURPOSES의 id
 * @param {boolean} [input.isRaining]     날씨 API 결과 (없으면 무시)
 * @param {Date} [input.now]
 * @param {number} [limit]
 */
export function rankPlaces(input, limit = 5) {
  const { coord, transport, minutes, purpose, isRaining = false, now } = input;
  const { day, minutes: nowMin } = nowInSeoul(now);

  return PLACES.map(place => {
    const travelMin = estimateTravelMin(coord, place.coord, transport);
    const arrivalMin = nowMin + travelMin;
    const state = openState(place, arrivalMin % (24 * 60), day);
    const usable = minutes - travelMin;
    return { place, travelMin, arrivalMin, state, usable };
  })
    .filter(c => Number.isFinite(c.travelMin))
    // 도착해서 최소 체류시간도 못 채우면 후보가 아니다.
    .filter(c => c.usable >= c.place.stayMin)
    .filter(c => c.state !== 'closed')
    .map(c => ({ ...c, score: scoreCandidate(c, { purpose, isRaining }) }))
    .sort((a, b) => b.score - a.score || a.travelMin - b.travelMin || a.place.id.localeCompare(b.place.id))
    .slice(0, limit);
}

function scoreCandidate({ place, travelMin, usable, state }, { purpose, isRaining }) {
  let score = 0;

  // 목적 일치가 가장 강한 신호.
  if (place.purposes.includes(purpose)) score += 40;

  // 이동시간이 짧을수록 "지금 출발"에 가깝다.
  score += Math.max(0, 30 - travelMin * 0.8);

  // 권장 체류시간을 채울 수 있으면 가산, 지나치게 남으면 소폭 감점(시간이 붕 뜬다).
  const slack = usable - place.stayIdeal;
  score += slack >= 0 ? 15 - Math.min(10, slack / 12) : Math.max(-15, slack / 2);

  if (state === 'closing_soon') score -= 18;
  if (isRaining) score += place.indoor ? 18 : -12;
  if (purpose === 'rainy' && !place.indoor) score -= 25;

  return score;
}

/** 후보를 화면/응답용 형태로 변환. */
export function toPick(candidate) {
  const { place, travelMin, state, usable } = candidate;
  return {
    id: place.id,
    name: place.name,
    type: place.type,
    travelMin,
    stayMin: Math.min(usable, place.stayIdeal),
    openState: state,
    reason: place.reason,
    map: place.map
  };
}

/** 라우터 없이 동작하는 기본 추천. 폴백 경로이자 정답 기준선. */
export function recommendLocally(input) {
  const ranked = rankPlaces(input, 3);
  return {
    source: 'local',
    picks: ranked.map(toPick),
    note: ranked.length
      ? '남은 시간과 이동수단으로 갈 수 있는 곳만 추린 뒤, 지금 출발하기 좋은 순서로 골랐어요.'
      : '지금 조건으로는 갈 만한 곳을 찾지 못했어요. 시간을 늘리거나 이동수단을 바꿔보세요.'
  };
}

export { PLACE_BY_ID };
