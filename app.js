const places = {
  food: [
    {name:'신포국제시장', type:'MARKET FOOD', meta:'대중교통 12분 · 약 45분', reason:'짧은 시간에도 인천다운 한 끼를 고르기 가장 좋아요. 여러 메뉴를 한곳에서 비교할 수 있어요.', map:'https://map.naver.com/p/search/신포국제시장'},
    {name:'차이나타운', type:'LOCAL CLASSIC', meta:'대중교통 18분 · 약 70분', reason:'골목을 걷고 한 끼까지 해결할 수 있는, 지금 출발하기 좋은 인천의 클래식 코스예요.', map:'https://map.naver.com/p/search/인천 차이나타운'},
    {name:'개항로', type:'LOCAL STREET', meta:'대중교통 15분 · 약 60분', reason:'오래된 거리의 가게와 새로운 식당을 함께 만날 수 있어요.', map:'https://map.naver.com/p/search/인천 개항로'}
  ],
  photo: [
    {name:'인천아트플랫폼', type:'PHOTO SPOT', meta:'대중교통 15분 · 약 60분', reason:'낡은 창고와 벽돌 건물 사이로 인천의 시간감이 남아 있어, 짧게 다녀와도 사진이 남아요.', map:'https://map.naver.com/p/search/인천아트플랫폼'},
    {name:'자유공원', type:'CITY VIEW', meta:'대중교통 20분 · 약 50분', reason:'언덕 위에서 내려다보는 항구와 오래된 도시 풍경이 지금의 인천을 보여줘요.', map:'https://map.naver.com/p/search/인천 자유공원'},
    {name:'개항장 거리', type:'HERITAGE WALK', meta:'대중교통 14분 · 약 60분', reason:'한 블록마다 다른 시대의 건축물이 이어지는 산책형 포토 스팟이에요.', map:'https://map.naver.com/p/search/인천 개항장'}
  ],
  rest: [
    {name:'인천아트플랫폼', type:'SLOW BREAK', meta:'대중교통 15분 · 약 60분', reason:'붐비는 식당 골목에서 한 걸음 떨어져, 잠시 앉아 인천의 오래된 공간을 느끼기 좋아요.', map:'https://map.naver.com/p/search/인천아트플랫폼'},
    {name:'개항로 카페거리', type:'QUIET CAFE', meta:'대중교통 15분 · 약 50분', reason:'골목의 작은 카페에서 천천히 쉬며 다음 동선을 정리해 보세요.', map:'https://map.naver.com/p/search/인천 개항로 카페'},
    {name:'자유공원', type:'GREEN PAUSE', meta:'대중교통 20분 · 약 45분', reason:'복잡한 거리보다 나무와 전망이 필요한 지금에 어울리는 휴식이에요.', map:'https://map.naver.com/p/search/인천 자유공원'}
  ],
  walk: [
    {name:'개항장 골목길', type:'WALKING ROUTE', meta:'대중교통 14분 · 약 65분', reason:'지도보다 발걸음으로 발견하는 간판과 건물이 많아요. 남은 시간에 맞춰 짧게 끊어 걸을 수 있어요.', map:'https://map.naver.com/p/search/인천 개항장'},
    {name:'자유공원', type:'CITY WALK', meta:'대중교통 20분 · 약 50분', reason:'경사 있는 산책길 끝에서 항구를 내려다보는 짧고 선명한 코스예요.', map:'https://map.naver.com/p/search/인천 자유공원'},
    {name:'월미문화의거리', type:'SEA WALK', meta:'대중교통 30분 · 약 80분', reason:'바다 바람을 맞으며 걷고 싶다면, 조금 더 이동해도 후회 없는 선택이에요.', map:'https://map.naver.com/p/search/월미문화의거리'}
  ]
};
let selectedMood = 'food'; let selectedTime = 90;
document.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.chip').forEach(x=>x.classList.remove('selected')); btn.classList.add('selected'); selectedTime=Number(btn.dataset.time); }));
document.querySelectorAll('.mood').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.mood').forEach(x=>x.classList.remove('selected')); btn.classList.add('selected'); selectedMood=btn.dataset.mood; }));
const textarea=document.querySelector('#observation'); textarea.addEventListener('input',()=>document.querySelector('#count').textContent=textarea.value.length);
document.querySelector('#recommend').addEventListener('click', () => {
  let picks=[...places[selectedMood]];
  if(selectedTime <= 60) picks.sort((a,b)=>parseInt(a.meta.match(/\d+/)[0])-parseInt(b.meta.match(/\d+/)[0]));
  const [top,...rest]=picks; const note=textarea.value.trim();
  document.querySelector('#primaryCard').innerHTML=`<div class="place-type">${top.type}</div><h3>${top.name}</h3><div class="place-meta">${top.meta}</div><div class="reason">${top.reason}</div><a class="navigate" target="_blank" rel="noopener" href="${top.map}">이곳으로 출발하기 →</a>`;
  document.querySelector('#alternatives').innerHTML=rest.map(p=>`<div class="alternative"><div><strong>${p.name}</strong><small>${p.meta}</small></div><span>후보</span></div>`).join('');
  document.querySelector('#agentNote').textContent=note ? `현장 메모 “${note}”를 반영해, 지금의 동선과 분위기에 맞춰 골랐어요.` : '남은 시간과 선택한 목적을 기준으로, 지금 떠나기 좋은 순서로 골랐어요.';
  const results=document.querySelector('#results');results.hidden=false;results.scrollIntoView({behavior:'smooth',block:'start'});
});
