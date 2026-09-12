import test from 'node:test';
import assert from 'node:assert/strict';

import { clean, parseUseTime, parseRestDate, parseHours } from '../lib/hours.js';

/*
 * 입력 예시는 TourAPI detailIntro 응답에서 실제로 관찰되는 형태를 본떴습니다.
 * 키가 없어 실제 응답으로는 아직 검증하지 못했으므로, 키를 받으면
 * scripts/sync-hours.mjs의 리포트로 이 픽스처를 먼저 갱신해야 합니다.
 */

test('마크업과 엔티티를 걷어낸다', () => {
  assert.equal(clean('09:00~18:00<br>연중무휴'), '09:00~18:00 연중무휴');
  assert.equal(clean('10:00&nbsp;~&nbsp;19:00'), '10:00 ~ 19:00');
  assert.equal(clean(null), '');
});

test('단순한 시간 범위를 파싱한다', () => {
  assert.deepEqual(parseUseTime('09:00~18:00').value, { open: '09:00', close: '18:00' });
  assert.deepEqual(parseUseTime('10:00 ~ 19:00').value, { open: '10:00', close: '19:00' });
  assert.deepEqual(parseUseTime('9시~18시').value, { open: '09:00', close: '18:00' });
});

test('상시 개방은 hours 없음(null)으로 본다', () => {
  assert.equal(parseUseTime('상시개방').value, null);
  assert.equal(parseUseTime('24시간').value, null);
  assert.equal(parseUseTime('연중 개방').value, null);
});

test('계절별로 갈리는 시간은 경고를 남긴다', () => {
  const result = parseUseTime('하절기 09:00~19:00 / 동절기 09:00~18:00');
  assert.deepEqual(result.value, { open: '09:00', close: '19:00' });
  assert.ok(result.warnings.some(w => w.includes('계절')), '계절 경고가 없음');
});

test('시간을 못 찾으면 undefined — 기존 값을 유지하라는 뜻', () => {
  assert.equal(parseUseTime('문의 요망').value, undefined);
  assert.equal(parseUseTime('').value, undefined);
  assert.ok(parseUseTime('문의 요망').warnings.length > 0);
});

test('휴무 요일을 뽑는다', () => {
  assert.deepEqual(parseRestDate('매주 월요일').value, [1]);
  assert.deepEqual(parseRestDate('매주 월요일 휴관').value, [1]);
  assert.deepEqual(parseRestDate('월요일, 화요일 휴관').value, [1, 2]);
  assert.deepEqual(parseRestDate('연중무휴').value, []);
});

test('요일 외 휴무 규칙은 반영하지 않되 경고로 남긴다', () => {
  const result = parseRestDate('매주 월요일, 1월 1일, 설날 및 추석 당일');
  assert.deepEqual(result.value, [1]);
  assert.ok(result.warnings.some(w => w.includes('요일 외')), '명절 휴무 경고가 없음');
});

test('시간과 휴무일을 places.js 형태로 합친다', () => {
  const result = parseHours({ usetime: '09:00~18:00', restdate: '매주 월요일' });
  assert.deepEqual(result.hours, { open: '09:00', close: '18:00', closedDays: [1] });
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.warnings, []);
});

test('상시 개방은 hours: null 로 합쳐진다', () => {
  const result = parseHours({ usetime: '상시개방', restdate: '연중무휴' });
  assert.equal(result.hours, null);
  assert.equal(result.confidence, 'high');
});

test('상시 개방인데 휴무 요일이 있으면 판단을 보류한다', () => {
  const result = parseHours({ usetime: '상시개방', restdate: '매주 월요일' });
  assert.equal(result.hours, undefined, '모순된 입력을 그대로 채택하면 안 된다');
  assert.equal(result.confidence, 'low');
});

test('애매한 입력은 confidence low 로 표시된다', () => {
  const result = parseHours({ usetime: '하절기 09:00~19:00 / 동절기 09:00~18:00', restdate: '매주 월요일' });
  assert.equal(result.confidence, 'low');
  assert.ok(result.warnings.length > 0);
});

test('파싱 결과는 openState가 바로 쓸 수 있는 모양이다', async () => {
  const { openState } = await import('../lib/recommend.js');
  const { hours } = parseHours({ usetime: '09:00~18:00', restdate: '매주 월요일' });
  const place = { hours, stayMin: 30 };

  assert.equal(openState(place, 14 * 60, 1), 'closed');  // 월요일
  assert.equal(openState(place, 14 * 60, 6), 'open');    // 토요일
  assert.equal(openState(place, 17 * 60 + 45, 6), 'closing_soon');
});
