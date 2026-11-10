// 멀티 유저 연결 모듈. 서버(server/server.js)가 제공한 http(s) 페이지에서 활성화, file:// 이나 서버 없는 곳(Pages)은 싱글 모드
(() => {
  'use strict';
  const SID_KEY = 'clawdrop.sid';

  function makeSid() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a); // randomUUID 는 비보안(http) 출처에서 사용 불가
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  // 탭(세션)마다 고유 ID: 새로 링크로 들어오면 새 ID, 새로고침은 유지
  function getSid(fresh) {
    let s = null;
    try { s = sessionStorage.getItem(SID_KEY); } catch (e) { /* 저장 불가 */ }
    if (!s || fresh) {
      s = makeSid();
      try { sessionStorage.setItem(SID_KEY, s); } catch (e) { /* 저장 불가 */ }
    }
    return s;
  }

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
    // handlers: onMessage(msg), onFail() (최초 연결 실패 → 싱글 모드), onDisconnect() (연결 후 끊김, 자동 재연결)
    connect(handlers) {
      let ws = null, welcomed = false, retry = 0;
      const send = msg => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
      function open() {
        try { ws = new WebSocket(url); } catch (e) { handlers.onFail(); return; }
        ws.onopen = () => { retry = 0; send({ t: 'hello', sid: getSid() }); };
        ws.onmessage = e => {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'sid_conflict') { send({ t: 'hello', sid: getSid(true) }); return; }
          if (m.t === 'welcome') welcomed = true;
          handlers.onMessage(m);
        };
        ws.onclose = () => {
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
