# Claw Drop 3D

탑다운 3D 인형뽑기. 혼자 하는 싱글 모드와, 서버(`server/`)에 접속해 한 명씩 차례로 뽑고 나머지는 실시간으로 구경·채팅·내기하는 멀티 모드가 있음.
three.js r128 (cdnjs UMD 빌드, 인터넷 연결 필요). 레이아웃은 휴대폰 세로 화면이 기준.

## 파일
- `index.html` : HUD, 조작 패드, 접속자 패널, 팝업(뽑은 인형·방명록·랭킹·광고·내기 카드), 스타일
- `game.js` : 씬, 집게 상태머신, 인형 물리(구 근사 Verlet), 멀티 동기화(스냅샷·아바타), UI 로직
- `net.js` : WebSocket 연결 (`window.ClawNet`, 서버가 없으면 null → 싱글 모드)
- `og-default.jpg` : 자랑 링크 기본 썸네일 (1200×630)
- 서버: `../../server/server.js` (정적 파일 + `/ws` 중계 + 자랑 페이지), `../../server/store.js` (영구 저장)

## 조작
- PC: `←↑↓→`/`WASD` 이동, `Space` 내리기(DROP), 클릭 인형 가리키기, `C` 시점 전환, 휠·`+`/`-`/`0` 줌, `Enter` 채팅, `B` 뽑은 인형, `G` 방명록, `R` 랭킹, `Esc` 팝업 닫기
- 휴대폰: 왼쪽 방향 패드 + 오른쪽 DROP, 두 손가락 핀치 줌, 인형 짧게 탭하면 가리키기, ☰ 메뉴에 나머지 기능
- 조준 제한 시간 20초(`AIM_TIME`). 지나면 자동으로 내려감

## 뽑기 규칙과 운 요소
- 집게 세기 `power` 0~1, 매 판 랜덤. 멀티는 서버가 정해 모두에게 공개(💪 칩), 싱글은 조준 시작마다 랜덤
  - `clawCfg(power)`: 잡을 확률 0.35~0.95, 들고 올라가는 동안 초당 놓칠 확률 0.52~0.02 (약할수록 잘 놓침)
- 인형 종류별 `bounce` (`KINDS`): 곰 0.08 · 고양이 0.15 · 토끼 0.2 · 병아리 0.35 · 젤리 0.6
  - 집는 순간 `bounce × (0.3 + 0.5 × power)` 확률로 튕겨나감 (세게 쥘수록 잘 튕김), 들고 있을 때 놓칠 확률도 bounce 만큼 증가
- 배출구(`CHUTE`)에 떨어지면 획득. 기록은 브라우저 `localStorage` `clawdrop.collection` (뽑은 인형 팝업)

## 멀티 모드
- 서버가 띄운 페이지로 접속하면 자동 멀티. 서버 없이 파일을 열거나 연결 실패 시 싱글
- 유저 구분: 서버 발급 HttpOnly 쿠키 `cd_uid` (2년). 화면·방송에는 sha256 앞 10자 공개 ID 만 사용. 같은 브라우저 새 탭을 열면 기존 탭 종료
- 차례: 대기열 순서로 1판씩. 물리는 차례를 가진 브라우저가 계산해 스냅샷을 방송, 서버는 중계만. 최대 45초, 끊기면 다음 사람
- 토큰: 하루 무료 5개(KST 0시 충전, 남은 게 더 많으면 유지), 차례 시작 시 1개 차감. 없으면 광고(현재 15초 자체 대기 화면) 1회 = 1개, 하루 10회
- 구경꾼 예측 내기: 차례 시작 시 내기 카드가 뜨고, 플레이어가 DROP 하기 전(또는 조준 시간 종료)까지 성공/실패 한쪽에 최대 10토큰
  - 적중자끼리 전체 판돈 1/n 균등 분배(나머지는 먼저 건 순서), 적중자 0명이면 전액 환불, 플레이어 이탈·시간 초과는 무효 환불
- 인형 가리키기: 4초 표시(고리 + 화살표 + 이름표), 1인 1개, 같은 인형 다시 누르면 해제. 서버는 0.5초 제한 후 중계만
- 채팅: 20자, 1초 1건, 저장 없음. 아바타 말풍선 + 화면 상단 흐르는 채팅(메뉴에서 끄기 가능)
- 방명록: 기계 왼쪽 3D 책 클릭 또는 `G`. 100자, 5초 1건, 최근 200건 보관
- 오늘 랭킹: 오늘 뽑은 인형 수 TOP 10 (KST 0시 초기화, 보상 없음)
- 자랑하기: `/u/<공개ID>` 기록 페이지 공유. 누를 때 브라우저가 1200×630 카드를 그려 `POST /u/og` 로 올림 → 링크 미리보기 썸네일(`/u/<id>/og.jpg`)
- 게임 내 토큰·인형은 현금·상품 교환 불가 (게임산업법 경품·환전 금지 준수)

## 서버 메시지 (주요)
- 차례: `queue_join`/`queue_leave`, `turn`(power 포함), `state`(스냅샷), `event`(GET 등), `drop`(플레이어 DROP = 내기 마감 신호), `turn_end`
- 내기: `bet_open`, `bet` → `bet_ok`/`bet_reject`, `bet_pool`, `bet_close`, `bet_result`
- 토큰·광고: `tokens`, `need_token`, `ad_start`/`ad_claim`/`ad_cancel` → `ad_ok`/`ad_done`/`ad_reject`
- 기타: `welcome`, `presence`, `point`, `chat`, `gb_post` → `gb_new`/`gb_reject`, `rank_get` → `rank`, `replaced`(다른 탭으로 전환)
- HTTP: `/version.json`(배포 시각, 화면 오른쪽 아래 표시), `/u/<id>`, `/u/<id>.json`, `/u/<id>/og.jpg`, `POST /u/og`

## 저장
- 서버: `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` 있으면 Upstash Redis (`cd:stats` 해시, `cd:gb` 리스트, `cd:og:<id>`), 없으면 `server/data/` 파일
  - 메모리 값 기준으로 동작, 유저 기록은 변경 2초 뒤 몰아서 저장, 종료 신호 시 남은 기록 저장. 저장 실패해도 게임은 계속 진행
- 브라우저: 뽑은 인형 기록, 흐르는 채팅 설정 (`localStorage`)

## 개발 참고
- 서버 `KIND_INFO` 순서는 `game.js` `KINDS` 순서와 맞춰야 함 (자랑 페이지·랭킹 집계)
- 탑다운 카메라는 `fitViews()` 가 기계 외곽 투영 범위를 HUD 를 뺀 영역 중앙에 맞춤 (resize 마다 재계산)
- 캔버스는 CSS `width:100%; height:100%` 필수 (`setSize(w,h,false)` 는 CSS 크기를 안 바꿈)
- 레이아웃 기준: 기본 = 휴대폰 세로, `(min-width:760px) and (min-height:501px)` 넓은 화면, `(hover:hover) and (pointer:fine)` 마우스 환경

## 테스트 훅
- `window.ClawGame` (`st`, `prizes`, `physics`, `updateClaw`, `drop`, `power`/`setPower`, `pointAt`, `openCollection`, `openRank`, `shareLink`, `makeShareCard` 등)
- THREE 를 Proxy 스텁으로 바꾸고 가짜 `ClawNet` 을 넣으면 node 에서 헤드리스로 차례·스냅샷·내기 로직 시뮬레이션 가능
