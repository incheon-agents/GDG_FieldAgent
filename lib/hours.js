/**
 * TourAPI(한국관광공사)의 자연어 이용시간·휴무일 문자열을
 * `lib/places.js`가 쓰는 `{ open, close, closedDays }` 구조로 바꾼다.
 *
 * TourAPI는 `detailIntro` 응답에서 이용시간을 정형 필드가 아니라 사람이 읽는 문장으로 준다.
 *   usetime  : "09:00~18:00", "하절기 09:00~19:00 / 동절기 09:00~18:00", "상시개방"
 *   restdate : "매주 월요일", "연중무휴", "매주 월요일(공휴일인 경우 다음날 휴관)"
 * 게다가 contentTypeId마다 필드 이름이 다르다(관광지 usetime / 문화시설 usetimeculture …).
 *
 * 그래서 이 파서는 **자동 반영용이 아니라 제안용**이다. 애매한 입력은 버리지 않고
 * `confidence: 'low'` 와 `warnings`를 달아서 돌려주고, 사람이 확인한 뒤 커밋하게 한다.
 * 틀린 영업시간은 사용자를 헛걸음시키므로, 조용히 추측하는 것보다 모른다고 하는 게 낫다.
 */

/** 0=일 … 6=토. Date#getDay(), places.js의 closedDays와 같은 규칙. */
const WEEKDAYS = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/** 시간 제한 없이 열려 있다는 뜻으로 자주 쓰이는 표현. */
const ALWAYS_OPEN = /상시\s*개방|연중\s*개방|24\s*시간|제한\s*없음|자유\s*관람/;

/** 쉬는 날이 없다는 뜻으로 자주 쓰이는 표현. */
const NEVER_CLOSED = /연중\s*무휴|휴무\s*없음|없음|연중\s*개방|상시\s*개방/;

/** 계절·요일별로 시간이 갈리는 문장. 하나로 접을 수 없으니 사람이 봐야 한다. */
const CONDITIONAL = /하절기|동절기|하계|동계|계절|평일|주말|토요일|일요일|공휴일|성수기|비수기/;

const HHMM = /(\d{1,2})\s*[:시]\s*(\d{2})?/g;
const RANGE = /(\d{1,2})\s*[:시]\s*(\d{2})?\s*[~\-–—]\s*(\d{1,2})\s*[:시]\s*(\d{2})?/;

/** TourAPI 문자열에는 <br>, &nbsp; 같은 마크업이 섞여 온다. */
export function clean(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = n => String(n).padStart(2, '0');

/**
 * 이용시간 문자열 → { open, close } | null(상시 개방)
 * 판단이 불가능하면 undefined를 돌려준다(= 모름, null과 구분된다).
 */
export function parseUseTime(raw) {
  const text = clean(raw);
  if (!text) return { value: undefined, warnings: ['이용시간 문자열이 비어 있음'] };
  if (ALWAYS_OPEN.test(text)) return { value: null, warnings: [] };

  const match = RANGE.exec(text);
  if (!match) return { value: undefined, warnings: [`시간 범위를 찾지 못함: "${text}"`] };

  const [, openH, openM = '00', closeH, closeM = '00'] = match;
  const open = Number(openH);
  const close = Number(closeH);
  if (open > 24 || close > 24) return { value: undefined, warnings: [`시각 범위를 벗어남: "${text}"`] };

  const warnings = [];
  if (CONDITIONAL.test(text)) warnings.push(`계절·요일별 시간이 섞여 있어 첫 번째만 사용함: "${text}"`);

  // 같은 문장에 시각이 여러 번 나오면 다른 조건의 시간이 섞였을 가능성이 높다.
  const times = text.match(HHMM) ?? [];
  if (times.length > 2 && warnings.length === 0) warnings.push(`시각이 ${times.length}개 발견됨: "${text}"`);

  if (close <= open) warnings.push(`마감이 개점보다 이르거나 같음(자정 넘김 가능): "${text}"`);

  return {
    value: { open: `${pad(open)}:${openM}`, close: `${pad(close)}:${closeM}` },
    warnings
  };
}

/** 휴무일 문자열 → { closedDays: number[] } */
export function parseRestDate(raw) {
  const text = clean(raw);
  if (!text) return { value: [], warnings: ['휴무일 문자열이 비어 있음'] };
  if (NEVER_CLOSED.test(text)) return { value: [], warnings: [] };

  const days = new Set();
  // "매주 월요일", "월·화 휴관", "월요일, 화요일" 등 요일 글자를 모두 걷는다.
  for (const [name, index] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`${name}\\s*요일|매주\\s*${name}|[·,/]\\s*${name}\\b`).test(text)) days.add(index);
  }

  const warnings = [];
  if (days.size === 0) warnings.push(`요일을 찾지 못함(명절·특정일만 있을 수 있음): "${text}"`);
  if (/공휴일|명절|설날|추석|1월\s*1일/.test(text)) {
    warnings.push(`요일 외 휴무 규칙이 있어 반영되지 않음: "${text}"`);
  }

  return { value: [...days].sort((a, b) => a - b), warnings };
}

/**
 * 한 장소의 이용시간·휴무일을 places.js의 `hours` 형태로 합친다.
 *
 * @returns {{ hours: object|null|undefined, confidence: 'high'|'low', warnings: string[] }}
 *   hours === null      → 상시 개방 (places.js에서도 null)
 *   hours === undefined → 판단 불가. 기존 값을 유지해야 한다.
 */
export function parseHours({ usetime, restdate } = {}) {
  const time = parseUseTime(usetime);
  const rest = parseRestDate(restdate);
  const warnings = [...time.warnings, ...rest.warnings];

  if (time.value === undefined) {
    return { hours: undefined, confidence: 'low', warnings };
  }

  if (time.value === null) {
    // 상시 개방인데 휴무일이 있으면 둘 중 하나가 틀렸다는 뜻이다.
    if (rest.value.length > 0) {
      return {
        hours: undefined,
        confidence: 'low',
        warnings: [...warnings, '상시 개방인데 휴무 요일이 지정돼 모순됨']
      };
    }
    return { hours: null, confidence: warnings.length ? 'low' : 'high', warnings };
  }

  return {
    hours: { ...time.value, closedDays: rest.value },
    confidence: warnings.length ? 'low' : 'high',
    warnings
  };
}
