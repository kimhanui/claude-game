# Game Arcade

HTML 게임 모음. 루트 `index.html` 을 열면 게임 목록에서 선택해 진입.

## 외부 서버 배포 (Render 등)
- 저장소 연결 후 Root Directory `server`, Build `npm install`, Start `node server.js` (포트는 `PORT` 환경변수 사용)
- 접속: `https://<앱 주소>/games/claw-machine/` → https 페이지는 같은 주소의 `wss://.../ws` 로 자동 연결
- 영구 저장(토큰·랭킹·방명록): Upstash Redis 무료 DB 생성(Render 와 같은 지역) → Render 환경변수 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 등록
  - 환경변수가 없으면 `server/data/` 파일에 저장 (Render 무료 플랜은 재배포 시 초기화)
  - Redis 장애 시에도 게임은 계속 진행, 저장 실패는 로그만 남김

## Claw Drop 3D 멀티 유저 (같이 구경하기)
- 서버를 띄운 PC 주소로 접속하면 멀티 모드: 브라우저마다 고유 ID(Guest-XXXX, 서버 발급 HttpOnly 쿠키로 탭·재시작 후에도 유지, 같은 브라우저 새 탭을 열면 기존 탭은 종료), 한 번에 한 명만 플레이(1판씩 대기열 순서), 나머지는 실시간 구경
- 서버 없이 파일을 직접 열거나 서버 연결에 실패하면 싱글 모드로 동작
- 실행 (Windows, 최초 1회 `npm install`)
  ```
  cd server
  npm install
  node server.js        # 기본 포트 8787, PORT 환경변수로 변경
  ```
- 접속 링크: `http://<서버 PC IP>:8787/games/claw-machine/` (실행 시 콘솔에 출력)
- 다른 PC 에서 접속이 안 되면 Windows 방화벽 인바운드 허용 필요 (관리자 PowerShell)
  ```
  New-NetFirewallRule -DisplayName "ClawDrop 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
  ```
- 서버는 접속자·대기열·최신 기계 상태만 중계, 물리는 차례를 가진 브라우저가 계산 (차례 최대 45초, 끊기면 다음 사람)
- 방명록: 기계 왼쪽 바닥의 방명록 책을 클릭하거나 G 키로 열기, 세션 이름으로 한 줄(최대 100자) 작성, 접속자에게 실시간 표시. 최근 200건 보관
- 토큰(멀티 전용): 하루 무료 5개(KST 0시 충전, 남은 토큰이 더 많으면 유지), 차례 시작 시 1개 차감
  - 토큰이 없으면 DROP 버튼이 "광고 보고 토큰 받기"로 바뀜. 광고 1회(15초) = 토큰 1개, 하루 최대 10회
  - 광고는 지금 자체 대기 화면(`#adSlot`). 시청 시간은 서버가 확인 (`AD_WAIT_MS` 로 변경 가능)
- 오늘 랭킹: 메뉴의 🏆 버튼 또는 R 키. 오늘 뽑은 인형 수 TOP 10 (KST 0시 초기화, 보상 없음)
- 자랑하기: 컬렉션 창의 "자랑하기" → `/u/<공개ID>` 기록 페이지 링크 공유 (모바일 공유 시트, 그 외 링크 복사)
- 게임 내 토큰·인형은 현금·상품으로 교환 불가 (게임산업법상 경품 제공·환전 금지 준수)

## 새 게임 추가
1. `games/<id>/index.html` 로 게임 작성 (게임 폴더 안에서 자체 완결, 목록 복귀 링크 `../../index.html`)
2. `games.js` 의 `window.GAMES` 배열에 항목 추가 (`id`, `title`, `desc`, `path`, `color`, `emoji`, 선택 `thumb`)

## 게임 목록
- `games/merge-drop` : 낙하 머지 퍼즐 (테마로 애셋 교체 가능, 상세는 폴더 내 README)
- `games/claw-machine` : 탑다운 3D 인형뽑기 (three.js r128 CDN 사용, 인터넷 연결 필요, `server/` 로 멀티 구경)
- `games/busking` : 3인칭 버스킹 (three.js r128 CDN). 키 하나 = 한 음, Space 노래, 팁·상점·버스 이동, 관객이 찍은 영상이 SNS(버스타그램)에 올라 팔로워가 늘어남. 진행은 브라우저에 저장. 상세는 폴더 내 README
