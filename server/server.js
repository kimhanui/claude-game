// Claw Drop 3D 멀티 유저 중계 서버
// - 저장소 루트 정적 파일을 HTTP 로 제공 (https 페이지에서 ws:// 가 막히므로 같은 서버에서 게임 페이지 제공)
// - /ws : 접속자·대기열·현재 플레이어·최신 스냅샷만 관리. 물리는 차례를 가진 클라이언트가 수행
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(__dirname, '..');
const TURN_LIMIT_MS = Number(process.env.TURN_LIMIT_MS) || 45000; // 한 차례 최대 시간 (조준 20초 + 집게 동작 여유)
const MAX_PRIZES = 80;
const GB_FILE = process.env.GB_FILE || path.join(__dirname, 'data', 'guestbook.json');
const CHAT_MAX_LEN = 20, CHAT_INTERVAL_MS = 1000; // 채팅: 저장 없이 중계만
const GB_KEEP = 200, GB_SEND = 200, GB_MAX_LEN = 100, GB_INTERVAL_MS = 5000; // 오늘 건수 계산을 위해 보관분 전체 전송

// ================= 정적 파일 =================
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  // 서버 코드·숨김 폴더는 제공하지 않음
  if (rel.split('/').some(s => s.startsWith('.')) || rel.startsWith('/server/') || rel.includes('node_modules')) {
    res.writeHead(404); return res.end('Not found');
  }
  let file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      if (!rel.endsWith('/')) { res.writeHead(301, { Location: rel + '/' }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

// ================= 게임 방 상태 =================
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];
const users = new Map();   // sid -> user { sid, id, name, color, ws }
let queue = [];            // user[] (대기 순서)
let player = null;         // 현재 차례 user
let turnTimer = null;
let snapshot = null;       // 최신 기계 상태 (차례 클라이언트가 보낸 것)
const wins = new Map();    // 공개 ID -> 뽑은 횟수 (서버 메모리, 재접속해도 같은 세션 ID 면 유지)

const pub = u => ({ id: u.id, name: u.name, color: u.color });
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const u of users.values()) if (u !== except && u.ws.readyState === 1) u.ws.send(data);
}
const presenceMsg = () => ({ t: 'presence', users: [...users.values()].map(pub), queue: queue.map(u => u.id), player: player ? player.id : null });
const broadcastPresence = () => broadcast(presenceMsg());

