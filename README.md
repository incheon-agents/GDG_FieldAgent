# 지금갈래? — Incheon Field Agent

> 인천에서는 갈 곳이 없어서가 아니라, 지금 내 시간과 동선에 맞는 곳을 고르기 어려웠습니다.
> `지금갈래?`는 현장 관찰과 실시간 조건을 바탕으로, 지금 출발할 코스를 짜주는 Agent입니다.

인천 토박이 지인한테 전화 걸어 "나 인천역 근처인데 코스 좀 짜줘" 하는 경험을 웹으로 옮긴 프로토타입입니다.

**핵심 질문** — "지금 이 자리에서 90분 안에 갈 수 있고, 내 상황에 맞는 인천의 장소는 어디지?"

## 두 개의 화면

| 경로 | 화면 | 무엇이 도는가 |
| --- | --- | --- |
| `/` (`index.html`) | **인천이니?** 챗봇 UI 데모 | 대화 흐름과 화면 구성 시연. 코스·인물·시간은 `chat.js`에 박힌 예시이며 실제 계산·매칭·예약이 아니다 |
| `/curator.html` | **지금갈래?** 코스 큐레이터 | 좌표 기반 코스 탐색 + 영업시간 판정 + 날씨 + Gemini. 아래 설명은 이쪽 이야기다 |

챗봇 데모를 실제 엔진에 연결하려면 `chat.js`의 `renderDemoCourse()`를 `POST /api/recommend` 호출로
바꾸면 됩니다. 지금은 두 화면이 `lib/places.js`의 출발지 목록만 공유합니다.

## 동작 방식

출력은 **한 곳이 아니라 코스**입니다. "차이나타운 들렀다가 자유공원 올라가서 개항로에서 커피"처럼
2~4곳을 순서대로 묶고, 각 구간의 이동시간과 도착 시각을 계산해 남은 시간 예산 안에 맞춥니다.

```
브라우저 (위치·시간·이동수단·목적·메모)
   │
   ├─ POST /api/recommend ──┐
   │                        │  1. 좌표로 구간별 이동시간 계산
   │                        │  2. "출발 → 1코스 → 이동 → 2코스 → …"를 전수 탐색해
   │                        │     시간 예산 안에 들어맞는 코스만 생성
   │                        │  3. 각 장소의 도착 시각 기준으로 영업 상태 확인
   │                        │  4. Open-Meteo로 현재 강수 확인 → 비 오면 실내만으로 탐색
   │                        │  5. 상위 3개 코스를 Gemini(Vercel AI Gateway)에 넘겨
   │                        │     "어느 코스를 고를지 + 뭐라고 설명할지"만 위임
   │                        │  6. 반환된 코스 id를 화이트리스트로 검증
   │                        └─ 실패/타임아웃/키 없음 → 4번까지의 결정론적 결과
   │
   └─ /api 자체가 없으면 (GitHub Pages) 같은 로직을 브라우저에서 실행
```

**코스를 모델이 만들게 하지 않습니다.** 코스 후보는 서버가 계산해서 고정하고, 모델은
그중 하나를 고르고 말로 설명하는 일만 합니다. 반환된 코스 id가 후보 밖이면 전부 버리고
결정론적 결과로 떨어집니다. 시간 계산은 어느 경로로 가든 서버 것이 그대로 남으므로,
존재하지 않는 장소나 시간이 안 맞는 동선이 화면에 나올 경로가 없습니다.

덕분에 네트워크가 끊긴 발표장에서도, API 키가 없어도 앱은 그대로 동작합니다.

