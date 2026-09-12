#!/usr/bin/env node
/**
 * TourAPI에서 영업시간·휴무일을 받아 `lib/places.js`의 현재 값과 비교하는 도구.
 *
 *   TOURAPI_KEY=... node scripts/sync-hours.mjs
 *   TOURAPI_KEY=... node scripts/sync-hours.mjs --place art_platform
 *
 * **places.js를 자동으로 고치지 않습니다.** 제안과 경고가 담긴 리포트만 만들고,
 * 반영은 사람이 확인한 뒤에 직접 합니다. 틀린 영업시간은 사용자를 헛걸음시키는데,
 * 그게 이 제품이 해결하겠다고 한 바로 그 문제이기 때문입니다.
 *
 * 리포트: build/hours-report.json
 *
 * ⚠️ 인증키가 없어 실제 응답으로 검증하지 못한 코드입니다. 처음 실행할 때는
 *    --place 로 한 곳만 돌려 필드 이름과 응답 모양부터 확인하세요.
 *    공공데이터포털 개발계정은 일 1,000회 제한이 있습니다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PLACES } from '../lib/places.js';
import { parseHours } from '../lib/hours.js';
import {
  INCHEON_AREA_CODE, CONTENT_TYPE_LABEL,
  pickIntroFields, bestCandidate, toItems
} from '../lib/tourapi.js';

const BASE_URL = process.env.TOURAPI_BASE_URL ?? 'https://apis.data.go.kr/B551011/KorService2';
const KEY = process.env.TOURAPI_KEY;
const TIMEOUT_MS = 10_000;
/** 공공데이터포털은 초당 호출량을 제한한다. 순차 호출 사이에 쉬어 간다. */
const THROTTLE_MS = 350;
const REPORT_PATH = 'build/hours-report.json';

if (!KEY) {
  console.error('TOURAPI_KEY 가 필요합니다. https://data.go.kr 에서 "한국관광공사 국문 관광정보 서비스" 활용신청 후 발급받으세요.');
  process.exit(1);
}

const onlyPlaceId = argValue('--place');
const targets = onlyPlaceId ? PLACES.filter(p => p.id === onlyPlaceId) : PLACES;

if (targets.length === 0) {
  console.error(`--place ${onlyPlaceId} 에 해당하는 장소가 없습니다.`);
  process.exit(1);
}

const results = [];

for (const place of targets) {
  process.stderr.write(`· ${place.name} … `);
  try {
    results.push(await inspect(place));
    process.stderr.write('완료\n');
  } catch (err) {
    results.push({ id: place.id, name: place.name, status: 'error', error: err.message });
    process.stderr.write(`실패 (${err.message})\n`);
  }
  await sleep(THROTTLE_MS);
}

await writeReport(results);
printSummary(results);

/* ------------------------------------------------------------------ 조회 */

async function inspect(place) {
  const search = await call('searchKeyword2', {
    keyword: place.name,
    areaCode: INCHEON_AREA_CODE,
    numOfRows: 10
  });

  const match = bestCandidate(place, toItems(search));
  if (!match) {
    return { id: place.id, name: place.name, status: 'not_found', current: place.hours };
  }
  if (!match.ok) {
    return {
      id: place.id, name: place.name, status: 'match_rejected',
      reason: match.reason, candidate: match.candidate?.title, current: place.hours
    };
  }

  const contentId = match.candidate.contentid;
  const contentTypeId = Number(match.candidate.contenttypeid);

  const intro = await call('detailIntro2', { contentId, contentTypeId });
  const introItem = toItems(intro)[0];
  const fields = pickIntroFields(introItem, contentTypeId);

  if (!fields.supported) {
    return {
      id: place.id, name: place.name, status: 'unsupported_type',
      contentId, contentType: CONTENT_TYPE_LABEL[contentTypeId] ?? contentTypeId, current: place.hours
    };
  }

  const parsed = parseHours(fields);
  return {
    id: place.id,
    name: place.name,
    status: parsed.hours === undefined ? 'unparsed' : 'ok',
    contentId,
    contentType: CONTENT_TYPE_LABEL[contentTypeId] ?? contentTypeId,
    matchedTitle: match.candidate.title,
    distanceKm: Number(match.distanceKm.toFixed(3)),
    nameMatches: match.nameMatches,
    raw: { usetime: fields.usetime, restdate: fields.restdate },
    current: place.hours,
    suggested: parsed.hours,
    changed: JSON.stringify(parsed.hours) !== JSON.stringify(place.hours),
    confidence: parsed.confidence,
    warnings: parsed.warnings
  };
}

async function call(operation, params) {
  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/${operation}`);
  url.searchParams.set('serviceKey', KEY);
  url.searchParams.set('MobileOS', 'ETC');
  url.searchParams.set('MobileApp', 'jigeum-galrae');
  url.searchParams.set('_type', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);

    // 키가 잘못됐거나 트래픽을 초과하면 200에 XML 오류를 실어 보낸다.
    if (!text.trimStart().startsWith('{')) {
      throw new Error(`JSON이 아닌 응답 (키·트래픽 확인): ${text.slice(0, 160)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ 출력 */

async function writeReport(rows) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, results: rows }, null, 2)
  );
}

function printSummary(rows) {
  const byStatus = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  console.log('\n=== TourAPI 영업시간 조회 결과 ===');
  console.log(Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(' · '));
  console.log(`\n리포트: ${REPORT_PATH}\n`);

  const changes = rows.filter(r => r.status === 'ok' && r.changed);
  if (changes.length === 0) {
    console.log('places.js와 달라진 값이 없습니다.');
  } else {
    console.log('--- 현재 값과 다른 항목 (직접 확인 후 반영하세요) ---');
    for (const row of changes) {
      console.log(`\n[${row.name}] ${row.contentType} · ${row.distanceKm}km · confidence=${row.confidence}`);
      console.log(`  원문   usetime="${row.raw.usetime ?? ''}" restdate="${row.raw.restdate ?? ''}"`);
      console.log(`  현재   ${JSON.stringify(row.current)}`);
      console.log(`  제안   ${JSON.stringify(row.suggested)}`);
      for (const warning of row.warnings) console.log(`  ⚠ ${warning}`);
    }
  }

  const attention = rows.filter(r => ['not_found', 'match_rejected', 'unsupported_type', 'unparsed', 'error'].includes(r.status));
  if (attention.length > 0) {
    console.log('\n--- 자동 반영 불가 (수동 확인 필요) ---');
    for (const row of attention) {
      console.log(`  ${row.name}: ${row.status}${row.reason ? ` — ${row.reason}` : ''}${row.error ? ` — ${row.error}` : ''}`);
    }
  }

  console.log('\n※ 이 스크립트는 places.js를 수정하지 않습니다. 확인 후 직접 반영하세요.');
}

/* ------------------------------------------------------------------ 유틸 */

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
