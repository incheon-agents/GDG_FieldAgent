import test from 'node:test';
import assert from 'node:assert/strict';

import { rankPlaces, estimateTravelMin, openState, recommendLocally } from '../lib/recommend.js';
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

test('라우터 키가 없으면 로컬 결과를 그대로 반환한다', async () => {
  const restore = stubNetwork();
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'local');
    assert.equal(res.body.picks.length, 3);
  } finally {
    restore();
  }
});

test('라우터가 목록에 없는 id를 돌려주면 폴백한다', async () => {
  const restore = stubRouter({ topId: '스타필드 안성', altIds: ['없는곳'], note: '지어낸 답' });
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 90, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.body.source, 'local');
    assert.ok(res.body.picks.every(p => PLACE_BY_ID.has(p.id)));
  } finally {
    restore();
  }
});

test('라우터가 유효한 id를 돌려주면 그 순서와 문구를 쓴다', async () => {
  const restore = stubRouter({
    topId: 'gaehangro',
    altIds: ['sinpo_market'],
    reasons: { gaehangro: '지금 시간이면 줄이 짧아요.' },
    note: '개항로부터 시작하는 걸 추천해요.'
  });
  try {
    const res = await invoke({ lat: INCHEON_STN[0], lng: INCHEON_STN[1], minutes: 120, transport: 'transit', purpose: 'solo_meal' });
    assert.equal(res.body.source, 'router');
    assert.equal(res.body.picks[0].id, 'gaehangro');
    assert.equal(res.body.picks[0].reason, '지금 시간이면 줄이 짧아요.');
    assert.equal(res.body.picks.length, 3, '모델이 2곳만 골라도 결정론적 순위로 채운다');
  } finally {
    restore();
  }
});

test('서비스 범위 밖 좌표는 400', async () => {
  const res = await invoke({ lat: 35.1796, lng: 129.0756, minutes: 90 }); // 부산
  assert.equal(res.status, 400);
});

test('후보가 하나도 없으면 빈 결과와 안내 문구를 준다', () => {
  const none = recommendLocally({ coord: INCHEON_STN, transport: 'walk', minutes: 25, purpose: 'with_kids', now: SAT_1400 });
  assert.equal(none.picks.length, 0);
  assert.match(none.note, /찾지 못했어요/);
});

/* ------------------------------------------------------------------ 헬퍼 */

async function invoke(body) {
  const req = { method: 'POST', body, headers: {} };
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

/** 날씨 호출만 가로채고 라우터 키는 비워 둔다. */
function stubNetwork() {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  delete process.env.RUNYOURAI_API_KEY;

  globalThis.fetch = async () => jsonResponse({ current: { precipitation: 0, weather_code: 0 } });

  return () => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  };
}

/** 라우터와 날씨 호출을 모두 가로채서 네트워크 없이 테스트한다. */
function stubRouter(payload) {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  process.env.RUNYOURAI_API_KEY = 'test-key';
  process.env.RUNYOURAI_BASE_URL = 'https://example.invalid/v1';
  process.env.RUNYOURAI_MODEL = 'test-model';

  globalThis.fetch = async url => {
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
