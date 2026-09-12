/**
 * 인천 큐레이션 데이터.
 *
 * 주의: 좌표는 대표 지점 근사값, 영업시간은 데모용 기본값입니다.
 * 실제 서비스 전에 현장 확인 또는 공공데이터로 교체해야 합니다.
 *
 * 필드 정의
 *  - coord      : [위도, 경도]
 *  - purposes   : 이 장소가 어울리는 목적 태그 (PURPOSES 참고)
 *  - stayMin    : 최소 체류시간(분). 이보다 짧으면 갈 이유가 없는 곳.
 *  - stayIdeal  : 권장 체류시간(분). 시간 여유 점수 계산 기준.
 *  - indoor     : 비/더위를 피할 수 있는가
 *  - hours      : null이면 상시 개방. { open, close, closedDays } (closedDays: 0=일 ~ 6=토)
 *  - reason     : 라우터 호출 실패 시 사용하는 기본 추천 문구
 */

export const PURPOSES = [
  { id: 'solo_meal', label: '혼밥', emoji: '🍜' },
  { id: 'photo',     label: '사진 남기기', emoji: '📷' },
  { id: 'quiet_cafe',label: '조용한 카페', emoji: '☕' },
  { id: 'with_kids', label: '아이와 함께', emoji: '🧒' },
  { id: 'rainy',     label: '비 올 때', emoji: '🌧' },
  { id: 'walk',      label: '가볍게 걷기', emoji: '🚶' }
];

/** 현재 위치를 잡지 못했을 때 고르는 기준점. */
export const LANDMARKS = [
  { id: 'incheon_stn',  label: '인천역 · 차이나타운', coord: [37.4766, 126.6167] },
  { id: 'dongincheon',  label: '동인천역 · 개항로',   coord: [37.4735, 126.6320] },
  { id: 'wolmido',      label: '월미도',             coord: [37.4757, 126.5977] },
  { id: 'songdo',       label: '송도 · 인천대입구역', coord: [37.3861, 126.6396] },
  { id: 'guwol',        label: '구월동 · 인천시청역', coord: [37.4570, 126.7018] },
  { id: 'bupyeong',     label: '부평역',             coord: [37.4894, 126.7238] },
  { id: 'sorae',        label: '소래포구',           coord: [37.3985, 126.7337] },
  { id: 'airport_t1',   label: '인천공항 T1',        coord: [37.4491, 126.4510] }
];