function validSnapshot(s) {
  return s && typeof s === 'object' && Array.isArray(s.c) && s.c.length <= 8 && Array.isArray(s.p) && s.p.length <= MAX_PRIZES
    && s.p.every(a => Array.isArray(a) && a.length <= 10);
}
// ================= 방명록 (파일 저장) =================
let guestbook = [];
try {
  const raw = JSON.parse(fs.readFileSync(GB_FILE, 'utf8'));
  if (Array.isArray(raw)) guestbook = raw.filter(e => e && typeof e.text === 'string').slice(-GB_KEEP);
} catch (e) { /* 파일 없음·손상 → 빈 목록 */ }
let gbSaveTimer = null;
function saveGuestbook() {
  clearTimeout(gbSaveTimer);
  gbSaveTimer = setTimeout(() => {
    fs.mkdir(path.dirname(GB_FILE), { recursive: true }, () => {
      const tmp = GB_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(guestbook), err => { if (!err) fs.rename(tmp, GB_FILE, () => {}); });
    });
  }, 500);
}
function cleanText(t, max = GB_MAX_LEN) {
  if (typeof t !== 'string') return '';
  return Array.from(t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

// 차례가 끝나면 들려 있던 인형은 놓은 상태로 정리
function dropHeld() { if (snapshot) for (const a of snapshot.p) a[7] = 0; }

function startNextTurn() {
  if (player || !queue.length) return false;
  player = queue.shift();
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => { log(`timeout ${player && player.name}`); endTurn(); }, TURN_LIMIT_MS);
  broadcast({ t: 'turn', player: player.id, snapshot });
  log(`turn -> ${player.name}`);
  return true;
}

function endTurn() {
  clearTimeout(turnTimer); turnTimer = null;
  player = null;
  dropHeld();
  if (!startNextTurn()) broadcast({ t: 'turn', player: null, snapshot });
  broadcastPresence();
}

function removeUser(u) {
  if (users.get(u.sid) !== u) return;
  users.delete(u.sid);
  queue = queue.filter(q => q !== u);
  log(`leave ${u.name} (${users.size})`);
  if (player === u) endTurn(); else broadcastPresence();
}

function log(t) { console.log(new Date().toISOString().slice(11, 19), t); }

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      if (me) return;
      if (typeof m.sid !== 'string' || !/^[0-9a-f]{16,64}$/.test(m.sid)) return ws.close();
      // 같은 세션 ID 가 이미 접속 중(탭 복제 등)이면 새 ID 발급 요청
      if (users.has(m.sid)) return send(ws, { t: 'sid_conflict' });
      const id = crypto.createHash('sha256').update(m.sid).digest('hex').slice(0, 10); // 공개용 ID (세션 ID 원문은 공유하지 않음)
      me = { sid: m.sid, id, name: 'Guest-' + id.slice(0, 4).toUpperCase(), color: COLORS[parseInt(id.slice(4, 6), 16) % COLORS.length], ws };
      users.set(me.sid, me);
      log(`join ${me.name} (${users.size})`);
      send(ws, { ...presenceMsg(), t: 'welcome', you: pub(me), snapshot, guestbook: guestbook.slice(-GB_SEND) });
      broadcastPresence();
      return;
    }
    if (!me) return;

    switch (m.t) {
      case 'init': // 첫 접속자가 만든 인형 배치를 공용 상태로 채택
        if (!snapshot && !player && validSnapshot(m.s)) { snapshot = m.s; broadcast({ t: 'state', s: snapshot }, me); }
        else if (snapshot) send(ws, { t: 'state', s: snapshot });
        break;
      case 'queue_join':
        if (player !== me && !queue.includes(me)) { queue.push(me); startNextTurn(); broadcastPresence(); }
        break;
      case 'queue_leave':
        if (queue.includes(me)) { queue = queue.filter(q => q !== me); broadcastPresence(); }
        break;
      case 'state':
        if (player === me && validSnapshot(m.s)) { snapshot = m.s; broadcast({ t: 'state', s: snapshot }, me); }
        break;
      case 'event':
        if (player === me && m.type === 'get' && Number.isInteger(m.kind) && /^#[0-9a-fA-F]{6}$/.test(m.color || '')) {
          wins.set(me.id, (wins.get(me.id) || 0) + 1);
          broadcast({ t: 'event', type: 'get', by: me.name, byId: me.id, kind: m.kind, color: m.color }, me);
        }
        break;
      case 'gb_post': {
        const text = cleanText(m.text);
        const now = Date.now();
        if (!text) break;
        if (me.gbAt && now - me.gbAt < GB_INTERVAL_MS) { send(ws, { t: 'gb_reject', reason: '잠시 후 다시 작성' }); break; }
        me.gbAt = now;
        const entry = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), by: me.name, byId: me.id, color: me.color, wins: wins.get(me.id) || 0, text, t: now }; // wins: 작성 시점 뽑은 횟수
        guestbook.push(entry);
        if (guestbook.length > GB_KEEP) guestbook = guestbook.slice(-GB_KEEP);
        saveGuestbook();
        broadcast({ t: 'gb_new', entry });
        log(`guestbook ${me.name}`);
        break;
      }
      case 'chat': {
        const text = cleanText(m.text, CHAT_MAX_LEN);
        const now = Date.now();
        if (!text || (me.chatAt && now - me.chatAt < CHAT_INTERVAL_MS)) break;
        me.chatAt = now;
        broadcast({ t: 'chat', id: me.id, text });
        break;
      }
      case 'turn_end':
        if (player === me) { if (validSnapshot(m.s)) snapshot = m.s; endTurn(); }
        break;
    }
  });
  ws.on('close', () => { if (me) removeUser(me); });
  ws.on('error', () => {});
});

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Claw Drop 서버 실행: 포트 ${PORT}`);
  for (const ip of ['localhost', ...ips]) console.log(`  http://${ip}:${PORT}/games/claw-machine/`);
});
