import test from 'node:test';
import assert from 'node:assert/strict';

import { rankPlaces, estimateTravelMin, openState, recommendLocally, buildCourses } from '../lib/recommend.js';
import { PLACE_BY_ID } from '../lib/places.js';
import handler from '../api/recommend.js';

const INCHEON_STN = [37.4766, 126.6167];
// 2026-09-12는 토요일. 한국시간 14:00.
const SAT_1400 = new Date('2026-09-12T05:00:00Z');
// 2026-09-14는 월요일(휴관일 확인용). 한국시간 14:00.
const MON_1400 = new Date('2026-09-14T05:00:00Z');

test('남은 시간 안에 왕복이 안 되는 곳은 후보에서 빠진다', () => {
  const short = rankPlaces({
    coord: INCHEON_STN, transport: 'transit', minutes: 60, purpose: 'walk', now: SAT_1400
  }, 20);
  for (const c of short) {
    assert.ok(c.travelMin + c.place.stayMin <= 60, `${c.place.name}이 60분 예산을 넘김`);
  }
  // 인천대공원은 최소 체류 50분 + 이동시간이라 1시간 안에는 불가능하다.
  assert.ok(!short.some(c => c.place.id === 'incheon_grand_park'));
});

test('도보는 반경 밖 장소를 아예 제외한다', () => {
  const far = estimateTravelMin(INCHEON_STN, PLACE_BY_ID.get('sorae_port').coord, 'walk');
  assert.equal(far, Infinity);

  const walkable = rankPlaces({
    coord: INCHEON_STN, transport: 'walk', minutes: 240, purpose: 'walk', now: SAT_1400
  }, 20);
  assert.ok(!walkable.some(c => c.place.id === 'sorae_port'));
  assert.ok(walkable.some(c => c.place.id === 'chinatown'));
});

test('휴관일에는 영업 상태가 closed로 계산된다', () => {
  const artPlatform = PLACE_BY_ID.get('art_platform');
  assert.equal(openState(artPlatform, 14 * 60, 1), 'closed'); // 월요일
  assert.equal(openState(artPlatform, 14 * 60, 6), 'open');   // 토요일
  assert.equal(openState(artPlatform, 17 * 60 + 45, 6), 'closing_soon');

  const monday = rankPlaces({
    coord: INCHEON_STN, transport: 'walk', minutes: 120, purpose: 'photo', now: MON_1400
  }, 20);
  assert.ok(!monday.some(c => c.place.id === 'art_platform'));
});

test('비가 오면 실내 장소가 위로 올라온다', () => {
  const input = { coord: INCHEON_STN, transport: 'transit', minutes: 120, purpose: 'photo', now: SAT_1400 };
  const dry = rankPlaces({ ...input, isRaining: false }, 3);
  const wet = rankPlaces({ ...input, isRaining: true }, 3);
  assert.ok(wet.filter(c => c.place.indoor).length >= dry.filter(c => c.place.indoor).length);
});

/* ------------------------------------------------------------------ 코스 */

