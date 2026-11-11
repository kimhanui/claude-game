// 버스킹: 3인칭 1인 플레이. 광장 가운데서 기타 연주 → 들리는 범위의 행인이 하나둘 멈춰 듣는다.
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ───────── 튜닝값 ───────── */
const CFG = {
  npcCount: 18,
  plazaR: 27,            // 행인이 걷는 광장 반지름
  playHold: 2.2,         // 마지막 음 이후 이 시간(초)까지는 "연주 중"
  hearBase: 8,           // 들리는 거리 = hearBase + hearGain * 열기
  hearGain: 10,
  stopGap: [2.6, 5.0],   // 다음 사람이 멈출 때까지 간격(초), 열기가 높을수록 짧아짐
  leaveGap: [1.0, 2.4],  // 연주를 멈춘 뒤 한 명씩 떠나는 간격
  quietBeforeLeave: 3.5, // 이만큼 조용하면 떠나기 시작
  patience: [40, 90],    // 연주 중이어도 이 정도 들으면 떠날 수 있음
  reStopCooldown: [14, 26],
};

/* ───────── 렌더러·씬 ───────── */
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x7d5f86, 32, 80);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);

// 하늘: 위 남색 → 분홍 → 지평선 호박색
const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x2e2b63) }, mid: { value: new THREE.Color(0xb7688a) }, bot: { value: new THREE.Color(0xf4a85c) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;' +
    'void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.55, h)) : mix(bot, mid, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
}));
scene.add(sky);

scene.add(new THREE.HemisphereLight(0xffd9b8, 0x3e3560, 0.62));
const sun = new THREE.DirectionalLight(0xffb27a, 0.75);
sun.position.set(28, 16, -14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
sun.shadow.bias = -0.0008;
scene.add(sun);

/* ───────── 광장 ───────── */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
const tileTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#a99886'; g.fillRect(0, 0, w, h);
  const n = 4, s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 150 + Math.random() * 30;
    g.fillStyle = `rgb(${v + 12},${v},${v - 14})`;
    g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
  }
});
tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
tileTex.repeat.set(26, 26);
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshLambertMaterial({ map: tileTex }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 버스킹 자리 표시(둥근 무대 판석)
const stage = new THREE.Mesh(new THREE.CircleGeometry(2.2, 40), new THREE.MeshLambertMaterial({ color: 0x8e7a8f }));
stage.rotation.x = -Math.PI / 2; stage.position.y = 0.01; stage.receiveShadow = true;
scene.add(stage);

const lambert = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
function addMesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  (parent || scene).add(m); return m;
}

// 분수 (플레이어 정면 저 멀리)
const FOUNTAIN = new THREE.Vector3(0, 0, -21);
const fountain = new THREE.Group(); fountain.position.copy(FOUNTAIN); scene.add(fountain);
const stoneMat = lambert(0xcbb8a4);
addMesh(new THREE.CylinderGeometry(3.4, 3.6, 0.7, 36), stoneMat, 0, 0.35, 0, fountain);
const water = addMesh(new THREE.CylinderGeometry(3.05, 3.05, 0.1, 36), lambert(0x5c8fc4, { emissive: 0x1d3c66 }), 0, 0.66, 0, fountain);
addMesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 14), stoneMat, 0, 1.2, 0, fountain);
addMesh(new THREE.CylinderGeometry(1.2, 0.5, 0.35, 24), stoneMat, 0, 2.15, 0, fountain);
const jetMat = new THREE.MeshLambertMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.55, emissive: 0x3f6f9f });
const jet = addMesh(new THREE.CylinderGeometry(0.06, 0.14, 1.4, 8), jetMat, 0, 3.0, 0, fountain);
jet.castShadow = false;

// 가로등 (불빛 수는 적게 유지)
const lampSpots = [[-6, -5], [6, -5], [-9, 9], [9, 9], [-15, -15], [15, -15]];
const bulbMat = lambert(0xffe2a0, { emissive: 0xffc670 });
lampSpots.forEach(([x, z], i) => {
  const pole = addMesh(new THREE.CylinderGeometry(0.07, 0.1, 4, 8), lambert(0x2f2b3a), x, 2, z);
  pole.receiveShadow = false;
  const bulb = addMesh(new THREE.SphereGeometry(0.28, 14, 10), bulbMat, x, 4.15, z);
  bulb.castShadow = false;
  if (i < 4) { const pl = new THREE.PointLight(0xffbe6a, 0.9, 13, 2); pl.position.set(x, 3.9, z); scene.add(pl); }
});

