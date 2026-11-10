// 게임 목록. 새 게임 추가 시
//   1) games/<id>/index.html 로 게임 작성 (목록 복귀 링크: href="../../index.html")
//   2) 아래 배열에 항목 1개 추가
// 필드: id, title(제목), desc(한 줄 설명), path(게임 index 경로), color(카드 강조색), emoji(카드 아이콘), thumb(선택, 썸네일 이미지 경로)
window.GAMES = [
  {
    id: 'merge-drop',
    title: 'Merge Drop',
    desc: '같은 것끼리 합쳐 더 큰 단계로 키우는 낙하 머지 퍼즐',
    path: 'games/merge-drop/index.html',
    color: '#ff9f43',
    emoji: '🫧',
  },
  {
    id: 'claw-machine',
    title: 'Claw Drop 3D',
    desc: '탑다운 3D 인형뽑기 시뮬레이터. 집게를 움직여 인형을 배출구로',
    path: 'games/claw-machine/index.html',
    color: '#ff5d8f',
    emoji: '🧸',
  },
];