test('코스 전체가 남은 시간 예산 안에 들어간다', () => {
  for (const minutes of [60, 90, 120, 240]) {
    const courses = buildCourses({
      coord: INCHEON_STN, transport: 'transit', minutes, purpose: 'photo', now: SAT_1400
    }, 3);
    assert.ok(courses.length > 0, `${minutes}분 코스가 나오지 않음`);

    for (const course of courses) {
      assert.ok(course.totalMin <= minutes, `${minutes}분 예산을 ${course.totalMin}분이 초과`);
      assert.ok(course.slackMin >= 0);
      // 같은 장소를 두 번 들르지 않는다.
      const ids = course.stops.map(s => s.place.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
});

test('두 번째 이후 장소도 도착 시각 기준으로 영업 상태를 본다', () => {
  // 한국시간 17:30 출발이면 18시 마감인 곳은 뒷 순서에 올 수 없다.
  const evening = new Date('2026-09-12T08:30:00Z');
  const courses = buildCourses({
    coord: INCHEON_STN, transport: 'walk', minutes: 180, purpose: 'photo', now: evening
  }, 3);

  for (const course of courses) {
    for (const stop of course.stops) {
      assert.notEqual(stop.state, 'closed');
      if (stop.place.hours) {
        const close = Number(stop.place.hours.close.split(':')[0]) * 60 + Number(stop.place.hours.close.split(':')[1]);
        assert.ok(stop.arrivalMin % 1440 < close, `${stop.place.name} 도착이 마감 이후`);
      }
    }
  }
});

test('시간이 늘어나면 코스가 길어진다', () => {
  const short = buildCourses({ coord: INCHEON_STN, transport: 'transit', minutes: 60, purpose: 'photo', now: SAT_1400 }, 1);
  const long = buildCourses({ coord: INCHEON_STN, transport: 'transit', minutes: 240, purpose: 'photo', now: SAT_1400 }, 1);
  assert.ok(long[0].stops.length > short[0].stops.length);
});

test('비가 오면 실내 장소만으로 코스를 짠다', () => {
  const input = { coord: INCHEON_STN, transport: 'transit', minutes: 120, purpose: 'photo', now: SAT_1400 };
  const wet = buildCourses({ ...input, isRaining: true }, 3);
  assert.ok(wet.length > 0);
  for (const course of wet) {
    assert.ok(course.stops.every(s => s.place.indoor), '비 오는 날 코스에 실외 장소가 섞임');
  }
});

test('대안 코스는 1코스가 서로 다르다', () => {
  const courses = buildCourses({
    coord: INCHEON_STN, transport: 'transit', minutes: 120, purpose: 'walk', now: SAT_1400
  }, 3);
  const firsts = courses.map(c => c.stops[0].place.id);
  assert.equal(new Set(firsts).size, firsts.length);
});

/* ------------------------------------------------------------------- API */

test('게이트웨이 키가 없으면 로컬 코스를 그대로 반환한다', async () => {
  const restore = stubNetwork();
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'local');
    assert.ok(res.body.course.stops.length >= 1);
    assert.ok(res.body.course.stops.every(s => PLACE_BY_ID.has(s.id)));
  } finally {
    restore();
  }
});

test('모델이 만들어내지 않은 코스 id를 돌려주면 폴백한다', async () => {
  const restore = stubModel({ courseId: 'starfield+anseong', note: '지어낸 코스' });
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.body.source, 'local');
    assert.notEqual(res.body.note, '지어낸 코스');
    assert.ok(res.body.course.stops.every(s => PLACE_BY_ID.has(s.id)));
  } finally {
    restore();
  }
});

test('모델이 고른 코스와 문구를 쓰되 동선은 서버 계산을 유지한다', async () => {
  const input = { coord: INCHEON_STN, transport: 'transit', minutes: 120, purpose: 'solo_meal', now: undefined };
  const generated = buildCourses(input, 3);
  const target = generated[1] ?? generated[0];

  const restore = stubModel({
    courseId: target.id,
    reasons: { [target.stops[0].place.id]: '지금 시간이면 줄이 짧아요.' },
    note: '여기부터 도는 게 나아요.'
  });
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 120, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.body.source, 'model');
    assert.equal(res.body.course.id, target.id);
    assert.equal(res.body.course.stops[0].reason, '지금 시간이면 줄이 짧아요.');
    assert.equal(res.body.note, '여기부터 도는 게 나아요.');
    // 모델은 문구만 바꿀 수 있다. 시간 계산은 서버 것이 그대로 남아야 한다.
    assert.equal(res.body.course.totalMin, target.totalMin);
    assert.ok(res.body.course.totalMin <= 120);
  } finally {
    restore();
  }
});

test('AI Gateway 요청이 문서화된 엔드포인트·헤더·모델로 나간다', async () => {
  const target = buildCourses({ coord: INCHEON_STN, transport: 'transit', minutes: 90, purpose: 'solo_meal' }, 1)[0];
  const seen = [];
  const restore = stubModel({ courseId: target.id }, seen);
  try {
    await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });

    const call = seen.find(c => !String(c.url).includes('open-meteo'));
    assert.ok(call, 'AI Gateway 호출이 발생하지 않음');
    assert.equal(call.url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(call.init.headers.Authorization, 'Bearer test-key');

    const body = JSON.parse(call.init.body);
    assert.equal(body.model, 'google/gemini-test');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].role, 'system');
    // 코스 후보가 프롬프트에 실제로 실려 나가야 모델이 그중에서 고를 수 있다.
    assert.match(body.messages[1].content, new RegExp(`코스 id=${target.id.replace(/\+/g, '\\+')}`));
  } finally {
    restore();
  }
});