// 나무·벤치
const leafMats = [lambert(0x4f7a52), lambert(0x5d8a4f), lambert(0x3f6b55)];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + rand(-0.08, 0.08), r = rand(30, 33);
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  addMesh(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 7), lambert(0x6b4a35), x, 0.8, z);
  const s = rand(1.4, 2.0);
  addMesh(new THREE.SphereGeometry(s, 10, 8), pick(leafMats), x, 1.6 + s, z);
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.5, r = 25;
  const b = new THREE.Group(); b.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); b.rotation.y = a; scene.add(b);
  addMesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), lambert(0x8a5a3c), 0, 0.5, 0, b);
  addMesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), lambert(0x8a5a3c), 0, 0.85, 0.28, b);
  addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), lambert(0x2f2b3a), -0.9, 0.25, 0, b);
  addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), lambert(0x2f2b3a), 0.9, 0.25, 0, b);
}

// 둘레 건물 (불 켜진 창문)
function windowTex(cols, rows, wall) {
  return canvasTex(cols * 16, rows * 22, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const lit = Math.random() < 0.45;
      g.fillStyle = lit ? pick(['#ffd88a', '#ffc46b', '#fff0c2']) : '#2a2440';
      g.fillRect(x * 16 + 4, y * 22 + 5, 8, 12);
    }
  });
}
const wallColors = ['#4a4064', '#5a4a5e', '#3f4762', '#61506a', '#4d3f55'];
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2, r = rand(42, 47);
  const w = rand(7, 11), h = rand(8, 22), d = rand(6, 9);
  const tex = windowTex(Math.round(w / 1.4), Math.round(h / 1.6), pick(wallColors));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
  m.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r); m.rotation.y = a;
  scene.add(m);
}

/* ───────── 사람 모델 ───────── */
const G = {
  leg: new THREE.BoxGeometry(0.17, 0.82, 0.2).translate(0, -0.41, 0),
  shoe: new THREE.BoxGeometry(0.18, 0.1, 0.3),
  torso: new THREE.CylinderGeometry(0.25, 0.21, 0.68, 10),
  arm: new THREE.BoxGeometry(0.12, 0.6, 0.14).translate(0, -0.3, 0),
  hand: new THREE.SphereGeometry(0.07, 8, 6),
  neck: new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8),
  head: new THREE.SphereGeometry(0.19, 14, 10),
  hair: new THREE.SphereGeometry(0.205, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  eye: new THREE.SphereGeometry(0.025, 6, 4),
};
const matCache = new Map();
const cmat = (c) => { if (!matCache.has(c)) matCache.set(c, lambert(c)); return matCache.get(c); };
const SKIN = [0xf3cfae, 0xe5b48c, 0xcf9a6e, 0xa8714a, 0x7d4f33];
const SHIRT = [0xe85d75, 0x4f8fd8, 0xf2c14e, 0x5bb08a, 0xf4f1ea, 0x8a6fd1, 0xe9884a, 0x3c3a52, 0x9bc4e2, 0xd14f4f];
const PANTS = [0x2d3550, 0x3b3b3b, 0x5a4a3a, 0x6c7f99, 0x24242c, 0x8a7b62];
const HAIR = [0x1f1a17, 0x3a2a1e, 0x5c3b22, 0x8a6a3c, 0xbfb3a6];
const EYE = 0x1a1420;

