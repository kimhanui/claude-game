// 영구 저장소: 유저 통계(토큰·GET 수 등)와 방명록
// - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 이 있으면 Upstash Redis (REST, 내장 fetch 사용)
// - 없으면 로컬 파일 (data/stats.json, data/guestbook.json)
// 서버는 메모리 값을 기준으로 동작하고 이 모듈은 기록만 담당 → 저장 실패해도 게임은 계속 진행 (로그만 남김)
'use strict';
const fs = require('fs');
const path = require('path');

const GB_KEEP = 200;
const FLUSH_MS = 2000;

function createStore(opts = {}) {
  const url = (opts.url ?? process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/+$/, '');
  const token = opts.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
  const prefix = opts.prefix ?? process.env.REDIS_PREFIX ?? 'cd';
  const dataDir = opts.dataDir ?? path.join(__dirname, 'data');
  const statsFile = opts.statsFile ?? process.env.STATS_FILE ?? path.join(dataDir, 'stats.json');
  const gbFile = opts.gbFile ?? process.env.GB_FILE ?? path.join(dataDir, 'guestbook.json');
  const log = opts.log || (t => console.log(t));
  const K_STATS = `${prefix}:stats`, K_GB = `${prefix}:gb`;

  const dirty = new Map();   // 저장 대기 중인 유저 id -> 객체
  let stats = {};            // 파일 모드에서 전체 덮어쓰기용 참조
  let gbCache = [];          // 파일 모드용 방명록
  let flushTimer = null;

  // ---------- Redis (Upstash REST) ----------
  async function redis(cmds) {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!res.ok) throw new Error(`redis http ${res.status}`);
    const out = await res.json();
    const err = out.find(r => r && r.error);
    if (err) throw new Error(`redis ${err.error}`);
    return out.map(r => r.result);
  }

  // ---------- 파일 ----------
  function writeJson(file, value) {
    return new Promise(resolve => {
      fs.mkdir(path.dirname(file), { recursive: true }, () => {
        const tmp = file + '.tmp';
        fs.writeFile(tmp, JSON.stringify(value), err => {
          if (err) { log(`store write fail ${err.message}`); return resolve(); }
          fs.rename(tmp, file, () => resolve());
        });
      });
    });
  }
  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
  }

  const mode = url && token ? 'redis' : 'file';

  return {
    mode,
    // 시작 시 1회: { stats: {id: obj}, guestbook: [entry] }
    async loadAll() {
      if (mode === 'redis') {
        try {
          const [h, list] = await redis([['HGETALL', K_STATS], ['LRANGE', K_GB, -GB_KEEP, -1]]);
          const out = {};
          for (let i = 0; i + 1 < (h || []).length; i += 2) { try { out[h[i]] = JSON.parse(h[i + 1]); } catch (e) { /* 손상 항목 무시 */ } }
          const gb = (list || []).map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
          stats = out;
          return { stats: out, guestbook: gb };
        } catch (e) {
          log(`store load fail (redis): ${e.message} → 빈 상태로 시작`);
          return { stats: {}, guestbook: [] };
        }
      }
      const s = readJson(statsFile, {});
      stats = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
      const g = readJson(gbFile, []);
      gbCache = Array.isArray(g) ? g.slice(-GB_KEEP) : [];
      return { stats, guestbook: gbCache.slice() };
    },
    // 변경된 유저 기록. 모아서 FLUSH_MS 마다 한 번에 저장
    saveUser(id, obj) {
      stats[id] = obj;
      dirty.set(id, obj);
      if (!flushTimer) flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    },
    async flush() {
      clearTimeout(flushTimer); flushTimer = null;
      if (!dirty.size) return;
      const items = [...dirty.entries()];
      dirty.clear();
      if (mode === 'redis') {
        try { await redis([['HSET', K_STATS, ...items.flatMap(([id, o]) => [id, JSON.stringify(o)])]]); }
        catch (e) { log(`store save fail (redis): ${e.message}`); for (const [id, o] of items) if (!dirty.has(id)) dirty.set(id, o); }
        return;
      }
      await writeJson(statsFile, stats);
    },
    async addGuestbook(entry) {
      if (mode === 'redis') {
        try { await redis([['RPUSH', K_GB, JSON.stringify(entry)], ['LTRIM', K_GB, -GB_KEEP, -1]]); }
        catch (e) { log(`store gb fail (redis): ${e.message}`); }
        return;
      }
      gbCache.push(entry);
      if (gbCache.length > GB_KEEP) gbCache = gbCache.slice(-GB_KEEP);
      await writeJson(gbFile, gbCache);
    },
  };
}

module.exports = { createStore, GB_KEEP };
