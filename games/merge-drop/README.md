# Merge Drop

같은 오브젝트끼리 부딪히면 다음 단계로 합쳐지는 낙하 머지 퍼즐. 외부 라이브러리 없는 순수 HTML/JS.

## 실행
- `index.html` 을 브라우저로 직접 열기 (WSL: `explorer.exe index.html`)
- 조작: 마우스/터치로 위치 조준 → 클릭(손 떼기)으로 낙하. 키보드 ←/→ 이동, Space 낙하
- 점선(위험선) 위로 넘친 상태가 2초 지속되면 게임 오버. 최고점은 테마별로 브라우저에 저장

## 테마(애셋) 교체
1. `assets/<내테마>/` 에 단계별 이미지 넣기 (정사각형 권장, 원형으로 잘려 그려짐. png/jpg/svg/webp)
2. `themes/sample-image.js` 를 복사해 `themes/<내테마>.js` 작성, `id`·`name`·`image` 경로 수정
3. `index.html` 의 테마 script 목록에 `<script src="themes/<내테마>.js"></script>` 추가
4. 화면 상단 드롭다운에서 테마 선택

### 테마 필드
| 필드 | 의미 |
|---|---|
| `id`, `name` | 식별자, 드롭다운 표시 이름 |
| `background`, `wallColor` | 통 안쪽 배경색, 테두리색 |
| `dropTiers` | 낙하 후보로 나오는 하위 단계 수 (기본 5) |
| `face` | 이미지 없는 단계에 얼굴 그리기 여부 |
| `finalBonus` | 최종 단계끼리 합쳐 소멸할 때 보너스 |
| `tiers[]` | 단계 목록 (작은 것 → 큰 것). 단계 수 자유 |
| `tiers[].radius` | 반지름 (게임 영역 400x640 기준, 통 폭 368) |
| `tiers[].score` | 그 단계가 합체로 생길 때 점수 |
| `tiers[].color` | 기본 색 (이미지 없거나 로드 실패 시 사용) |
| `tiers[].image` | 이미지 경로 (선택) |

## 파일
- `index.html` : 화면·테마 드롭다운·테마 script 목록
- `game.js` : Verlet 물리, 합체, 점수, 게임 오버 판정
- `themes/*.js` : 테마 정의 (`window.THEMES.push`, file:// 에서 fetch 가 막혀 JS 로 등록)
- `assets/<테마>/` : 테마 이미지

## 개발 참고
- 합체 직후 큰 겹침 보정이 속도로 바뀌어 튕겨나가는 현상 → 서브스텝당 속도 상한 `MAX_SPEED`
- 최고점은 `localStorage` 에 테마별 저장

## 테스트 훅
- `window.MergeDrop` (`state`, `tick`, `reset`, `drop`, `setAim`) → DOM 스텁으로 node 헤드리스 시뮬레이션 가능