**비가 오면 실외 장소를 점수로 미루지 않고 후보에서 제외합니다.** 점수 조정으로는 목적 태그가
맞는 실외 장소가 계속 살아남는데, 비 오는 날 언덕 위 공원을 추천하는 순간 제품에 대한 신뢰가
무너지기 때문입니다. 실내만으로 코스가 안 나오는 위치·시간대에서만 제약을 풉니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `index.html`, `chat.css`, `chat.js` | 챗봇 UI 데모 |
| `curator.html`, `styles.css`, `app.js` | 코스 큐레이터 화면 |
| `lib/places.js` | 장소 데이터 (좌표·목적 태그·체류시간·영업시간·실내 여부) |
| `lib/recommend.js` | 순수 로직: 이동시간 추정, 영업 상태, 코스 탐색. 브라우저와 서버가 **같은 코드**를 쓴다 |
| `api/recommend.js` | Vercel 서버리스 함수. 날씨 조회 + Gemini 호출 + 코스 id 검증 |
| `lib/hours.js` | TourAPI의 자연어 이용시간·휴무일 → `{open, close, closedDays}` 파서 |
| `lib/tourapi.js` | TourAPI 필드 매핑과 장소 매칭 판정 (순수 로직) |
| `scripts/sync-hours.mjs` | TourAPI 조회 → 현재 값과 비교한 리포트 생성 (자동 반영 안 함) |
| `test/*.test.js` | `node:test` 기반 테스트 (네트워크 없이 실행) |
| `.github/workflows/ci.yml` | PR마다 Node 20·22에서 테스트 실행 |

## 실행

테스트는 네트워크 없이 돌아갑니다. 날씨와 모델 호출은 전부 스텁으로 가로채므로
CI에서 외부 서비스 장애에 영향받지 않습니다.

```bash
# 프런트엔드만 (모델 없이 로컬 코스 계산으로 동작)
python3 -m http.server 8000
#   챗봇 데모      http://localhost:8000/
#   코스 큐레이터   http://localhost:8000/curator.html

# 서버리스 함수까지
cp .env.example .env.local   # 값 채우기
npx vercel dev

npm test
```

## Gemini 연결 (Vercel AI Gateway)

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway)의 OpenAI 호환 Chat Completions
엔드포인트로 Gemini를 호출합니다.

```
POST https://ai-gateway.vercel.sh/v1/chat/completions
Authorization: Bearer <AI_GATEWAY_API_KEY | VERCEL_OIDC_TOKEN>
{ "model": "google/gemini-3.8-flash", ... }
```

**Vercel에 배포하면 키 설정이 필요 없습니다.** 배포 시 `VERCEL_OIDC_TOKEN`이 자동 주입되고
`askGemini()`가 그걸 씁니다. 로컬 `vercel dev`나 다른 호스트에서만 `AI_GATEWAY_API_KEY`가
필요합니다. 모델은 `GEMINI_MODEL`로 바꿀 수 있고, 비우면 `google/gemini-3.8-flash`입니다.
이 작업은 추론 난이도가 낮고 응답 속도가 곧 체감 품질이라 flash 계열이면 충분합니다.

공식 SDK(`ai` + `@ai-sdk/openai-compatible`) 대신 `fetch`를 씁니다. 이 저장소는 의존성이
0개이고 여기서 필요한 건 문서화된 Chat Completions 한 번의 호출뿐이라, SDK가 주는
스트리밍·툴 콜·프로바이더 추상화가 하나도 쓰이지 않기 때문입니다. 그 중 하나가 필요해지는
시점에 갈아타면 됩니다.

키를 만들 때 **budget(예산 상한)을 함께 걸어 두세요.** 현재 `/api/recommend`에는 인증도
레이트리밋도 없어서, 엔드포인트를 아는 사람은 누구나 호출할 수 있습니다. 해커톤 데모
범위에서는 괜찮지만 공개 배포 전에는 호출 상한(IP별 제한, Vercel KV 카운터 등)이 필요합니다.

## 영업시간 데이터 (TourAPI)

코스 로직 전체가 `lib/places.js`의 `hours` 값을 신뢰하고 돕니다. 그런데 **네이버와 카카오는
영업시간을 아예 주지 않습니다** — 무료 여부 이전에 응답 필드에 없습니다.

