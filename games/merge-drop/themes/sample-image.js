// 이미지 테마 예시: assets/sample/ 의 이미지를 단계별로 사용
// 자기 애셋으로 바꾸려면
//   1) assets/<내테마>/ 에 이미지(png/jpg/svg/webp) 넣기 (정사각형 권장, 원형으로 잘려 그려짐)
//   2) 이 파일을 복사해 id/name/image 경로 수정
//   3) index.html 에 <script src="themes/<내테마>.js"></script> 추가
// 이미지 로드 실패 시 color 로 대신 그려짐
(function () {
  const radii = [15, 21, 28, 34, 42, 50, 59, 68, 79, 92, 106];
  const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
                  '#9b59b6', '#e84393', '#d35400', '#16a085', '#2c3e50'];
  window.THEMES.push({
    id: 'sample-image',
    name: '이미지 예시',
    background: '#eef6ff',
    wallColor: '#7f8fa6',
    dropTiers: 5,
    face: false,
    finalBonus: 100,
    tiers: radii.map((r, i) => ({
      name: 'Lv' + (i + 1),
      radius: r,
      score: (i + 1) * (i + 2) / 2,
      color: colors[i],
      image: 'assets/sample/tier' + i + '.svg',
    })),
  });
})();