function makePerson(look) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legMat = cmat(look.pants), skin = cmat(look.skin);
  const mkLeg = (x) => {
    const p = new THREE.Group(); p.position.set(x, 0.86, 0); body.add(p);
    const m = new THREE.Mesh(G.leg, legMat); m.castShadow = true; p.add(m);
    const s = new THREE.Mesh(G.shoe, cmat(0x2a2422)); s.position.set(0, -0.82, 0.05); p.add(s);
    return p;
  };
  const legL = mkLeg(0.11), legR = mkLeg(-0.11);
  const torso = new THREE.Mesh(G.torso, cmat(look.shirt)); torso.position.y = 1.2; torso.castShadow = true; body.add(torso);
  const mkArm = (x) => {
    const p = new THREE.Group(); p.position.set(x, 1.48, 0); body.add(p);
    const m = new THREE.Mesh(G.arm, cmat(look.shirt)); m.castShadow = true; p.add(m);
    const h = new THREE.Mesh(G.hand, skin); h.position.y = -0.64; p.add(h);
    return p;
  };
  const armL = mkArm(0.33), armR = mkArm(-0.33); // 정면(+z) 기준 왼쪽 = +x
  const neck = new THREE.Mesh(G.neck, skin); neck.position.y = 1.58; body.add(neck);
  const head = new THREE.Group(); head.position.y = 1.62; body.add(head);
  const hm = new THREE.Mesh(G.head, skin); hm.position.y = 0.17; hm.castShadow = true; head.add(hm);
  const hair = new THREE.Mesh(G.hair, cmat(look.hair)); hair.position.set(0, 0.2, -0.015); hair.rotation.x = -0.25; head.add(hair);
  [0.07, -0.07].forEach((x) => { const e = new THREE.Mesh(G.eye, cmat(EYE)); e.position.set(x, 0.19, 0.175); head.add(e); });
  return { g, body, legL, legR, armL, armR, head };
}
const randomLook = () => ({ skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR) });

function makeGuitar() {
  const g = new THREE.Group();
  const wood = lambert(0xd08a45), dark = lambert(0x3b2414), neckM = lambert(0x6b4425);
  const lower = addMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 22), wood, -0.08, 0, 0, g); lower.rotation.x = Math.PI / 2;
  const upper = addMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 22), wood, 0.17, 0, 0, g); upper.rotation.x = Math.PI / 2;
  addMesh(new THREE.CircleGeometry(0.065, 18), dark, 0.07, 0, 0.051, g);
  addMesh(new THREE.BoxGeometry(0.03, 0.13, 0.02), dark, -0.16, 0, 0.055, g);
  addMesh(new THREE.BoxGeometry(0.58, 0.055, 0.04), neckM, 0.58, 0, 0.02, g);
  addMesh(new THREE.BoxGeometry(0.15, 0.075, 0.035), dark, 0.93, 0, 0.02, g);
  const str = addMesh(new THREE.BoxGeometry(1.08, 0.03, 0.004), lambert(0xe6e0d0, { emissive: 0x403a30 }), 0.38, 0, 0.056, g);
  str.castShadow = false;
  return g;
}

/* ───────── 플레이어 ───────── */
const player = makePerson({ skin: 0xe5b48c, shirt: 0x2f6f73, pants: 0x2d3550, hair: 0x1f1a17 });
player.g.rotation.y = Math.PI; // 광장 안쪽(-z)을 바라봄
scene.add(player.g);
// 비니
const beanie = addMesh(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lambert(0xf2c14e), 0, 0.2, -0.01, player.head);
beanie.rotation.x = -0.15;
const guitar = makeGuitar();
guitar.position.set(-0.02, 1.12, 0.25);
guitar.rotation.z = 0.38; // 넥이 왼쪽 위로
player.body.add(guitar);
const ARM_R_REST = { x: -0.75, z: 0.55 }, ARM_L_REST = { x: -1.15, z: -0.15 };
player.armR.rotation.set(ARM_R_REST.x, 0, ARM_R_REST.z);
player.armL.rotation.set(ARM_L_REST.x, 0.5, ARM_L_REST.z);

// 열린 기타 케이스 (발 앞, 플레이어 기준 정면 = -z)
const CASE_POS = new THREE.Vector3(0.1, 0, -1.35);
const gcase = new THREE.Group(); gcase.position.copy(CASE_POS); gcase.rotation.y = 0.15; scene.add(gcase);
addMesh(new THREE.BoxGeometry(0.55, 0.12, 1.1), lambert(0x1e1b26), 0, 0.06, 0, gcase);
addMesh(new THREE.BoxGeometry(0.45, 0.02, 1.0), lambert(0x8f2e46), 0, 0.125, 0, gcase);
const lid = addMesh(new THREE.BoxGeometry(0.55, 0.04, 1.1), lambert(0x1e1b26), -0.3, 0.3, 0, gcase);
lid.rotation.z = 1.2;

