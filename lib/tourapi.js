/**
 * TourAPI(한국관광공사 국문 관광정보 서비스) 응답을 다루는 순수 로직.
 *
 * 네트워크 호출은 `scripts/sync-hours.mjs`가 하고, 여기에는 키 없이도
 * 테스트할 수 있는 부분만 둔다. 필드 매핑과 매칭 판정이 실제로 틀리기 쉬운 곳이다.
 *
 * ⚠️ 이 모듈은 공공데이터포털 문서를 근거로 작성했고, 인증키가 없어
 *    실제 응답으로는 아직 검증하지 못했습니다. 키를 받으면 sync 스크립트의
 *    리포트로 필드 이름부터 확인해야 합니다.
 */

import { haversineKm } from './recommend.js';

/** 인천광역시. areaBasedList / searchKeyword의 areaCode. */
export const INCHEON_AREA_CODE = 2;

/**
 * detailIntro는 contentTypeId마다 이용시간·휴무일 필드 이름이 다르다.
 * 이게 TourAPI를 쓸 때 가장 많이 틀리는 지점이라 한 곳에 모아 둔다.
 */
export const INTRO_FIELDS = {
  12: { usetime: 'usetime', restdate: 'restdate' },                    // 관광지
  14: { usetime: 'usetimeculture', restdate: 'restdateculture' },      // 문화시설
  15: { usetime: 'playtime', restdate: null },                         // 축제·공연·행사
  25: { usetime: null, restdate: null },                               // 여행코스 (시간 없음)
  28: { usetime: 'usetimeleports', restdate: 'restdateleports' },      // 레포츠
  32: { usetime: 'checkintime', restdate: null },                      // 숙박
  38: { usetime: 'opentime', restdate: 'restdateshopping' },           // 쇼핑
  39: { usetime: 'opentimefood', restdate: 'restdatefood' }            // 음식점
};

export const CONTENT_TYPE_LABEL = {
  12: '관광지', 14: '문화시설', 15: '행사', 25: '여행코스',
  28: '레포츠', 32: '숙박', 38: '쇼핑', 39: '음식점'
};

/**
 * detailIntro 응답 항목에서 이용시간·휴무일 원문을 꺼낸다.
 * 지원하지 않는 contentTypeId면 `supported: false`로 알려 준다.
 */
export function pickIntroFields(item, contentTypeId) {
  const map = INTRO_FIELDS[Number(contentTypeId)];
  if (!map) {
    return { supported: false, usetime: undefined, restdate: undefined };
  }
  return {
    supported: Boolean(map.usetime),
    usetime: map.usetime ? item?.[map.usetime] : undefined,
    restdate: map.restdate ? item?.[map.restdate] : undefined
  };
}

/** 이름이 같아도 다른 지점일 수 있으니, 이 거리보다 멀면 매칭을 의심한다. */
const MATCH_RADIUS_KM = 1.2;

/**
 * 검색 결과 후보가 우리 장소와 같은 곳인지 판정한다.
 *
 * 이름만 믿으면 "자유공원"처럼 전국에 여럿 있는 이름에서 엉뚱한 곳이 붙는다.
 * 좌표 거리를 1차 근거로 쓰고, 이름 일치는 보조로만 본다.
 */
export function scoreCandidate(place, candidate) {
  const lat = Number(candidate?.mapy);
  const lng = Number(candidate?.mapx);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, distanceKm: null, reason: '후보에 좌표가 없음' };
  }

  const distanceKm = haversineKm(place.coord, [lat, lng]);
  const nameMatches = normalizeName(candidate?.title ?? '') === normalizeName(place.name);

  if (distanceKm > MATCH_RADIUS_KM) {
    return {
      ok: false,
      distanceKm,
      reason: `좌표가 ${distanceKm.toFixed(2)}km 떨어져 있어 동일 장소로 보기 어려움`
    };
  }

  return {
    ok: true,
    distanceKm,
    nameMatches,
    reason: nameMatches ? '이름·좌표 모두 일치' : `좌표는 ${distanceKm.toFixed(2)}km로 가깝지만 이름이 다름`
  };
}

/** 공백·괄호·수식어 차이를 무시하고 이름을 비교하기 위한 정규화. */
export function normalizeName(name) {
  return String(name)
    .replace(/<[^>]*>/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/인천\s*(광역시)?/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 후보 목록에서 가장 가까운 것을 고른다. 없으면 null. */
export function bestCandidate(place, candidates) {
  const scored = (candidates ?? [])
    .map(candidate => ({ candidate, ...scoreCandidate(place, candidate) }))
    .filter(entry => entry.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return scored[0] ?? null;
}

/** TourAPI는 항목이 1개면 객체, 여러 개면 배열을 준다. 0개면 빈 문자열인 경우도 있다. */
export function toItems(body) {
  const item = body?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}
