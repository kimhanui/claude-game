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
const { createStore } = require('./store');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(__dirname, '..');
const TURN_LIMIT_MS = Number(process.env.TURN_LIMIT_MS) || 45000; // 한 차례 최대 시간 (조준 20초 + 집게 동작 여유)
const MAX_PRIZES = 80;
const CHAT_MAX_LEN = 20, CHAT_INTERVAL_MS = 1000; // 채팅: 저장 없이 중계만
const GB_KEEP = 200, GB_SEND = 200, GB_MAX_LEN = 100, GB_INTERVAL_MS = 5000; // 오늘 건수 계산을 위해 보관분 전체 전송
// 토큰: 하루 무료 FREE_TOKENS 개 (KST 0시 충전, 이월분이 더 많으면 유지) + 광고 1회당 AD_REWARD 개 (하루 AD_DAILY_MAX 회)
const FREE_TOKENS = 5, AD_REWARD = 1, AD_DAILY_MAX = 10;
const AD_WAIT_MS = Number(process.env.AD_WAIT_MS) || 15000; // 광고(대기 화면) 최소 시청 시간
const RANK_TOP = 10;
const POINT_INTERVAL_MS = 500; // 인형 가리키기 최소 간격
// 구경꾼 예측 내기: 플레이어 차례 시작 ~ DROP(또는 조준 시간 종료) 전까지 성공/실패 중 한쪽에 토큰을 검
// 적중자끼리 전체 판돈을 1/n 균등 분배 (나머지는 먼저 건 순서대로 1개씩), 적중자가 없거나 판이 무효면 전액 환불
const BET_MAX = 10;
const BET_WINDOW_MS = Number(process.env.BET_WINDOW_MS) || 21500; // 조준 20초 + 여유. DROP 신호가 없을 때의 마감 안전장치
// 인형 종류: games/claw-machine/game.js 의 KINDS 순서와 동일하게 유지
const KIND_INFO = [['🧸', '곰'], ['🐰', '토끼'], ['🐱', '고양이'], ['🐥', '병아리'], ['💧', '젤리']];

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

// ================= 유저 구분 쿠키 =================
// 로그인 없이 브라우저 단위로 구분: 처음 페이지를 열 때 서버가 랜덤 ID 를 HttpOnly 쿠키로 발급, WebSocket 접속 시 자동 전송됨
const UID_COOKIE = 'cd_uid';
const UID_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2년
function readUid(req) {
  const m = /(?:^|;\s*)cd_uid=([0-9a-f]{32,64})(?:;|$)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
const publicId = uid => crypto.createHash('sha256').update(uid).digest('hex').slice(0, 10);
function issueUid(req, res) {
  if (readUid(req)) return;
  const https = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; // Render 등은 프록시 뒤 https
  res.setHeader('Set-Cookie', `${UID_COOKIE}=${crypto.randomBytes(24).toString('hex')}; Path=/; Max-Age=${UID_MAX_AGE}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`);
}

// ================= 배포 버전 (KST 날짜·시간) =================
// Render 빌드 시 postinstall 이 기록한 build.json → 없으면(로컬) 게임·서버 파일 중 가장 늦은 수정 시각
function buildTime() {
  try { const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'build.json'), 'utf8')).t; if (Number.isFinite(t)) return t; } catch (e) { /* 없음 */ }
  let t = 0;
  for (const f of ['server/server.js', 'server/store.js', 'games/claw-machine/game.js', 'games/claw-machine/index.html', 'games/claw-machine/net.js']) {
    try { t = Math.max(t, fs.statSync(path.join(ROOT, f)).mtimeMs); } catch (e) { /* 없음 */ }
  }
  return Math.floor(t) || Date.now();
}
const VERSION = (() => {
  const t = buildTime();
  const d = new Date(t + 9 * 3600e3).toISOString(); // KST
  return { t, label: `${d.slice(0, 10).replace(/-/g, '.')} ${d.slice(11, 16)}`, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) };
})();