/* ───────── 기타 소리 (Karplus–Strong) ───────── */
let actx = null, master = null;
const pluckCache = new Map();
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = actx.createGain(); master.gain.value = 0.8;
    master.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function pluckBuffer(midi) {
  if (pluckCache.has(midi)) return pluckCache.get(midi);
  const sr = actx.sampleRate, freq = 440 * Math.pow(2, (midi - 69) / 12);
  const len = Math.floor(sr * 2.4), N = Math.max(2, Math.round(sr / freq));
  const buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) ring[i] = (ring[i] + ring[(i + 1) % N]) * 0.5; // 손가락 피킹처럼 부드럽게
  const decay = midi > 70 ? 0.9985 : 0.9965;
  let idx = 0, peak = 0;
  for (let n = 0; n < len; n++) {
    const cur = ring[idx], nxt = ring[(idx + 1) % N];
    ring[idx] = (cur + nxt) * 0.5 * decay;
    d[n] = cur; peak = Math.max(peak, Math.abs(cur));
    idx = (idx + 1) % N;
  }
  const norm = 0.55 / (peak || 1);
  for (let n = 0; n < len; n++) d[n] *= norm;
  const fade = Math.floor(sr * 0.05);
  for (let n = 0; n < fade; n++) d[len - 1 - n] *= n / fade;
  pluckCache.set(midi, buf);
  return buf;
}
function playPluck(midi) {
  if (!ensureAudio()) return;
  const src = actx.createBufferSource(); src.buffer = pluckBuffer(midi);
  const body = actx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 3800; body.Q.value = 0.7;
  const g = actx.createGain(); g.gain.value = 0.9;
  src.connect(body); body.connect(g); g.connect(master);
  src.start();
}
let noiseBuf = null;
function playClap(vol) {
  if (!actx) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.08), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  const src = actx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = rand(0.85, 1.15);
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(1100, 1700); f.Q.value = 1.2;
  const g = actx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master); src.start();
}

/* ───────── 음 배치: 키 하나 = 한 음 (e.code 사용 → 한/영 무관) ───────── */
const STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
const NAMES = ['도', '레', '미', '파', '솔', '라', '시', '도', '레', '미'];
const ROWS = [
  { oct: 2, base: 72, color: 'var(--high)', codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'], labels: 'QWERTYUIOP'.split('') },
  { oct: 1, base: 60, color: 'var(--mid)', codes: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'], labels: 'ASDFGHJKL;'.split('') },
  { oct: 0, base: 48, color: 'var(--low)', codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'], labels: 'ZXCVBNM,./'.split('') },
];
const NOTE_COLOR = { 0: 0x7fb3ff, 1: 0xffc65c, 2: 0xff8fb1 };
const keyMap = new Map(); // code → {midi, oct, el}
const keysEl = $('#keys');
ROWS.forEach((row) => {
  const r = document.createElement('div'); r.className = 'row'; r.dataset.oct = row.oct;
  row.codes.forEach((code, i) => {
    const cap = document.createElement('div'); cap.className = 'cap'; cap.style.setProperty('--c', row.color);
    cap.innerHTML = `<span class="k">${row.labels[i]}</span><span class="n">${NAMES[i]}</span>`;
    r.appendChild(cap);
    keyMap.set(code, { midi: row.base + STEPS[i], oct: row.oct, el: cap });
  });
  keysEl.appendChild(r);
});
const padsEl = $('#pads');
STEPS.forEach((s, i) => {
  const b = document.createElement('button'); b.className = 'pad'; b.textContent = NAMES[i];
  b.style.setProperty('--c', i < 7 ? 'var(--mid)' : 'var(--high)');
  b.setAttribute('aria-label', `${NAMES[i]} 연주`);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); noteOn(60 + s, i < 7 ? 1 : 2); flash(b); });
  padsEl.appendChild(b);
});
function flash(el) { el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 140); }

