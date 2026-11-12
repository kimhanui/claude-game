# Game Arcade

HTML 게임 모음. 루트 `index.html` 을 열면 게임 목록에서 선택해 진입.

## 외부 서버 배포 (Render 등)
- 저장소 연결 후 Root Directory `server`, Build `npm install`, Start `node server.js` (포트는 `PORT` 환경변수 사용)
- 접속: `https://<앱 주소>/games/claw-machine/` → https 페이지는 같은 주소의 `wss://.../ws` 로 자동 연결
- 영구 저장(토큰·랭킹·방명록): Upstash Redis 무료 DB 생성(Render 와 같은 지역) → Render 환경변수 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 등록
  - 환경변수가 없으면 `server/data/` 파일에 저장 (Render 무료 플랜은 재배포 시 초기화)
  - Redis 장애 시에도 게임은 계속 진행, 저장 실패는 로그만 남김

## Claw Drop 3D 멀티 서버 실행 (로컬 PC)
- 실행 (Windows, 최초 1회 `npm install`)
  ```
  cd server
  npm install
  node server.js        # 기본 포트 8787, PORT 환경변수로 변경
  ```
- 접속 링크: `http://<서버 PC IP>:8787/games/claw-machine/` (실행 시 콘솔에 출력). 서버 없이 파일을 열면 싱글 모드
- 다른 PC 에서 접속이 안 되면 Windows 방화벽 인바운드 허용 필요 (관리자 PowerShell)
  ```
  New-NetFirewallRule -DisplayName "ClawDrop 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
  ```
- 게임 규칙·멀티 기능·서버 메시지·저장 구조는 `games/claw-machine/README.md`

## 새 게임 추가
1. `games/<id>/index.html` 로 게임 작성 (게임 폴더 안에서 자체 완결, 목록 복귀 링크 `../../index.html`)
   - 게임 폴더에 `README.md` 로 게임별 context(파일 구성, 조작, 규칙·튜닝값, 저장, 테스트 훅) 정리
2. `games.js` 의 `window.GAMES` 배열에 항목 추가 (`id`, `title`, `desc`, `path`, `color`, `emoji`, 선택 `thumb`)

## 게임 목록
- `games/merge-drop` : 낙하 머지 퍼즐 (테마로 애셋 교체 가능, 상세는 폴더 내 README)
- `games/claw-machine` : 탑다운 3D 인형뽑기 (three.js r128 CDN). 싱글 + `server/` 로 멀티(차례제·구경·채팅·예측 내기·랭킹). 상세는 폴더 내 README
- `games/busking` : 3인칭 버스킹 (three.js r128 CDN). 키 하나 = 한 음, Space 노래, 팁·상점·버스 이동, 관객이 찍은 영상이 SNS(버스타그램)에 올라 팔로워가 늘어남. 진행은 브라우저에 저장. 상세는 폴더 내 README