const server = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0];
  if (req.method === 'POST' && pathname === '/u/og') return receiveOg(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  issueUid(req, res);
  if (pathname === '/version.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(VERSION));
  }
  const share = /^\/u\/([0-9a-f]{10})\/?$/.exec(pathname);
  if (share) return serveSharePage(share[1], req, res);
  const card = /^\/u\/([0-9a-f]{10})\.json$/.exec(pathname);
  if (card) return serveCardJson(card[1], res);
  const og = /^\/u\/([0-9a-f]{10})\/og\.jpg$/.exec(pathname);
  if (og) return serveOg(og[1], res);
  serveStatic(req, res);
});

// ================= 자랑 페이지 (/u/<공개ID>) =================
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 미리보기 크롤러용 절대 주소 (Render 등은 프록시 뒤 https)
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host.replace(/[^\w.:-]/g, '')}`;
}
function serveSharePage(id, req, res) {
  const s = stats.get(id);
  const origin = originOf(req);
  const img = `${origin}/u/${id}/og.jpg` + (s && s.ogAt ? `?v=${s.ogAt}` : '');
  const head = (title, desc) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${origin}/u/${id}`)}"><meta property="og:site_name" content="Claw Drop 3D">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="${OG_W}"><meta property="og:image:height" content="${OG_H}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<style>
  :root{--bg:#1d1b2e;--panel:#2b2842;--text:#f3f0ff;--sub:#a9a3c9;--line:#47426b;--accent:#ffb84d}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
  main{width:100%;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px 20px;text-align:center}
  h1{margin:0 0 6px;font-size:22px} .sub{color:var(--sub);margin:0 0 18px;font-size:14px}
  .stats{display:flex;gap:8px;justify-content:center;margin-bottom:18px} .stat{flex:1;background:var(--bg);border-radius:10px;padding:10px 4px}
  .stat b{display:block;font-size:22px;color:var(--accent)} .stat span{font-size:12px;color:var(--sub)}
  .kinds{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:20px} .kind{background:var(--bg);border-radius:10px;padding:8px 2px;font-size:12px;color:var(--sub)}
  .kind .e{font-size:26px;display:block} .kind b{color:var(--text)}
  a.go{display:block;padding:14px;border-radius:12px;background:var(--accent);color:#2b1d00;font-weight:700;text-decoration:none;font-size:16px}
</style></head><body><main>`;
  res.setHeader('Cache-Control', 'no-cache');
  if (!s) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(head('기록 없음 · Claw Drop 3D', '인형뽑기 기록을 찾을 수 없음') +
      '<h1>기록을 찾을 수 없음</h1><p class="sub">링크가 잘못됐거나 기록이 없는 유저</p><a class="go" href="/games/claw-machine/">인형뽑기 하러 가기</a></main></body></html>');
  }
  rollDay(s);
  const rank = rankOf(id);
  const title = `${s.name} 님의 인형뽑기 기록`;
  const desc = `누적 ${s.total}개 · 오늘 ${s.dayWins}개` + (rank ? ` · 오늘 ${rank}위` : '');
  const kinds = KIND_INFO.map(([e, n], i) => `<div class="kind"><span class="e">${e}</span>${esc(n)} <b>${s.kinds[i] || 0}</b></div>`).join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(head(title + ' · Claw Drop 3D', desc) +
    `<h1 style="color:${/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : 'inherit'}">${esc(s.name)}</h1><p class="sub">Claw Drop 3D 인형뽑기 기록</p>
<div class="stats"><div class="stat"><b>${s.total}</b><span>누적 획득</span></div><div class="stat"><b>${s.dayWins}</b><span>오늘 획득</span></div><div class="stat"><b>${rank ? rank + '위' : '-'}</b><span>오늘 순위</span></div></div>
<div class="kinds">${kinds}</div><a class="go" href="/games/claw-machine/">나도 인형뽑기 하러 가기</a></main></body></html>`);
}

// ================= 자랑하기 썸네일 (og:image) =================
// 브라우저가 자랑하기 때 그린 1200x630 카드(JPEG)를 받아 저장, 크롤러에 제공. 없으면 기본 이미지
const OG_W = 1200, OG_H = 630, OG_MAX_BYTES = 200 * 1024, OG_INTERVAL_MS = 10000, OG_CACHE_MAX = 50;
const OG_DEFAULT = path.join(ROOT, 'games', 'claw-machine', 'og-default.jpg');
const ogCache = new Map();   // 공개 ID -> Buffer (최근 사용분만)
const ogLastAt = new Map();  // 공개 ID -> 마지막 업로드 시각
function cacheOg(id, buf) {
  ogCache.delete(id); ogCache.set(id, buf);
  while (ogCache.size > OG_CACHE_MAX) ogCache.delete(ogCache.keys().next().value);
}
function serveCardJson(id, res) {
  const s = stats.get(id);
  res.setHeader('Cache-Control', 'no-cache');
  if (!s) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end('{}'); }
  rollDay(s);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ name: s.name, color: s.color, total: s.total, dayWins: s.dayWins, rank: rankOf(id), kinds: s.kinds }));
}
async function serveOg(id, res) {
  let buf = ogCache.get(id);
  if (!buf && stats.get(id) && stats.get(id).ogAt) { buf = await store.loadOg(id); if (buf) cacheOg(id, buf); }
  if (!buf) {
    try { buf = await fs.promises.readFile(OG_DEFAULT); } catch (e) { res.writeHead(404); return res.end(); }
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=300' });
  res.end(buf);
}
function receiveOg(req, res) {
  const done = (code, body) => { if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); } };
  const uid = readUid(req);
  const id = uid && publicId(uid);
  if (!id || !stats.get(id)) { req.resume(); return done(403, { error: 'no_user' }); }
  const now = Date.now();
  if (now - (ogLastAt.get(id) || 0) < OG_INTERVAL_MS) { req.resume(); return done(429, { error: 'too_fast' }); }
  if (Number(req.headers['content-length']) > OG_MAX_BYTES) { req.resume(); return done(413, { error: 'too_big' }); }
  const chunks = []; let size = 0, over = false;
  req.on('data', c => { size += c.length; if (size > OG_MAX_BYTES) over = true; else chunks.push(c); });
  req.on('error', () => done(400, { error: 'read' }));
  req.on('end', async () => {
    if (over) return done(413, { error: 'too_big' });
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return done(400, { error: 'not_jpeg' });
    ogLastAt.set(id, now);
    cacheOg(id, buf);
    const s = stats.get(id);
    s.ogAt = now; store.saveUser(id, s);
    await store.saveOg(id, buf);
    done(200, { ok: true, v: now });
  });
}

// ================= 유저 통계 (토큰·GET 수, store 에 영구 저장) =================
const store = createStore({ log: t => log(t) });
const stats = new Map();   // 공개 ID -> { name, color, total, kinds[], day, dayWins, lastWinAt, tokens, ads }
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function normStat(o) {
  const n = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const kinds = KIND_INFO.map((_, i) => n(o && Array.isArray(o.kinds) ? o.kinds[i] : 0));
  return { name: String(o && o.name || 'Guest'), color: String(o && o.color || '#ffffff'), total: n(o && o.total), kinds,
    day: String(o && o.day || ''), dayWins: n(o && o.dayWins), lastWinAt: n(o && o.lastWinAt), tokens: n(o && o.tokens), ads: n(o && o.ads), ogAt: n(o && o.ogAt) };
}
// 날짜가 바뀌었으면 무료 토큰 충전·광고 횟수·오늘 GET 초기화 (true = 변경됨)
function rollDay(s) {
  const today = kstDay();
  if (s.day === today) return false;
  s.day = today; s.dayWins = 0; s.ads = 0; s.tokens = Math.max(s.tokens, FREE_TOKENS);
  return true;
}
function statOf(u) {
  let s = stats.get(u.id);
  if (!s) { s = normStat({ name: u.name, color: u.color }); stats.set(u.id, s); }
  if (rollDay(s)) store.saveUser(u.id, s);
  return s;
}
const saveStat = u => store.saveUser(u.id, stats.get(u.id));
function sendTokens(u) {
  const s = statOf(u);
  send(u.ws, { t: 'tokens', tokens: s.tokens, adLeft: Math.max(0, AD_DAILY_MAX - s.ads), adMax: AD_DAILY_MAX, free: FREE_TOKENS });
}
function rankRows() {
  const today = kstDay();
  return [...stats.entries()].filter(([, s]) => s.day === today && s.dayWins > 0)
    .sort((a, b) => b[1].dayWins - a[1].dayWins || a[1].lastWinAt - b[1].lastWinAt);
}
function rankOf(id) { const i = rankRows().findIndex(([k]) => k === id); return i < 0 ? 0 : i + 1; }

// ================= 게임 방 상태 =================
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];
const users = new Map();   // uid(쿠키 원본, 비공개) -> user { sid, id, name, color, ws }
let queue = [];            // user[] (대기 순서)
let player = null;         // 현재 차례 user
let turnTimer = null;
let snapshot = null;       // 최신 기계 상태 (차례 클라이언트가 보낸 것)
let turnPower = null;      // 이번 차례 집게 세기 0~1 (차례 시작 시 랜덤, 모두에게 공개)
let bet = null;            // 진행 중 내기 { round, playerId, playerName, open, closeAt, timer, entries: Map(id -> {side, amount}) }
let betRound = 0;

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
// ================= 방명록 (store 에 저장, 시작 시 불러옴) =================
let guestbook = [];
function cleanText(t, max = GB_MAX_LEN) {
  if (typeof t !== 'string') return '';
  return Array.from(t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

// 차례가 끝나면 들려 있던 인형은 놓은 상태로 정리
function dropHeld() { if (snapshot) for (const a of snapshot.p) a[7] = 0; }

// ================= 구경꾼 예측 내기 =================
const BET_SIDES = ['succ', 'fail'];
function betPool() {
  const pool = { succ: { n: 0, sum: 0 }, fail: { n: 0, sum: 0 } };
  if (bet) for (const e of bet.entries.values()) { pool[e.side].n++; pool[e.side].sum += e.amount; }
  return pool;
}
const betOpenMsg = () => ({ t: 'bet_open', round: bet.round, player: bet.playerId, name: bet.playerName, closesInMs: Math.max(0, bet.closeAt - Date.now()), max: BET_MAX, power: turnPower, pool: betPool() });
function openBet(u) {
  if (bet) settleBet('void');
  bet = { round: ++betRound, playerId: u.id, playerName: u.name, open: true, closeAt: Date.now() + BET_WINDOW_MS, entries: new Map() };
  bet.timer = setTimeout(closeBet, BET_WINDOW_MS);
  broadcast(betOpenMsg(), u);
}
function closeBet() {
  if (!bet || !bet.open) return;
  bet.open = false; clearTimeout(bet.timer);
  broadcast({ t: 'bet_close', round: bet.round, pool: betPool() });
}
function placeBet(u, m) {
  const reject = reason => send(u.ws, { t: 'bet_reject', round: m.round, reason });
  if (!bet || bet.round !== m.round || !bet.open) return reject('내기 마감');
  if (bet.playerId === u.id) return reject('내 차례에는 참여 불가');
  if (bet.entries.has(u.id)) return reject('이미 참여함');
  if (!BET_SIDES.includes(m.side)) return reject('성공/실패 선택 필요');
  const st = statOf(u);
  const amount = m.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > BET_MAX) return reject(`1~${BET_MAX}개만 가능`);
  if (amount > st.tokens) return reject('토큰 부족');
  st.tokens -= amount; saveStat(u); sendTokens(u);
  bet.entries.set(u.id, { side: m.side, amount });
  send(u.ws, { t: 'bet_ok', round: bet.round, side: m.side, amount });
  broadcast({ t: 'bet_pool', round: bet.round, pool: betPool() });
}
// outcome: 'succ' | 'fail' | 'void'(플레이어 이탈·응답 없음 → 환불)
function settleBet(outcome) {
  if (!bet) return;
  const b = bet; bet = null;
  clearTimeout(b.timer);
  const all = [...b.entries.entries()]; // 건 순서 유지
  const pool = all.reduce((a, [, e]) => a + e.amount, 0);
  const winners = outcome === 'void' ? [] : all.filter(([, e]) => e.side === outcome);
  const refund = !winners.length;
  const share = refund ? 0 : Math.floor(pool / winners.length), rem = refund ? 0 : pool % winners.length;
  const payout = new Map();
  if (refund) for (const [id, e] of all) payout.set(id, e.amount);
  else winners.forEach(([id], i) => payout.set(id, share + (i < rem ? 1 : 0)));
  for (const [id, n] of payout) { const s = stats.get(id); if (s && n > 0) { s.tokens += n; store.saveUser(id, s); } }
  const base = { t: 'bet_result', round: b.round, outcome, name: b.playerName, pool, bettors: all.length, winners: winners.length, share, refund };
  for (const u of users.values()) {
    const e = b.entries.get(u.id);
    send(u.ws, e ? { ...base, mine: { side: e.side, amount: e.amount, payout: payout.get(u.id) || 0 } } : base);
    if (payout.has(u.id)) sendTokens(u);
  }
  if (all.length) log(`bet #${b.round} ${outcome} pool ${pool} bettors ${all.length} winners ${winners.length}`);
}

function startNextTurn() {
  if (player) return false;
  // 차례 시작 시 토큰 1개 차감. 토큰이 없는 대기자는 건너뜀
  while (queue.length && !player) {
    const u = queue.shift();
    const s = statOf(u);
    if (s.tokens <= 0) { send(u.ws, { t: 'need_token' }); sendTokens(u); continue; }
    s.tokens--; saveStat(u); sendTokens(u);
    player = u;
  }
  if (!player) { turnPower = null; return false; }
  turnPower = Math.round(Math.random() * 100) / 100;
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => { log(`timeout ${player && player.name}`); endTurn('void'); }, TURN_LIMIT_MS);
  broadcast({ t: 'turn', player: player.id, snapshot, power: turnPower });
  openBet(player);
  log(`turn -> ${player.name}`);
  return true;
}