/* ───────── 연주 상태 ───────── */
let now = 0, lastNoteAt = -99, heat = 0, notesInSet = 0, strum = 0;
const isPlaying = () => now - lastNoteAt < CFG.playHold;
const hearRadius = () => CFG.hearBase + CFG.hearGain * heat;

function noteOn(midi, oct) {
  ensureAudio();
  playPluck(midi);
  lastNoteAt = now;
  heat = Math.min(1, heat + 0.03);
  notesInSet++;
  strum = 1;
  spawnNoteSprite(oct);
  for (const n of npcs) if (n.state === 'listen') n.bob = 1;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { toggleIntro(); return; }
  const k = keyMap.get(e.code);
  if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (!introEl.hidden) closeIntro();
  if (e.repeat) return;
  noteOn(k.midi, k.oct);
  flash(k.el);
});

/* ───────── 떠오르는 음표 ───────── */
const noteTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff'; g.font = 'bold 48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 32, 34);
});
const noteTex2 = canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff'; g.font = 'bold 46px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♫', 32, 34);
});
const notes = [];
for (let i = 0; i < 28; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false, fog: false }));
  s.visible = false; s.scale.set(0.42, 0.42, 1); scene.add(s);
  notes.push({ s, life: 0, v: new THREE.Vector3() });
}
let noteIdx = 0;
const tmpV = new THREE.Vector3();
function spawnNoteSprite(oct) {
  const n = notes[noteIdx++ % notes.length];
  guitar.getWorldPosition(tmpV);
  n.s.position.copy(tmpV).add(new THREE.Vector3(rand(-0.2, 0.2), 0.3, rand(-0.2, 0.1)));
  n.s.material.map = Math.random() < 0.5 ? noteTex : noteTex2;
  n.s.material.color.setHex(NOTE_COLOR[oct]);
  n.v.set(rand(-0.5, 0.5), rand(0.9, 1.3), rand(-0.9, -0.4));
  n.life = 1; n.s.visible = true;
}
function updateNotes(dt) {
  for (const n of notes) {
    if (!n.s.visible) continue;
    n.life -= dt / 1.8;
    if (n.life <= 0) { n.s.visible = false; continue; }
    n.s.position.addScaledVector(n.v, dt);
    n.s.position.x += Math.sin((1 - n.life) * 8 + n.v.x * 9) * dt * 0.4;
    n.s.material.opacity = Math.min(1, n.life * 2);
  }
}

/* ───────── 행인 NPC ───────── */
// 들을 자리: 플레이어 정면(-z) 반원 2줄
const SPOTS = [];
[-46, -23, 0, 23, 46].forEach((deg) => SPOTS.push({ a: deg * Math.PI / 180, r: 3.5 }));
[-58, -35, -12, 12, 35, 58].forEach((deg) => SPOTS.push({ a: deg * Math.PI / 180, r: 5.0 }));
SPOTS.forEach((s) => { s.pos = new THREE.Vector3(Math.sin(s.a) * s.r, 0, -Math.cos(s.a) * s.r); s.taken = null; });

const OBSTACLES = [
  { p: new THREE.Vector3(0, 0, 0), r: 1.4 },
  { p: CASE_POS, r: 0.8 },
  { p: FOUNTAIN, r: 3.9 },
  ...lampSpots.map(([x, z]) => ({ p: new THREE.Vector3(x, 0, z), r: 0.35 })),
];

function edgePoint(fromAngle) {
  for (let t = 0; t < 10; t++) {
    const a = fromAngle === undefined ? rand(0, Math.PI * 2) : fromAngle + Math.PI + rand(-1.0, 1.0);
    const p = new THREE.Vector3(Math.sin(a) * CFG.plazaR * rand(0.82, 1), 0, Math.cos(a) * CFG.plazaR * rand(0.82, 1));
    if (p.distanceTo(FOUNTAIN) > 5) return p;
  }
  return new THREE.Vector3(CFG.plazaR, 0, 0);
}