test('OIDC 토큰만 있어도 호출한다 (Vercel 배포 기본 경로)', async () => {
  const seen = [];
  const restore = stubModel({ courseId: 'nope' }, seen, { useOidc: true });
  try {
    await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });
    const call = seen.find(c => !String(c.url).includes('open-meteo'));
    assert.ok(call, 'OIDC 토큰만으로는 호출하지 않음');
    assert.equal(call.init.headers.Authorization, 'Bearer oidc-token');
  } finally {
    restore();
  }
});

test('같은 IP가 분당 상한을 넘으면 429와 Retry-After를 준다', async () => {
  const { __test } = await import('../api/recommend.js');
  __test.resetRateLimit();
  try {
    const now = Date.now();
    let last;
    // 상한(20)까지는 통과해야 한다.
    for (let i = 0; i < 20; i++) last = __test.takeToken('1.2.3.4', now);
    assert.equal(last.allowed, true, '상한 이내인데 막혔다');

    const blocked = __test.takeToken('1.2.3.4', now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);

    // 다른 IP는 영향을 받지 않는다.
    assert.equal(__test.takeToken('5.6.7.8', now).allowed, true);

    // 윈도가 지나면 다시 열린다.
    assert.equal(__test.takeToken('1.2.3.4', now + 60_001).allowed, true);
  } finally {
    __test.resetRateLimit();
  }
});

test('레이트리밋에 걸리면 코스 계산도 모델 호출도 하지 않는다', async () => {
  const { __test } = await import('../api/recommend.js');
  __test.resetRateLimit();
  const seen = [];
  const restore = stubModel({ courseId: 'nope' }, seen);
  try {
    const req = { lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' };
    for (let i = 0; i < 20; i++) await invoke(req, { 'x-forwarded-for': '9.9.9.9' });

    const callsBefore = seen.length;
    const res = await invoke(req, { 'x-forwarded-for': '9.9.9.9' });

    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'rate_limited');
    assert.equal(seen.length, callsBefore, '429인데 외부 호출이 나갔다');
  } finally {
    restore();
    __test.resetRateLimit();
  }
});

test('서비스 범위 밖 좌표는 400', async () => {
  const res = await invoke({ lat: 35.1796, lng: 129.0756, minutes: 90 }); // 부산
  assert.equal(res.status, 400);
});

test('코스를 못 짜면 빈 결과와 안내 문구를 준다', () => {
  const none = recommendLocally({ coord: INCHEON_STN, transport: 'walk', minutes: 25, purpose: 'with_kids', now: SAT_1400 });
  assert.equal(none.course, null);
  assert.match(none.note, /코스가 없어요/);
});

/* ------------------------------------------------------------------ 헬퍼 */

async function invoke(body, headers = {}) {
  const req = { method: 'POST', body, headers };
  const captured = {};
  const res = {
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; }
  };
  await handler(req, res);
  return captured;
}

/** 날씨 호출만 가로채고 게이트웨이 키는 비워 둔다. */
function stubNetwork() {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;

  globalThis.fetch = async () => jsonResponse({ current: { precipitation: 0, weather_code: 0 } });

  return () => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  };
}

/** 모델과 날씨 호출을 모두 가로채서 네트워크 없이 테스트한다. */
function stubModel(payload, seen = [], { useOidc = false } = {}) {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  if (useOidc) {
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL_OIDC_TOKEN = 'oidc-token';
  } else {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
  }
  process.env.GEMINI_MODEL = 'google/gemini-test';

  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    if (String(url).includes('open-meteo')) {
      return jsonResponse({ current: { precipitation: 0, weather_code: 0 } });
    }
    return jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  };

  return () => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  };
}

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}
