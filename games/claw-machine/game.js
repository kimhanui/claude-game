(() => {
  'use strict';
  if (!window.THREE) {
    document.getElementById('msg').textContent = 'three.js 로드 실패 (인터넷 연결 확인)';
    return;
  }

  // ================= 설정 =================
  const HALF = 3;                 // 기계 내부 반폭 (x,z: -3 ~ 3)
  const CHUTE = { x0: -HALF, x1: -1.6, z0: 1.6, z1: HALF };  // 배출구(구멍) 영역
  const CHUTE_WALL_H = 0.75;
  const RAIL_Y = 6.2;             // 집게 레일 높이
  const CLAW_HOME_Y = 5.4;
  const CLAW_REACH = 0.85;        // 허브에서 갈고리 끝까지 길이
  const MOVE_SPEED = 2.4, DROP_SPEED = 2.6, LIFT_SPEED = 2.2;
  const LIMIT = 2.55;             // 집게 이동 한계
  const HOME = { x: (CHUTE.x0 + CHUTE.x1) / 2, z: (CHUTE.z0 + CHUTE.z1) / 2 };
  const AIM_TIME = 20;            // 조준 제한 시간(초)
  const GRAVITY = -14;
  const PRIZE_COUNT = 18;
  const STRENGTH = {              // grab: 잡기 기본 확률, slip: 들고 있는 동안 초당 놓칠 확률
    weak:   { grab: 0.5,  slip: 0.45 },
    normal: { grab: 0.75, slip: 0.18 },
    strong: { grab: 0.95, slip: 0.03 },
  };

  // ================= 렌더러/씬 =================
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14121f');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  // 시점: 카메라 방향(dir)만 정의, 위치·거리는 fitViews() 가 화면 크기에 맞춰 자동 계산
  const VIEWS = [
    { dir: [0, 1, 0.22], name: '탑다운' },
    { dir: [0, 0.55, 1], name: '정면' },
  ];
  let viewIdx = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camReady = false;

  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3550', 0.65));
  const sun = new THREE.DirectionalLight('#ffffff', 0.85);
  sun.position.set(3, 12, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  scene.add(sun);
  const lamp = new THREE.PointLight('#ffd9a0', 0.5, 14);
  lamp.position.set(0, 6.5, 0);
  scene.add(lamp);

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...extra });
  function box(w, h, d, material, x, y, z, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // ================= 기계 =================
  const floorMat = mat('#e9d8ff');
  // 바닥 (배출구 구멍 제외 2조각)
  box(2 * HALF, 0.2, CHUTE.z0 + HALF, floorMat, 0, -0.1, (-HALF + CHUTE.z0) / 2, false);
  box(HALF - CHUTE.x1, 0.2, HALF - CHUTE.z0, floorMat, (CHUTE.x1 + HALF) / 2, -0.1, (CHUTE.z0 + HALF) / 2, false);
  // 배출구 내부 (어두운 구덩이)
  box(CHUTE.x1 - CHUTE.x0, 0.1, CHUTE.z1 - CHUTE.z0, mat('#1b1828'), HOME.x, -1.6, HOME.z, false);
  const pitMat = mat('#2d2945');
  box(0.05, 1.5, CHUTE.z1 - CHUTE.z0, pitMat, CHUTE.x1, -0.85, HOME.z, false);
  box(CHUTE.x1 - CHUTE.x0, 1.5, 0.05, pitMat, HOME.x, -0.85, CHUTE.z0, false);
  // 배출구 칸막이 (아크릴)
  const acrylic = mat('#bfe6ff', { transparent: true, opacity: 0.35, roughness: 0.1 });
  const chuteWalls = [
    { x0: CHUTE.x1 - 0.05, x1: CHUTE.x1 + 0.05, y0: 0, y1: CHUTE_WALL_H, z0: CHUTE.z0 - 0.05, z1: CHUTE.z1 },
    { x0: CHUTE.x0, x1: CHUTE.x1 + 0.05, y0: 0, y1: CHUTE_WALL_H, z0: CHUTE.z0 - 0.05, z1: CHUTE.z0 + 0.05 },
  ];
  for (const w of chuteWalls) box(w.x1 - w.x0, w.y1 - w.y0, w.z1 - w.z0, acrylic, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, (w.z0 + w.z1) / 2, false);
  // 배출구 표시 줄무늬
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(CHUTE.x1 - CHUTE.x0, CHUTE.z1 - CHUTE.z0),
    new THREE.MeshBasicMaterial({ color: '#ffb84d', transparent: true, opacity: 0.12 }));
  stripe.rotation.x = -Math.PI / 2; stripe.position.set(HOME.x, CHUTE_WALL_H + 0.01, HOME.z);
  scene.add(stripe);

  // 기둥·유리·레일
  const frameMat = mat('#ff5d8f', { roughness: 0.4 });
  for (const [x, z] of [[-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF]]) box(0.16, RAIL_Y + 0.6, 0.16, frameMat, x, RAIL_Y / 2 - 0.2, z);
  const glass = mat('#cfe9ff', { transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false });
  box(2 * HALF, RAIL_Y, 0.02, glass, 0, RAIL_Y / 2, -HALF, false);
  box(0.02, RAIL_Y, 2 * HALF, glass, -HALF, RAIL_Y / 2, 0, false);
  box(0.02, RAIL_Y, 2 * HALF, glass, HALF, RAIL_Y / 2, 0, false);
  box(2 * HALF, 1.2, 0.02, glass, 0, 0.6, HALF, false); // 앞면은 낮게 (정면 시점 가림 방지)
  const railMat = mat('#9aa0b5', { metalness: 0.6, roughness: 0.3 });
  box(2 * HALF, 0.1, 0.1, railMat, 0, RAIL_Y, -HALF, false);
  box(2 * HALF, 0.1, 0.1, railMat, 0, RAIL_Y, HALF, false);
  const bridge = box(0.12, 0.12, 2 * HALF, railMat, 0, RAIL_Y - 0.05, 0, false); // 집게 따라 x 이동

  // ================= 집게 =================
  const claw = new THREE.Group();
  scene.add(claw);
  const metal = mat('#d7dbe8', { metalness: 0.75, roughness: 0.25 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 16), metal);
  hub.castShadow = true; claw.add(hub);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), mat('#ff5d8f'));
  cap.position.y = 0.18; claw.add(cap);
  const hinges = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = i * Math.PI * 2 / 3;
    const hinge = new THREE.Group();
    hinge.position.set(0.2, -0.1, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.09), metal);
    arm.position.y = -0.35; arm.castShadow = true;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.09), metal);
    tip.position.set(-0.08, -0.7, 0); tip.rotation.z = -0.5; tip.castShadow = true;
    hinge.add(arm, tip); pivot.add(hinge); claw.add(pivot);
    hinges.push(hinge);
  }
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), mat('#444'));
  scene.add(cable);
  // 바닥 조준 마커
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: '#ff3d6a', transparent: true, opacity: 0.85, depthTest: false }));
  marker.rotation.x = -Math.PI / 2; marker.renderOrder = 10;
  scene.add(marker);
  const ray = new THREE.Raycaster();

  // ================= 인형 =================
  const KINDS = [
    { key: 'bear', name: '곰',  emoji: '🧸', colors: ['#c98b5a', '#a86b3f', '#e7b98a'] },
    { key: 'bunny', name: '토끼', emoji: '🐰', colors: ['#ffffff', '#ffd1e3', '#e8e0ff'] },
    { key: 'cat', name: '고양이',   emoji: '🐱', colors: ['#ffb36b', '#9a9aa8', '#2f2f3a'] },
    { key: 'chick', name: '병아리', emoji: '🐥', colors: ['#ffe15a', '#ffd23f'] },
    { key: 'blob', name: '젤리',  emoji: '💧', colors: ['#7ad7ff', '#8ef0b0', '#c49bff'] },
  ];

  function plushMesh(kind, color, r) {
    const g = new THREE.Group();
    const m = mat(color, { roughness: 0.95 });
    const dark = mat('#222230');
    const add = (geo, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const o = new THREE.Mesh(geo, material);
      o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; o.receiveShadow = true;
      g.add(o); return o;
    };
    const body = new THREE.SphereGeometry(r, 20, 14);
    if (kind.key === 'blob') {
      add(body, m, 0, -r * 0.1, 0, 1.1, 0.85, 1.1);
      add(new THREE.SphereGeometry(r * 0.1, 8, 6), dark, -r * 0.3, r * 0.15, r * 0.88);
      add(new THREE.SphereGeometry(r * 0.1, 8, 6), dark, r * 0.3, r * 0.15, r * 0.88);
      return g;
    }
    // 몸통 + 머리
    add(body, m, 0, -r * 0.35, 0, 0.9, 0.7, 0.9);
    const hr = r * 0.62;
    const headY = r * 0.32;
    add(new THREE.SphereGeometry(hr, 20, 14), m, 0, headY, 0);
    const eye = new THREE.SphereGeometry(hr * 0.12, 8, 6);
    add(eye, dark, -hr * 0.38, headY + hr * 0.1, hr * 0.9);
    add(eye, dark, hr * 0.38, headY + hr * 0.1, hr * 0.9);
    if (kind.key === 'bear') {
      const ear = new THREE.SphereGeometry(hr * 0.32, 10, 8);
      add(ear, m, -hr * 0.7, headY + hr * 0.75, 0); add(ear, m, hr * 0.7, headY + hr * 0.75, 0);
      add(new THREE.SphereGeometry(hr * 0.3, 10, 8), mat('#f3dcc2'), 0, headY - hr * 0.2, hr * 0.85, 1, 0.75, 0.6);
    } else if (kind.key === 'bunny') {
      const ear = new THREE.SphereGeometry(hr * 0.22, 10, 8);
      add(ear, m, -hr * 0.35, headY + hr * 1.2, 0, 1, 2.6, 0.7); add(ear, m, hr * 0.35, headY + hr * 1.2, 0, 1, 2.6, 0.7);
    } else if (kind.key === 'cat') {
      const ear = new THREE.ConeGeometry(hr * 0.3, hr * 0.5, 4);
      add(ear, m, -hr * 0.55, headY + hr * 0.9, 0); add(ear, m, hr * 0.55, headY + hr * 0.9, 0);
    } else if (kind.key === 'chick') {
      const beak = add(new THREE.ConeGeometry(hr * 0.16, hr * 0.35, 8), mat('#ff8c2a'), 0, headY - hr * 0.1, hr * 1.02);
      beak.rotation.x = Math.PI / 2;
    }
    return g;
  }

  let prizes = [];
  let nextId = 1;                 // 인형 고유 번호 (멀티 스냅샷 동기화용)
  function makePrize(id, kind, color, r, x, y, z, rotY) {
    const mesh = plushMesh(kind, color, r);
    mesh.rotation.y = rotY;
    scene.add(mesh);
    nextId = Math.max(nextId, id + 1);
    return { id, kind, color, r, mesh, x, y, z, px: x, py: y, pz: z, tx: x, ty: y, tz: z, held: false, spin: (Math.random() - 0.5) * 0.4, tiltX: 0, tiltZ: 0 };
  }
  function spawnPrize(x, y, z) {
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    const color = kind.colors[Math.floor(Math.random() * kind.colors.length)];
    const p = makePrize(nextId, kind, color, 0.42 + Math.random() * 0.14, x, y, z, Math.random() * Math.PI * 2);
    prizes.push(p);
    return p;
  }

  function inChuteXZ(x, z) { return x > CHUTE.x0 && x < CHUTE.x1 && z > CHUTE.z0 && z < CHUTE.z1; }

  function refill() {
    const need = PRIZE_COUNT - prizes.length;
    for (let i = 0; i < need; i++) {
      let x, z;
      do { x = (Math.random() * 2 - 1) * (HALF - 0.5); z = (Math.random() * 2 - 1) * (HALF - 0.5); }
      while (x < CHUTE.x1 + 0.5 && z > CHUTE.z0 - 0.5);
      spawnPrize(x, 1.5 + Math.random() * 3, z);
    }
    for (let i = 0; i < 400; i++) physics(1 / 60); // 미리 안착
  }

  // ================= 물리 (구 근사 Verlet) =================
  function collideBox(p, b) {
    const cx = Math.max(b.x0, Math.min(p.x, b.x1));
    const cy = Math.max(b.y0, Math.min(p.y, b.y1));
    const cz = Math.max(b.z0, Math.min(p.z, b.z1));
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= p.r * p.r || d2 === 0) return;
    const d = Math.sqrt(d2), push = (p.r - d) / d;
    p.x += dx * push; p.y += dy * push; p.z += dz * push;
  }

  function physics(dt) {
    const SUB = 4, h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (const p of prizes) {
        if (p.held) continue;
        const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995, vz = (p.z - p.pz) * 0.995;
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x += vx; p.y += vy + GRAVITY * h * h; p.z += vz;
      }
      for (let it = 0; it < 2; it++) {
        for (let i = 0; i < prizes.length; i++) {
          const a = prizes[i];
          for (let j = i + 1; j < prizes.length; j++) {
            const b = prizes[j];
            if (a.held && b.held) continue;
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const min = (a.r + b.r) * 0.92; // 봉제인형이라 약간 눌림 허용
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= min * min || d2 === 0) continue;
            const d = Math.sqrt(d2), o = (min - d) / d;
            const wa = a.held ? 0 : b.held ? 1 : 0.5, wb = 1 - wa;
            a.x -= dx * o * wa; a.y -= dy * o * wa; a.z -= dz * o * wa;
            b.x += dx * o * wb; b.y += dy * o * wb; b.z += dz * o * wb;
          }
        }
        for (const p of prizes) {
          if (p.held) continue;
          // 바닥 (배출구 위는 구멍)
          if (!inChuteXZ(p.x, p.z) && p.y < p.r) {
            p.y = p.r;
            p.px = p.x - (p.x - p.px) * 0.8; p.pz = p.z - (p.z - p.pz) * 0.8; // 마찰
          }
          // 외벽
          p.x = Math.max(-HALF + p.r, Math.min(HALF - p.r, p.x));
          p.z = Math.max(-HALF + p.r, Math.min(HALF - p.r, p.z));
          for (const w of chuteWalls) collideBox(p, w);
        }
      }
    }
  }

  // ================= 게임 상태 =================
  const $ = id => document.getElementById(id);
  const ui = { coins: $('coins'), won: $('won'), timer: $('timer'), msg: $('msg'), toast: $('toast'), bag: $('bagItems') };
  let coins = 10, sessionWon = 0;

  // ================= 컬렉션 (뽑은 인형, 브라우저에 저장) =================
  const COLL_KEY = 'clawdrop.collection';
  let collection = [];
  try { collection = JSON.parse(localStorage.getItem(COLL_KEY) || '[]').filter(c => KINDS.some(k => k.key === c.kind)); } catch (e) { collection = []; }
  const saveCollection = () => { try { localStorage.setItem(COLL_KEY, JSON.stringify(collection)); } catch (e) { /* 저장 불가 환경 무시 */ } };
  const kindOf = key => KINDS.find(k => k.key === key);

  // 썸네일: 별도 작은 렌더러로 인형을 정면에서 찍어 이미지로 보관
  let thumbRenderer = null;
  const thumbCache = new Map();
  function makeThumb(c) {
    const ck = c.kind + c.color;
    if (thumbCache.has(ck)) return thumbCache.get(ck);
    try {
      if (!thumbRenderer) {
        thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbRenderer.setSize(160, 160, false);
      }
      const ts = new THREE.Scene();
      ts.add(new THREE.HemisphereLight('#ffffff', '#6a6290', 0.9));
      const dl = new THREE.DirectionalLight('#ffffff', 0.7); dl.position.set(2, 3, 4); ts.add(dl);
      const r = 0.5, mesh = plushMesh(kindOf(c.kind), c.color, r);
      mesh.rotation.y = -0.35;
      ts.add(mesh);
      const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
      cam.position.set(0, r * 0.9, r * 4.6); cam.lookAt(0, r * 0.15, 0);
      thumbRenderer.render(ts, cam);
      const url = thumbRenderer.domElement.toDataURL('image/png');
      mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      thumbCache.set(ck, url);
      return url;
    } catch (e) { return null; }
  }

  const $coll = $('collection'), $collGrid = $('collGrid'), $collSummary = $('collSummary'), $collCount = $('collCount');
  const collOpen = () => $coll.classList.contains('show');
  function renderCollection() {
    $collCount.textContent = collection.length;
    $collSummary.innerHTML = '';
    for (const k of KINDS) {
      const n = collection.filter(c => c.kind === k.key).length;
      const chip = document.createElement('span');
      chip.className = 'sum' + (n ? '' : ' none');
      chip.textContent = `${k.emoji} ${k.name} ${n}`;
      $collSummary.appendChild(chip);
    }
    $collGrid.innerHTML = '';
    if (!collection.length) { $collGrid.innerHTML = '<p class="empty">아직 뽑은 인형 없음</p>'; return; }
    collection.slice().reverse().forEach((c, i) => {
      const k = kindOf(c.kind);
      const card = document.createElement('div'); card.className = 'item';
      const url = makeThumb(c);
      const thumb = document.createElement(url ? 'img' : 'div');
      thumb.className = 'thumb';
      if (url) { thumb.src = url; thumb.alt = k.name; } else thumb.textContent = k.emoji;
      const name = document.createElement('div'); name.className = 'name'; name.textContent = k.name;
      const meta = document.createElement('div'); meta.className = 'meta';
      const d = new Date(c.t);
      meta.textContent = `#${collection.length - i} · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = c.color;
      name.prepend(dot);
      card.append(thumb, name, meta);
      $collGrid.appendChild(card);
    });
  }
  function openCollection() { keys.clear(); renderCollection(); $coll.classList.add('show'); }
  function closeCollection() { $coll.classList.remove('show'); }
  const st = { phase: 'aim', x: HOME.x, z: HOME.z, y: CLAW_HOME_Y, open: 0.55, timer: AIM_TIME, held: null, targetY: 0, wait: 0 };
  const keys = new Set();

  // ================= 멀티 모드 =================
  // role: single(혼자) / connecting(서버 연결 중) / spectator(구경) / player(내 차례, 이 클라이언트가 물리 진행)
  const NET = window.ClawNet || null;
  let role = NET ? 'connecting' : 'single';
  let conn = null, me = null;
  let presence = { users: [], queue: [], player: null };
  const clawTarget = { x: st.x, y: st.y, z: st.z, open: st.open };
  const simulating = () => role === 'single' || role === 'player';
  const noCoins = () => role === 'single' && coins <= 0;
  const userById = id => presence.users.find(u => u.id === id);
  const r3 = v => Math.round(v * 1000) / 1000;

  function exportSnapshot() {
    return {
      c: [r3(st.x), r3(st.y), r3(st.z), r3(st.open), st.phase, Math.max(0, Math.ceil(st.timer))],
      p: prizes.map(p => [p.id, KINDS.indexOf(p.kind), p.color, r3(p.r), r3(p.x), r3(p.y), r3(p.z), p.held ? 1 : 0, r3(p.mesh.rotation.y)]),
    };
  }

  // exact: 위치 즉시 반영(차례 시작) / 아니면 목표값만 갱신해 부드럽게 따라감(구경)
  function applySnapshot(s, exact) {
    if (!s || !Array.isArray(s.p) || !Array.isArray(s.c)) return;
    const byId = new Map(prizes.map(p => [p.id, p]));
    const next = [];
    for (const a of s.p) {
      const kind = KINDS[a[1]];
      if (!kind || !Number.isFinite(a[0])) continue;
      let p = byId.get(a[0]);
      if (p) byId.delete(a[0]);
      else p = makePrize(a[0], kind, String(a[2]), +a[3] || 0.45, +a[4], +a[5], +a[6], +a[8] || 0);
      p.tx = +a[4]; p.ty = +a[5]; p.tz = +a[6];
      p.held = !!a[7];
      if (exact) { p.x = p.px = p.tx; p.y = p.py = p.ty; p.z = p.pz = p.tz; }
      next.push(p);
    }
    for (const p of byId.values()) scene.remove(p.mesh); // 배출됐거나 사라진 인형
    prizes = next;
    const [cx, cy, cz, open, phase, timer] = s.c;
    Object.assign(clawTarget, { x: +cx, y: +cy, z: +cz, open: +open });
    if (exact) Object.assign(st, clawTarget);
    if (typeof phase === 'string') st.phase = phase;
    if (Number.isFinite(timer)) st.timer = timer;
  }

  // 구경 중: 수신한 목표값으로 부드럽게 보간
  function followSnapshot(dt) {
    const k = Math.min(1, dt * 12);
    for (const p of prizes) {
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
    }
    st.x += (clawTarget.x - st.x) * k; st.y += (clawTarget.y - st.y) * k;
    st.z += (clawTarget.z - st.z) * k; st.open += (clawTarget.open - st.open) * k;
  }

  let sendAcc = 0;
  const sendState = () => conn && conn.send({ t: 'state', s: exportSnapshot() });

  function beginTurn(snap) {
    role = 'player';
    if (snap) applySnapshot(snap, true);
    for (const p of prizes) { p.held = false; p.px = p.x; p.py = p.y; p.pz = p.z; }
    Object.assign(st, { x: HOME.x, z: HOME.z, y: CLAW_HOME_Y, open: 0.55, held: null });
    if (prizes.length < 10) refill();
    keys.clear();
    startAim();
    toast('내 차례!');
    sendState();
    updateNetUi();
  }

  // 1판 종료 → 서버에 알리고 구경으로 전환
  function finishTurn() {
    if (conn) conn.send({ t: 'turn_end', s: exportSnapshot() });
    becomeSpectator();
  }
  function becomeSpectator() {
    if (role === 'player') releaseHeld();
    role = 'spectator';
    keys.clear();
    for (const p of prizes) { p.tx = p.x; p.ty = p.y; p.tz = p.z; }
    Object.assign(clawTarget, { x: st.x, y: st.y, z: st.z, open: st.open });
    updateNetUi();
  }

  const PHASE_TEXT = { aim: '조준 중', drop: '내려가는 중', close: '잡는 중', lift: '올리는 중', return: '배출구로 이동 중', release: '내려놓는 중', settle: '정리 중' };
  function spectatorMsg() {
    if (role === 'connecting') return '서버 연결 중...';
    if (role === 'offline') return '서버 연결 끊김, 재연결 중...';
    const p = userById(presence.player);
    const qi = me ? presence.queue.indexOf(me.id) : -1;
    if (p) return `${p.name} 플레이 중 · ${PHASE_TEXT[st.phase] || ''}` + (qi >= 0 ? ` · 내 순서 ${qi + 1}번째` : '');
    return '비어 있음: "플레이하기" 를 눌러 시작';
  }

  function updateNetUi() {
    if (!NET || !me) return;
    const list = $('peopleList');
    list.innerHTML = '';
    const order = [];
    const pl = userById(presence.player);
    if (pl) order.push([pl, '플레이 중']);
    presence.queue.forEach((id, i) => { const u = userById(id); if (u) order.push([u, `대기 ${i + 1}`]); });
    for (const u of presence.users) if (!order.some(o => o[0] === u)) order.push([u, '구경']);
    for (const [u, status] of order) {
      const li = document.createElement('li');
      if (u.id === me.id) li.className = 'me';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = u.color;
      const name = document.createElement('span'); name.className = 'pname'; name.textContent = u.name + (u.id === me.id ? ' (나)' : '');
      const stt = document.createElement('span'); stt.className = 'pstat'; stt.textContent = status;
      li.append(dot, name, stt);
      list.appendChild(li);
    }
    $('peopleCount').textContent = presence.users.length;
    $('meName').textContent = me.name;
    $('meName').style.color = me.color;
    const btn = $('queueBtn');
    const qi = presence.queue.indexOf(me.id);
    btn.disabled = role === 'player' || role === 'offline';
    btn.textContent = role === 'player' ? '내 차례 (1판)' : qi >= 0 ? `대기 취소 (${qi + 1}번째)` : (!presence.player && !presence.queue.length ? '플레이하기' : '대기열 등록');
    const canControl = role === 'player';
    $('refillBtn').disabled = !canControl;
    $('strength').disabled = !canControl;
    rebuildAvatars();
  }

  function onNetMessage(m) {
    switch (m.t) {
      case 'welcome':
        me = m.you;
        presence = { users: m.users || [], queue: m.queue || [], player: m.player || null };
        document.body.classList.add('multi');
        guestbook = Array.isArray(m.guestbook) ? m.guestbook : [];
        gbBook.visible = true;
        refreshBook();
        if (gbOpen()) renderGuestbook();
        becomeSpectator();
        if (m.snapshot) applySnapshot(m.snapshot, !prizes.length);
        else if (!prizes.length) { refill(); conn.send({ t: 'init', s: exportSnapshot() }); becomeSpectator(); }
        resize();
        break;
      case 'presence':
        presence = { users: m.users, queue: m.queue, player: m.player };
        updateNetUi();
        break;
      case 'turn':
        presence.player = m.player;
        if (me && m.player === me.id) beginTurn(m.snapshot);
        else {
          if (role === 'player') becomeSpectator(); // 시간 초과 등으로 차례 종료
          if (m.snapshot) applySnapshot(m.snapshot, false);
          updateNetUi();
        }
        break;
      case 'state':
        if (role !== 'player') applySnapshot(m.s, false);
        break;
      case 'gb_new':
        if (m.entry) addGuestbookEntry(m.entry);
        break;
      case 'gb_reject':
        toast(m.reason || '등록 실패');
        break;
      case 'event':
        if (m.type === 'get' && KINDS[m.kind]) toast(`GET! ${KINDS[m.kind].emoji} ${m.by}`);
        break;
    }
  }

  // ================= 접속자 아바타 (기계 앞 = 플레이어, 오른쪽 줄 = 구경·대기) =================
  const avatarGroup = new THREE.Group();
  scene.add(avatarGroup);
  const stageGroup = new THREE.Group();
  stageGroup.visible = false;
  scene.add(stageGroup);
  {
    const stageMat = mat('#2a2640');
    const front = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 2, 0.1, 1.4), stageMat);
    front.position.set(1, -0.05, HALF + 0.7); front.receiveShadow = true;
    const side = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2 * HALF), stageMat);
    side.position.set(HALF + 1, -0.05, 0); side.receiveShadow = true;
    stageGroup.add(front, side);
  }
  const AVATAR_SLOTS = 8;
  function labelSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(20,18,31,.8)';
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 8, 248, 48, 16); else g.rect(4, 8, 248, 48);
    g.fill();
    g.fillStyle = color; g.font = 'bold 28px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sp.scale.set(1.5, 0.375, 1);
    sp.renderOrder = 20;
    return sp;
  }
  function avatarMesh(u, isMe, isPlayer) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 14), mat(u.color));
    body.position.y = 0.25; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat('#f6e1c8'));
    head.position.y = 0.66; head.castShadow = true;
    const eye = new THREE.SphereGeometry(0.025, 6, 4), dark = mat('#222230');
    const e1 = new THREE.Mesh(eye, dark); e1.position.set(-0.06, 0.69, 0.15);
    const e2 = new THREE.Mesh(eye, dark); e2.position.set(0.06, 0.69, 0.15);
    g.add(body, head, e1, e2);
    if (isMe) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 24), new THREE.MeshBasicMaterial({ color: '#ffb84d' }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    }
    const label = labelSprite((isPlayer ? '🕹 ' : '') + u.name + (isMe ? ' (나)' : ''), u.color);
    label.position.y = 1.1;
    g.add(label);
    return g;
  }
  let avatarKey = '', avatars = [];
  function rebuildAvatars() {
    const others = [...presence.queue.map(userById), ...presence.users.filter(u => u.id !== presence.player && !presence.queue.includes(u.id))].filter(Boolean);
    const key = JSON.stringify([presence.player, others.map(u => u.id), presence.users.length]);
    if (key === avatarKey) return;
    avatarKey = key;
    for (const o of avatars) {
      avatarGroup.remove(o);
      o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose(); } });
    }
    avatars = [];
    const pl = userById(presence.player);
    if (pl) {
      const a = avatarMesh(pl, me && pl.id === me.id, true);
      a.position.set(0, 0, HALF + 0.7);
      avatars.push(a);
    }
    others.slice(0, AVATAR_SLOTS).forEach((u, i) => {
      const a = avatarMesh(u, me && u.id === me.id, false);
      a.position.set(HALF + 1, 0, -HALF + 0.4 + i * (2 * HALF - 0.8) / (AVATAR_SLOTS - 1));
      avatars.push(a);
    });
    for (const a of avatars) avatarGroup.add(a);
    stageGroup.visible = true;
  }

  // ================= 방명록 (멀티 모드, 서버 저장) =================
  const GB_MAX = 100;
  let guestbook = [], gbUnread = 0;
  const $gb = $('guestbook'), $gbList = $('gbList'), $gbInput = $('gbInput');
  const gbOpen = () => $gb.classList.contains('show');
  function fmtTime(t) {
    const d = new Date(t), now = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  // 작성 시점 뽑은 횟수 (예전 글은 기록 없음)
  const winsText = e => Number.isInteger(e.wins) ? `🧸 ${e.wins}회` : '';
  const isToday = t => new Date(t).toDateString() === new Date().toDateString();
  function renderGuestbook() {
    $('gbCount').textContent = guestbook.length;
    $gbList.innerHTML = '';
    if (!guestbook.length) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = '첫 글을 남겨 주세요';
      $gbList.appendChild(li); return;
    }
    for (const e of guestbook.slice().reverse()) {
      const li = document.createElement('li');
      const head = document.createElement('div'); head.className = 'gb-head';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#888';
      const name = document.createElement('span'); name.className = 'gb-name'; name.textContent = e.by + (me && e.byId === me.id ? ' (나)' : '');
      const won = document.createElement('span'); won.className = 'gb-wins'; won.textContent = winsText(e);
      const time = document.createElement('span'); time.className = 'gb-time'; time.textContent = fmtTime(e.t);
      head.append(dot, name, won, time);
      const text = document.createElement('div'); text.className = 'gb-text'; text.textContent = e.text;
      li.append(head, text);
      $gbList.appendChild(li);
    }
  }
  // 기계 왼쪽 바닥에 놓인 방명록(받침대 + 펼친 책). 클릭 또는 G 로 열기
  const gbBook = new THREE.Group();
  gbBook.position.set(-HALF - 2.3, 0, 0.2);
  gbBook.visible = false; // 멀티 모드에서만 표시
  scene.add(gbBook);
  const gbPageCanvas = document.createElement('canvas');
  gbPageCanvas.width = 1024; gbPageCanvas.height = 680;
  const gbPageTex = new THREE.CanvasTexture(gbPageCanvas);
  const gbLabelCanvas = document.createElement('canvas');
  gbLabelCanvas.width = 512; gbLabelCanvas.height = 96;
  const gbLabelTex = new THREE.CanvasTexture(gbLabelCanvas);
  {
    const wood = mat('#8a5a3c');
    const pad = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 2.6), mat('#2a2640'));
    pad.position.y = -0.05; pad.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.6), wood);
    base.position.y = 0.03; base.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 10), wood);
    post.position.y = 0.33; post.castShadow = true;
    const tilt = new THREE.Group(); // 책 면이 위·정면(+z)을 함께 보도록 기울임
    tilt.position.y = 0.68; tilt.rotation.x = -Math.PI / 2 + 0.4;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.42, 0.06), mat('#9b2d4a'));
    cover.castShadow = true;
    const pages = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 1.32), new THREE.MeshBasicMaterial({ map: gbPageTex }));
    pages.position.z = 0.032;
    tilt.add(cover, pages);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: gbLabelTex, depthTest: false }));
    label.scale.set(2, 0.375, 1); label.renderOrder = 20;
    label.position.set(0, 1.1, -1.05); // 탑다운에서 책 위쪽(화면상)으로 보이도록 뒤편에 배치
    gbBook.add(pad, base, post, tilt, label);
  }
  function fitText(g, text, maxW, maxLines) {
    const lines = [];
    let cur = '';
    for (const ch of Array.from(text)) {
      if (g.measureText(cur + ch).width > maxW && cur) {
        if (lines.length === maxLines - 1) { cur = cur.slice(0, -1) + '…'; break; }
        lines.push(cur); cur = '';
      }
      cur += ch;
    }
    lines.push(cur);
    return lines;
  }
  function refreshBook() {
    const g = gbPageCanvas.getContext('2d');
    const W = gbPageCanvas.width, H = gbPageCanvas.height;
    g.fillStyle = '#fbf3e2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9c9a8'; g.fillRect(W / 2 - 3, 0, 6, H);
    g.textBaseline = 'top'; g.textAlign = 'left';
    // 왼쪽 면: 제목·건수·새 글
    g.fillStyle = '#5b3a2a'; g.font = 'bold 120px system-ui, sans-serif';
    g.fillText('방명록', 50, 60);
    g.font = '64px system-ui, sans-serif'; g.fillStyle = '#7a6352';
    g.fillText(`오늘 총 ${guestbook.filter(e => isToday(e.t)).length}건`, 50, 230);
    if (gbUnread > 0) { g.fillStyle = '#e2475b'; g.font = 'bold 72px system-ui, sans-serif'; g.fillText(`새 글 ${gbUnread > 99 ? '99+' : gbUnread}`, 50, 330); }
    g.fillStyle = '#9a8670'; g.font = '48px system-ui, sans-serif';
    g.fillText('클릭 또는 G 로 쓰기', 50, H - 100);
    // 오른쪽 면: 최근 글 3건 (한 줄씩)
    let y = 40;
    const recent = guestbook.slice(-3).reverse();
    if (!recent.length) { g.fillStyle = '#9a8670'; g.font = '52px system-ui, sans-serif'; for (const line of fitText(g, '첫 글을 남겨 주세요', W / 2 - 90, 2)) { g.fillText(line, W / 2 + 45, y); y += 64; } }
    for (const e of recent) {
      g.fillStyle = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#888';
      g.beginPath(); g.arc(W / 2 + 60, y + 24, 16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5b3a2a'; g.font = 'bold 46px system-ui, sans-serif';
      g.fillText(String(e.by), W / 2 + 90, y);
      const wt = winsText(e);
      if (wt) { const nx = W / 2 + 90 + g.measureText(String(e.by)).width + 16; g.fillStyle = '#c0781f'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText(wt, nx, y + 4); }
      g.fillStyle = '#3a2a20'; g.font = '50px system-ui, sans-serif';
      g.fillText(fitText(g, String(e.text), W / 2 - 90, 1)[0], W / 2 + 45, y + 62);
      y += 205;
    }
    gbPageTex.needsUpdate = true;
    // 위에 뜨는 이름표
    const l = gbLabelCanvas.getContext('2d');
    l.clearRect(0, 0, 512, 96);
    l.fillStyle = 'rgba(20,18,31,.82)';
    l.beginPath();
    if (l.roundRect) l.roundRect(6, 12, 500, 72, 24); else l.rect(6, 12, 500, 72);
    l.fill();
    l.textAlign = 'center'; l.textBaseline = 'middle'; l.font = 'bold 40px system-ui, sans-serif';
    l.fillStyle = gbUnread > 0 ? '#ff8a98' : '#ffb84d';
    l.fillText(gbUnread > 0 ? `📖 방명록 · 새 글 ${gbUnread > 99 ? '99+' : gbUnread}` : '📖 방명록 (G)', 256, 50);
    gbLabelTex.needsUpdate = true;
  }
  // 책 클릭 판정
  const pickRay = new THREE.Raycaster(), pickNdc = new THREE.Vector2();
  function pointerOnBook(e) {
    if (!gbBook.visible) return false;
    pickNdc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    pickRay.setFromCamera(pickNdc, camera);
    return pickRay.intersectObjects(gbBook.children.slice(1), true).length > 0; // 바닥 판(pad) 제외
  }
  canvas.addEventListener('pointerdown', e => { if (pointerOnBook(e)) { e.preventDefault(); openGuestbook(); } });
  canvas.addEventListener('pointermove', e => { canvas.style.cursor = pointerOnBook(e) ? 'pointer' : ''; });
  function openGuestbook() {
    if (!me) return;
    keys.clear();
    gbUnread = 0; refreshBook();
    renderGuestbook();
    $gb.classList.add('show');
    $gbInput.focus();
  }
  function closeGuestbook() { $gb.classList.remove('show'); $gbInput.blur(); }
  function addGuestbookEntry(e) {
    guestbook.push(e);
    if (guestbook.length > 200) guestbook = guestbook.slice(-200);
    if (gbOpen()) renderGuestbook();
    else if (!me || e.byId !== me.id) gbUnread++;
    refreshBook();
  }
  function postGuestbook() {
    const text = $gbInput.value.trim();
    if (!text || !conn) return;
    conn.send({ t: 'gb_post', text: text.slice(0, GB_MAX) });
    $gbInput.value = '';
    $('gbLeft').textContent = GB_MAX;
  }

  const TOUCH = !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches);
  const HOWTO = TOUCH ? '◀▲▼▶ 로 이동, DROP 으로 내리기' : '방향키로 이동, Space 로 내리기';
  function setMsg(t) { ui.msg.textContent = t; }
  function toast(t) {
    ui.toast.textContent = t; ui.toast.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => ui.toast.classList.remove('show'), 1100);
  }
  function updateHud() {
    ui.coins.textContent = coins;
    ui.won.textContent = collection.length;
    ui.bag.textContent = collection.length ? collection.slice(-12).map(c => kindOf(c.kind).emoji).join('') + (collection.length > 12 ? ' …' : '') : '-';
    ui.timer.textContent = st.phase === 'aim' && !noCoins() && role !== 'connecting' ? Math.ceil(st.timer) : '-';
    if (!simulating()) { const t = spectatorMsg(); if (ui.msg.textContent !== t) setMsg(t); }
  }

  function startAim() {
    st.phase = 'aim'; st.timer = AIM_TIME;
    if (role === 'player') setMsg('내 차례 (1판): ' + HOWTO);
    else setMsg(coins > 0 ? HOWTO : '코인 부족: "코인 +5" 를 눌러 충전');
  }

  function drop() {
    if (!simulating() || st.phase !== 'aim' || noCoins()) return;
    if (role === 'single') coins--;
    st.phase = 'drop';
    // 집게 아래에서 가장 높은 표면까지 내려감
    let surface = 0;
    for (const p of prizes) {
      if (p.held) continue;
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      if (d < p.r + 0.15) surface = Math.max(surface, p.y + Math.sqrt(Math.max(0, (p.r + 0.15) ** 2 - d * d)) * 0.75);
    }
    if (inChuteXZ(st.x, st.z)) surface = Math.max(surface, -0.5);
    st.targetY = Math.max(surface, 0) + CLAW_REACH - 0.35;
    setMsg('내려가는 중...');
  }

  function tryGrab() {
    const cfg = STRENGTH[$('strength').value];
    const tipY = st.y - CLAW_REACH;
    let best = null, bestD = Infinity;
    for (const p of prizes) {
      if (p.held) continue;
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      const vertOk = p.y + p.r > tipY - 0.1 && p.y - p.r < st.y;
      if (d < 0.6 && vertOk && d < bestD) { best = p; bestD = d; }
    }
    if (!best) return null;
    const align = 1 - Math.min(1, bestD / 0.6) * 0.6;   // 중심에 가까울수록 유리
    const sizePenalty = best.r > 0.5 ? 0.85 : 1;
    if (Math.random() < cfg.grab * align * sizePenalty) {
      best.held = true;
      best.offX = (best.x - st.x) * 0.4; best.offZ = (best.z - st.z) * 0.4;
      return best;
    }
    // 실패: 살짝 밀려남
    const ang = Math.atan2(best.z - st.z, best.x - st.x);
    best.px -= Math.cos(ang) * 0.05; best.pz -= Math.sin(ang) * 0.05; best.py -= 0.03;
    return null;
  }

  function releaseHeld() {
    const p = st.held;
    if (!p) return;
    p.held = false; p.px = p.x; p.py = p.y; p.pz = p.z;
    st.held = null;
  }

  function updateClaw(dt) {
    const cfg = STRENGTH[$('strength').value];
    switch (st.phase) {
      case 'aim': {
        if (noCoins()) break;
        let mx = 0, mz = 0;
        if (keys.has('left')) mx -= 1; if (keys.has('right')) mx += 1;
        if (keys.has('up')) mz -= 1; if (keys.has('down')) mz += 1;
        st.x = Math.max(-LIMIT, Math.min(LIMIT, st.x + mx * MOVE_SPEED * dt));
        st.z = Math.max(-LIMIT, Math.min(LIMIT, st.z + mz * MOVE_SPEED * dt));
        st.timer -= dt;
        if (st.timer <= 0) drop();
        break;
      }
      case 'drop':
        st.y -= DROP_SPEED * dt;
        if (st.y <= st.targetY) { st.y = st.targetY; st.phase = 'close'; st.wait = 0.6; setMsg('잡는 중...'); }
        break;
      case 'close':
        st.open = Math.max(0.12, st.open - dt * 1.2);
        st.wait -= dt;
        if (st.wait <= 0) {
          st.held = tryGrab();
          if (st.held) st.open = 0.28;
          st.phase = 'lift';
          setMsg(st.held ? '잡았다! 올리는 중...' : '헛손질...');
        }
        break;
      case 'lift':
        st.y = Math.min(CLAW_HOME_Y, st.y + LIFT_SPEED * dt);
        if (st.held && Math.random() < cfg.slip * dt) { releaseHeld(); setMsg('앗, 놓쳤다!'); }
        if (st.y >= CLAW_HOME_Y) st.phase = 'return';
        break;
      case 'return': {
        const dx = HOME.x - st.x, dz = HOME.z - st.z, d = Math.hypot(dx, dz), step = MOVE_SPEED * 1.1 * dt;
        if (st.held && Math.random() < cfg.slip * 0.6 * dt) { releaseHeld(); setMsg('앗, 놓쳤다!'); }
        if (d <= step) { st.x = HOME.x; st.z = HOME.z; st.phase = 'release'; st.wait = 0.8; }
        else { st.x += dx / d * step; st.z += dz / d * step; }
        break;
      }
      case 'release':
        st.open = Math.min(0.55, st.open + dt * 1.5);
        if (st.open > 0.4) releaseHeld();
        st.wait -= dt;
        if (st.wait <= 0) {
          if (role === 'player') { st.phase = 'settle'; st.wait = 1.5; } // 떨어지는 인형이 배출구에 닿을 때까지 기다린 뒤 차례 종료
          else startAim();
        }
        break;
      case 'settle':
        st.wait -= dt;
        if (st.wait <= 0) { startAim(); finishTurn(); }
        break;
    }
    if (st.phase === 'aim' || st.phase === 'drop') st.open += (0.55 - st.open) * Math.min(1, dt * 6);

    // 들고 있는 인형은 집게 아래로 끌려옴
    if (st.held) {
      const p = st.held, k = Math.min(1, dt * 8);
      p.x += (st.x + p.offX - p.x) * k;
      p.z += (st.z + p.offZ - p.z) * k;
      p.y += (st.y - CLAW_REACH * 0.75 - p.r * 0.35 - p.y) * k;
      p.px = p.x; p.py = p.y; p.pz = p.z;
    }
  }

  function collectFallen() {
    const keep = [];
    for (const p of prizes) {
      if (p.y < -1.1) {
        scene.remove(p.mesh);
        collection.push({ kind: p.kind.key, color: p.color, t: Date.now() });
        saveCollection(); sessionWon++;
        if (collOpen()) renderCollection();
        toast('GET! ' + p.kind.emoji);
        if (role === 'player' && conn) conn.send({ t: 'event', type: 'get', kind: KINDS.indexOf(p.kind), color: p.color });
      } else keep.push(p);
    }
    prizes = keep;
  }

  // ================= 입력 =================
  const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  window.addEventListener('keydown', e => {
    if (gbOpen()) { if (e.key === 'Escape') closeGuestbook(); return; } // 방명록 입력 중 게임 조작 차단
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key.toLowerCase() === 'g' && !collOpen()) { e.preventDefault(); openGuestbook(); return; }
    if (e.key.toLowerCase() === 'b') { collOpen() ? closeCollection() : openCollection(); return; }
    if (collOpen()) { if (e.key === 'Escape') closeCollection(); return; } // 팝업 중 게임 조작 차단
    const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) { keys.add(k); e.preventDefault(); }
    else if (e.key === ' ') { e.preventDefault(); drop(); }
    else if (e.key.toLowerCase() === 'c') toggleView();
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) keys.delete(k);
  });
  window.addEventListener('blur', () => keys.clear());
  document.querySelectorAll('#dpad [data-dir]').forEach(btn => {
    const dir = btn.dataset.dir;
    btn.addEventListener('pointerdown', e => { e.preventDefault(); keys.add(dir); btn.setPointerCapture(e.pointerId); });
    const up = () => keys.delete(dir);
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
  });
  $('dropBtn').addEventListener('click', drop);
  // 모바일 메뉴(도구 줄)·접속자 목록 접기/펼치기
  const $top = $('top');
  function setMenu(open) { $top.classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', open); }
  $('menuBtn').addEventListener('click', () => setMenu(!$top.classList.contains('open')));
  canvas.addEventListener('pointerdown', () => setMenu(false));
  $('peopleToggle').addEventListener('click', () => {
    const open = $('people').classList.toggle('open');
    $('peopleToggle').setAttribute('aria-expanded', open);
  });
  $('wonChip').addEventListener('click', openCollection);
  $('collBtn').addEventListener('click', openCollection);
  $('bag').addEventListener('click', openCollection);
  $('collClose').addEventListener('click', closeCollection);
  $coll.addEventListener('click', e => { if (e.target === $coll) closeCollection(); });
  $('collClear').addEventListener('click', () => {
    if (!collection.length || !confirm('뽑은 인형 기록을 모두 지울까요?')) return;
    collection = []; saveCollection(); renderCollection();
  });
  $('coinBtn').addEventListener('click', () => { coins += 5; if (st.phase === 'aim') startAim(); });
  $('refillBtn').addEventListener('click', () => { if (simulating()) { refill(); if (role === 'player') sendState(); } });
  $('queueBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (!conn || !me || role === 'player') return;
    conn.send({ t: presence.queue.includes(me.id) ? 'queue_leave' : 'queue_join' });
  });
  $('gbClose').addEventListener('click', closeGuestbook);
  $gb.addEventListener('click', e => { if (e.target === $gb) closeGuestbook(); });
  $('gbForm').addEventListener('submit', e => { e.preventDefault(); postGuestbook(); });
  $gbInput.addEventListener('input', () => { $('gbLeft').textContent = GB_MAX - Array.from($gbInput.value).length; });
  $('viewBtn').addEventListener('click', toggleView);
  $('strength').addEventListener('change', e => e.target.blur());
  function toggleView() { viewIdx = (viewIdx + 1) % VIEWS.length; $('viewBtn').textContent = '시점: ' + VIEWS[viewIdx].name + ' (C)'; }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitViews(w, h);
  }

  // 기계 외곽 박스가 HUD 를 피해 화면 가운데 꽉 차도록 시점별 카메라 위치 계산
  function fitViews(w, h) {
    const corners = [];
    const multi = document.body.classList.contains('multi'); // 멀티: 왼쪽 방명록·앞쪽·오른쪽 아바타 영역 포함
    for (const x of [multi ? -HALF - 3.5 : -HALF, multi ? HALF + 1.8 : HALF]) for (const y of [0, RAIL_Y + 0.4]) for (const z of [-HALF, multi ? HALF + 1.4 : HALF]) corners.push(new THREE.Vector3(x, y, z));
    // 사용 가능 영역 (NDC): 실제 HUD 위치로 계산. 터치 조작부는 세로 화면이면 아래, 가로 화면이면 좌우를 비움
    const R = id => { const r = $(id).getBoundingClientRect(); return r.width ? r : null; };
    const tr = R('top'), mr = R('msg'), pad = R('dpad');
    let topPx = Math.max(56, tr ? tr.bottom : 0, mr ? mr.bottom : 0) + 8, botPx = 16, leftPx = 0, rightPx = 0;
    if (pad) {
      const side = [R('dropBtn'), multi ? R('people') : null].filter(Boolean);
      if (h >= w) botPx = h - Math.min(pad.top, ...side.map(r => r.top)) + 8;
      else { leftPx = pad.right + 8; rightPx = w - Math.min(w, ...side.map(r => r.left)) + 8; }
    }
    const top = 1 - 2 * (topPx / h), bottom = -1 + 2 * (botPx / h);
    const left = -1 + 2 * (leftPx / w), rightN = 1 - 2 * (rightPx / w);
    const tcy = (top + bottom) / 2, ty = Math.max(0.3, (top - bottom) / 2 * 0.96);
    const tcx = (left + rightN) / 2, tx = Math.max(0.3, (rightN - left) / 2 * 0.94);
    const cam = camera.clone();
    const halfT = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    for (const view of VIEWS) {
      const dir = new THREE.Vector3(...view.dir).normalize();
      const look = new THREE.Vector3(0, RAIL_Y * 0.3, 0);
      let D = 15;
      for (let i = 0; i < 40; i++) {
        cam.position.copy(look).addScaledVector(dir, D);
        cam.lookAt(look);
        cam.updateMatrixWorld();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of corners) {
          v.copy(c).project(cam);
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const half = D * halfT;
        right.setFromMatrixColumn(cam.matrixWorld, 0);
        up.setFromMatrixColumn(cam.matrixWorld, 1);
        look.addScaledVector(right, (cx - tcx) * half * cam.aspect * 0.8).addScaledVector(up, (cy - tcy) * half * 0.8);
        D *= Math.pow(Math.max((x1 - x0) / 2 / tx, (y1 - y0) / 2 / ty), 0.8);
      }
      view.pos = cam.position.clone();
      view.look = look.clone();
    }
    if (!camReady) { camPos.copy(VIEWS[viewIdx].pos); camLook.copy(VIEWS[viewIdx].look); camReady = true; }
  }
  window.addEventListener('resize', resize);

  // ================= 루프 =================
  const FIXED = 1 / 60;
  let last = performance.now(), acc = 0;
  const down = new THREE.Vector3(0, -1, 0);

  function syncVisuals(dt) {
    claw.position.set(st.x, st.y, st.z);
    bridge.position.x = st.x;
    hinges.forEach(h => { h.rotation.z = st.open; });
    const cableLen = RAIL_Y - st.y - 0.14;
    cable.scale.y = Math.max(0.01, cableLen);
    cable.position.set(st.x, st.y + 0.14 + cableLen / 2, st.z);

    // 조준 마커: 집게 바로 아래 표면에 표시
    ray.set(new THREE.Vector3(st.x, st.y - CLAW_REACH - 0.05, st.z), down);
    const targets = prizes.filter(p => !p.held).map(p => p.mesh);
    const hit = ray.intersectObjects(targets, true)[0];
    const my = hit ? hit.point.y + 0.02 : (inChuteXZ(st.x, st.z) ? CHUTE_WALL_H + 0.02 : 0.02);
    marker.position.set(st.x, my, st.z);
    marker.visible = st.phase === 'aim' || st.phase === 'drop';

    for (const p of prizes) {
      p.mesh.position.set(p.x, p.y, p.z);
      // 굴러가는 느낌: 이동 방향으로 살짝 기울임
      const vx = (p.x - p.px) / FIXED, vz = (p.z - p.pz) / FIXED;
      p.tiltZ += (-vx * 0.08 - p.tiltZ) * Math.min(1, dt * 5);
      p.tiltX += (vz * 0.08 - p.tiltX) * Math.min(1, dt * 5);
      p.mesh.rotation.x = p.tiltX; p.mesh.rotation.z = p.tiltZ;
      if (p.held) p.mesh.rotation.y += p.spin * dt;
    }

    const v = VIEWS[viewIdx], k = Math.min(1, dt * 4);
    camPos.lerp(v.pos, k);
    camLook.lerp(v.look, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; acc += dt;
    while (acc >= FIXED) {
      if (simulating()) {
        updateClaw(FIXED);
        physics(FIXED);
        collectFallen();
      }
      acc -= FIXED;
    }
    if (!simulating()) followSnapshot(dt);
    else if (role === 'player') {
      sendAcc += dt;
      if (sendAcc >= 1 / 15) { sendAcc = 0; sendState(); } // 약 15Hz 로 구경꾼에게 상태 전송
    }
    syncVisuals(dt);
    updateHud();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  resize();
  if (NET) {
    setMsg('서버 연결 중...');
    conn = NET.connect({
      onMessage: onNetMessage,
      onFail: () => { // 서버 없음 → 혼자 하기
        conn = null; role = 'single';
        document.body.classList.remove('multi');
        if (!prizes.length) refill();
        startAim();
      },
      onDisconnect: () => {
        if (role === 'player') becomeSpectator();
        role = 'offline';
        presence = { users: [], queue: [], player: null };
        updateNetUi();
      },
    });
  } else {
    refill();
    startAim();
  }
  requestAnimationFrame(loop);

  // 테스트용 노출
  window.ClawGame = { st, get prizes() { return prizes; }, physics, updateClaw, drop, collectFallen, get won() { return sessionWon; }, get collection() { return collection; }, openCollection, closeCollection,
    exportSnapshot, applySnapshot, get role() { return role; }, get guestbook() { return guestbook; }, get gbUnread() { return gbUnread; }, openGuestbook, closeGuestbook };
})();