const npcs = [];
function newWalkTarget(n) {
  const fromA = Math.atan2(n.pos.x, n.pos.z);
  n.target = edgePoint(fromA);
  // 일부는 버스킹 자리 근처를 지나가도록 경유지 추가
  n.via = Math.random() < 0.45 ? new THREE.Vector3(rand(-7, 7), 0, rand(-9, -2.5)) : null;
}
function spawnNpc(initial) {
  const p = makePerson(randomLook());
  scene.add(p.g);
  const n = Object.assign(p, {
    pos: initial ? new THREE.Vector3(rand(-22, 22), 0, rand(-22, 20)) : edgePoint(),
    dir: new THREE.Vector3(0, 0, 1), speed: rand(1.05, 1.55), phase: rand(0, 6),
    state: 'walk', cooldown: 0, spot: null, listenFor: 0, patience: 0, bob: 0, clapUntil: 0, nextClap: 0, headYaw: 0, scale: rand(0.92, 1.08),
  });
  if (n.pos.distanceTo(FOUNTAIN) < 5 || n.pos.length() < 3) n.pos.set(rand(12, 20), 0, rand(4, 14));
  n.g.scale.setScalar(n.scale);
  newWalkTarget(n);
  npcs.push(n);
}
for (let i = 0; i < CFG.npcCount; i++) spawnNpc(true);

