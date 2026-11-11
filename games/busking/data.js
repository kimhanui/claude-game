// 버스킹 데이터: 장소, 상점 아이템, SNS(버스타그램) 봇 문구. 값만 고쳐서 밸런스·문구 조정
window.BUSK_DATA = {
  // 장소: fare=버스비, tipMult=팁 배율, sns=SNS 반응 배율, area=걷는 구역(circle: 원형 광장, street: x 방향 거리)
  locations: [
    {
      id: 'plaza', name: '동네 광장', emoji: '⛲', fare: 2000,
      desc: '분수가 있는 조용한 광장. 처음 시작하기 좋아요.',
      perks: ['사람 적당함', '취객 출몰'],
      npcCount: 18, mix: { filmer: 3, drunk: 2, family: 2 }, tipMult: 1.0, sns: 1.0,
      area: { type: 'circle', r: 27 },
      look: { sky: [0x2e2b63, 0xb7688a, 0xf4a85c], fog: [0x7d5f86, 32, 80], hemi: [0xffd9b8, 0x3e3560, 0.62], sun: [0xffb27a, 0.75], bg: '#2e2b63' },
    },
    {
      id: 'river', name: '한강공원', emoji: '🌉', fare: 6000,
      desc: '노을 지는 강변 산책로. 가족 단위 손님과 치맥하는 어른들이 많아요.',
      perks: ['팁 후함', '아이 많음', '치맥 취객'],
      npcCount: 20, mix: { filmer: 3, drunk: 3, family: 4 }, tipMult: 1.25, sns: 1.3,
      area: { type: 'street', halfX: 30, zMin: -13, zMax: 9 },
      look: { sky: [0x3b3f7a, 0xe07a7a, 0xffc06a], fog: [0xc98a7e, 40, 110], hemi: [0xffe2c4, 0x45506a, 0.7], sun: [0xffa860, 0.85], bg: '#3b3f7a' },
    },
    {
      id: 'hongdae', name: '홍대 걷고싶은거리', emoji: '🌃', fare: 15000,
      desc: '버스킹의 성지. 밤거리에 사람이 많고 폰으로 찍는 사람도 많아서 SNS에 잘 퍼져요.',
      perks: ['사람 많음', '찍는 사람 많음', 'SNS 2배'],
      npcCount: 26, mix: { filmer: 7, drunk: 3, family: 1 }, tipMult: 1.4, sns: 2.0,
      area: { type: 'street', halfX: 30, zMin: -12, zMax: 10 },
      look: { sky: [0x0d0b24, 0x2a1d52, 0x5b2a6e], fog: [0x231a3a, 26, 70], hemi: [0xb9a8ff, 0x1d1730, 0.55], sun: [0x8f7cff, 0.35], bg: '#0d0b24' },
    },
  ],

  // 상점. slot 별로 하나씩 착용(glasses, gear 는 벗을 수 있음). stat: hear=들리는 거리, attract=멈춰 서는 정도, tip=팁, quality=SNS 영상 점수
  items: [
    { id: 'guitar', slot: 'instrument', name: '어쿠스틱 기타', icon: '🎸', price: 0, desc: '처음부터 함께한 기타. 따뜻한 소리.', stat: { hear: 1, attract: 1, tip: 1, quality: 1 } },
    { id: 'ukulele', slot: 'instrument', name: '우쿨렐레', icon: '🌺', price: 30000, desc: '밝고 귀여운 소리. 아이들이 특히 좋아해요.', stat: { hear: 0.95, attract: 1.1, tip: 1.05, quality: 1.05, family: 1.8 } },
    { id: 'electric', slot: 'instrument', name: '일렉 기타 + 앰프', icon: '⚡', price: 90000, desc: '앰프로 크게 울려요. 멀리서도 들리고 취객이 열광해요.', stat: { hear: 1.5, attract: 1.15, tip: 1.1, quality: 1.1, drunk: 1.8 } },
    { id: 'violin', slot: 'instrument', name: '바이올린', icon: '🎻', price: 160000, desc: '길게 우는 활 소리. 발걸음을 잘 붙잡고 팁이 후해져요.', stat: { hear: 1.1, attract: 1.3, tip: 1.45, quality: 1.2 } },
    { id: 'beanie', slot: 'hat', name: '노란 비니', icon: '🧶', price: 0, style: 0, desc: '늘 쓰던 비니.' },
    { id: 'cap', slot: 'hat', name: '빨간 야구모자', icon: '🧢', price: 10000, style: 1, desc: '캐주얼하게.' },
    { id: 'fedora', slot: 'hat', name: '페도라', icon: '🎩', price: 25000, style: 2, desc: '분위기 있는 거리의 음악가.' },
    { id: 'sunglasses', slot: 'glasses', name: '선글라스', icon: '🕶️', price: 8000, style: 1, desc: '밤에도 씁니다.' },
    { id: 'shirt', slot: 'top', name: '청록 셔츠', icon: '👕', price: 0, style: 0, desc: '편한 셔츠.' },
    { id: 'sparkle', slot: 'top', name: '반짝이 셔츠', icon: '✨', price: 30000, style: 2, desc: '조명 받으면 번쩍.' },
    { id: 'jacket', slot: 'top', name: '가죽 재킷', icon: '🧥', price: 45000, style: 3, desc: '록 스피릿.' },
    { id: 'micstand', slot: 'gear', name: '마이크 스탠드', icon: '🎤', price: 20000, desc: '노래가 훨씬 멀리 들리고 사람이 더 잘 모여요.', stat: { singHear: 1.6, singAttract: 1.35 } },
  ],
  // 꾸미기 점수(style 합)는 팁과 멈춰 서는 정도를 조금 올림

  // 팔로워 칭호 (min 이상)
  titles: [
    { min: 0, name: '무명 버스커' },
    { min: 50, name: '동네 버스커' },
    { min: 500, name: '떠오르는 버스커' },
    { min: 5000, name: '인기 버스커' },
    { min: 50000, name: '거리의 스타' },
    { min: 500000, name: '전설의 버스커' },
  ],
  milestones: [100, 1000, 10000, 100000, 1000000],

  sns: {
    appName: '버스타그램',
    handlePre: ['seoul', 'night', 'mint', 'coffee', 'guitar', 'music', 'daily', 'walk', 'hangang', 'hongdae', 'cat', 'sunny', 'moon', 'lofi', 'vibe', 'bus', 'pocket'],
    handleSuf: ['_lover', '.log', '_92', '_diary', '_zip', '_kim', '_lee', '_park', '_00', '.mp3', '_day', '_07'],
    handleKo: ['고양이집사', '퇴근길', '산책러', '라면한그릇', '오늘도맑음', '노래방죽돌이', '한강러버', '홍대불주먹', '감성충전', '버스킹덕후'],
    captions: {
      low: ['그냥 지나가다 찍음', '기타 든 사람 발견', '이게 버스킹인가'],
      mid: ['{loc}에서 만난 버스커 🎸', '퇴근길 BGM', '오늘 운 좋았다', '{loc} 산책하다가 🎶'],
      high: ['와 이건 꼭 봐야 됨 ㅠㅠ', '{loc} 길거리에서 소름 돋음', '이분 누군지 아는 사람?? 🔥', '발이 안 떨어졌다…'],
      tags: '#버스킹 #{loc} #라이브',
    },
    // 영상 내용(태그)에 따라 고르는 봇 댓글
    comments: {
      generic: ['👍', '🔥🔥', '멋져요', '좋다', '👏👏', '오 좋은데?', '저장각'],
      quiet: ['연주 언제 시작해요?ㅋㅋ', '기타 메고 서 있기 챌린지', '조용한 버스킹 컨셉인가요', '튜닝 중이었나 봐요', '음… 다음 영상 기대할게요'],
      busy: ['손가락 날아다니네', '속주 실화?', '연습 엄청 했나 봐요', '쉬지 않고 치시네'],
      variety: ['멜로디 좋네요 자작곡인가요?', '음역 넓게 쓰는 거 좋다', '높은 음 나올 때 소름'],
      sing: ['목소리 꿀이다 🍯', '노래 한 소절만 더…', '라이브로 들으면 소름일 듯', '음색 미쳤다'],
      nosing: ['연주만으로도 좋네', '노래도 불러주세요!', '보컬 있으면 더 좋을 듯'],
      crowdBig: ['사람 엄청 모였네', '저기 나도 있음ㅋㅋㅋ', '다음엔 앞자리 사수한다', '관객 반응 좋다'],
      crowdSmall: ['관객 적어도 멋짐', '첫 번째 팬 할게요', '이런 분이 더 떠야 하는데'],
      drunk: ['옆에 아저씨 춤 지분 50%ㅋㅋㅋ', '아저씨가 주인공임', '앵콜 아저씨 찾습니다', '아저씨 텐션 무엇ㅋㅋ', '술 한잔하고 들으면 딱이지'],
      kid: ['목마 탄 꼬마 너무 귀여워 ㅠㅠ', '아이가 제일 신났네ㅋㅋ', '아빠 어깨 위 VIP석', '꼬마 손 흔드는 거 봐 🥹'],
      applause: ['박수 소리 들린다 👏', '끝나고 박수 터지는 거 좋다', '마지막 박수에 감동'],
      high: ['와 소름…', '알고리즘아 고마워', '이분 계정 알려주세요!!', '출근길에 이거 보고 힘남', '이 영상 저장함', '몇 번째 돌려보는지 모름'],
      viral: ['떡상 각', '여기 1등 댓글 자리 맞나요', '저 이분 처음부터 봤어요', '추천에 떠서 왔어요'],
      fame: ['또 이분이다!!', '요즘 피드에 자주 뜨네', '실물 영접하고 싶다', '찐팬 출석'],
      loc_plaza: ['동네에 이런 분이?', '분수대 앞 버스킹 낭만 있다'],
      loc_river: ['한강 노을이랑 찰떡', '치맥 각이다', '강바람 맞으면서 들으면 최고일 듯'],
      loc_hongdae: ['역시 홍대', '홍대 버스킹 클라스', '홍대 가면 꼭 찾아갈게요'],
      inst_ukulele: ['우쿨렐레 소리 힐링 🌺', '소리가 너무 귀엽잖아'],
      inst_electric: ['일렉 사운드 찢었다 ⚡', '앰프 빵빵하네'],
      inst_violin: ['바이올린 버스킹 처음 봐요', '활 쓰는 거 우아하다 🎻'],
      style_sunglasses: ['선글라스 간지', '밤인데 선글라스ㅋㅋ 근데 멋짐'],
      style_fedora: ['페도라 잘 어울려요', '분위기 장인'],
      style_jacket: ['재킷 핏 미쳤다', '록스타 재질'],
      style_sparkle: ['셔츠 반짝이는 거 봐ㅋㅋ', '조명 필요 없는 남자'],
      style_cap: ['모자 귀엽다'],
      mic: ['마이크까지 세팅 제대로네'],
      replyToMe: ['본인 등판!!', '헐 진짜 본인이세요?', '다음 공연 언제 해요?', '팬이에요 ㅠㅠ', '여기서 만나네요ㅋㅋ', '사인해 주세요'],
    },
  },
};
