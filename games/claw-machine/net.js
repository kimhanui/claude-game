// 멀티 유저 연결 모듈. 서버(server/server.js)가 제공한 http(s) 페이지에서 활성화, file:// 이나 서버 없는 곳(Pages)은 싱글 모드
(() => {
  'use strict';
  // 유저 구분은 서버가 발급한 HttpOnly 쿠키로 처리 (브라우저 단위, 탭·재시작 후에도 유지). 같은 브라우저 새 탭이 접속하면 기존 탭은 종료

  function resolveUrl() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q.includes('://') ? q : `ws://${q}/ws`;
    if (location.protocol === 'http:') return `ws://${location.host}/ws`;
    if (location.protocol === 'https:') return `wss://${location.host}/ws`; // 외부 호스팅(https). 서버 없는 곳(Pages)은 연결 실패 → 싱글 모드
    return null;
  }

  const url = resolveUrl();
  window.ClawNet = !url ? null : {
    url,
    // handlers: onMessage(msg), onFail() (최초 연결 실패 → 싱글 모드), onDisconnect() (연결 후 끊김, 자동 재연결). replaced 메시지 후에는 재연결 안 함
    connect(handlers) {
      let ws = null, welcomed = false, retry = 0, replaced = false;
      const send = msg => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
      function open() {
        try { ws = new WebSocket(url); } catch (e) { handlers.onFail(); return; }
        ws.onopen = () => { retry = 0; send({ t: 'hello' }); };
        ws.onmessage = e => {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'replaced') replaced = true;
          if (m.t === 'welcome') welcomed = true;
          handlers.onMessage(m);
        };
        ws.onclose = () => {
          if (replaced) return; // 다른 탭으로 전환됨 → 재연결 안 함
          if (!welcomed) { handlers.onFail(); return; }
          handlers.onDisconnect();
          setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
        };
      }
      open();
      return { send };
    },
  };
})();
