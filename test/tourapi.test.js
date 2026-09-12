import test from 'node:test';
import assert from 'node:assert/strict';

import { pickIntroFields, scoreCandidate, bestCandidate, normalizeName, toItems } from '../lib/tourapi.js';
import { PLACE_BY_ID } from '../lib/places.js';

const ART_PLATFORM = PLACE_BY_ID.get('art_platform'); // [37.4739, 126.6222]

test('contentTypeId마다 다른 이용시간 필드를 고른다', () => {
  // 관광지(12)
  assert.deepEqual(
    pickIntroFields({ usetime: '09:00~18:00', restdate: '매주 월요일' }, 12),
    { supported: true, usetime: '09:00~18:00', restdate: '매주 월요일' }
  );
  // 문화시설(14)은 필드 이름이 다르다 — 여기서 틀리면 조용히 undefined가 된다.
  assert.deepEqual(
    pickIntroFields({ usetimeculture: '10:00~18:00', restdateculture: '매주 월요일' }, 14),
    { supported: true, usetime: '10:00~18:00', restdate: '매주 월요일' }
  );
  // 음식점(39)
  assert.equal(pickIntroFields({ opentimefood: '11:00~21:00' }, 39).usetime, '11:00~21:00');
});

test('문화시설 응답에 관광지 필드명을 쓰면 값을 못 찾는다 (매핑이 필요한 이유)', () => {
  const cultureItem = { usetimeculture: '10:00~18:00' };
  assert.equal(pickIntroFields(cultureItem, 12).usetime, undefined);
  assert.equal(pickIntroFields(cultureItem, 14).usetime, '10:00~18:00');
});

test('시간 필드가 없는 타입은 supported: false', () => {
  assert.equal(pickIntroFields({}, 25).supported, false);  // 여행코스
  assert.equal(pickIntroFields({}, 999).supported, false); // 모르는 타입
});

test('좌표가 가까우면 같은 장소로 본다', () => {
  const result = scoreCandidate(ART_PLATFORM, {
    title: '인천아트플랫폼', mapy: '37.4740', mapx: '126.6220'
  });
  assert.equal(result.ok, true);
  assert.equal(result.nameMatches, true);
  assert.ok(result.distanceKm < 0.1);
});

test('이름이 같아도 좌표가 멀면 거절한다', () => {
  // 전국에 같은 이름이 여럿인 경우를 막는 방어선.
  const result = scoreCandidate(PLACE_BY_ID.get('jayu_park'), {
    title: '자유공원', mapy: '35.1000', mapx: '129.0000' // 부산 근처
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /떨어져/);
});

test('좌표가 없는 후보는 판정 불가', () => {
  const result = scoreCandidate(ART_PLATFORM, { title: '인천아트플랫폼' });
  assert.equal(result.ok, false);
  assert.equal(result.distanceKm, null);
});

test('좌표는 가깝지만 이름이 다르면 통과시키되 이유를 남긴다', () => {
  const result = scoreCandidate(ART_PLATFORM, {
    title: '인천아트플랫폼 공연장', mapy: '37.4741', mapx: '126.6225'
  });
  assert.equal(result.ok, true);
  assert.equal(result.nameMatches, false);
  assert.match(result.reason, /이름이 다름/);
});

test('후보 중 가장 가까운 것을 고른다', () => {
  const best = bestCandidate(ART_PLATFORM, [
    { title: '엉뚱한 곳', mapy: '37.5000', mapx: '126.7000' },
    { title: '인천아트플랫폼', mapy: '37.4739', mapx: '126.6222' }
  ]);
  assert.equal(best.candidate.title, '인천아트플랫폼');
  assert.equal(best.ok, true);
});

test('후보가 없으면 null', () => {
  assert.equal(bestCandidate(ART_PLATFORM, []), null);
  assert.equal(bestCandidate(ART_PLATFORM, undefined), null);
});

test('이름 정규화가 표기 차이를 흡수한다', () => {
  assert.equal(normalizeName('인천 아트플랫폼'), normalizeName('인천아트플랫폼'));
  assert.equal(normalizeName('자유공원 (인천)'), normalizeName('자유공원'));
  assert.equal(normalizeName('<b>차이나타운</b>'), '차이나타운');
});

test('items가 단일 객체여도 배열로 정규화한다', () => {
  assert.equal(toItems({ response: { body: { items: { item: { contentid: '1' } } } } }).length, 1);
  assert.equal(toItems({ response: { body: { items: { item: [{}, {}] } } } }).length, 2);
  assert.deepEqual(toItems({ response: { body: { items: '' } } }), []);
  assert.deepEqual(toItems(undefined), []);
});
