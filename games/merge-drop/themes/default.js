// 기본 테마: 이미지 없이 색상 + 얼굴로 그리는 슬라임 11단계
// tier 필드: name(이름), radius(반지름, 논리좌표 400x640 기준), score(합체로 생성될 때 점수), color(기본 색), image(선택, 이미지 경로)
window.THEMES.push({
  id: 'slime',
  name: '슬라임 (기본)',
  background: '#fdf3df',   // 통 안쪽 배경색
  wallColor: '#c9a46b',    // 통 테두리색
  dropTiers: 5,            // 낙하 후보: 하위 몇 단계까지 랜덤 등장
  face: true,              // 이미지 없는 단계에 얼굴 그리기
  tiers: [
    { name: '방울',   radius: 15,  score: 1,  color: '#ff6b8b' },
    { name: '꼬마',   radius: 21,  score: 3,  color: '#ff9f43' },
    { name: '말랑',   radius: 28,  score: 6,  color: '#feca57' },
    { name: '통통',   radius: 34,  score: 10, color: '#7bed9f' },
    { name: '뭉치',   radius: 42,  score: 15, color: '#48dbfb' },
    { name: '왕방울', radius: 50,  score: 21, color: '#5f9cff' },
    { name: '구름',   radius: 59,  score: 28, color: '#a29bfe' },
    { name: '젤리',   radius: 68,  score: 36, color: '#e056fd' },
    { name: '대장',   radius: 79,  score: 45, color: '#ff7675' },
    { name: '거인',   radius: 92,  score: 55, color: '#00b894' },
    { name: '전설',   radius: 106, score: 66, color: '#fdcb6e' },
  ],
  // 최종 단계끼리 합치면 사라지며 받는 보너스
  finalBonus: 100,
});
