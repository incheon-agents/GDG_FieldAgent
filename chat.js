import { LANDMARKS } from './lib/places.js';
const log = document.querySelector('#messages');
let chosen = LANDMARKS[0].label;
function message(text, user = false) {
  const row = document.createElement('div'); row.className = `message${user ? ' user' : ''}`;
  if (!user) { const a = document.createElement('span'); a.className = 'avatar'; a.textContent = '✳'; row.append(a); }
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const p = document.createElement('p'); p.textContent = text; bubble.append(p); row.append(bubble); log.append(row); return bubble;
}
function action(parent, label, fn) { const b = document.createElement('button'); b.type='button'; b.className='action'; b.textContent=label; b.addEventListener('click',()=>fn(b)); parent.append(b); return b; }
function reveal() { log.lastElementChild?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); }
function note(parent,text) { const p=document.createElement('p'); p.className='note'; p.textContent=text; parent.append(p); }
function item(parent,title,detail) { const d=document.createElement('div'); d.className='item'; const h=document.createElement('strong');h.textContent=title; const p=document.createElement('p');p.textContent=detail;d.append(h,p);parent.append(d);return d; }
function welcome() { log.replaceChildren();message('안녕, 인천이니? 👋\n나는 네 인천 로컬 친구야. 어디 갈지 고민 중이라면 위에서 골라봐. 오늘의 인천은 내가 맡을게!'); }
function course() {
 const b=message('결정하기 귀찮은 날이지? 😎\n출발 위치와 남은 시간만 알려줘. 오늘 코스는 내가 정해줄게.');
 const l=document.createElement('label');l.textContent='어디서 출발해?';const select=document.createElement('select');select.setAttribute('aria-label','출발 위치');LANDMARKS.forEach(m=>select.add(new Option(m.label,m.label)));select.value=chosen;l.append(select);
 const t=document.createElement('label');t.textContent='얼마나 놀 수 있어?';const time=document.createElement('select');time.setAttribute('aria-label','가용 시간');[60,90,120,240].forEach(n=>time.add(new Option(`${n}분`,n)));time.value='90';t.append(time);b.append(l,t);
 action(b,'✦ 고민 끝! 코스 강제 배정',()=>{chosen=select.value;const mins=Number(time.value);message(`${chosen}에서 ${mins}분! 코스 정해줘.`,true);const out=message('오늘은 이 순서로 가자. 고민은 여기서 끝!');
 const routes={ '인천역 · 차이나타운':['차이나타운 골목 산책','신포시장 먹거리 구경','개항장 거리'], '동인천역 · 개항로':['개항로 골목 산책','동인천 로컬 식당','배다리 책방 거리'], '월미도':['문화의 거리 산책','바다 앞 식사','월미도 바다 구경'], '송도 · 인천대입구역':['센트럴파크 산책','송도 식사 시간','한옥마을 주변 구경'], '구월동 · 인천시청역':['중앙공원 산책','구월동 식사 시간','로데오 거리'], '부평역':['문화의 거리','부평시장 먹거리 구경','평리단길 산책'], '소래포구':['소래포구 산책','시장 먹거리 구경','포구 전망 구경'], '인천공항 T1':['터미널 실내 산책','터미널 식사 시간','실내 휴식']};
 const stops=routes[chosen]||routes[LANDMARKS[0].label];const moving=15;const first=Math.floor((mins-moving)/3);stops.forEach((s,i)=>item(out,`${String(i+1).padStart(2,'0')} · ${s}`,`${i===2?mins-moving-first*2:first}분 머무르기${i<2?' · 다음 이동 예시 '+(i===0?7:8)+'분':''}`));note(out,`총 ${mins}분 (이동 예시 15분 포함). 시연용 동선이며 거리·영업시간·이동시간은 검증되지 않았어요.`);action(out,'마음에 들어 · 코스 담기',button=>{button.textContent='✓ 이번 대화에 담았어';button.disabled=true;});reveal();});reveal();
}
function people(){const b=message('혼자 먹기 아쉬울 때, 같이 한 끼 어때? 🍚');note(b,'아래는 가상 인물입니다. 거리·인원·시간은 예시이며 실제 주변인 조회가 아닙니다.');[['민지 · 인천 로컬','한식 좋아해요 · 2명 · 15:00까지'],['준 · 인천 여행 중','시장 먹거리 탐방 · 1명 · 16:00까지'],['소라 · 인천 로컬','밥 먹고 가볍게 산책 · 2명 · 17:00까지']].forEach(([name,detail])=>{const d=item(b,name,detail);action(d,'같이 먹자고 해보기',btn=>{btn.textContent='✓ 데모 신청 완료';btn.disabled=true;message(`${name.split(' · ')[0]}님에게 식사 동행을 신청했어 — 시연용 확인이야. 실제 메시지는 전송되지 않아. 공개된 식당에서 만나고 개인 연락처는 공유하지 않는 게 좋아.`);reveal();});});reveal();}
function food(){const b=message('프랜차이즈 대신, 골목의 한 끼. 이런 분위기는 어때?');[['시장 한 바퀴','신포시장 · 먹거리 구경과 가벼운 한 끼'],['골목 식당 찾기','개항로 · 산책하다 만나는 작은 식당'],['커피 한 잔의 여유','평리단길 · 개성 있는 카페 탐방']].forEach(([n,d])=>{const card=item(b,n,d);action(card,'이 분위기로 이야기하기',()=>{message(`${n} 느낌이 좋아!`,true);message('좋아! 강제 코스에서 출발 위치와 시간을 골라줘. 이 데모는 분위기 탐색용이라 실제 매장과 비체인 여부는 아직 연결하지 않았어.');reveal();});});note(b,'지역 탐색 예시 · 실제 매장 추천/체인 여부 검증 전');reveal();}
function life(){const b=message('이동할 때도, 잠깐 쉬어갈 때도 도와줄게. 무엇이 필요해?');[['🚇 대중교통','출발지와 목적지를 정하고 지도 앱에서 최신 시간표를 확인해줘. 이 데모는 실시간 도착 정보를 제공하지 않아.'],['🪑 쉬어갈 곳','공원 쉼터나 공공시설부터 찾아보자. 벤치 위치·이용 가능 여부는 아직 연결하지 않았어.'],['🚻 화장실 찾기','역사나 공공시설의 안내 표지를 확인해봐. 개방 여부와 이용시간은 현장에서 확인이 필요해.']].forEach(([n,t])=>action(b,n,()=>{message(n,true);message(t);reveal();}));reveal();}
const handlers={course,people,food,life};document.querySelectorAll('[data-guide]').forEach(b=>b.addEventListener('click',()=>handlers[b.dataset.guide]()));document.querySelector('#reset').addEventListener('click',welcome);
document.querySelector('#composer').addEventListener('submit',e=>{e.preventDefault();const input=document.querySelector('#question');const text=input.value.trim();if(!text)return;message(text,true);input.value='';if(/같이|동행|친구/.test(text))people();else if(/맛집|밥|음식|카페/.test(text))food();else if(/교통|화장실|벤치|버스|지하철/.test(text))life();else if(/코스|시간|추천/.test(text))course();else{message('나는 지금 UI 데모 모드야. 자유로운 AI 답변은 아직 연결 전이지만, 위의 네 가지 가이드는 직접 눌러볼 수 있어. 먼저 강제 코스로 오늘 동선을 정해볼까?');reveal();}});welcome();
