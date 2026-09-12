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

/* ================================================================== 코스 */

/**
 * 코스 탐색.
 *
 * 한 곳을 고르는 순위 문제가 아니라, 남은 시간이라는 예산 안에
 * "출발 → 1코스 → 이동 → 2코스 → …"가 실제로 들어맞는 경로를 찾는 문제다.
 * 각 구간의 이동시간과 도착 시각을 누적해서 계산하므로,
 * 두 번째 장소가 도착 시점에 문을 닫는 코스는 애초에 만들어지지 않는다.
 */

/** 장소 수가 적어 전수 탐색으로 충분하다. 데이터가 커지면 여기부터 손봐야 한다. */
const SEARCH_POOL = 10;

export function buildCourses(input, limit = 3) {
  const { isRaining = false, purpose } = input;

  // 비가 오거나 "비 올 때"를 고른 경우, 실외 장소는 점수로 미루지 않고 아예 뺀다.
  // 점수 조정으로는 목적 태그가 맞는 실외 장소가 계속 살아남는데,
  // 비 오는 날 언덕 위 공원을 추천하는 순간 제품에 대한 신뢰가 무너진다.
  if (isRaining || purpose === 'rainy') {
    const indoorOnly = searchCourses(input, { indoorOnly: true }, limit);
    // 실내만으로 코스가 안 나오면(그런 위치·시간대가 있다) 제약을 푼다.
    if (indoorOnly.length > 0) return indoorOnly;
  }
  return searchCourses(input, { indoorOnly: false }, limit);
}

function searchCourses(input, { indoorOnly }, limit) {
  const { coord, transport, minutes, purpose, isRaining = false, now } = input;
  const { day, minutes: nowMin } = nowInSeoul(now);
  const maxStops = minutes >= 180 ? 4 : 3;

  // 첫 장소로든 두 번째 장소로든 갈 가능성이 있는 곳만 후보 풀에 넣는다.
  // 실내로 좁힐 때는 상위 10곳 안에 실내가 몇 곳 없을 수 있으니 풀 전체에서 고른다.
  const pool = rankPlaces({ ...input, isRaining }, indoorOnly ? Infinity : SEARCH_POOL)
    .map(c => c.place)
    .filter(p => !indoorOnly || p.indoor);
  const courses = [];

  const walk = (stops, cursor, elapsed) => {
    if (stops.length > 0) courses.push(finishCourse(stops, elapsed, { minutes, purpose, isRaining }));
    if (stops.length >= maxStops) return;

    for (const place of pool) {
      if (stops.some(s => s.place.id === place.id)) continue;

      const travelMin = estimateTravelMin(cursor, place.coord, transport);
      if (!Number.isFinite(travelMin)) continue;

      const arrivalTotal = elapsed + travelMin;
      const spent = arrivalTotal + place.stayMin;
      if (spent > minutes) continue;

      const state = openState(place, (nowMin + arrivalTotal) % (24 * 60), day);
      if (state === 'closed') continue;

      walk([...stops, { place, travelMin, arrivalMin: nowMin + arrivalTotal, state }], place.coord, spent);
    }
  };

  walk([], coord, 0);

  courses.sort((a, b) => b.score - a.score || a.totalMin - b.totalMin || a.id.localeCompare(b.id));
  return pickDistinct(courses, limit);
}

function finishCourse(stops, elapsed, { minutes, purpose, isRaining }) {
  const slack = minutes - elapsed;
  const withStay = allocateStay(stops, slack);
  const totalMin = withStay.reduce((sum, s) => sum + s.travelMin + s.stayMin, 0);

  return {
    id: stops.map(s => s.place.id).join('+'),
    stops: withStay,
    totalMin,
    slackMin: minutes - totalMin,
    score: scoreCourse(withStay, minutes - elapsed, { purpose, isRaining })
  };
}

/** 남는 시간을 권장 체류시간 비율대로 각 장소에 나눠 준다. */
function allocateStay(stops, slack) {
  const want = stops.map(s => Math.max(0, s.place.stayIdeal - s.place.stayMin));
  const total = want.reduce((a, b) => a + b, 0);
  let left = Math.max(0, slack);

  return stops.map((s, i) => {
    const share = total === 0 ? 0 : Math.min(want[i], Math.round((want[i] / total) * Math.min(left, total)));
    left -= share;
    return { ...s, stayMin: s.place.stayMin + share };
  });
}

function scoreCourse(stops, slack, { purpose, isRaining }) {
  let score = 0;

  for (const { place, state } of stops) {
    if (place.purposes.includes(purpose)) score += 35;
    if (isRaining) score += place.indoor ? 15 : -20;
    if (purpose === 'rainy' && !place.indoor) score -= 25;
    if (state === 'closing_soon') score -= 15;
  }

  // 이동에 시간을 쓰는 만큼 코스의 밀도가 떨어진다.
  score -= stops.reduce((sum, s) => sum + s.travelMin, 0) * 0.7;

  // 시간이 20분 넘게 붕 뜨면 "코스를 짜줬다"고 하기 어렵다.
  score -= Math.max(0, slack - 20) * 0.5;

  // 성격이 다른 곳이 이어질 때 코스가 코스다워진다.
  score += (new Set(stops.map(s => s.place.type)).size - 1) * 8;
  score += (stops.length - 1) * 10;

  return score;
}

/** 1코스가 겹치거나 구성이 같은 코스는 대안으로서 의미가 없다. */
function pickDistinct(courses, limit) {
  const chosen = [];
  const seenFirst = new Set();
  const seenSet = new Set();

  for (const course of courses) {
    const first = course.stops[0].place.id;
    const key = course.stops.map(s => s.place.id).sort().join('|');
    if (seenFirst.has(first) || seenSet.has(key)) continue;
    seenFirst.add(first);
    seenSet.add(key);
    chosen.push(course);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

/** 코스를 응답/화면용 형태로 변환. */
export function toCoursePayload(course) {
  return {
    id: course.id,
    totalMin: course.totalMin,
    slackMin: course.slackMin,
    stops: course.stops.map(({ place, travelMin, stayMin, arrivalMin, state }) => ({
      id: place.id,
      name: place.name,
      type: place.type,
      travelMin,
      stayMin,
      arrivalAt: formatClock(arrivalMin),
      openState: state,
      reason: place.reason,
      map: place.map
    }))
  };
}

export function formatClock(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 라우터 없이 동작하는 기본 추천. 폴백 경로이자 정답 기준선. */
export function recommendLocally(input) {
  const courses = buildCourses(input, 3);
  if (courses.length === 0) {
    return {
      source: 'local',
      course: null,
      otherCourses: [],
      note: '지금 조건으로는 짤 수 있는 코스가 없어요. 시간을 늘리거나 이동수단을 바꿔보세요.'
    };
  }

  const [best, ...rest] = courses;
  return {
    source: 'local',
    course: toCoursePayload(best),
    otherCourses: rest.map(toCoursePayload),
    note: describeCourse(best)
  };
}

export function describeCourse(course) {
  const names = course.stops.map(s => s.place.name).join(' → ');
  return `${names} 순서로 돌면 ${course.totalMin}분쯤 걸려요.`;
}

export { PLACE_BY_ID };