function freeSpotFor(n) {
  let best = null, bd = 1e9;
  for (const s of SPOTS) {
    if (s.taken) continue;
    const d = s.pos.distanceTo(n.pos) + s.r * 0.8; // 앞줄 우선
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function startListening(n) {
  const s = freeSpotFor(n);
  if (!s) return false;
  s.taken = n; n.spot = s; n.state = 'approach'; n.via = null;
  n.patience = rand(CFG.patience[0], CFG.patience[1]); n.listenFor = 0;
  return true;
}
function stopListening(n) {
  if (n.spot) n.spot.taken = null;
  n.spot = null; n.state = 'walk'; n.cooldown = rand(CFG.reStopCooldown[0], CFG.reStopCooldown[1]);
  n.clapUntil = 0;
  newWalkTarget(n); n.via = null;
}

const steer = new THREE.Vector3(), push = new THREE.Vector3(), dv = new THREE.Vector3();
function moveToward(n, goal, speed, dt, avoidPlayer) {
  steer.subVectors(goal, n.pos); steer.y = 0;
  const dist = steer.length();
  if (dist < 1e-4) return dist;
  steer.divideScalar(dist);
  push.set(0, 0, 0);
  for (const o of OBSTACLES) {
    if (!avoidPlayer && o.r < 2 && o.p.lengthSq() < 4) continue;
    dv.subVectors(n.pos, o.p); dv.y = 0;
    const d = dv.length(), lim = o.r + 0.9;
    if (d < lim && d > 1e-4) push.addScaledVector(dv.divideScalar(d), (lim - d) * 1.8);
  }
  for (const m of npcs) {
    if (m === n) continue;
    dv.subVectors(n.pos, m.pos); dv.y = 0;
    const d = dv.length();
    if (d < 0.75 && d > 1e-4) push.addScaledVector(dv.divideScalar(d), (0.75 - d) * 2.2);
  }
  steer.add(push).normalize();
  n.dir.lerp(steer, Math.min(1, dt * 5)).normalize();
  const sp = Math.min(speed, dist * 2.5 + 0.15);
  n.pos.addScaledVector(n.dir, sp * dt);
  return dist;
}
function turnTo(n, yaw, dt, rate) { n.g.rotation.y += wrapAngle(yaw - n.g.rotation.y) * Math.min(1, dt * rate); }

function animateWalk(n, dt, speed) {
  n.phase += dt * speed * 5.2;
  const s = Math.sin(n.phase);
  n.legL.rotation.x = s * 0.6; n.legR.rotation.x = -s * 0.6;
  n.armL.rotation.set(-s * 0.45, 0, -0.06); n.armR.rotation.set(s * 0.45, 0, 0.06);
  n.body.position.y = Math.abs(Math.cos(n.phase)) * 0.04;
  n.body.rotation.z = 0;
}
function animateStand(n, dt, t) {
  n.legL.rotation.x *= 1 - Math.min(1, dt * 8); n.legR.rotation.x *= 1 - Math.min(1, dt * 8);
  n.bob = Math.max(0, n.bob - dt * 3.5);
  const groove = isPlaying() ? 0.035 + 0.035 * heat : 0.01;
  n.body.rotation.z = Math.sin(t * 2.1 + n.phase) * groove;
  n.body.position.y = -n.bob * 0.035;
  n.head.rotation.x = n.bob * 0.18;
  if (t < n.clapUntil) {
    const c = Math.abs(Math.sin(t * 22 + n.phase)) * 0.25;
    n.armL.rotation.set(-1.15, 0, -0.35 + c); n.armR.rotation.set(-1.15, 0, 0.35 - c);
  } else {
    n.armL.rotation.set(-0.05, 0, -0.08); n.armR.rotation.set(-0.05, 0, 0.08);
  }
}

let nextStopAt = 2, nextLeaveAt = 0, applauded = true;
function updateCrowd(dt, t) {
  const playing = isPlaying();
  const R = hearRadius();

  // 1) 들리는 범위의 행인 중 한 명씩 멈춰 세우기
  if (playing && t >= nextStopAt) {
    const cand = npcs.filter((n) => n.state === 'walk' && n.cooldown <= 0 && n.pos.length() < R && n.pos.length() > 2.6);
    if (cand.length && Math.random() < 0.35 + 0.6 * heat) {
      cand.sort((a, b) => a.pos.length() - b.pos.length());
      startListening(cand[Math.floor(Math.random() * Math.min(3, cand.length))]);
    }
    nextStopAt = t + rand(CFG.stopGap[0], CFG.stopGap[1]) / (0.6 + heat);
  }

  // 2) 연주가 끝나면 박수 한 번, 그 뒤 조용하면 한 명씩 떠남
  const quiet = t - lastNoteAt;
  if (playing) applauded = false;
  if (!playing && !applauded && quiet > 0.4) {
    applauded = true;
    if (notesInSet >= 8) for (const n of npcs) if (n.state === 'listen') { n.clapUntil = t + rand(1.4, 2.6); n.nextClap = t + rand(0, 0.25); }
    notesInSet = 0;
  }
  if (!playing && quiet > CFG.quietBeforeLeave && t >= nextLeaveAt) {
    const ls = npcs.filter((n) => n.state === 'listen' || n.state === 'approach');
    if (ls.length) stopListening(pick(ls));
    nextLeaveAt = t + rand(CFG.leaveGap[0], CFG.leaveGap[1]);
  }

  for (const n of npcs) {
    n.cooldown -= dt;
    if (n.state === 'walk') {
      const goal = n.via || n.target;
      const d = moveToward(n, goal, n.speed, dt, true);
      if (d < 1.0) { if (n.via) n.via = null; else newWalkTarget(n); }
      n.g.rotation.y = Math.atan2(n.dir.x, n.dir.z);
      animateWalk(n, dt, n.speed);
      // 들리면 고개를 돌려 쳐다봄
      const dist = n.pos.length();
      let look = 0;
      if (playing && dist < R) {
        look = clamp(wrapAngle(Math.atan2(-n.pos.x, -n.pos.z) - n.g.rotation.y), -1.1, 1.1) * clamp((R - dist) / 4, 0, 1);
      }
      n.headYaw += (look - n.headYaw) * Math.min(1, dt * 4);
      n.head.rotation.set(0, n.headYaw, 0);
    } else if (n.state === 'approach') {
      const d = moveToward(n, n.spot.pos, n.speed * 0.8, dt, false);
      n.g.rotation.y = Math.atan2(n.dir.x, n.dir.z);
      animateWalk(n, dt, n.speed * 0.8);
      n.headYaw *= 1 - Math.min(1, dt * 4); n.head.rotation.y = n.headYaw;
      if (d < 0.12) n.state = 'listen';
    } else if (n.state === 'listen') {
      n.pos.lerp(n.spot.pos, Math.min(1, dt * 2));
      turnTo(n, Math.atan2(-n.pos.x, -n.pos.z), dt, 5);
      n.head.rotation.y *= 0.9;
      animateStand(n, dt, t);
      n.listenFor += dt * (heat < 0.15 ? 2 : 1);
      if (t < n.clapUntil && t >= n.nextClap) { playClap(0.05 + 0.03 * Math.random()); n.nextClap = t + rand(0.13, 0.2); }
      if (playing && n.listenFor > n.patience) stopListening(n);
    }
    n.g.position.copy(n.pos);
  }
}

/* ───────── 플레이어 애니메이션 ───────── */
function updatePlayer(dt, t) {
  strum = Math.max(0, strum - dt * 7);
  player.armR.rotation.x = ARM_R_REST.x + strum * 0.35;
  player.armR.rotation.z = ARM_R_REST.z - strum * 0.12;
  const playing = isPlaying();
  player.body.rotation.z = playing ? Math.sin(t * 2.4) * (0.02 + 0.03 * heat) : 0;
  player.head.rotation.x = playing ? 0.08 + Math.sin(t * 4.8) * 0.04 * heat : 0.03;
  player.body.position.y = -strum * 0.02;
}

/* ───────── 카메라: 끌어서 회전, 휠·핀치로 확대 ───────── */
const CAM_DEFAULT = { yaw: 0.42, pitch: 0.3, dist: 7.6 };
const cam = Object.assign({}, CAM_DEFAULT);
const camTarget = new THREE.Vector3(0, 0.75, -2.4);
function placeCamera() {
  const cp = Math.cos(cam.pitch);
  camera.position.set(camTarget.x + Math.sin(cam.yaw) * cp * cam.dist, camTarget.y + Math.sin(cam.pitch) * cam.dist, camTarget.z + Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(camTarget);
}
const pointers = new Map();
let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  if (pointers.size === 1) {
    cam.yaw -= (e.clientX - p.x) * 0.006;
    cam.pitch = clamp(cam.pitch + (e.clientY - p.y) * 0.004, 0.04, 1.15);
  }
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD) cam.dist = clamp(cam.dist * pinchD / d, 3.5, 16);
    pinchD = d;
  }
});
const endPtr = (e) => { pointers.delete(e.pointerId); pinchD = 0; };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 3.5, 16); }, { passive: false });
$('#viewBtn').addEventListener('click', () => Object.assign(cam, CAM_DEFAULT));

