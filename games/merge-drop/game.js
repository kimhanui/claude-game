(() => {
  'use strict';

  // ---------- 상수 (논리 좌표 400x640) ----------
  const W = 400, H = 640;
  const WALL_L = 16, WALL_R = W - 16, FLOOR = H - 16;
  const DROP_Y = 56;          // 조준 중인 오브젝트 높이
  const DANGER_Y = 110;       // 이 선 위로 넘친 상태가 지속되면 게임오버
  const OVER_LIMIT = 2.0;     // 초과 허용 시간(초)
  const GRAVITY = 1400;       // px/s^2
  const SUBSTEPS = 8;
  const DAMPING = 0.995;
  const DROP_COOLDOWN = 0.45; // 초
  const MAX_SPEED = 900;      // px/s, 합체로 생긴 큰 겹침이 튕겨나가는 현상 방지

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('nextCanvas');
  const nctx = nextCanvas.getContext('2d');
  const $score = document.getElementById('score');
  const $best = document.getElementById('best');
  const $overlay = document.getElementById('overlay');
  const $final = document.getElementById('finalScore');
  const $themeSelect = document.getElementById('themeSelect');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---------- 테마 ----------
  const themes = window.THEMES || [];
  if (!themes.length) throw new Error('THEMES 가 비어 있음: themes/*.js 로드 확인');
  let theme;
  const imageCache = new Map(); // src -> {img, ok}

  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const entry = { img: new Image(), ok: false };
    entry.img.onload = () => { entry.ok = true; };
    entry.img.onerror = () => { entry.ok = false; console.warn('이미지 로드 실패, 색상으로 대체:', src); };
    entry.img.src = src;
    imageCache.set(src, entry);
    return entry;
  }

  function setTheme(id) {
    theme = themes.find(t => t.id === id) || themes[0];
    theme.tiers.forEach(t => { if (t.image) loadImage(t.image); });
    store.set('mergedrop.theme', theme.id);
    $themeSelect.value = theme.id;
    $best.textContent = bestScore();
    reset();
  }

  themes.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    $themeSelect.appendChild(o);
  });
  $themeSelect.addEventListener('change', () => setTheme($themeSelect.value));

  // ---------- 상태 ----------
  let bodies, effects, score, current, next, aimX, cooldown, overTimer, gameOver, nextId;

  const bestKey = () => 'mergedrop.best.' + theme.id;
  const bestScore = () => parseInt(store.get(bestKey()) || '0', 10) || 0;
  const randTier = () => Math.floor(Math.random() * Math.min(theme.dropTiers || 5, theme.tiers.length));

  function reset() {
    bodies = []; effects = [];
    score = 0; cooldown = 0; overTimer = 0; gameOver = false; nextId = 1;
    current = randTier(); next = randTier();
    aimX = W / 2;
    $score.textContent = '0';
    $overlay.classList.remove('show');
    drawNext();
  }

  function makeBody(tier, x, y) {
    return { id: nextId++, tier, r: theme.tiers[tier].radius, x, y, px: x, py: y, age: 0, dead: false, pop: 0 };
  }

  // ---------- 입력 ----------
  function toLogicalX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (W / rect.width);
  }
  let pointerDown = false;
  canvas.addEventListener('pointerdown', e => { pointerDown = true; aimX = toLogicalX(e.clientX); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { aimX = toLogicalX(e.clientX); });
  canvas.addEventListener('pointerup', e => { if (pointerDown) { aimX = toLogicalX(e.clientX); drop(); } pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') aimX -= 12;
    else if (e.key === 'ArrowRight') aimX += 12;
    else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); drop(); }
  });
  document.getElementById('restartBtn').addEventListener('click', reset);
  document.getElementById('overlayRestart').addEventListener('click', reset);

  function clampAim(r) { return Math.max(WALL_L + r, Math.min(WALL_R - r, aimX)); }

  function drop() {
    if (gameOver || cooldown > 0) return;
    const r = theme.tiers[current].radius;
    bodies.push(makeBody(current, clampAim(r), DROP_Y));
    current = next; next = randTier();
    cooldown = DROP_COOLDOWN;
    drawNext();
  }

  // ---------- 물리 ----------
  function addScore(n) {
    score += n;
    $score.textContent = score;
    if (score > bestScore()) { store.set(bestKey(), String(score)); $best.textContent = score; }
  }

  function merge(a, b) {
    a.dead = b.dead = true;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const last = theme.tiers.length - 1;
    if (a.tier >= last) {
      addScore(theme.finalBonus || 100);
      spawnEffect(mx, my, a.r * 1.4, theme.tiers[last].color);
      return null;
    }
    const nb = makeBody(a.tier + 1, mx, my);
    nb.pop = 1;
    addScore(theme.tiers[nb.tier].score);
    spawnEffect(mx, my, nb.r, theme.tiers[nb.tier].color);
    return nb;
  }

  function step(dt) {
    const h = dt / SUBSTEPS;
    const maxStep = MAX_SPEED * h;
    for (let s = 0; s < SUBSTEPS; s++) {
      // 적분 (Verlet)
      for (const b of bodies) {
        let vx = (b.x - b.px) * DAMPING, vy = (b.y - b.py) * DAMPING;
        const sp = Math.hypot(vx, vy);
        if (sp > maxStep) { vx *= maxStep / sp; vy *= maxStep / sp; }
        b.px = b.x; b.py = b.y;
        b.x += vx; b.y += vy + GRAVITY * h * h;
      }
      // 원-원 충돌 + 합체
      const born = [];
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (a.dead) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (b.dead) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const minD = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD) continue;
          if (a.tier === b.tier) {
            const nb = merge(a, b);
            if (nb) born.push(nb);
            break;
          }
          const d = Math.sqrt(d2) || 0.0001;
          const overlap = (minD - d);
          const nx = dx / d, ny = dy / d;
          const ma = a.r * a.r, mb = b.r * b.r, mt = ma + mb;
          a.x -= nx * overlap * (mb / mt); a.y -= ny * overlap * (mb / mt);
          b.x += nx * overlap * (ma / mt); b.y += ny * overlap * (ma / mt);
        }
      }
      if (born.length || bodies.some(b => b.dead)) {
        bodies = bodies.filter(b => !b.dead).concat(born);
      }
      // 벽·바닥
      for (const b of bodies) {
        if (b.x - b.r < WALL_L) { b.x = WALL_L + b.r; }
        if (b.x + b.r > WALL_R) { b.x = WALL_R - b.r; }
        if (b.y + b.r > FLOOR) {
          b.y = FLOOR - b.r;
          b.px = b.x - (b.x - b.px) * 0.9; // 바닥 마찰
        }
      }
    }
  }

  function checkOver(dt) {
    let over = false;
    for (const b of bodies) {
      if (b.age < 1.0) continue; // 막 떨어진 것은 제외
      const speed = Math.hypot(b.x - b.px, b.y - b.py);
      if (b.y - b.r < DANGER_Y && speed < 1.5) { over = true; break; }
    }
    overTimer = over ? overTimer + dt : 0;
    if (overTimer >= OVER_LIMIT) {
      gameOver = true;
      $final.textContent = '점수 ' + score + ' / 최고점 ' + bestScore();
      $overlay.classList.add('show');
    }
  }

  // ---------- 이펙트 ----------
  function spawnEffect(x, y, r, color) {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 120;
      effects.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, size: 3 + r * 0.06, color });
    }
  }

  // ---------- 렌더 ----------
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  function drawTier(g, tier, x, y, r, alpha = 1) {
    const t = theme.tiers[tier];
    g.save();
    g.globalAlpha = alpha;
    const imgEntry = t.image ? imageCache.get(t.image) : null;
    if (imgEntry && imgEntry.ok) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.closePath();
      g.clip();
      g.drawImage(imgEntry.img, x - r, y - r, r * 2, r * 2);
    } else {
      const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      grad.addColorStop(0, shade(t.color, 60));
      grad.addColorStop(1, t.color);
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = Math.max(1.5, r * 0.06);
      g.strokeStyle = shade(t.color, -50);
      g.stroke();
      if (theme.face) drawFace(g, x, y, r, t.color);
    }
    g.restore();
  }

  function drawFace(g, x, y, r, color) {
    const ex = r * 0.32, ey = -r * 0.1, er = Math.max(1.5, r * 0.1);
    g.fillStyle = '#2d2a3e';
    g.beginPath(); g.arc(x - ex, y + ey, er, 0, Math.PI * 2); g.arc(x + ex, y + ey, er, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x - ex + er * 0.35, y + ey - er * 0.35, er * 0.35, 0, Math.PI * 2);
    g.arc(x + ex + er * 0.35, y + ey - er * 0.35, er * 0.35, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2d2a3e'; g.lineWidth = Math.max(1, r * 0.05); g.lineCap = 'round';
    g.beginPath(); g.arc(x, y + r * 0.12, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.fillStyle = shade(color, 40); g.globalAlpha *= 0.6;
    g.beginPath(); g.arc(x - r * 0.55, y + r * 0.15, r * 0.12, 0, Math.PI * 2); g.arc(x + r * 0.55, y + r * 0.15, r * 0.12, 0, Math.PI * 2); g.fill();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    // 통
    ctx.fillStyle = theme.wallColor || '#888';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = theme.background || '#fff';
    ctx.fillRect(WALL_L, 0, WALL_R - WALL_L, FLOOR);

    // 위험선
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = overTimer > 0 ? `rgba(230,40,60,${0.5 + 0.5 * Math.sin(performance.now() / 80)})` : 'rgba(230,40,60,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(WALL_L, DANGER_Y); ctx.lineTo(WALL_R, DANGER_Y); ctx.stroke();
    ctx.restore();

    // 조준 가이드 + 대기 오브젝트
    if (!gameOver) {
      const r = theme.tiers[current].radius;
      const x = clampAim(r);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, DROP_Y + r); ctx.lineTo(x, FLOOR); ctx.stroke();
      ctx.restore();
      drawTier(ctx, current, x, DROP_Y, r, cooldown > 0 ? 0.4 : 1);
    }

    // 오브젝트
    for (const b of bodies) {
      const s = 1 + b.pop * 0.15;
      drawTier(ctx, b.tier, b.x, b.y, b.r * s);
    }

    // 파티클
    for (const p of effects) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawNext() {
    const S = nextCanvas.width;
    nctx.clearRect(0, 0, S, S);
    drawTier(nctx, next, S / 2, S / 2, S * 0.4);
  }

  // ---------- 화면 맞춤 ----------
  function fit() {
    const stage = document.getElementById('stage');
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const scale = Math.min(sw / W, sh / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * scale * dpr);
    canvas.height = Math.floor(H * scale * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  window.addEventListener('resize', fit);

  // ---------- 루프 ----------
  // 물리는 고정 스텝(1/60초)으로 진행해 프레임레이트와 무관하게 동일한 거동 유지
  const FIXED = 1 / 60;
  let last = performance.now(), acc = 0;
  function tick(dt) {
    cooldown = Math.max(0, cooldown - dt);
    step(dt);
    for (const b of bodies) { b.age += dt; b.pop = Math.max(0, b.pop - dt * 5); }
    checkOver(dt);
  }
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= FIXED) { if (!gameOver) tick(FIXED); acc -= FIXED; }
    for (const p of effects) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    effects = effects.filter(p => p.life > 0);
    render();
    requestAnimationFrame(loop);
  }

  // 시작
  setTheme(store.get('mergedrop.theme') || themes[0].id);
  fit();
  requestAnimationFrame(loop);

  // 디버그/테스트용 노출
  window.MergeDrop = { get state() { return { bodies, score, gameOver, theme }; }, tick, reset, drop, setAim: x => { aimX = x; } };
})();