// outcome: 정상 종료면 'fail'(GET 이 있었으면 이미 'succ' 로 정산됨), 시간 초과·이탈이면 'void'
function endTurn(outcome = 'fail') {
  settleBet(outcome);
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
  if (player === u) endTurn('void'); else broadcastPresence();
}

function log(t) { console.log(new Date().toISOString().slice(11, 19), t); }

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  let me = null;
  // 쿠키가 없으면(다른 주소에서 ?server= 로 접속 등) 이번 연결 한정 임시 ID
  const uid = readUid(req) || crypto.randomBytes(24).toString('hex');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      if (me) return;
      // 같은 브라우저의 다른 탭이 이미 접속 중이면 새 탭으로 전환: 기존 탭은 종료 안내 후 끊음(기존 탭은 재연결 안 함)
      const old = users.get(uid);
      if (old) { send(old.ws, { t: 'replaced' }); removeUser(old); old.ws.close(4001, 'replaced'); }
      const id = publicId(uid); // 공개용 ID (쿠키 원본은 공유하지 않음)
      me = { sid: uid, id, name: 'Guest-' + id.slice(0, 4).toUpperCase(), color: COLORS[parseInt(id.slice(4, 6), 16) % COLORS.length], ws };
      users.set(me.sid, me);
      const st = statOf(me);
      if (st.name !== me.name || st.color !== me.color) { st.name = me.name; st.color = me.color; saveStat(me); }
      log(`join ${me.name} (${users.size})`);
      send(ws, { ...presenceMsg(), t: 'welcome', you: pub(me), snapshot, power: player ? turnPower : null, guestbook: guestbook.slice(-GB_SEND) });
      sendTokens(me);
      if (bet && bet.open && bet.playerId !== me.id) send(ws, betOpenMsg());
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
        if (player === me || queue.includes(me)) break;
        if (statOf(me).tokens <= 0) { send(ws, { t: 'need_token' }); sendTokens(me); break; }
        queue.push(me); startNextTurn(); broadcastPresence();
        break;
      case 'ad_start': { // 광고(대기 화면) 시작: 시작 시각 기록
        const st = statOf(me);
        if (st.ads >= AD_DAILY_MAX) { send(ws, { t: 'ad_reject', reason: '오늘 광고 보상 모두 사용 (0시 충전)' }); break; }
        me.adAt = Date.now();
        send(ws, { t: 'ad_ok', waitMs: AD_WAIT_MS });
        break;
      }
      case 'ad_claim': { // 최소 시청 시간이 지났을 때만 1회 지급
        const st = statOf(me);
        if (!me.adAt || Date.now() - me.adAt < AD_WAIT_MS - 300) { send(ws, { t: 'ad_reject', reason: '광고 시청 시간 부족' }); break; }
        me.adAt = null;
        if (st.ads >= AD_DAILY_MAX) { send(ws, { t: 'ad_reject', reason: '오늘 광고 보상 모두 사용 (0시 충전)' }); break; }
        st.ads++; st.tokens += AD_REWARD; saveStat(me);
        send(ws, { t: 'ad_done', reward: AD_REWARD });
        sendTokens(me);
        break;
      }
      case 'ad_cancel':
        me.adAt = null;
        break;
      case 'rank_get': {
        const rows = rankRows();
        const i = rows.findIndex(([k]) => k === me.id);
        send(ws, { t: 'rank', day: kstDay(), top: rows.slice(0, RANK_TOP).map(([id, s]) => ({ id, name: s.name, color: s.color, wins: s.dayWins })),
          me: { rank: i < 0 ? 0 : i + 1, wins: statOf(me).dayWins } });
        break;
      }
      case 'queue_leave':
        if (queue.includes(me)) { queue = queue.filter(q => q !== me); broadcastPresence(); }
        break;
      case 'state':
        if (player === me && validSnapshot(m.s)) { snapshot = m.s; broadcast({ t: 'state', s: snapshot }, me); }
        break;
      case 'event':
        if (player === me && m.type === 'get' && Number.isInteger(m.kind) && m.kind >= 0 && m.kind < KIND_INFO.length && /^#[0-9a-fA-F]{6}$/.test(m.color || '')) {
          const st = statOf(me);
          st.total++; st.kinds[m.kind]++; st.dayWins++; st.lastWinAt = Date.now(); saveStat(me);
          broadcast({ t: 'event', type: 'get', by: me.name, byId: me.id, kind: m.kind, color: m.color }, me);
          if (bet && bet.playerId === me.id) { closeBet(); settleBet('succ'); }
        }
        break;
      case 'drop': // 플레이어가 집게를 내림 → 내기 마감
        if (player === me) closeBet();
        break;
      case 'bet':
        placeBet(me, m);
        break;
      case 'point': { // 기계 안 인형 가리키기: 중계만 (같은 id 재전송 = 해제, 클라이언트가 토글)
        const now = Date.now();
        if (!Number.isInteger(m.id) || m.id < 0 || m.id >= 100000) break;
        if (me.pointAt && now - me.pointAt < POINT_INTERVAL_MS) break;
        me.pointAt = now;
        broadcast({ t: 'point', by: me.id, id: m.id }, me);
        break;
      }
      case 'gb_post': {
        const text = cleanText(m.text);
        const now = Date.now();
        if (!text) break;
        if (me.gbAt && now - me.gbAt < GB_INTERVAL_MS) { send(ws, { t: 'gb_reject', reason: '잠시 후 다시 작성' }); break; }
        me.gbAt = now;
        const entry = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), by: me.name, byId: me.id, color: me.color, wins: statOf(me).total, text, t: now }; // wins: 작성 시점 누적 뽑은 횟수
        guestbook.push(entry);
        if (guestbook.length > GB_KEEP) guestbook = guestbook.slice(-GB_KEEP);
        store.addGuestbook(entry);
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

// 저장된 통계·방명록을 불러온 뒤 서버 시작
store.loadAll().then(data => {
  for (const [id, o] of Object.entries(data.stats || {})) if (/^[0-9a-f]{10}$/.test(id)) stats.set(id, normStat(o));
  guestbook = (data.guestbook || []).filter(e => e && typeof e.text === 'string').slice(-GB_KEEP);
  server.listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`Claw Drop 서버 실행: 포트 ${PORT} (저장소: ${store.mode}, 유저 기록 ${stats.size}건, 버전 ${VERSION.label})`);
    for (const ip of ['localhost', ...ips]) console.log(`  http://${ip}:${PORT}/games/claw-machine/`);
  });
});
// 종료(재배포 등) 시 저장 대기분 기록
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { store.flush().finally(() => process.exit(0)); });