/* ───────── HUD·안내 ───────── */
const introEl = $('#intro');
function closeIntro() { introEl.hidden = true; ensureAudio(); }
function toggleIntro() { introEl.hidden = !introEl.hidden; }
$('#startBtn').addEventListener('click', closeIntro);
$('#helpBtn').addEventListener('click', () => { introEl.hidden = false; $('#startBtn').focus(); });
const crowdN = $('#crowdN'), stateT = $('#stateT');
let lastCrowd = -1, lastPlaying = null;
function updateHud() {
  const c = npcs.reduce((s, n) => s + (n.state === 'listen' ? 1 : 0), 0);
  if (c !== lastCrowd) { crowdN.textContent = c; lastCrowd = c; }
  const p = isPlaying();
  if (p !== lastPlaying) {
    document.body.classList.toggle('playing', p);
    stateT.textContent = p ? '연주 중' : '쉬는 중';
    lastPlaying = p;
  }
}

/* ───────── 루프 ───────── */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 55; // 세로 화면은 시야 넓게
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
function step(dt) {
  now += dt;
  if (!isPlaying()) heat = Math.max(0, heat - dt * 0.12);
  else heat = Math.max(0, heat - dt * 0.02);
  updatePlayer(dt, now);
  updateCrowd(dt, now);
  updateNotes(dt);
  jet.scale.y = 1 + Math.sin(now * 6) * 0.06;
  water.material.emissiveIntensity = 0.9 + Math.sin(now * 1.7) * 0.1;
}
let paused = false;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (!paused) step(dt);
  placeCamera();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// 디버그·테스트용
window.__busk = { npcs, noteOn, cfg: CFG, get heat() { return heat; }, get now() { return now; }, step, set paused(v) { paused = v; } };
})();