export const PLACES = [
  {
    id: 'sinpo_market',
    name: '신포국제시장',
    type: 'MARKET FOOD',
    coord: [37.4696, 126.6263],
    purposes: ['solo_meal', 'walk'],
    stayMin: 30, stayIdeal: 50,
    indoor: false,
    hours: { open: '10:00', close: '20:00', closedDays: [] },
    reason: '혼자 들어가도 어색하지 않은 가게가 모여 있어, 짧은 시간에 인천다운 한 끼를 고르기 가장 좋아요.',
    map: 'https://map.naver.com/p/search/신포국제시장'
  },
  {
    id: 'chinatown',
    name: '인천 차이나타운',
    type: 'LOCAL CLASSIC',
    coord: [37.4757, 126.6178],
    purposes: ['solo_meal', 'photo', 'walk', 'with_kids'],
    stayMin: 40, stayIdeal: 70,
    indoor: false,
    hours: { open: '10:00', close: '21:00', closedDays: [] },
    reason: '골목을 걷고 한 끼까지 해결할 수 있는, 인천역에서 바로 시작하기 좋은 클래식 코스예요.',
    map: 'https://map.naver.com/p/search/인천 차이나타운'
  },
  {
    id: 'donghwa_village',
    name: '송월동 동화마을',
    type: 'COLOR ALLEY',
    coord: [37.4779, 126.6155],
    purposes: ['photo', 'with_kids', 'walk'],
    stayMin: 25, stayIdeal: 40,
    indoor: false,
    hours: null,
    reason: '벽화 골목이 짧고 촘촘해서, 시간이 애매할 때 아이와 함께 사진만 찍고 나오기 좋아요.',
    map: 'https://map.naver.com/p/search/송월동 동화마을'
  },
  {
    id: 'art_platform',
    name: '인천아트플랫폼',
    type: 'PHOTO SPOT',
    coord: [37.4739, 126.6222],
    purposes: ['photo', 'quiet_cafe', 'rainy', 'walk'],
    stayMin: 30, stayIdeal: 55,
    indoor: true,
    hours: { open: '11:00', close: '18:00', closedDays: [1] },
    reason: '낡은 창고와 벽돌 건물 사이로 인천의 시간감이 남아 있어, 짧게 다녀와도 사진이 남아요.',
    map: 'https://map.naver.com/p/search/인천아트플랫폼'
  },
  {
    id: 'jayu_park',
    name: '자유공원',
    type: 'CITY VIEW',
    coord: [37.4739, 126.6250],
    purposes: ['photo', 'walk'],
    stayMin: 25, stayIdeal: 45,
    indoor: false,
    hours: null,
    reason: '언덕 위에서 내려다보는 항구와 오래된 도시 풍경이 지금의 인천을 한 장면으로 보여줘요.',
    map: 'https://map.naver.com/p/search/인천 자유공원'
  },
  {
    id: 'gaehangro',
    name: '개항로',
    type: 'LOCAL STREET',
    coord: [37.4721, 126.6300],
    purposes: ['solo_meal', 'quiet_cafe', 'photo', 'walk'],
    stayMin: 30, stayIdeal: 60,
    indoor: false,
    hours: { open: '11:00', close: '22:00', closedDays: [] },
    reason: '오래된 거리의 가게와 새로 생긴 식당·카페가 한 블록 안에 섞여 있어요.',
    map: 'https://map.naver.com/p/search/인천 개항로'
  },
  {
    id: 'gaehangjang',
    name: '개항장 거리',
    type: 'HERITAGE WALK',
    coord: [37.4740, 126.6210],
    purposes: ['photo', 'walk'],
    stayMin: 30, stayIdeal: 55,
    indoor: false,
    hours: null,
    reason: '한 블록마다 다른 시대의 건축물이 이어져서, 걷는 것 자체가 코스가 되는 구간이에요.',
    map: 'https://map.naver.com/p/search/인천 개항장'
  },
  {
    id: 'baedari',
    name: '배다리 헌책방거리',
    type: 'OLD BOOKS',
    coord: [37.4737, 126.6383],
    purposes: ['quiet_cafe', 'rainy', 'photo', 'walk'],
    stayMin: 25, stayIdeal: 45,
    indoor: true,
    hours: { open: '11:00', close: '19:00', closedDays: [1] },
    reason: '비가 오거나 조용히 시간을 보내고 싶을 때, 책방 몇 곳만 들러도 한 시간이 채워져요.',
    map: 'https://map.naver.com/p/search/배다리 헌책방거리'
  },
  {
    id: 'wolmi_street',
    name: '월미문화의거리',
    type: 'SEA WALK',
    coord: [37.4750, 126.5970],
    purposes: ['walk', 'photo', 'with_kids'],
    stayMin: 40, stayIdeal: 70,
    indoor: false,
    hours: null,
    reason: '바다 바람을 맞으며 걷고 싶다면, 조금 더 이동해도 후회 없는 선택이에요.',
    map: 'https://map.naver.com/p/search/월미문화의거리'
  },
  {
    id: 'immigration_museum',
    name: '한국이민사박물관',
    type: 'INDOOR MUSEUM',
    coord: [37.4713, 126.5926],
    purposes: ['rainy', 'with_kids'],
    stayMin: 40, stayIdeal: 60,
    indoor: true,
    hours: { open: '09:00', close: '18:00', closedDays: [1] },
    reason: '월미도 끝자락의 실내 코스라, 비가 오거나 아이와 함께일 때 동선이 무너지지 않아요.',
    map: 'https://map.naver.com/p/search/한국이민사박물관'
  },
  {
    id: 'songdo_central_park',
    name: '송도 센트럴파크',
    type: 'WATER PARK',
    coord: [37.3925, 126.6390],
    purposes: ['walk', 'photo', 'with_kids'],
    stayMin: 40, stayIdeal: 75,
    indoor: false,
    hours: null,
    reason: '수로를 따라 평평한 길이 이어져서, 아이와 함께여도 속도를 맞추기 쉬운 산책 코스예요.',
    map: 'https://map.naver.com/p/search/송도 센트럴파크'
  },
  {
    id: 'tri_bowl',
    name: '트라이보울',
    type: 'ART HALL',
    coord: [37.3893, 126.6446],
    purposes: ['photo', 'rainy', 'quiet_cafe'],
    stayMin: 25, stayIdeal: 45,
    indoor: true,
    hours: { open: '10:00', close: '18:00', closedDays: [1] },
    reason: '센트럴파크 바로 옆 실내 전시 공간이라, 비가 오면 산책 코스를 그대로 대체할 수 있어요.',
    map: 'https://map.naver.com/p/search/인천 트라이보울'
  },
  {
    id: 'sorae_port',
    name: '소래포구 종합어시장',
    type: 'SEA MARKET',
    coord: [37.4009, 126.7375],
    purposes: ['solo_meal', 'photo', 'with_kids'],
    stayMin: 45, stayIdeal: 80,
    indoor: true,
    hours: { open: '08:00', close: '21:00', closedDays: [] },
    reason: '시장 안쪽은 지붕이 있어 날씨를 덜 타고, 회 한 접시로 한 끼가 바로 해결돼요.',
    map: 'https://map.naver.com/p/search/소래포구 종합어시장'
  },
  {
    id: 'incheon_grand_park',
    name: '인천대공원',
    type: 'BIG GREEN',
    coord: [37.4472, 126.7418],
    purposes: ['walk', 'with_kids', 'photo'],
    stayMin: 50, stayIdeal: 90,
    indoor: false,
    hours: null,
    reason: '시간이 넉넉할 때 아이를 풀어놓기 좋은 넓은 공원이에요. 짧게 들르기엔 아까운 곳이고요.',
    map: 'https://map.naver.com/p/search/인천대공원'
  },
  {
    id: 'bupyeong_street',
    name: '부평 문화의거리',
    type: 'CITY STREET',
    coord: [37.4934, 126.7229],
    purposes: ['solo_meal', 'quiet_cafe', 'rainy', 'walk'],
    stayMin: 30, stayIdeal: 55,
    indoor: false,
    hours: { open: '11:00', close: '22:00', closedDays: [] },
    reason: '지하상가와 바로 이어져서 비가 와도 동선이 끊기지 않고, 혼자 먹을 곳도 많아요.',
    map: 'https://map.naver.com/p/search/부평 문화의거리'
  }
];

export const PLACE_BY_ID = new Map(PLACES.map(p => [p.id, p]));