- 네이버 지역검색: `title / link / category / description / telephone / address / roadAddress / mapx / mapy`
- 카카오 로컬(키워드 장소 검색): `id / place_name / category_name / category_group_* / phone / address_name / road_address_name / x / y / place_url / distance`

그래서 **한국관광공사 TourAPI**를 씁니다. 공공데이터포털에서 무료, 개발계정 일 1,000회,
`detailIntro`가 이용시간·휴무일을 제공하고 현재 데이터셋이 관광지/문화시설 위주라 커버리지가 맞습니다.

```bash
TOURAPI_KEY=... npm run sync:hours
TOURAPI_KEY=... node scripts/sync-hours.mjs --place art_platform   # 한 곳만
```

**이 스크립트는 `places.js`를 자동으로 고치지 않습니다.** `build/hours-report.json`과 콘솔 요약만
만들고, 반영은 사람이 확인한 뒤에 합니다. 틀린 영업시간은 사용자를 헛걸음시키는데 그게 이 제품이
해결하겠다고 한 바로 그 문제라서, 파서가 애매하다고 판단한 값은 채택하지 않고 경고로 남깁니다.

까다로운 지점 두 가지를 코드에서 다룹니다.

**필드 이름이 `contentTypeId`마다 다릅니다.** 관광지(12)는 `usetime`/`restdate`인데 문화시설(14)은
`usetimeculture`/`restdateculture`, 음식점(39)은 `opentimefood`입니다. 잘못 읽으면 조용히
`undefined`가 되므로 `lib/tourapi.js`의 `INTRO_FIELDS` 한 곳에 모아 두고 테스트로 고정했습니다.

**이름만으로 매칭하면 엉뚱한 곳이 붙습니다.** "자유공원"은 전국에 여럿입니다. 그래서 검색 결과의
좌표와 우리 좌표 거리를 1차 근거로 쓰고, 1.2km를 넘으면 매칭을 거절합니다.

> ⚠️ 인증키가 없어 **실제 TourAPI 응답으로는 아직 검증하지 못했습니다.** 필드 이름과 엔드포인트
> 버전(`KorService2`)은 문서 기준입니다. 처음 실행할 때는 `--place`로 한 곳만 돌려 응답 모양부터
> 확인하세요. `TOURAPI_BASE_URL`로 주소를 바꿀 수 있습니다.

## 알려진 한계

- **이동시간은 추정치입니다.** 직선거리 × 1.3에 이동수단별 평균 속도를 적용합니다
  (`lib/recommend.js`의 `estimateTravelMin`). 실제 경로 API로 교체할 수 있는 단일 지점으로 분리해 뒀습니다.
  코스가 길어질수록 구간마다 오차가 누적되므로, 실사용 전에 가장 먼저 교체해야 할 부분입니다.
- **코스 탐색은 전수 탐색입니다.** 장소 15곳 · 최대 4스톱이라 문제없지만, 데이터가 수백 곳으로
  늘면 `searchCourses()`의 탐색 전략부터 손봐야 합니다 (`SEARCH_POOL` 참고).
- **좌표는 대표 지점 근사값, 영업시간은 아직 데모용 기본값입니다.** 위 TourAPI 파이프라인은
  준비돼 있지만 키가 없어 아직 한 번도 돌리지 않았고, 커밋된 값은 여전히 손으로 넣은 추정치입니다.
- `/api/recommend`의 레이트리밋은 **서버리스 인스턴스 메모리** 기반이라 인스턴스가 늘면 각자
  따로 셉니다. 결정론적 상한이 필요하면 Vercel KV 같은 공유 저장소로 옮겨야 합니다. 실제
  비용 방어선은 AI Gateway 키의 budget 설정입니다.
- 현장 메모는 모델을 거칠 때만 추천에 반영됩니다. 로컬 폴백에서는 그 사실을 화면에 표시합니다.
- 사용자가 남긴 메모는 Vercel AI Gateway를 거쳐 Google로 전송됩니다. 공개 서비스로 전환한다면 고지가 필요합니다.
