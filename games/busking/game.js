// 버스킹: 3인칭 1인 플레이. 연주·노래로 행인을 모으고, 팁으로 장비를 사고, 버스로 장소를 옮기며
// 관객이 찍어 올린 영상(버스타그램)으로 팔로워를 모아 유명해지는 게 목표.
(() => {
'use strict';
const D = window.BUSK_DATA;
const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fmtWon = (v) => Math.round(v).toLocaleString('ko-KR') + '원';
const fmtCount = (v) => {
  v = Math.round(v);
  if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '억';
  if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '만';
  return v.toLocaleString('ko-KR');
};
const V3 = THREE.Vector3;

/* ───────── 튜닝값 ───────── */
const CFG = {
  playHold: 2.2,         // 마지막 음 이후 이 시간(초)까지는 "연주 중"
  hearBase: 8,           // 들리는 거리 = (hearBase + hearGain * 열기) * 악기·노래 배율 + 유명도
  hearGain: 10,
  stopGap: [2.6, 5.0],   // 다음 사람이 멈출 때까지 간격(초), 열기·매력이 높을수록 짧아짐
  leaveGap: [1.0, 2.4],  // 연주를 멈춘 뒤 한 명씩 떠나는 간격
  quietBeforeLeave: 3.5, // 이만큼 조용하면 떠나기 시작
  patience: [40, 90],    // 연주 중이어도 이 정도 들으면 떠날 수 있음
  reStopCooldown: [14, 26],
  singBoost: 1.25,       // 노래하면 들리는 거리 배율 (마이크 스탠드면 추가)
  clipLen: 7,            // 찍는 사람 영상 길이(초)
  clipSize: [270, 480],  // 세로 영상 해상도
  clipFps: 20,
  maxPosts: 40,
  micThreshold: 0.03,    // 마이크 소리 크기(RMS)가 이 이상이면 노래 중
  micIdleRelease: 15,    // Space를 뗀 뒤 이 시간(초) 지나면 마이크 장치를 닫음
  // 떼창: 같은 멜로디(후렴)를 반복하면 관객이 외우고 따라 부름 (악기로 친 음 기준)
  hookMin: 4, hookMax: 6, // 후렴 길이(음 개수)
  hookRepeats: 3,         // 이만큼 반복하면 듣던 관객이 외움
  hookWindow: 90,         // 이 시간(초) 안에 친 음만 비교
  choirMinCrowd: 5,       // 듣는 사람이 이 이상이어야 떼창
  hookLock: 20,           // 외운 후렴을 이 시간(초) 안에 쳤으면 새 후렴을 안 익힘 (긴 멜로디의 다른 구간으로 계속 바뀌는 것 방지)
};

/* ───────── 저장 (진행 상황 localStorage, 영상 IndexedDB) ───────── */
const SAVE_KEY = 'busking-save-v1';
const ITEM = Object.fromEntries(D.items.map((i) => [i.id, i]));
const LOC = Object.fromEntries(D.locations.map((l) => [l.id, l]));
const S = {
  money: 0, handle: '길거리_버스커', loc: 'plaza',
  owned: ['guitar', 'beanie', 'shirt'],
  eq: { instrument: 'guitar', hat: 'beanie', glasses: null, top: 'shirt', gear: null },
  posts: [], unseen: 0, milestone: 0,
};
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) { const d = JSON.parse(raw); Object.assign(S, d, { eq: Object.assign({}, S.eq, d.eq) }); }
} catch (e) { /* 저장 데이터가 깨졌으면 새로 시작 */ }
if (!LOC[S.loc]) S.loc = 'plaza';
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 용량 초과 등은 무시 */ } }

const vids = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('busking-videos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
    const t = db.transaction('v', mode), q = fn(t.objectStore('v'));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  }));
  return {
    put: (k, b) => tx('readwrite', (s) => s.put(b, k)).catch(() => {}),
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
    del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => {}),
    clear: () => tx('readwrite', (s) => s.clear()).catch(() => {}),
  };
})();

/* ───────── 렌더러·씬 ───────── */
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x7d5f86, 32, 80);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);

const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
scene.add(new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;' +
    'void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.55, h)) : mix(bot, mid, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
})));
const hemi = new THREE.HemisphereLight(0xffd9b8, 0x3e3560, 0.62);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb27a, 0.75);
sun.position.set(28, 16, -14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
sun.shadow.bias = -0.0008;
scene.add(sun);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
const lambert = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
function addMesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  (parent || scene).add(m); return m;
}
function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
  });
}
function windowTex(cols, rows, wall, litP) {
  return canvasTex(cols * 16, rows * 22, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      g.fillStyle = Math.random() < (litP || 0.45) ? pick(['#ffd88a', '#ffc46b', '#fff0c2']) : '#2a2440';
      g.fillRect(x * 16 + 4, y * 22 + 5, 8, 12);
    }
  });
}
function tileTexture(base, lo, spread, n, repeat) {
  const t = canvasTex(256, 256, (g, w) => {
    g.fillStyle = base; g.fillRect(0, 0, w, w);
    const s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = lo + Math.random() * spread;
      g.fillStyle = `rgb(${v + 12},${v},${v - 14})`;
      g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  return t;
}

/* ───────── 장소 (환경) ───────── */
const CASE_POS = new V3(0.1, 0, -1.35);
let env = null; // { group, obstacles, L, tick }

function buildPlaza(add, ob, anim) {
  const ground = add(new THREE.CircleGeometry(60, 48), new THREE.MeshLambertMaterial({ map: tileTexture('#a99886', 150, 30, 4, 26) }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const FOUNTAIN = new V3(0, 0, -21);
  const f = new THREE.Group(); f.position.copy(FOUNTAIN); add.group.add(f);
  const stone = lambert(0xcbb8a4);
  addMesh(new THREE.CylinderGeometry(3.4, 3.6, 0.7, 36), stone, 0, 0.35, 0, f);
  const water = addMesh(new THREE.CylinderGeometry(3.05, 3.05, 0.1, 36), lambert(0x5c8fc4, { emissive: 0x1d3c66 }), 0, 0.66, 0, f);
  addMesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 14), stone, 0, 1.2, 0, f);
  addMesh(new THREE.CylinderGeometry(1.2, 0.5, 0.35, 24), stone, 0, 2.15, 0, f);
  const jet = addMesh(new THREE.CylinderGeometry(0.06, 0.14, 1.4, 8), new THREE.MeshLambertMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.55, emissive: 0x3f6f9f }), 0, 3.0, 0, f);
  jet.castShadow = false;
  ob.push({ p: FOUNTAIN, r: 3.9 });
  anim.push((t) => { jet.scale.y = 1 + Math.sin(t * 6) * 0.06; water.material.emissiveIntensity = 0.9 + Math.sin(t * 1.7) * 0.1; });
  lamps(add, ob, [[-6, -5], [6, -5], [-9, 9], [9, 9], [-15, -15], [15, -15]], 4);
  const leaf = [lambert(0x4f7a52), lambert(0x5d8a4f), lambert(0x3f6b55)];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand(-0.08, 0.08), r = rand(30, 33);
    tree(add, Math.sin(a) * r, Math.cos(a) * r, pick(leaf));
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; bench(add, Math.sin(a) * 25, Math.cos(a) * 25, a); }
  const walls = ['#4a4064', '#5a4a5e', '#3f4762', '#61506a', '#4d3f55'];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2, r = rand(42, 47);
    building(add, Math.sin(a) * r, Math.cos(a) * r, a, rand(7, 11), rand(8, 22), rand(6, 9), pick(walls));
  }
}
function buildRiver(add, ob, anim) {
  const grass = add(new THREE.PlaneGeometry(200, 120), lambert(0x6f9a4f), 0, -0.01, 52); grass.rotation.x = -Math.PI / 2; grass.castShadow = false;
  const path = add(new THREE.PlaneGeometry(200, 26), new THREE.MeshLambertMaterial({ map: tileTexture('#b7a99a', 165, 25, 4, 1) }), 0, 0, -2);
  path.rotation.x = -Math.PI / 2; path.castShadow = false; path.material.map.repeat.set(50, 6.5);
  const bank = add(new THREE.BoxGeometry(200, 0.6, 2), lambert(0x8d8070), 0, -0.2, -16);
  bank.castShadow = false;
  const water = add(new THREE.PlaneGeometry(260, 90), lambert(0x4a78a8, { emissive: 0x1b2f55 }), 0, -0.45, -62);
  water.rotation.x = -Math.PI / 2; water.castShadow = false;
  // 노을 반짝임
  const glint = add(new THREE.PlaneGeometry(10, 60), new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.35 }), 18, -0.4, -60);
  glint.rotation.x = -Math.PI / 2; glint.castShadow = false;
  anim.push((t) => { glint.material.opacity = 0.28 + Math.sin(t * 1.3) * 0.08; water.material.emissiveIntensity = 0.9 + Math.sin(t * 0.8) * 0.1; });
  // 다리
  const deck = add(new THREE.BoxGeometry(260, 1.2, 4), lambert(0x6b6f86), 0, 9, -78);
  deck.castShadow = false;
  const bulb = lambert(0xffe2a0, { emissive: 0xffc670 });
  for (let x = -120; x <= 120; x += 24) {
    add(new THREE.BoxGeometry(2.2, 9, 2.2), lambert(0x5d6078), x, 4, -78).castShadow = false;
    for (let k = -2; k <= 2; k++) add(new THREE.SphereGeometry(0.35, 8, 6), bulb, x + k * 4, 9.9, -76).castShadow = false;
  }
  const walls = ['#3d4466', '#54496b', '#3a4f6a', '#5b4a63'];
  for (let i = 0; i < 26; i++) building(add, -125 + i * 10 + rand(-2, 2), -100, 0, rand(7, 10), rand(12, 40), 8, pick(walls), 0.55);
  lamps(add, ob, [[-24, -13], [-12, -13], [0, -14], [12, -13], [24, -13]], 3);
  const leaf = [lambert(0x4f7a52), lambert(0x5d8a4f), lambert(0x3f6b55)];
  for (let x = -32; x <= 32; x += 8) tree(add, x + rand(-1.5, 1.5), rand(14, 17), pick(leaf));
  for (let x = -27; x <= 27; x += 18) bench(add, x, -15, Math.PI);
}
function buildHongdae(add, ob, anim) {
  const brick = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#3a3036'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const v = 70 + Math.random() * 30;
      g.fillStyle = `rgb(${v + 40},${v},${v})`;
      g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28);
    }
  });
  brick.wrapS = brick.wrapT = THREE.RepeatWrapping; brick.repeat.set(60, 12);
  const ground = add(new THREE.PlaneGeometry(220, 60), new THREE.MeshLambertMaterial({ map: brick }), 0, 0, 0);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const signs = ['LIVE', '노래방', 'CAFE', 'PUB', '악기점', '코인노래방', 'BAR', '24시', '타코', '포차'];
  const neon = ['#ff4fa3', '#44e6ff', '#ffe14d', '#9b6bff', '#5dff8a', '#ff7a3d'];
  const walls = ['#2a2440', '#33284a', '#2b3046', '#3a2b40'];
  [[-18, 0], [16, Math.PI]].forEach(([z, rot]) => {
    for (let x = -60; x < 60;) {
      const w = rand(6, 9), h = rand(8, 18);
      building(add, x + w / 2, z, rot, w - 0.3, h, 7, pick(walls), 0.55);
      const text = pick(signs), color = pick(neon);
      const tex = canvasTex(256, 96, (g) => {
        g.fillStyle = '#120d1f'; g.fillRect(0, 0, 256, 96);
        g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color;
        g.font = '800 54px system-ui, "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, 128, 50);
      });
      const sign = add(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: tex }), x + w / 2, rand(3.2, 5.5), z + (rot ? -3.56 : 3.56));
      sign.rotation.y = rot; sign.castShadow = false;
      const ph = rand(0, 6);
      anim.push((t) => { sign.material.color.setScalar(0.8 + 0.2 * Math.sin(t * 3 + ph) * (Math.sin(t * 0.7 + ph) > 0.92 ? 1 : 0.2)); });
      x += w;
    }
  });
  // 거리 위 전구 줄
  const bulbGeo = new THREE.SphereGeometry(0.09, 6, 4);
  const bulbMats = ['#ffd27a', '#ff9ec9', '#9fe4ff'].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let x = -28; x <= 28; x += 8) {
    for (let k = 0; k <= 14; k++) {
      const z = -13 + k * (26 / 14), y = 5.6 - Math.sin((k / 14) * Math.PI) * 1.1;
      const b = add(bulbGeo, bulbMats[k % 3], x, y, z); b.castShadow = false; b.receiveShadow = false;
    }
  }
  [[-10, 0xff5fb0], [10, 0x5fd0ff], [0, 0xffc66a]].forEach(([x, c]) => { const l = new THREE.PointLight(c, 0.9, 16, 2); l.position.set(x, 4.5, -5); add.group.add(l); });
  lamps(add, ob, [[-8, -11], [8, -11]], 2);
}
function lamps(add, ob, spots, lit) {
  const bulbMat = lambert(0xffe2a0, { emissive: 0xffc670 });
  spots.forEach(([x, z], i) => {
    add(new THREE.CylinderGeometry(0.07, 0.1, 4, 8), lambert(0x2f2b3a), x, 2, z).receiveShadow = false;
    add(new THREE.SphereGeometry(0.28, 14, 10), bulbMat, x, 4.15, z).castShadow = false;
    if (i < lit) { const pl = new THREE.PointLight(0xffbe6a, 0.9, 13, 2); pl.position.set(x, 3.9, z); add.group.add(pl); }
    ob.push({ p: new V3(x, 0, z), r: 0.35 });
  });
}
function tree(add, x, z, leafMat) {
  add(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 7), lambert(0x6b4a35), x, 0.8, z);
  const s = rand(1.4, 2.0);
  add(new THREE.SphereGeometry(s, 10, 8), leafMat, x, 1.6 + s, z);
}
function bench(add, x, z, rot) {
  const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rot; add.group.add(b);
  const wood = lambert(0x8a5a3c), iron = lambert(0x2f2b3a);
  addMesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood, 0, 0.5, 0, b);
  addMesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), wood, 0, 0.85, 0.28, b);
  addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), iron, -0.9, 0.25, 0, b);
  addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), iron, 0.9, 0.25, 0, b);
}
function building(add, x, z, rot, w, h, d, wall, litP) {
  const tex = windowTex(Math.max(2, Math.round(w / 1.4)), Math.max(2, Math.round(h / 1.6)), wall, litP);
  const m = add(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }), x, h / 2, z);
  m.rotation.y = rot; m.castShadow = false;
}

function buildEnv(id) {
  if (env) { scene.remove(env.group); disposeTree(env.group); }
  const L = LOC[id], group = new THREE.Group();
  scene.add(group);
  const add = (geo, mat, x, y, z) => addMesh(geo, mat, x, y, z, group);
  add.group = group;
  const ob = [], anim = [];
  ({ plaza: buildPlaza, river: buildRiver, hongdae: buildHongdae })[id](add, ob, anim);
  const stage = add(new THREE.CircleGeometry(2.2, 40), lambert(id === 'hongdae' ? 0x5a3d6e : 0x8e7a8f), 0, 0.012, 0);
  stage.rotation.x = -Math.PI / 2; stage.castShadow = false;
  const lk = L.look;
  skyU.top.value.setHex(lk.sky[0]); skyU.mid.value.setHex(lk.sky[1]); skyU.bot.value.setHex(lk.sky[2]);
  scene.fog.color.setHex(lk.fog[0]); scene.fog.near = lk.fog[1]; scene.fog.far = lk.fog[2];
  hemi.color.setHex(lk.hemi[0]); hemi.groundColor.setHex(lk.hemi[1]); hemi.intensity = lk.hemi[2];
  sun.color.setHex(lk.sun[0]); sun.intensity = lk.sun[1];
  document.body.style.background = lk.bg;
  env = { group, L, obstacles: [{ p: new V3(0, 0, 0), r: 1.4 }, { p: CASE_POS, r: 0.8 }, ...ob], tick: (t) => anim.forEach((f) => f(t)) };
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

function makePerson(look, ownShirt) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const legMat = cmat(look.pants), skin = cmat(look.skin), shirt = ownShirt ? lambert(look.shirt) : cmat(look.shirt);
  const mkLeg = (x) => {
    const p = new THREE.Group(); p.position.set(x, 0.86, 0); body.add(p);
    const m = new THREE.Mesh(G.leg, legMat); m.castShadow = true; p.add(m);
    const s = new THREE.Mesh(G.shoe, cmat(0x2a2422)); s.position.set(0, -0.82, 0.05); p.add(s);
    return p;
  };
  const legL = mkLeg(0.11), legR = mkLeg(-0.11);
  const torso = new THREE.Mesh(G.torso, shirt); torso.position.y = 1.2; torso.castShadow = true; body.add(torso);
  const mkArm = (x) => {
    const p = new THREE.Group(); p.position.set(x, 1.48, 0); body.add(p);
    const m = new THREE.Mesh(G.arm, shirt); m.castShadow = true; p.add(m);
    const h = new THREE.Mesh(G.hand, skin); h.position.y = -0.64; p.add(h);
    return p;
  };
  const armL = mkArm(0.33), armR = mkArm(-0.33); // 정면(+z) 기준 왼쪽 = +x
  const neck = new THREE.Mesh(G.neck, skin); neck.position.y = 1.58; body.add(neck);
  const head = new THREE.Group(); head.position.y = 1.62; body.add(head);
  const hm = new THREE.Mesh(G.head, skin); hm.position.y = 0.17; hm.castShadow = true; head.add(hm);
  const hair = new THREE.Mesh(G.hair, cmat(look.hair)); hair.position.set(0, 0.2, -0.015); hair.rotation.x = -0.25; head.add(hair);
  [0.07, -0.07].forEach((x) => { const e = new THREE.Mesh(G.eye, cmat(0x1a1420)); e.position.set(x, 0.19, 0.175); head.add(e); });
  return { g, body, legL, legR, armL, armR, head, shirt, torso };
}
const randomLook = () => ({ skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR) });

/* ───────── 악기 모델 ───────── */
function makeGuitarModel(wood, scale) {
  const g = new THREE.Group();
  const w = lambert(wood), dark = lambert(0x3b2414), neckM = lambert(0x6b4425);
  addMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 22), w, -0.08, 0, 0, g).rotation.x = Math.PI / 2;
  addMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 22), w, 0.17, 0, 0, g).rotation.x = Math.PI / 2;
  addMesh(new THREE.CircleGeometry(0.065, 18), dark, 0.07, 0, 0.051, g);
  addMesh(new THREE.BoxGeometry(0.03, 0.13, 0.02), dark, -0.16, 0, 0.055, g);
  addMesh(new THREE.BoxGeometry(0.58, 0.055, 0.04), neckM, 0.58, 0, 0.02, g);
  addMesh(new THREE.BoxGeometry(0.15, 0.075, 0.035), dark, 0.93, 0, 0.02, g);
  addMesh(new THREE.BoxGeometry(1.08, 0.03, 0.004), lambert(0xe6e0d0, { emissive: 0x403a30 }), 0.38, 0, 0.056, g).castShadow = false;
  g.scale.setScalar(scale);
  return g;
}
function makeElectricModel() {
  const g = new THREE.Group();
  const red = lambert(0xc8283c, { emissive: 0x2a0508 }), white = lambert(0xf2efe8), dark = lambert(0x1d1a22);
  addMesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 20), red, -0.06, 0, 0, g).rotation.x = Math.PI / 2;
  const horn = addMesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), red, 0.14, 0.06, 0, g); horn.rotation.z = 0.5;
  addMesh(new THREE.BoxGeometry(0.2, 0.14, 0.01), white, -0.04, -0.03, 0.035, g);
  addMesh(new THREE.BoxGeometry(0.66, 0.05, 0.04), lambert(0x6b4425), 0.6, 0, 0.0, g);
  addMesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), dark, 0.98, 0.02, 0, g);
  addMesh(new THREE.BoxGeometry(1.1, 0.025, 0.004), lambert(0xe6e0d0, { emissive: 0x403a30 }), 0.38, 0, 0.042, g).castShadow = false;
  return g;
}
function makeViolinModel() {
  const g = new THREE.Group();
  const wood = lambert(0x9a4a1e, { emissive: 0x1a0800 }), dark = lambert(0x24150c);
  const b1 = addMesh(new THREE.SphereGeometry(0.1, 14, 10), wood, 0, 0, -0.07, g); b1.scale.set(1, 0.35, 1.05);
  const b2 = addMesh(new THREE.SphereGeometry(0.085, 14, 10), wood, 0, 0, 0.1, g); b2.scale.set(1, 0.35, 1.05);
  addMesh(new THREE.BoxGeometry(0.035, 0.03, 0.28), dark, 0, 0.03, 0.3, g);
  addMesh(new THREE.SphereGeometry(0.025, 8, 6), dark, 0, 0.04, 0.46, g);
  return g;
}
const INSTRUMENTS = {
  guitar: { make: () => makeGuitarModel(0xd08a45, 1), pos: [-0.02, 1.12, 0.25], rot: [0, 0, 0.38], armR: [-0.75, 0, 0.55], armL: [-1.15, 0.5, -0.15], motion: 'strum' },
  ukulele: { make: () => makeGuitarModel(0xe6b36a, 0.62), pos: [0.0, 1.24, 0.24], rot: [0, 0, 0.45], armR: [-0.95, 0, 0.6], armL: [-1.35, 0.45, -0.25], motion: 'strum' },
  electric: { make: makeElectricModel, pos: [-0.02, 1.1, 0.25], rot: [0, 0, 0.32], armR: [-0.75, 0, 0.55], armL: [-1.15, 0.5, -0.15], motion: 'strum' },
  violin: { make: makeViolinModel, pos: [0.16, 1.52, 0.2], rot: [0.15, 0.55, -0.25], armR: [-1.35, 0, 0.75], armL: [-1.55, 0.3, -0.35], motion: 'bow' },
};

/* ───────── 플레이어 ───────── */
const player = makePerson({ skin: 0xe5b48c, shirt: 0x2f6f73, pants: 0x2d3550, hair: 0x1f1a17 }, true);
player.g.rotation.y = Math.PI; // 광장 안쪽(-z)을 바라봄
scene.add(player.g);
const mouth = addMesh(new THREE.SphereGeometry(0.04, 10, 6), cmat(0x5a1f28), 0, 0.085, 0.172, player.head);
mouth.scale.set(1, 0.25, 0.4); mouth.castShadow = false;
const hats = {
  beanie: (() => { const m = addMesh(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lambert(0xf2c14e), 0, 0.2, -0.01, player.head); m.rotation.x = -0.15; return m; })(),
  cap: (() => {
    const g = new THREE.Group(); g.position.set(0, 0.2, 0); player.head.add(g);
    const red = lambert(0xd8343f);
    addMesh(new THREE.SphereGeometry(0.212, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), red, 0, 0, -0.01, g).rotation.x = -0.12;
    addMesh(new THREE.BoxGeometry(0.26, 0.02, 0.17), red, 0, 0.02, 0.2, g).rotation.x = 0.08;
    return g;
  })(),
  fedora: (() => {
    const g = new THREE.Group(); g.position.set(0, 0.3, 0); g.rotation.x = -0.08; player.head.add(g);
    const felt = lambert(0x4a3a2e);
    addMesh(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 24), felt, 0, 0, 0, g);
    addMesh(new THREE.CylinderGeometry(0.17, 0.2, 0.17, 20), felt, 0, 0.09, 0, g);
    addMesh(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 20), lambert(0x1a1410), 0, 0.03, 0, g);
    return g;
  })(),
};
const glasses = (() => {
  const g = new THREE.Group(); g.position.set(0, 0.19, 0.185); player.head.add(g);
  const m = lambert(0x111018, { emissive: 0x05050a });
  addMesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), m, 0.065, 0, 0, g);
  addMesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), m, -0.065, 0, 0, g);
  addMesh(new THREE.BoxGeometry(0.04, 0.012, 0.012), m, 0, 0.01, 0, g);
  return g;
})();
const collar = (() => {
  const g = new THREE.Group(); player.body.add(g);
  const m = lambert(0x15131a);
  addMesh(new THREE.BoxGeometry(0.14, 0.16, 0.04), m, 0.1, 1.48, 0.2, g).rotation.set(-0.3, 0, -0.5);
  addMesh(new THREE.BoxGeometry(0.14, 0.16, 0.04), m, -0.1, 1.48, 0.2, g).rotation.set(-0.3, 0, 0.5);
  addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.02), lambert(0xe9e4da), 0, 1.22, 0.215, g);
  return g;
})();
// 무대 소품: 열린 기타 케이스, 앰프, 마이크 스탠드
const gcase = new THREE.Group(); gcase.position.copy(CASE_POS); gcase.rotation.y = 0.15; scene.add(gcase);
addMesh(new THREE.BoxGeometry(0.55, 0.12, 1.1), lambert(0x1e1b26), 0, 0.06, 0, gcase);
addMesh(new THREE.BoxGeometry(0.45, 0.02, 1.0), lambert(0x8f2e46), 0, 0.125, 0, gcase);
addMesh(new THREE.BoxGeometry(0.55, 0.04, 1.1), lambert(0x1e1b26), -0.3, 0.3, 0, gcase).rotation.z = 1.2;
const pile = new THREE.Group(); gcase.add(pile);
const amp = new THREE.Group(); amp.position.set(-1.25, 0, -0.2); amp.rotation.y = -0.4; scene.add(amp);
addMesh(new THREE.BoxGeometry(0.62, 0.62, 0.36), lambert(0x1d1a22), 0, 0.31, 0, amp);
addMesh(new THREE.BoxGeometry(0.5, 0.42, 0.01), lambert(0x3a3542), 0, 0.27, -0.185, amp);
addMesh(new THREE.BoxGeometry(0.5, 0.06, 0.01), lambert(0xc9a24a, { emissive: 0x3a2a08 }), 0, 0.55, -0.185, amp);
const micStand = new THREE.Group(); micStand.position.set(-0.05, 0, -0.42); scene.add(micStand);
addMesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), lambert(0x222026), 0, 0.015, 0, micStand);
addMesh(new THREE.CylinderGeometry(0.012, 0.012, 1.62, 8), lambert(0x2b2930), 0, 0.82, 0, micStand);
addMesh(new THREE.CylinderGeometry(0.03, 0.022, 0.13, 10), lambert(0x111015), 0, 1.68, 0.04, micStand).rotation.x = 0.9;
addMesh(new THREE.SphereGeometry(0.035, 10, 8), lambert(0x8a8a90), 0, 1.72, 0.1, micStand);

let inst = null; // { id, cfg, group, bow }
function equipInstrument(id) {
  if (inst) { player.body.remove(inst.group); disposeTree(inst.group); if (inst.bow) { player.armR.remove(inst.bow); disposeTree(inst.bow); } }
  const c = INSTRUMENTS[id], group = c.make();
  group.position.set(...c.pos); group.rotation.set(...c.rot);
  player.body.add(group);
  let bow = null;
  if (c.motion === 'bow') {
    bow = new THREE.Group(); bow.position.set(0, -0.64, 0.02); bow.rotation.set(0, 0, 1.45);
    addMesh(new THREE.BoxGeometry(0.012, 0.72, 0.012), lambert(0x3b2414), 0, 0.3, 0, bow);
    addMesh(new THREE.BoxGeometry(0.004, 0.66, 0.02), lambert(0xf1ece0), 0.014, 0.3, 0, bow);
    player.armR.add(bow);
  }
  inst = { id, cfg: c, group, bow };
  player.armR.rotation.set(...c.armR); player.armL.rotation.set(...c.armL);
}
function applyLook() {
  const eq = S.eq;
  Object.entries(hats).forEach(([k, m]) => { m.visible = eq.hat === k; });
  glasses.visible = eq.glasses === 'sunglasses';
  collar.visible = eq.top === 'jacket';
  const topColor = { shirt: [0x2f6f73, 0x000000], sparkle: [0xe0b84a, 0x4a3608], jacket: [0x1f1c22, 0x000000] }[eq.top] || [0x2f6f73, 0];
  player.shirt.color.setHex(topColor[0]); player.shirt.emissive.setHex(topColor[1]);
  if (!inst || inst.id !== eq.instrument) equipInstrument(eq.instrument);
  amp.visible = eq.instrument === 'electric';
  micStand.visible = eq.gear === 'micstand';
}
const styleScore = () => ['hat', 'glasses', 'top'].reduce((s, k) => s + ((S.eq[k] && ITEM[S.eq[k]].style) || 0), 0);
const instStat = () => ITEM[S.eq.instrument].stat;

/* ───────── 소리 ───────── */
let actx = null, master = null, recDest = null;
const bufCache = new Map();
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = actx.createGain(); master.gain.value = 0.8;
    master.connect(comp); comp.connect(actx.destination);
    if (actx.createMediaStreamDestination) { recDest = actx.createMediaStreamDestination(); comp.connect(recDest); }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
const PLUCK = {
  guitar: { smooth: 2, lo: 0.9965, hi: 0.9985, len: 2.4, lp: 3800, gain: 0.9 },
  ukulele: { smooth: 1, lo: 0.992, hi: 0.995, len: 1.3, lp: 5200, gain: 0.8, shift: 12 },
  electric: { smooth: 2, lo: 0.9985, hi: 0.9992, len: 3.0, lp: 2600, gain: 0.5, drive: true },
};
function pluckBuffer(midi, kind) {
  const key = kind + midi;
  if (bufCache.has(key)) return bufCache.get(key);
  const P = PLUCK[kind], sr = actx.sampleRate, freq = 440 * Math.pow(2, (midi - 69) / 12);
  const len = Math.floor(sr * P.len), N = Math.max(2, Math.round(sr / freq));
  const buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  for (let k = 0; k < P.smooth; k++) for (let i = 0; i < N; i++) ring[i] = (ring[i] + ring[(i + 1) % N]) * 0.5;
  const decay = midi > 70 ? P.hi : P.lo;
  let idx = 0, peak = 0;
  for (let n = 0; n < len; n++) {
    const cur = ring[idx];
    ring[idx] = (cur + ring[(idx + 1) % N]) * 0.5 * decay;
    d[n] = cur; peak = Math.max(peak, Math.abs(cur));
    idx = (idx + 1) % N;
  }
  const norm = 0.55 / (peak || 1), fade = Math.floor(sr * 0.05);
  for (let n = 0; n < len; n++) d[n] *= norm;
  for (let n = 0; n < fade; n++) d[len - 1 - n] *= n / fade;
  bufCache.set(key, buf);
  return buf;
}
let driveCurve = null;
function playPluck(midi, kind) {
  const P = PLUCK[kind];
  const src = actx.createBufferSource(); src.buffer = pluckBuffer(midi + (P.shift || 0), kind);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = P.lp; lp.Q.value = 0.7;
  const g = actx.createGain(); g.gain.value = P.gain;
  if (P.drive) {
    if (!driveCurve) {
      driveCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; driveCurve[i] = Math.tanh(x * 6) * 0.9; }
    }
    const ws = actx.createWaveShaper(); ws.curve = driveCurve; ws.oversample = '2x';
    src.connect(ws); ws.connect(lp);
  } else src.connect(lp);
  lp.connect(g); g.connect(master);
  src.start();
}
function playBowed(midi) {
  const t = actx.currentTime, f = 440 * Math.pow(2, (midi + 12 - 69) / 12);
  const o1 = actx.createOscillator(), o2 = actx.createOscillator();
  o1.type = o2.type = 'sawtooth'; o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 7;
  const lfo = actx.createOscillator(), lg = actx.createGain();
  lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35);
  lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 1.4;
  const bp = actx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 3000; bp.gain.value = 5;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.09);
  g.gain.setValueAtTime(0.16, t + 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  o1.connect(lp); o2.connect(lp); lp.connect(bp); bp.connect(g); g.connect(master);
  [o1, o2, lfo].forEach((o) => { o.start(t); o.stop(t + 1.55); });
}
function playInstrument(midi) {
  if (!ensureAudio()) return;
  if (S.eq.instrument === 'violin') playBowed(midi); else playPluck(midi, S.eq.instrument);
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
function playCoin(bill) {
  if (!actx) return;
  const t = actx.currentTime;
  if (bill) { // 지폐: 사락
    const src = actx.createBufferSource(); src.buffer = noiseBuf || (playClap(0), noiseBuf); src.playbackRate.value = 0.5;
    const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g = actx.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
    return;
  }
  [2637, 3520].forEach((fr, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = fr * rand(0.97, 1.03);
    g.gain.setValueAtTime(0.0001, t + i * 0.05); g.gain.exponentialRampToValueAtTime(0.07, t + i * 0.05 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 0.25);
    o.connect(g); g.connect(master); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.3);
  });
}

// 떼창: 합성 목소리 여러 개를 음정·타이밍을 살짝 흐트려 합창처럼
const foldChoir = (m) => { while (m > 71) m -= 12; while (m < 55) m += 12; return m; };
function choirNote(midi, count, dur, solo, kid, drunk) {
  if (!ensureAudio()) return;
  const t0 = actx.currentTime, base = foldChoir(midi);
  const out = actx.createGain(); out.gain.value = Math.min(0.55, 0.13 * Math.sqrt(count)) * (solo ? 1.25 : 1);
  const mix = actx.createGain();
  [[800, 6, 1], [1150, 8, 0.5], [2900, 10, 0.2]].forEach(([fr, q, gv]) => {
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
    const g = actx.createGain(); g.gain.value = gv * 3;
    mix.connect(bp); bp.connect(g); g.connect(out);
  });
  out.connect(master);
  const voices = clamp(Math.round(2 + count * 0.5), 3, 7);
  for (let i = 0; i < voices; i++) {
    const st = t0 + Math.random() * 0.045, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(base + (kid && i === 0 ? 12 : 0));         // 아이는 한 옥타브 위
    o.detune.value = rand(-14, 14) + (drunk && i === 1 ? rand(-50, 50) : 0); // 취객은 음이탈
    g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.22, st + 0.05);
    g.gain.setValueAtTime(0.22, st + dur); g.gain.exponentialRampToValueAtTime(0.0001, st + dur + 0.25);
    o.connect(g); g.connect(mix); o.start(st); o.stop(st + dur + 0.3);
  }
}
function playHowl() {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(560, t); o.frequency.linearRampToValueAtTime(880, t + 0.35); o.frequency.linearRampToValueAtTime(700, t + 1.0);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.1);
}

// 노래(Space·🎤 버튼): 마지막으로 친 음을 따라 "아~" 하는 목소리 합성
let voice = null, voiceMidi = 60;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function foldVoice(m) { while (m > 72) m -= 12; while (m < 52) m += 12; return m; }
function voiceStart() {
  if (!ensureAudio() || voice) return;
  const t = actx.currentTime, f = midiHz(voiceMidi);
  const o1 = actx.createOscillator(), o2 = actx.createOscillator();
  o1.type = o2.type = 'sawtooth'; o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 8;
  const lfo = actx.createOscillator(), lg = actx.createGain();
  lfo.frequency.value = 5.3; lg.gain.value = f * 0.007;
  lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
  const mix = actx.createGain(); mix.gain.value = 0.5;
  o1.connect(mix); o2.connect(mix);
  const out = actx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.32, t + 0.09);
  [[800, 8, 1], [1150, 10, 0.55], [2900, 12, 0.22]].forEach(([fr, q, gv]) => { // "아" 포먼트
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
    const g = actx.createGain(); g.gain.value = gv * 4;
    mix.connect(bp); bp.connect(g); g.connect(out);
  });
  out.connect(master);
  [o1, o2, lfo].forEach((o) => o.start(t));
  voice = { o1, o2, lfo, lg, out };
}
function voiceTo(m) {
  voiceMidi = foldVoice(m);
  if (!voice) return;
  const t = actx.currentTime, f = midiHz(voiceMidi);
  voice.o1.frequency.setTargetAtTime(f, t, 0.035); voice.o2.frequency.setTargetAtTime(f, t, 0.035);
  voice.lg.gain.setTargetAtTime(f * 0.007, t, 0.05);
  voice.out.gain.cancelScheduledValues(t); voice.out.gain.setValueAtTime(0.14, t); voice.out.gain.exponentialRampToValueAtTime(0.32, t + 0.07); // "라" 끊어 부르기
}
function voiceStop() {
  if (!voice) return;
  const t = actx.currentTime, v = voice; voice = null;
  v.out.gain.cancelScheduledValues(t); v.out.gain.setValueAtTime(Math.max(0.0001, v.out.gain.value), t); v.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  [v.o1, v.o2, v.lfo].forEach((o) => o.stop(t + 0.22));
}

// 노래 = Space(모바일 🎤 버튼)를 누르고 있는 동안만 마이크가 켜짐(푸시투토크).
// 마이크 소리 크기가 기준을 넘으면 "노래 중". 녹화 영상에는 내 목소리가 들어감.
// 마이크를 못 쓰면(권한 거부, http 접속 등) 누르는 동안 합성 목소리로 대신 부름.
let micState = 'off', micStream = null, micTrack = null, micSrc = null, micAnalyser = null, micBuf = null, micLevel = 0, micIdle = null;
let singHeld = false;
const useSynth = () => micState === 'denied' || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
async function micAcquire() {
  if (micState === 'ready' || micState === 'asking') return;
  micState = 'asking';
  try {
    ensureAudio();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    micTrack = micStream.getAudioTracks()[0];
    micSrc = actx.createMediaStreamSource(micStream);
    micAnalyser = actx.createAnalyser(); micAnalyser.fftSize = 1024; micBuf = new Float32Array(micAnalyser.fftSize);
    micSrc.connect(micAnalyser);
    if (recDest) micSrc.connect(recDest);
    micState = 'ready';
    micTrack.enabled = singHeld;
    if (!singHeld) micIdle = setTimeout(micRelease, CFG.micIdleRelease * 1000);
  } catch (e) {
    micState = 'denied';
    toast('마이크를 쓸 수 없어서 합성 목소리로 불러요. 브라우저에서 마이크를 허용하고 https 주소로 접속하면 내 목소리로 부를 수 있어요');
    if (singHeld) { voiceStart(); voiceTo(lastMidi); }
  }
}
function micRelease() { // 한동안 안 쓰면 장치까지 닫음 (브라우저 마이크 표시도 꺼짐)
  if (micState !== 'ready' || singHeld) return;
  micStream.getTracks().forEach((t) => t.stop());
  try { micSrc.disconnect(); } catch (e) { /* 무시 */ }
  micState = 'off'; micStream = micTrack = micSrc = micAnalyser = null; micLevel = 0;
}
function singDown() {
  if (singHeld) return;
  singHeld = true; singCap.classList.add('on'); singPadEl.classList.add('on');
  ensureAudio();
  clearTimeout(micIdle);
  if (useSynth()) { voiceStart(); voiceTo(lastMidi); return; }
  if (micState === 'ready') micTrack.enabled = true; else micAcquire();
}
function singUp() {
  if (!singHeld) return;
  singHeld = false; singCap.classList.remove('on'); singPadEl.classList.remove('on');
  voiceStop();
  if (micTrack) micTrack.enabled = false;
  micLevel = 0;
  clearTimeout(micIdle); micIdle = setTimeout(micRelease, CFG.micIdleRelease * 1000);
}
function readMic() {
  if (!singHeld || micState !== 'ready') return;
  micAnalyser.getFloatTimeDomainData(micBuf);
  let sum = 0; for (let i = 0; i < micBuf.length; i++) sum += micBuf[i] * micBuf[i];
  micLevel = micLevel * 0.75 + Math.sqrt(sum / micBuf.length) * 0.25;
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
const keyMap = new Map();
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
const singCap = document.createElement('div'); singCap.className = 'cap sing'; singCap.style.setProperty('--c', '#7dffb2');
singCap.innerHTML = '<span class="k">Space</span><span class="n">🎤 누르는 동안 노래</span><i class="lvl"></i>';
const handCap = document.createElement('div'); handCap.className = 'cap sing'; handCap.style.setProperty('--c', '#ffb35c');
handCap.innerHTML = '<span class="k">Enter</span><span class="n">📣 관객에게 넘기기</span>';
const extraRow = document.createElement('div'); extraRow.className = 'row extra';
extraRow.append(singCap, handCap); keysEl.appendChild(extraRow);
const padsEl = $('#pads');
STEPS.forEach((s, i) => {
  const b = document.createElement('button'); b.className = 'pad'; b.textContent = NAMES[i];
  b.style.setProperty('--c', i < 7 ? 'var(--mid)' : 'var(--high)');
  b.setAttribute('aria-label', `${NAMES[i]} 연주`);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); noteOn(60 + s, i < 7 ? 1 : 2); flash(b); });
  padsEl.appendChild(b);
});
const singPadEl = document.createElement('button'); singPadEl.className = 'pad singpad'; singPadEl.innerHTML = '🎤 누르는 동안 노래<i class="lvl"></i>';
singPadEl.style.setProperty('--c', '#7dffb2');
padsEl.appendChild(singPadEl);
const handPadEl = document.createElement('button'); handPadEl.className = 'pad handpad'; handPadEl.textContent = '📣 넘기기';
handPadEl.style.setProperty('--c', '#ffb35c');
padsEl.appendChild(handPadEl);
handPadEl.addEventListener('pointerdown', (e) => { e.preventDefault(); handPadEl.setPointerCapture(e.pointerId); handDown(); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => handPadEl.addEventListener(ev, handUp));
singPadEl.addEventListener('pointerdown', (e) => { e.preventDefault(); singPadEl.setPointerCapture(e.pointerId); singDown(); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => singPadEl.addEventListener(ev, singUp));
function flash(el) { el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 140); }

/* ───────── 연주 상태 ───────── */
let now = 0, lastNoteAt = -99, lastPluckAt = -99, heat = 0, strum = 0, bowDir = 1, lastMidi = 60;
let setStats = null; // 한 곡(조용해지기 전까지) 기록 → 박수·팁 판단
const isSinging = () => singHeld && (voice !== null || micLevel > CFG.micThreshold);
const isPlaying = () => now - lastNoteAt < CFG.playHold;
let followersCache = 0;
const fameF = () => Math.log10(1 + followersCache); // 0 ~ 6
function hearRadius() {
  const sing = isSinging() ? CFG.singBoost * ((S.eq.gear === 'micstand') ? ITEM.micstand.stat.singHear : 1) : 1;
  return (CFG.hearBase + CFG.hearGain * heat) * instStat().hear * sing * (now < choirBoostUntil ? 1.6 : 1) + fameF() * 1.2;
}
function attractMult() {
  const sing = isSinging() ? 1.3 * ((S.eq.gear === 'micstand') ? ITEM.micstand.stat.singAttract : 1) : 1;
  return instStat().attract * sing * (1 + fameF() * 0.15) * (1 + styleScore() * 0.03) * (now < choirBoostUntil ? 1.4 : 1);
}
function newSet() { return { t0: now, notes: 0, uniq: new Set(), octs: new Set(), singT: 0 }; }
function trackNote(midi, oct) {
  if (!setStats) setStats = newSet();
  setStats.notes++; setStats.uniq.add(midi); setStats.octs.add(oct);
  if (rec) { rec.stats.notes++; rec.stats.uniq.add(midi); rec.stats.octs.add(oct); }
}

function noteOn(midi, oct) {
  ensureAudio();
  playInstrument(midi);
  lastNoteAt = now; lastPluckAt = now; lastMidi = midi;
  heat = Math.min(1, heat + 0.03 * instStat().attract);
  strum = 1; bowDir = -bowDir;
  trackNote(midi, oct);
  spawnNoteSprite(oct);
  if (voice) voiceTo(midi);
  for (const n of npcs) if (n.state === 'listen') n.bob = 1;
  hookNote(midi);
}

/* ───────── 떼창: 후렴 익히기 → 같이 부르기 / 관객에게 넘기기 ───────── */
const hist = [];           // 최근에 친 음 { m, t }
let hook = null;           // 관객이 외운 후렴 { id, seq, iv(음 사이 간격) }
let hookCand = null;       // 익히는 중인 후렴 { seq, count }
let hookPos = 0;           // 지금 후렴 몇 번째 음까지 맞게 쳤는지
let hookId = 0, hookUsedAt = -99, choirUntil = 0, choirBoostUntil = 0, choirPasses = 0, passChoir = false, passBubbles = 0;
let handHeld = false, hand = null, lastHandToast = -99;
const sameSeq = (a, b) => a && b && a.length === b.length && a.every((m, i) => m === b[i]);
function findRepeat() {
  const n = hist.length;
  for (let L = CFG.hookMax; L >= CFG.hookMin; L--) {
    if (n < L * 2) continue;
    const tail = hist.slice(n - L).map((h) => h.m);
    if (new Set(tail).size < 3) continue; // 같은 음만 반복하는 건 후렴으로 안 침
    let count = 1, j = n - 2 * L;
    while (j >= 0) {
      let ok = true;
      for (let k = 0; k < L; k++) if (hist[j + k].m !== tail[k]) { ok = false; break; }
      if (ok) { count++; j -= L; } else j--;
    }
    if (count >= 2) return { seq: tail, count };
  }
  return null;
}
const listening = () => npcs.filter((n) => n.state === 'listen');
const participation = () => clamp(0.35 + 0.2 * choirPasses + 0.35 * heat, 0, 1);
const canSing = (n) => hook && n.state === 'listen' && n.knows === hook.id && n.type !== 'runner' && n.type !== 'filmer';
const isSinger = (n) => canSing(n) && n.singSeed < participation();
const choirReady = () => hook && listening().length >= CFG.choirMinCrowd && npcs.filter(isSinger).length >= 2;
const choirOn = () => now < choirUntil;
function learnHook(seq) {
  const L = seq.length, tail = hist.slice(hist.length - L);
  const iv = tail.map((h, i) => (i < L - 1 ? clamp(tail[i + 1].t - h.t, 0.18, 0.9) : 0.45));
  const fresh = !hook;
  hook = { id: ++hookId, seq, iv }; hookCand = null; hookPos = 0; choirPasses = 0; hookUsedAt = now;
  listening().forEach((n) => { n.knows = hook.id; });
  toast(fresh ? '🎤 관객이 후렴을 외웠어요! 다시 치면 따라 불러요' : '🎤 관객이 새 후렴을 외웠어요');
}
function choirSing(midi, dur, solo) {
  const singers = npcs.filter(isSinger);
  if (!singers.length) return;
  const kid = singers.some((n) => n.type === 'family'), drunk = singers.some((n) => n.type === 'drunk');
  choirNote(midi, singers.length, dur, solo, kid, drunk);
  choirUntil = now + Math.max(1.0, dur + 0.6); choirBoostUntil = now + 6; passChoir = true;
  heat = Math.min(1, heat + 0.04);
  lastNoteAt = now;
  if (setStats) setStats.choir = (setStats.choir || 0) + 1;
  if (rec) rec.stats.choir = true;
  for (const n of singers) n.bob = 1;
  if (passBubbles < 2 && Math.random() < 0.35) { // 한 소절에 말풍선은 두 개까지
    const n = pick(singers); passBubbles++;
    say(n, n.type === 'drunk' ? '♪ 랄랄라~!!' : n.type === 'family' ? '♪ 라라!' : pick(['♪ 라~', '♪ 라라~', '♪ 라라라']));
  }
}
function completeHook() {
  hookUsedAt = now;
  listening().forEach((n) => { n.knows = hook.id; }); // 이번에 들은 사람도 외움
  if (passChoir) {
    choirPasses++;
    if (!S.firstChoir) { S.firstChoir = true; save(); toast('🎉 첫 떼창!'); }
    const dw = npcs.find((n) => n.type === 'dogwalker' && isSinger(n));
    if (dw && Math.random() < 0.4) { say(dw.dog, '아우~'); playHowl(); }
  }
  passChoir = false; passBubbles = 0;
}
function hookNote(midi) {
  hist.push({ m: midi, t: now });
  while (hist.length > 80 || (hist.length && now - hist[0].t > CFG.hookWindow)) hist.shift();
  // 1) 외운 후렴을 치는 중이면 관객이 두 번째 음부터 합류
  if (hook) {
    const seq = hook.seq;
    if (midi === seq[hookPos]) hookPos++;
    else {
      if (hookPos >= 2 && choirOn()) { // 후렴 중간에 다른 음 → "어?"
        npcs.filter(isSinger).slice(0, 2).forEach((n, i) => say(n, '어?', i * 0.15));
        choirUntil = 0; passChoir = false; passBubbles = 0;
      }
      hookPos = midi === seq[0] ? 1 : 0;
    }
    if (hookPos >= 2 && choirReady()) choirSing(midi, 0.38, false);
    if (hookPos === seq.length) { completeHook(); hookPos = 0; }
  }
  // 2) 새 후렴 익히기
  const r = findRepeat();
  if (r && !partOfHook(r.seq) && !(hook && now - hookUsedAt < CFG.hookLock)) {
    hookCand = r;
    if (r.count >= CFG.hookRepeats) learnHook(r.seq);
  }
}
// 외운 후렴을 이어서 반복하면 생기는 "후렴의 일부·순서만 돌린 것"은 새 후렴으로 안 침
function partOfHook(seq) {
  if (!hook) return false;
  const cyc = hook.seq.concat(hook.seq);
  for (let i = 0; i < hook.seq.length; i++) if (seq.every((m, k) => cyc[i + k] === m)) return true;
  return false;
}
function handDown() {
  if (handHeld) return;
  handHeld = true; handCap.classList.add('on'); handPadEl.classList.add('on');
  ensureAudio();
  const c = listening().length;
  if (!hook) { if (now - lastHandToast > 3) toast('아직 관객이 외운 후렴이 없어요. 같은 멜로디를 3번 반복해 보세요'); lastHandToast = now; return; }
  if (!choirReady()) { if (now - lastHandToast > 3) toast(`따라 부를 관객이 부족해요 (듣는 사람 ${c}/${CFG.choirMinCrowd}명)`); lastHandToast = now; return; }
  hand = { i: 0, at: now + 0.15 };
  passChoir = false; passBubbles = 0;
}
function handUp() {
  if (!handHeld) return;
  handHeld = false; hand = null; handCap.classList.remove('on'); handPadEl.classList.remove('on');
}
function updateHand() {
  if (!hand) return;
  if (!choirReady()) { hand = null; toast('따라 부르던 관객이 흩어졌어요'); return; }
  if (now < hand.at) return;
  const i = hand.i, d = hook.iv[i];
  choirSing(hook.seq[i], Math.max(0.25, d * 0.85), true);
  hand.i++;
  if (hand.i >= hook.seq.length) { completeHook(); hand.i = 0; hand.at = now + d + 0.5; } else hand.at = now + d;
}
function resetChoir() {
  hist.length = 0; hook = null; hookCand = null; hookPos = 0; hookUsedAt = -99; choirUntil = 0; choirBoostUntil = 0; choirPasses = 0; hand = null;
}

const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  if (e.code === 'Escape') { if (!phoneEl.hidden) closePhone(); else toggleIntro(); return; }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!introEl.hidden) closeIntro();
    if (!e.repeat) singDown();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    if (!introEl.hidden) { closeIntro(); return; }
    if (!e.repeat) handDown();
    return;
  }
  const k = keyMap.get(e.code);
  if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (!introEl.hidden) closeIntro();
  if (e.repeat) return;
  noteOn(k.midi, k.oct);
  flash(k.el);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !typing(e)) { e.preventDefault(); singUp(); }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !typing(e)) { e.preventDefault(); handUp(); }
});
window.addEventListener('blur', () => { singUp(); handUp(); });

/* ───────── 떠오르는 음표·글자 ───────── */
const glyphTex = (ch, size) => canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff'; g.font = `bold ${size}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 32, 34);
});
const noteTexs = [glyphTex('♪', 48), glyphTex('♫', 46)];
const notes = [];
for (let i = 0; i < 28; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTexs[0], transparent: true, depthWrite: false, fog: false }));
  s.visible = false; s.scale.set(0.42, 0.42, 1); scene.add(s);
  notes.push({ s, life: 0, v: new V3() });
}
let noteIdx = 0;
const tmpV = new V3(), tmpV2 = new V3();
function spawnNoteSprite(oct, fromMouth) {
  const n = notes[noteIdx++ % notes.length];
  if (fromMouth) player.head.getWorldPosition(tmpV).add(new V3(0, 0.25, -0.2)); else inst.group.getWorldPosition(tmpV).add(new V3(rand(-0.2, 0.2), 0.3, rand(-0.2, 0.1)));
  n.s.position.copy(tmpV);
  n.s.material.map = pick(noteTexs);
  n.s.material.color.setHex(oct === 'sing' ? 0x7dffb2 : NOTE_COLOR[oct]);
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
// "+1,000" 처럼 케이스 위로 떠오르는 금액
const goldCache = new Map();
function goldTex(text) {
  if (goldCache.has(text)) return goldCache.get(text);
  const t = canvasTex(256, 80, (g) => {
    g.font = '800 54px system-ui, "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = 'rgba(40,24,0,.85)'; g.strokeText(text, 128, 42);
    g.fillStyle = '#ffd34d'; g.fillText(text, 128, 42);
  });
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  goldCache.set(text, t);
  return t;
}
const floats = [];
for (let i = 0; i < 10; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false }));
  s.visible = false; s.scale.set(0.8, 0.25, 1); s.renderOrder = 11; scene.add(s); floats.push({ s, life: 0 });
}
let floatIdx = 0;
function floatText(text, pos) {
  const f = floats[floatIdx++ % floats.length];
  f.s.material.map = goldTex(text); f.s.material.needsUpdate = true;
  f.s.position.copy(pos).add(new V3(rand(-0.15, 0.15), 0.35, 0)); f.life = 1; f.s.visible = true;
}
function updateFloats(dt) {
  for (const f of floats) {
    if (!f.s.visible) continue;
    f.life -= dt / 1.4;
    if (f.life <= 0) { f.s.visible = false; continue; }
    f.s.position.y += dt * 0.6; f.s.material.opacity = Math.min(1, f.life * 2.5);
  }
}

/* ───────── 행인 NPC ───────── */
const SPOTS = [];
[-46, -23, 0, 23, 46].forEach((deg) => SPOTS.push({ a: deg * Math.PI / 180, r: 3.5, row: 'front' }));
[-58, -35, -12, 12, 35, 58].forEach((deg) => SPOTS.push({ a: deg * Math.PI / 180, r: 5.0, row: 'back' }));
SPOTS.forEach((s) => { s.pos = new V3(Math.sin(s.a) * s.r, 0, -Math.cos(s.a) * s.r); s.taken = null; });

// 관객 유형: 걷는 속도, 끌림, 인내심 배율, 선호 줄, 팁 줄 확률과 금액 가중치([100, 500, 1000, 5000, 10000]원)
const TYPES = {
  normal: { speed: [1.05, 1.55], attract: 1.0, patience: 1.0, row: null, tip: 0.3, amounts: [4, 6, 3, 0.5, 0.1] },
  filmer: { speed: [0.95, 1.3], attract: 1.7, patience: 0.8, row: 'front', tip: 0.15, amounts: [2, 4, 3, 0.5, 0] },
  drunk: { speed: [0.55, 0.8], attract: 2.4, patience: 1.8, row: null, tip: 0.7, amounts: [0, 2, 4, 2, 0.8] },
  family: { speed: [0.85, 1.1], attract: 1.4, patience: 1.0, row: 'back', tip: 0.5, amounts: [3, 6, 2, 0.2, 0] },
  dogwalker: { speed: [0.85, 1.15], attract: 1.2, patience: 0.6, row: null, tip: 0.3, amounts: [3, 6, 2, 0.3, 0] }, // 강아지가 보채서 오래 못 있음
  runner: { speed: [3.0, 3.8], attract: 0.45, patience: 0.45, row: null, tip: 0.12, amounts: [3, 5, 1, 0, 0] },   // 잘 안 멈추고 금방 다시 뜀
};
const AMOUNTS = [100, 500, 1000, 5000, 10000];
const LINES = {
  drunkWalk: ['딸꾹', '으어~', '집이 어디더라…'],
  drunkListen: ['좋다~!', '♪ 랄랄라~', '딸꾹', '한 곡 더!'],
  drunkArrive: ['어이~ 총각!', '좋다~!'],
  drunkCheer: ['앵콜~!!', '앵콜! 앵콜!'],
  drunkTip: ['옜다!', '용돈이다~'],
  filmArrive: ['오, 찍어야지', '이거 올려야겠다'],
  filmCheer: ['저장 완료', '좋아요 눌러야지'],
  kidArrive: ['아빠 저거 봐!', '기타다!'],
  kidListen: ['와아~', '노래 좋아!'],
  kidCheer: ['또 해줘!', '와아아!'],
  kidTip: ['내가 넣을래!'],
  normalCheer: ['와~', '잘한다!', '멋있다'],
  recognize: ['어? 버스타그램에서 본 사람!', '헐 그 버스커다', '실물이 낫네'],
  playerSing: ['♪ 라라라~', '♪ 오늘 밤~', '♪ 우우~', '♪ 랄랄라'],
  dogArrive: ['잠깐만 듣고 가자', '쉿, 들어봐'],
  dogLeave: ['알았어 가자~', '그래그래 산책 가자'],
  dogCheer: ['우리 초코도 좋대요'],
  bark: ['멍!', '왈왈!', '멍멍!'],
  runArrive: ['헉헉… 좋은데?', '잠깐 쉬어 갈까'],
  runCheer: ['화이팅!', '다시 뛰어야지'],
};

function makePhone(caseColor) {
  const g = new THREE.Group();
  addMesh(new THREE.BoxGeometry(0.085, 0.165, 0.014), lambert(caseColor), 0, 0, 0, g);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.15), new THREE.MeshBasicMaterial({ color: 0xbfe3ff }));
  screen.position.z = -0.0085; screen.rotation.y = Math.PI; g.add(screen);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  lens.position.set(0.022, 0.06, 0.0085); g.add(lens);
  const rec = new THREE.Mesh(new THREE.CircleGeometry(0.013, 10), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
  rec.position.set(-0.02, 0.06, 0.0085); rec.visible = false; g.add(rec);
  g.userData.rec = rec;
  return g;
}
function makeBottle() {
  const g = new THREE.Group();
  const m = lambert(0x3f8f4f, { emissive: 0x0c2a12 });
  addMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 10), m, 0, -0.06, 0, g);
  addMesh(new THREE.CylinderGeometry(0.016, 0.035, 0.09, 8), m, 0, 0.075, 0, g);
  return g;
}
const DOG_COLORS = [[0xb07a45, 0x5a3a20], [0xf2eadc, 0xd8c8b0], [0x2b2622, 0x4a3f38], [0xd9a54a, 0xb07a2a], [0xe8e2d8, 0x8a6040]];
function makeDog() {
  const [c1, c2] = pick(DOG_COLORS), fur = lambert(c1), dark = lambert(c2), g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  addMesh(new THREE.BoxGeometry(0.2, 0.18, 0.46), fur, 0, 0.36, 0, body);
  const head = new THREE.Group(); head.position.set(0, 0.5, 0.26); body.add(head);
  addMesh(new THREE.BoxGeometry(0.19, 0.17, 0.18), fur, 0, 0, 0.02, head);
  addMesh(new THREE.BoxGeometry(0.11, 0.08, 0.1), dark, 0, -0.04, 0.14, head);
  addMesh(new THREE.SphereGeometry(0.022, 6, 4), cmat(0x111111), 0, -0.01, 0.195, head).castShadow = false;
  [0.07, -0.07].forEach((x) => {
    addMesh(new THREE.SphereGeometry(0.018, 6, 4), cmat(0x111111), x, 0.03, 0.11, head).castShadow = false;
    addMesh(new THREE.BoxGeometry(0.05, 0.1, 0.03), dark, x * 1.25, 0.07, -0.03, head).rotation.z = x > 0 ? -0.35 : 0.35;
  });
  addMesh(new THREE.BoxGeometry(0.21, 0.04, 0.05), lambert(0xd8343f), 0, -0.07, -0.05, head); // 목줄
  const legs = [];
  [[0.07, 0.17], [-0.07, 0.17], [0.07, -0.17], [-0.07, -0.17]].forEach(([x, z]) => {
    const p = new THREE.Group(); p.position.set(x, 0.3, z); body.add(p);
    addMesh(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(0, -0.15, 0), dark, 0, 0, 0, p);
    legs.push(p);
  });
  const tail = new THREE.Group(); tail.position.set(0, 0.42, -0.23); body.add(tail);
  addMesh(new THREE.CylinderGeometry(0.018, 0.028, 0.2, 6).translate(0, 0.1, 0), fur, 0, 0, 0, tail);
  tail.rotation.x = -0.6;
  return { g, body, head, legs, tail, pos: new V3(), phase: rand(0, 6), type: 'dog', scale: 1, pending: null, bubble: null, bubbleUntil: 0 };
}
function playBark() {
  if (!actx) return;
  const t = actx.currentTime;
  [0, 0.16].forEach((d) => {
    const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(rand(520, 640), t + d); o.frequency.exponentialRampToValueAtTime(260, t + d + 0.09);
    f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
    o.connect(f); f.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.12);
  });
}
const leashMat = new THREE.LineBasicMaterial({ color: 0xd8343f });
const flashTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,250,220,.7)'); r.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});
const AVATAR_COLORS = ['#ff7aa8', '#7ab8ff', '#ffc65c', '#7dffb2', '#b49bff', '#ff9a5c'];
function genHandle() {
  const sns = D.sns;
  return Math.random() < 0.3 ? pick(sns.handleKo) + Math.floor(rand(1, 99)) : pick(sns.handlePre) + pick(sns.handleSuf);
}
function decorate(n) {
  if (n.type === 'filmer') {
    n.phone = makePhone(pick([0xf4f1ea, 0xff8fb1, 0x2a2a33, 0x9bc4e2]));
    n.phone.scale.setScalar(1.5);
    n.body.add(n.phone);
    n.handle = genHandle(); n.avatar = pick(AVATAR_COLORS);
    n.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    n.flash.position.set(0.02, 0.06, 0.03); n.flash.scale.set(0.4, 0.4, 1); n.flash.visible = false; n.phone.add(n.flash);
  } else if (n.type === 'drunk') {
    const bottle = makeBottle(); bottle.position.set(0, -0.66, 0.05); bottle.rotation.x = 1.1; n.armR.add(bottle);
    addMesh(new THREE.SphereGeometry(0.04, 8, 6), cmat(0xd9474f), 0, 0.15, 0.185, n.head).castShadow = false;
    [0.1, -0.1].forEach((x) => { const c = addMesh(new THREE.SphereGeometry(0.045, 8, 6), cmat(0xef7f86), x, 0.12, 0.15, n.head); c.scale.z = 0.4; c.castShadow = false; });
    addMesh(new THREE.BoxGeometry(0.07, 0.3, 0.02), cmat(0xc0392b), 0.04, 1.32, 0.235, n.body).rotation.set(-0.12, 0, 0.35);
  } else if (n.type === 'dogwalker') {
    n.dog = makeDog(); scene.add(n.dog.g); speakers.push(n.dog);
    n.dog.pos.copy(n.pos).add(new V3(0.7, 0, 0));
    n.leash = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 9 }, () => new V3())), leashMat);
    n.leash.frustumCulled = false; scene.add(n.leash);
  } else if (n.type === 'runner') {
    const band = addMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14, 1, true), lambert(pick([0xff4f7a, 0x37d0ff, 0xf2e14d])), 0, 0.24, 0, n.head);
    band.material.side = THREE.DoubleSide; band.castShadow = false;
    [0.19, -0.19].forEach((x) => { addMesh(new THREE.SphereGeometry(0.025, 6, 4), cmat(0xf4f4f4), x, 0.16, 0.02, n.head).castShadow = false; }); // 이어폰
    n.lean = 0;
  } else if (n.type === 'family') {
    const kid = makePerson(randomLook());
    kid.g.scale.setScalar(0.5); kid.head.scale.setScalar(1.4);
    kid.g.position.set(0, 1.5, -0.18);
    kid.legL.rotation.set(-1.0, 0, 0.55); kid.legR.rotation.set(-1.0, 0, -0.55);
    n.body.add(kid.g); n.kid = kid;
  }
}

/* 말풍선 */
const bubbleCache = new Map();
const BUBBLE_FONT = '700 44px system-ui, -apple-system, "Malgun Gothic", sans-serif';
function bubbleTex(text) {
  if (bubbleCache.has(text)) return bubbleCache.get(text);
  const meas = document.createElement('canvas').getContext('2d'); meas.font = BUBBLE_FONT;
  const pad = 24, tail = 16, w = Math.ceil(meas.measureText(text).width) + pad * 2, h = 44 + pad * 2 + tail, bh = h - tail;
  const tex = canvasTex(w, h, (g) => {
    g.fillStyle = '#fff8ec'; g.strokeStyle = 'rgba(42,34,64,.35)'; g.lineWidth = 3;
    const r = 30;
    g.beginPath();
    g.moveTo(r, 2); g.lineTo(w - r, 2); g.quadraticCurveTo(w - 2, 2, w - 2, r); g.lineTo(w - 2, bh - r); g.quadraticCurveTo(w - 2, bh - 2, w - r, bh - 2);
    g.lineTo(w / 2 + 14, bh - 2); g.lineTo(w / 2, h - 2); g.lineTo(w / 2 - 14, bh - 2);
    g.lineTo(r, bh - 2); g.quadraticCurveTo(2, bh - 2, 2, bh - r); g.lineTo(2, r); g.quadraticCurveTo(2, 2, r, 2);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#2a2240'; g.font = BUBBLE_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, bh / 2 + 2);
  });
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const b = { tex, aspect: w / h };
  bubbleCache.set(text, b);
  return b;
}
function say(n, text, delay) { n.pending = { text, at: now + (delay || 0) }; }
const speakers = []; // npcs + 플레이어
function updateBubbles(t) {
  for (const n of speakers) {
    if (n.pending && t >= n.pending.at) {
      if (!n.bubble) {
        n.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false }));
        n.bubble.center.set(0.5, 0); n.bubble.renderOrder = 10; scene.add(n.bubble);
      }
      const b = bubbleTex(n.pending.text);
      n.bubble.material.map = b.tex; n.bubble.material.needsUpdate = true;
      n.bubble.scale.set(0.36 * b.aspect, 0.36, 1);
      n.bubbleUntil = t + 2.2; n.pending = null;
    }
    if (!n.bubble) continue;
    const left = n.bubbleUntil - t;
    n.bubble.visible = left > 0;
    if (left > 0) {
      n.bubble.position.set(n.pos.x, (n.type === 'family' ? 2.95 : n.type === 'dog' ? 0.85 : 2.2) * n.scale, n.pos.z);
      n.bubble.material.opacity = Math.min(1, left / 0.3);
    }
  }
}
const playerSpeaker = { pos: new V3(0, 0, 0), scale: 1.08, type: 'player', pending: null, bubble: null, bubbleUntil: 0 };
speakers.push(playerSpeaker);

function areaEdge(fromPos) {
  const A = env.L.area;
  if (A.type === 'circle') {
    const fromA = fromPos ? Math.atan2(fromPos.x, fromPos.z) : undefined;
    for (let t = 0; t < 10; t++) {
      const a = fromA === undefined ? rand(0, Math.PI * 2) : fromA + Math.PI + rand(-1.0, 1.0);
      const p = new V3(Math.sin(a) * A.r * rand(0.82, 1), 0, Math.cos(a) * A.r * rand(0.82, 1));
      if (!env.obstacles.some((o) => o.r > 2 && p.distanceTo(o.p) < o.r + 1.2)) return p;
    }
    return new V3(A.r, 0, 0);
  }
  const side = fromPos ? (fromPos.x > 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1);
  return new V3(side * A.halfX * rand(0.9, 1), 0, rand(A.zMin, A.zMax));
}
function areaRandom() {
  const A = env.L.area;
  for (let t = 0; t < 20; t++) {
    const p = A.type === 'circle' ? new V3(rand(-22, 22), 0, rand(-22, 20)) : new V3(rand(-A.halfX, A.halfX), 0, rand(A.zMin, A.zMax));
    if (A.type === 'circle' && p.length() > A.r) continue;
    if (p.length() < 3.5 || env.obstacles.some((o) => o.r > 2 && p.distanceTo(o.p) < o.r + 1.2)) continue;
    return p;
  }
  return areaEdge();
}

const npcs = [];
function newWalkTarget(n) {
  n.target = areaEdge(n.pos);
  n.via = Math.random() < 0.45 ? new V3(rand(-7, 7), 0, rand(-9, -2.5)) : null; // 일부는 버스킹 자리 앞을 지나감
}
function spawnNpc(type) {
  const look = randomLook();
  if (type === 'drunk') Object.assign(look, { shirt: 0xe9e4da, pants: 0x3a3d4a, skin: pick([0xe5b48c, 0xcf9a6e]) });
  if (type === 'runner') Object.assign(look, { shirt: pick([0xff6a3d, 0x2fd18a, 0x3d8bff, 0xf5f5f5, 0xff4f9a]), pants: 0x1c1c22 });
  const p = makePerson(look);
  scene.add(p.g);
  const T = TYPES[type];
  const n = Object.assign(p, {
    type, pos: areaRandom(), dir: new V3(0, 0, 1), speed: rand(T.speed[0], T.speed[1]), phase: rand(0, 6),
    state: 'walk', cooldown: 0, spot: null, listenFor: 0, patience: 0, bob: 0, clapUntil: 0, nextClap: 0, headYaw: 0, scale: rand(0.92, 1.08),
    nextTalk: rand(3, 10), pending: null, bubble: null, bubbleUntil: 0, recorded: false, knows: 0, singSeed: Math.random(),
  });
  n.g.scale.setScalar(n.scale);
  decorate(n);
  newWalkTarget(n);
  npcs.push(n); speakers.push(n);
}
function clearNpcs() {
  for (const n of npcs) {
    scene.remove(n.g);
    for (const sp of [n, n.dog]) {
      if (!sp) continue;
      if (sp.bubble) { scene.remove(sp.bubble); sp.bubble.material.dispose(); }
      const i = speakers.indexOf(sp); if (i >= 0) speakers.splice(i, 1);
    }
    if (n.dog) scene.remove(n.dog.g);
    if (n.leash) { scene.remove(n.leash); n.leash.geometry.dispose(); }
  }
  npcs.length = 0;
  SPOTS.forEach((s) => { s.taken = null; });
}
function spawnCrowd() {
  const L = env.L, mix = [];
  Object.entries(L.mix).forEach(([type, c]) => { for (let i = 0; i < c; i++) mix.push(type); });
  for (let i = 0; i < L.npcCount; i++) spawnNpc(mix[i] || 'normal');
}

function freeSpotFor(n) {
  const want = TYPES[n.type].row;
  let best = null, bd = 1e9;
  for (const pass of want ? [want, null] : [null]) {
    for (const s of SPOTS) {
      if (s.taken || (pass && s.row !== pass)) continue;
      const d = s.pos.distanceTo(n.pos) + s.r * 0.8;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) return best;
  }
  return null;
}
function startListening(n) {
  const s = freeSpotFor(n);
  if (!s) return false;
  s.taken = n; n.spot = s; n.state = 'approach'; n.via = null;
  n.patience = rand(CFG.patience[0], CFG.patience[1]) * TYPES[n.type].patience * (1 + fameF() * 0.1); n.listenFor = 0;
  return true;
}
function stopListening(n) {
  if (n.type === 'dogwalker' && n.state === 'listen' && Math.random() < 0.6) { say(n, pick(LINES.dogLeave)); say(n.dog, pick(LINES.bark)); playBark(); }
  if (n.spot) n.spot.taken = null;
  n.spot = null; n.state = 'walk'; n.cooldown = rand(CFG.reStopCooldown[0], CFG.reStopCooldown[1]);
  n.clapUntil = 0; n.recorded = false;
  if (rec && rec.filmer === n) finishRecording();
  newWalkTarget(n); n.via = null;
}
function onArrive(n) {
  const f = fameF();
  if (f >= 2 && Math.random() < 0.12 * f) say(n, pick(LINES.recognize), 0.4);
  else if (n.type === 'filmer') say(n, pick(LINES.filmArrive), 0.6);
  else if (n.type === 'drunk') say(n, pick(LINES.drunkArrive), 0.3);
  else if (n.type === 'family') say(n, pick(LINES.kidArrive), 0.4);
  else if (n.type === 'dogwalker') say(n, pick(LINES.dogArrive), 0.4);
  else if (n.type === 'runner') say(n, pick(LINES.runArrive), 0.3);
  n.nextTalk = now + rand(5, 9);
  if (n.type === 'filmer') maybeStartRecording(n);
}

const steer = new V3(), push = new V3(), dv = new V3();
function moveToward(n, goal, speed, dt, avoidPlayer) {
  steer.subVectors(goal, n.pos); steer.y = 0;
  const dist = steer.length();
  if (dist < 1e-4) return dist;
  steer.divideScalar(dist);
  push.set(0, 0, 0);
  for (const o of env.obstacles) {
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
  n.pos.addScaledVector(n.dir, Math.min(speed, dist * 2.5 + 0.15) * dt);
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
  n.head.rotation.set(n.bob * 0.18, n.head.rotation.y * 0.9, 0);
  if (t < n.clapUntil) {
    const c = Math.abs(Math.sin(t * 22 + n.phase)) * 0.25;
    n.armL.rotation.set(-1.15, 0, -0.35 + c); n.armR.rotation.set(-1.15, 0, 0.35 - c);
  } else {
    n.armL.rotation.set(-0.05, 0, -0.08); n.armR.rotation.set(-0.05, 0, 0.08);
  }
}
function animateRun(n, dt, speed, inPlace) {
  n.phase += dt * (inPlace ? 9 : speed * 2.9);
  const s = Math.sin(n.phase), amp = inPlace ? 0.55 : 1.0;
  n.legL.rotation.x = s * amp; n.legR.rotation.x = -s * amp;
  n.armL.rotation.set(-0.9 - s * 0.6 * amp, 0, -0.1); n.armR.rotation.set(-0.9 + s * 0.6 * amp, 0, 0.1); // 팔 굽혀 흔들기
  n.body.position.y = Math.abs(Math.cos(n.phase)) * (inPlace ? 0.05 : 0.09);
  n.lean += ((inPlace ? 0.05 : 0.22) - n.lean) * Math.min(1, dt * 5);
  n.body.rotation.set(n.lean, 0, 0);
}
// 강아지: 주인 오른쪽 옆을 따라 종종걸음, 서서 들을 땈 앉아서 꼬리 흔들기
function updateDog(n, dt, t, sitting) {
  const d = n.dog, yaw = n.g.rotation.y;
  const side = new V3(-Math.cos(yaw), 0, Math.sin(yaw)), fwd = new V3(Math.sin(yaw), 0, Math.cos(yaw));
  const goal = n.pos.clone().addScaledVector(side, sitting ? 0.55 : 0.75).addScaledVector(fwd, sitting ? 0.1 : 0.35);
  const prev = d.pos.clone();
  d.pos.lerp(goal, Math.min(1, dt * (sitting ? 3 : 4)));
  const moved = prev.distanceTo(d.pos) / Math.max(dt, 1e-3);
  const dYaw = moved > 0.15 ? Math.atan2(d.pos.x - prev.x, d.pos.z - prev.z) : sitting ? Math.atan2(-d.pos.x, -d.pos.z) : yaw;
  d.g.rotation.y += wrapAngle(dYaw - d.g.rotation.y) * Math.min(1, dt * 6);
  d.g.position.copy(d.pos);
  const p = isPlaying();
  if (sitting && moved < 0.3) {
    d.body.rotation.x = -0.35; d.body.position.y = -0.06;
    d.legs[0].rotation.x = 0.35; d.legs[1].rotation.x = 0.35; d.legs[2].rotation.x = -1.2; d.legs[3].rotation.x = -1.2;
    d.head.rotation.x = 0.3 + (p ? Math.sin(t * 4.8) * 0.12 : 0);
    d.tail.rotation.z = Math.sin(t * (p ? 16 : 6)) * 0.6;
  } else {
    d.phase += dt * Math.max(2, moved) * 9;
    const s = Math.sin(d.phase);
    d.body.rotation.x = 0; d.body.position.y = Math.abs(s) * 0.03;
    d.legs[0].rotation.x = s * 0.7; d.legs[3].rotation.x = s * 0.7; d.legs[1].rotation.x = -s * 0.7; d.legs[2].rotation.x = -s * 0.7;
    d.head.rotation.x = 0; d.tail.rotation.z = Math.sin(t * 10) * 0.4;
  }
  // 목줄: 주인 오른손 → 강아지 목, 살짝 처지게
  n.armR.children[1].getWorldPosition(tmpV);
  d.head.getWorldPosition(tmpV2); tmpV2.y -= 0.06;
  const pos = n.leash.geometry.attributes.position;
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pos.setXYZ(i, tmpV.x + (tmpV2.x - tmpV.x) * k, tmpV.y + (tmpV2.y - tmpV.y) * k - Math.sin(k * Math.PI) * 0.12, tmpV.z + (tmpV2.z - tmpV.z) * k);
  }
  pos.needsUpdate = true;
}
// 떼창 중: 다 같이 같은 박자로 좌우로 흔들며 팔 들기, 밤에는 찍는 사람이 폰 플래시를 켜고 흔듦
function choirPose(n, t) {
  const on = choirOn(), sway = Math.sin(now * 2.4);
  if (n.type === 'filmer') {
    const wave = on && env.L.night;
    n.flash.visible = wave;
    if (wave) {
      n.phone.position.set(sway * 0.12, 2.05, 0.4); n.phone.rotation.set(-0.2, 0, -sway * 0.5);
      n.armL.rotation.set(-2.75, 0, -0.35 + sway * 0.15); n.armR.rotation.set(-2.75, 0, 0.35 + sway * 0.15);
    }
    return;
  }
  if (!on || !isSinger(n)) return;
  if (n.type === 'family') {
    n.kid.armL.rotation.set(-2.8, 0, 0.3 + sway * 0.25); n.kid.armR.rotation.set(-2.8, 0, -0.3 + sway * 0.25);
    n.body.rotation.z = sway * 0.06;
    return;
  }
  n.body.rotation.z = sway * (n.type === 'drunk' ? 0.22 : 0.12);
  n.armL.rotation.set(-2.7 + sway * 0.15, 0, 0.35 - sway * 0.2);
  if (n.type !== 'dogwalker') n.armR.rotation.set(-2.7 - sway * 0.15, 0, -0.35 - sway * 0.2); // 강아지 산책은 한 손에 목줄
  n.head.rotation.x = -0.15;
}
function phonePose(n, filming, t) {
  const r = n.phone.userData.rec;
  if (filming) {
    n.phone.position.set(0, 1.76, 0.66); n.phone.rotation.set(0.05, 0, 0);
    n.armL.rotation.set(-1.95, 0, -0.45); n.armR.rotation.set(-1.95, 0, 0.45);
    r.visible = (t % 1) < 0.6;
  } else {
    // 화면 보며 걷기: 화면이 얼굴 쪽 위를 향하게(윗부분이 앞으로 기울게) 손바닥 위에 올려 듦
    n.phone.position.set(-0.12, 1.2, 0.5); n.phone.rotation.set(0.75, -0.25, 0);
    n.flash.visible = false;
    n.armR.rotation.set(-1.1, 0, 0.4);
    r.visible = false;
  }
}
function drunkDance(n, dt, t) {
  n.bob = Math.max(0, n.bob - dt * 3);
  const p = isPlaying();
  const s = Math.sin(t * (p ? 3.2 : 1.3) + n.phase);
  n.body.rotation.z = s * (p ? 0.2 : 0.12);
  n.body.position.y = -n.bob * 0.06;
  n.head.rotation.set(n.bob * 0.25, n.head.rotation.y * 0.9, -s * 0.15);
  n.legL.rotation.x = p ? Math.max(0, s) * 0.5 : 0; n.legR.rotation.x = p ? Math.max(0, -s) * 0.5 : 0;
  if (t < n.clapUntil) { n.armL.rotation.set(-2.9 + Math.sin(t * 14) * 0.4, 0, 0.2); n.armR.rotation.set(-2.7, 0, -0.2); }
  else if (p) { n.armL.rotation.set(-2.4 + s * 0.5, 0, 0.35); n.armR.rotation.set(-1.0 - n.bob * 1.0, 0, 0.1); }
  else { n.armL.rotation.set(0, 0, -0.1); n.armR.rotation.set(-0.3, 0, 0.1); }
}
function familyPose(n, mode, t) {
  const k = n.kid;
  if (mode === 'walk') {
    n.armL.rotation.set(-2.85, 0, -0.12); n.armR.rotation.set(-2.85, 0, 0.12);
    k.armL.rotation.set(-0.5, 0, 0.55); k.armR.rotation.set(-0.5, 0, -0.55);
    k.legL.rotation.x = -1.0; k.legR.rotation.x = -1.0;
    k.body.position.y = Math.abs(Math.sin(n.phase)) * 0.06;
    return;
  }
  n.armL.rotation.set(-0.85, 0, -0.25); n.armR.rotation.set(-0.85, 0, 0.25);
  const p = isPlaying();
  if (t < n.clapUntil) {
    const c = Math.abs(Math.sin(t * 24 + n.phase)) * 0.3;
    k.armL.rotation.set(-1.3, 0, -0.4 + c); k.armR.rotation.set(-1.3, 0, 0.4 - c);
  } else if (p) {
    const w = Math.sin(t * 6 + n.phase) * 0.35;
    k.armL.rotation.set(-2.7 + w, 0, 0.3); k.armR.rotation.set(-2.7 - w, 0, -0.3);
  } else {
    k.armL.rotation.set(-0.4, 0, 0.3); k.armR.rotation.set(-0.4, 0, -0.3);
  }
  const kick = p ? Math.sin(t * 5 + n.phase) * 0.25 : 0;
  k.legL.rotation.x = -1.0 + kick; k.legR.rotation.x = -1.0 - kick;
  k.body.position.y = n.bob * 0.08;
  k.head.rotation.y *= 0.9;
}

/* ───────── 팁: 관객이 기타 케이스에 돈을 던짐 ───────── */
const flyers = [];
let setEarn = 0, setPending = 0;
const coinGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.008, 14);
const billGeo = new THREE.PlaneGeometry(0.17, 0.08);
const coinMats = { 100: lambert(0xc9ccd2, { emissive: 0x222428 }), 500: lambert(0xe2e2e8, { emissive: 0x2a2a30 }) };
const billMats = { 1000: 0x7fa8d9, 5000: 0xe8a35a, 10000: 0x8cc48a };
Object.keys(billMats).forEach((k) => { billMats[k] = lambert(billMats[k], { side: THREE.DoubleSide, emissive: 0x111111 }); });
function setQuality(st) {
  if (!st) return 0;
  const dur = Math.max(4, now - st.t0);
  const dens = clamp(st.notes / (dur * 2.0), 0, 1);
  const variety = clamp(st.uniq.size / 9, 0, 1);
  const sing = clamp(st.singT / Math.min(dur, 8), 0, 1);
  const length = clamp(dur / 25, 0, 1);
  return clamp((0.3 * dens + 0.2 * variety + 0.25 * sing + 0.25 * length) * instStat().quality + (st.choir ? 0.2 : 0), 0, 1);
}
function payTips(t) {
  const q = setQuality(setStats), f = fameF(), L = env.L, it = instStat();
  for (const n of npcs) {
    if (n.state !== 'listen') continue;
    const T = TYPES[n.type];
    const p = T.tip * (0.35 + 0.8 * q) * (1 + f * 0.12) * (1 + styleScore() * 0.04) * it.tip * (setStats && setStats.choir ? 1.4 : 1);
    if (Math.random() > Math.min(0.95, p)) continue;
    let w = T.amounts.slice(), sum = w.reduce((a, b) => a + b, 0), r = Math.random() * sum, i = 0;
    while ((r -= w[i]) > 0 && i < w.length - 1) i++;
    if (i < 4 && Math.random() < q * 0.3 + f * 0.05 + (it.tip - 1) * 0.3) i++; // 잘하면·유명하면 한 단계 큰돈
    const amount = Math.round(AMOUNTS[i] * L.tipMult / 100) * 100;
    flyers.push({ n, amount, at: t + rand(0.6, 3.2), mesh: null });
    setPending++;
  }
}
function updateFlyers(dt, t) {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (!f.mesh) {
      if (t < f.at) continue;
      const bill = f.amount >= 1000;
      f.mesh = new THREE.Mesh(bill ? billGeo : coinGeo, bill ? billMats[[1000, 5000, 10000].reduce((a, b) => (f.amount >= b ? b : a), 1000)] : coinMats[f.amount >= 500 ? 500 : 100]);
      f.mesh.castShadow = true; scene.add(f.mesh);
      f.from = f.n.pos.clone().setY(f.n.type === 'family' ? 2.4 * f.n.scale : 1.35 * f.n.scale);
      gcase.localToWorld(f.to = new V3(rand(-0.15, 0.15), 0.14, rand(-0.35, 0.35)));
      f.t = 0; f.dur = 0.75 + f.from.distanceTo(f.to) * 0.08; f.bill = bill;
      if (f.n.type === 'drunk' && f.amount >= 5000) say(f.n, pick(LINES.drunkTip));
      if (f.n.type === 'family' && Math.random() < 0.4) say(f.n, pick(LINES.kidTip));
      if (f.n.state === 'listen') f.n.bob = 1;
    }
    f.t += dt / f.dur;
    const k = Math.min(1, f.t);
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.position.y += Math.sin(k * Math.PI) * 0.6;
    if (f.bill) f.mesh.rotation.set(-Math.PI / 2 + Math.sin(f.t * 20) * 0.6, f.t * 4, Math.sin(f.t * 13) * 0.4);
    else f.mesh.rotation.set(f.t * 18, 0, f.t * 7);
    if (k >= 1) {
      scene.remove(f.mesh);
      if (pile.children.length < 50) {
        const m = new THREE.Mesh(f.mesh.geometry, f.mesh.material);
        gcase.worldToLocal(m.position.copy(f.to)); m.position.y = 0.135 + pile.children.length * 0.0015;
        m.rotation.set(f.bill ? -Math.PI / 2 : 0, rand(0, 6), 0);
        pile.add(m);
      }
      S.money += f.amount; setEarn += f.amount; setPending--;
      playCoin(f.bill);
      floatText('+' + f.amount.toLocaleString('ko-KR'), f.to);
      flyers.splice(i, 1);
      if (setPending <= 0) { toast(`💰 이번 공연 수익 +${fmtWon(setEarn)}`); setEarn = 0; setPending = 0; save(); }
    }
  }
}

/* ───────── 찍는 사람 시점 녹화 → 버스타그램 업로드 ───────── */
let rec = null, recRenderer = null, recCanvas = null, recCam = null, recNextAt = 0;
function ensureRecRenderer() {
  if (recRenderer) return true;
  try {
    recCanvas = document.createElement('canvas');
    [recCanvas.width, recCanvas.height] = CFG.clipSize;
    recRenderer = new THREE.WebGLRenderer({ canvas: recCanvas, antialias: false, preserveDrawingBuffer: true });
    recRenderer.setPixelRatio(1); recRenderer.setSize(CFG.clipSize[0], CFG.clipSize[1], false);
    recCam = new THREE.PerspectiveCamera(52, CFG.clipSize[0] / CFG.clipSize[1], 0.1, 300);
    return true;
  } catch (e) { return false; }
}
function maybeStartRecording(n) {
  if (rec || n.recorded || now < recNextAt || !ensureRecRenderer()) return;
  n.recorded = true;
  const stats = { notes: 0, uniq: new Set(), octs: new Set(), singT: 0, crowdMax: 0, drunk: false, kid: false, dog: false, runner: false, applause: false, choir: false };
  rec = { filmer: n, t0: now, w0: performance.now() / 1000, stats, thumb: null, mr: null, chunks: [], lastFrame: -1 };
  if (window.MediaRecorder && recCanvas.captureStream) {
    try {
      const stream = recCanvas.captureStream(CFG.clipFps);
      if (recDest) recDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 900000 } : undefined);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) rec && rec.mr === mr ? rec.chunks.push(e.data) : mr._chunks.push(e.data); };
      mr._chunks = [];
      mr.start(500);
      rec.mr = mr;
    } catch (e) { rec.mr = null; }
  }
}
function renderRecFrame(t) {
  const n = rec.filmer;
  n.phone.getWorldPosition(tmpV);
  tmpV2.set(0, 1.45, 0).sub(tmpV).normalize();
  recCam.position.copy(tmpV).addScaledVector(tmpV2, 0.12);
  recCam.lookAt(Math.sin(t * 1.3) * 0.08, 1.4 + Math.sin(t * 1.7) * 0.05, 0); // 손떨림
  recRenderer.render(scene, recCam);
}
function updateRecording(t) {
  if (!rec) return;
  const st = rec.stats;
  if (isSinging()) st.singT += 1 / 60;
  let crowd = 0;
  for (const n of npcs) if (n.state === 'listen') { crowd++; if (n.type === 'drunk') st.drunk = true; if (n.type === 'family') st.kid = true; if (n.type === 'dogwalker') st.dog = true; if (n.type === 'runner') st.runner = true; }
  st.crowdMax = Math.max(st.crowdMax, crowd);
  if (t - rec.lastFrame >= 1 / CFG.clipFps) { rec.lastFrame = t; renderRecFrame(t); }
  const wall = performance.now() / 1000 - rec.w0; // 영상 길이는 실제 시간 기준(프레임이 느려도 7초)
  if (!rec.thumb && wall > CFG.clipLen * 0.55) rec.thumb = makeThumb();
  if (wall >= CFG.clipLen) finishRecording();
}
function makeThumb() {
  const c = document.createElement('canvas'); c.width = 180; c.height = 320;
  c.getContext('2d').drawImage(recCanvas, 0, 0, 180, 320);
  return c.toDataURL('image/jpeg', 0.72);
}
function finishRecording() {
  const r = rec; if (!r) return;
  rec = null; recNextAt = now + 2;
  if (performance.now() / 1000 - r.w0 < 2.5) { if (r.mr) try { r.mr.stop(); } catch (e) { /* 무시 */ } return; } // 너무 짧으면 버림
  const thumb = r.thumb || makeThumb();
  const done = (blob) => createPost(r, blob, thumb);
  if (r.mr && r.mr.state !== 'inactive') {
    r.mr.onstop = () => done(new Blob(r.chunks.concat(r.mr._chunks), { type: r.mr.mimeType || 'video/webm' }));
    try { r.mr.stop(); } catch (e) { done(null); }
  } else done(null);
}

/* ───────── 버스타그램 (SNS) ───────── */
const postProg = (p, t) => (t < p.live ? 0 : 1 - Math.exp(-(t - p.live) / 45000));
function computeFollowers(t) { return S.posts.reduce((s, p) => s + Math.round(p.gain * postProg(p, t)), 0); }
function clipQuality(st) {
  const dens = clamp(st.notes / (CFG.clipLen * 2.0), 0, 1);
  const variety = clamp(st.uniq.size / 8, 0, 1);
  const sing = clamp(st.singT / 4, 0, 1);
  const crowd = clamp(st.crowdMax / 8, 0, 1);
  let q = 0.32 * dens + 0.16 * variety + 0.22 * sing + 0.2 * crowd + 0.1 * (st.applause ? 1 : 0) + (st.choir ? 0.25 : 0);
  q = q * instStat().quality + styleScore() * 0.012;
  return clamp(q, 0, 1);
}
function clipTags(st, q, viral) {
  const tags = ['generic'];
  if (st.notes < 3 && st.singT < 1) tags.push('quiet', 'quiet');
  if (st.notes >= CFG.clipLen * 2.6) tags.push('busy');
  if (st.uniq.size >= 7 || st.octs.size >= 2) tags.push('variety');
  if (st.singT >= 1.5) tags.push('sing', 'sing'); else if (st.notes >= 4) tags.push('nosing');
  if (st.crowdMax >= 6) tags.push('crowdBig'); else if (st.notes >= 3) tags.push('crowdSmall');
  if (st.drunk) tags.push('drunk', 'drunk');
  if (st.kid) tags.push('kid', 'kid');
  if (st.dog) tags.push('dog', 'dog');
  if (st.runner) tags.push('runner');
  if (st.choir) tags.push('choir', 'choir', 'choir');
  if (st.applause) tags.push('applause');
  if (q > 0.65) tags.push('high', 'high');
  if (viral) tags.push('viral', 'viral');
  if (followersCache >= 300) tags.push('fame');
  tags.push('loc_' + S.loc);
  if (S.eq.instrument !== 'guitar') tags.push('inst_' + S.eq.instrument, 'inst_' + S.eq.instrument);
  ['hat', 'glasses', 'top'].forEach((k) => { const id = S.eq[k]; if (id && D.sns.comments['style_' + id]) tags.push('style_' + id); });
  if (S.eq.gear === 'micstand' && st.singT > 1) tags.push('mic');
  return tags;
}
function createPost(r, blob, thumb) {
  const st = r.stats, L = env.L, q = clipQuality(st), fol = computeFollowers(Date.now());
  const reach = (15 + fol * 0.5) * L.sns * (0.5 + q * 1.3) + q * q * 300 * L.sns;
  let likes = Math.round(reach * (0.08 + 0.3 * q) * rand(0.7, 1.3));
  const viral = q > 0.7 && Math.random() < (0.08 + 0.15 * (q - 0.7) / 0.3) * (st.choir ? 2 : 1);
  if (viral) likes = Math.round(likes * rand(6, 15));
  const gain = Math.round(likes * (0.1 + 0.3 * q) * rand(0.7, 1.2));
  const live = Date.now() + rand(4000, 9000);
  const tier = q > 0.65 ? 'high' : q > 0.3 ? 'mid' : 'low';
  const caption = pick(D.sns.captions[tier]).replace('{loc}', L.name) + '\n' + D.sns.captions.tags.replace('{loc}', L.name.split(' ')[0]);
  // 영상 내용에 맞는 봇 댓글: 태그 비중대로 뽑고 중복 없이
  const tags = clipTags(st, q, viral), pool = D.sns.comments, used = new Set(), comments = [];
  const count = clamp(Math.round(2 + Math.sqrt(likes) * 0.7), 2, 30);
  for (let i = 0, tries = 0; i < count && tries < 200; tries++) {
    const text = pick(pool[pick(tags)] || pool.generic);
    if (used.has(text)) continue;
    used.add(text); i++;
    comments.push({ h: genHandle(), text, at: live + Math.pow(Math.random(), 1.8) * 150000 });
  }
  comments.sort((a, b) => a.at - b.at);
  const post = {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), handle: r.filmer.handle, avatar: r.filmer.avatar,
    loc: S.loc, caption, thumb, video: !!(blob && blob.size), q, likes, gain, viral, live, comments, myLike: false, announced: false,
  };
  S.posts.unshift(post);
  while (S.posts.length > CFG.maxPosts) vids.del(S.posts.pop().id);
  if (post.video) vids.put(post.id, blob);
  save();
  if (r.filmer.state === 'listen') say(r.filmer, '업로드 완료!', 0.2);
}
function snsTick() {
  const t = Date.now();
  followersCache = computeFollowers(t);
  for (const p of S.posts) {
    if (!p.announced && t >= p.live) {
      p.announced = true; S.unseen++;
      toast(p.viral ? `🔥 @${p.handle} 님이 올린 내 영상이 터졌어요!` : `📱 @${p.handle} 님이 내 영상을 버스타그램에 올렸어요`);
      save();
    }
  }
  const ms = D.milestones.filter((m) => followersCache >= m).length;
  if (ms > S.milestone) {
    S.milestone = ms;
    toast(`🎉 팔로워 ${fmtCount(D.milestones[ms - 1])}명 돌파! 이제 '${titleOf(followersCache)}'`);
    save();
  }
}
const titleOf = (f) => D.titles.reduce((a, t) => (f >= t.min ? t.name : a), D.titles[0].name);

/* ───────── 군중 업데이트 ───────── */
let nextStopAt = 2, nextLeaveAt = 0, applauded = true;
function updateCrowd(dt, t) {
  const playing = isPlaying(), R = hearRadius(), am = attractMult(), it = instStat();

  if (playing && t >= nextStopAt) {
    const cand = npcs.filter((n) => n.state === 'walk' && n.cooldown <= 0 && n.pos.length() > 2.6 &&
      n.pos.length() < R * (TYPES[n.type].attract > 2 ? 1.3 : 1));
    const wOf = (n) => TYPES[n.type].attract * (it[n.type] || 1);
    if (cand.length && Math.random() < Math.min(0.98, (0.35 + 0.6 * heat) * am)) {
      cand.sort((a, b) => a.pos.length() - b.pos.length());
      const near = cand.slice(0, 4);
      let r = Math.random() * near.reduce((s, n) => s + wOf(n), 0);
      startListening(near.find((n) => (r -= wOf(n)) <= 0) || near[0]);
    }
    nextStopAt = t + rand(CFG.stopGap[0], CFG.stopGap[1]) / ((0.6 + heat) * Math.sqrt(am));
  }

  // 연주가 끝나면 박수와 팁(찍는 사람은 계속 촬영), 그 뒤 조용하면 한 명씩 떠남
  const quiet = t - lastNoteAt;
  if (playing) applauded = false;
  if (!playing && !applauded && quiet > 0.4) {
    applauded = true;
    if (setStats && (setStats.notes >= 8 || setStats.singT >= 3)) {
      if (rec) rec.stats.applause = true;
      for (const n of npcs) {
        if (n.state !== 'listen') continue;
        if (n.type !== 'filmer') { n.clapUntil = t + rand(1.4, 2.6); n.nextClap = t + rand(0, 0.25); }
        const d = rand(0.1, 0.9);
        if (n.type === 'drunk') say(n, pick(LINES.drunkCheer), d);
        else if (n.type === 'family') say(n, pick(LINES.kidCheer), d);
        else if (n.type === 'filmer') { if (Math.random() < 0.5) say(n, pick(LINES.filmCheer), d); }
        else if (n.type === 'dogwalker') { say(n.dog, pick(LINES.bark), d); setTimeout(playBark, d * 1000); if (Math.random() < 0.4) say(n, pick(LINES.dogCheer), d + 0.8); }
        else if (n.type === 'runner') { if (Math.random() < 0.5) say(n, pick(LINES.runCheer), d); }
        else if (Math.random() < 0.3) say(n, pick(LINES.normalCheer), d);
      }
      payTips(t);
    }
    setStats = null;
  }
  if (!playing && quiet > CFG.quietBeforeLeave && t >= nextLeaveAt && flyers.length === 0) {
    const ls = npcs.filter((n) => n.state === 'listen' || n.state === 'approach');
    if (ls.length) stopListening(pick(ls));
    nextLeaveAt = t + rand(CFG.leaveGap[0], CFG.leaveGap[1]);
  }

  for (const n of npcs) {
    n.cooldown -= dt;
    if (n.state === 'walk' || n.state === 'approach') {
      const walking = n.state === 'walk';
      const sp = walking ? n.speed : n.speed * 0.8;
      const d = moveToward(n, walking ? (n.via || n.target) : n.spot.pos, sp, dt, walking);
      if (n.type === 'drunk') { // 갈지자 걸음
        const w = Math.sin(t * 1.5 + n.phase) * 0.55 * Math.min(1, d);
        n.pos.x -= n.dir.z * w * dt; n.pos.z += n.dir.x * w * dt;
      }
      n.g.rotation.y = Math.atan2(n.dir.x, n.dir.z);
      if (n.type === 'runner') animateRun(n, dt, sp, false); else animateWalk(n, dt, sp);
      if (walking && d < 1.0) { if (n.via) n.via = null; else newWalkTarget(n); }
      if (!walking && d < 0.12) { n.state = 'listen'; onArrive(n); }
      const dist = n.pos.length(), hearing = playing && dist < R;
      const toPlayer = wrapAngle(Math.atan2(-n.pos.x, -n.pos.z) - n.g.rotation.y);
      const look = walking && hearing ? clamp(toPlayer, -1.1, 1.1) * clamp((R - dist) / 4, 0, 1) : 0;
      n.headYaw += (look - n.headYaw) * Math.min(1, dt * 4);
      let pitch = 0, roll = 0;
      if (n.type === 'filmer') { phonePose(n, false, t); pitch = hearing ? 0 : 0.4; }
      else if (n.type === 'drunk') {
        n.body.rotation.z = Math.sin(t * 1.5 + n.phase) * 0.16; roll = -n.body.rotation.z * 0.7;
        n.armR.rotation.x *= 1.5;
        if (walking && t >= n.nextTalk) { say(n, pick(LINES.drunkWalk)); n.nextTalk = t + rand(6, 11); }
      } else if (n.type === 'dogwalker') {
        n.armR.rotation.set(-0.45, 0, 0.25); updateDog(n, dt, t, false);
      } else if (n.type === 'family') {
        familyPose(n, 'walk', t);
        const kl = hearing ? clamp(toPlayer, -1.4, 1.4) : Math.sin(t * 0.7 + n.phase) * 0.6;
        n.kid.head.rotation.y += (kl - n.kid.head.rotation.y) * Math.min(1, dt * 4);
      }
      n.head.rotation.set(pitch, n.headYaw, roll);
    } else if (n.state === 'listen') {
      n.pos.lerp(n.spot.pos, Math.min(1, dt * 2));
      turnTo(n, Math.atan2(-n.pos.x, -n.pos.z), dt, 5);
      n.headYaw = 0;
      if (n.type === 'drunk') drunkDance(n, dt, t);
      else if (n.type === 'runner') animateRun(n, dt, 0, true); // 제자리 뛰기
      else animateStand(n, dt, t);
      if (n.type === 'dogwalker') {
        if (t >= n.clapUntil) n.armR.rotation.set(-0.45, 0, 0.25);
        updateDog(n, dt, t, true);
        if (playing && t >= n.nextTalk) { say(n.dog, pick(LINES.bark)); playBark(); n.nextTalk = t + rand(8, 14); }
      }
      if (n.type === 'filmer') { phonePose(n, true, t); n.head.rotation.x = 0.05; if (!rec && !n.recorded) maybeStartRecording(n); }
      if (n.type === 'family') familyPose(n, 'listen', t);
      choirPose(n, t);
      n.listenFor += dt * (heat < 0.15 ? 2 : 1);
      if (t < n.clapUntil && t >= n.nextClap && n.type !== 'runner') { playClap((n.type === 'family' ? 0.035 : 0.05) + 0.03 * Math.random()); n.nextClap = t + rand(0.13, 0.2); }
      if (playing && t >= n.nextTalk) {
        if (n.type === 'drunk') { say(n, pick(LINES.drunkListen)); n.nextTalk = t + rand(5, 9); }
        else if (n.type === 'family') { say(n, pick(LINES.kidListen)); n.nextTalk = t + rand(7, 12); }
      }
      if (playing && n.listenFor > n.patience) stopListening(n);
    }
    n.g.position.copy(n.pos);
  }
}

/* ───────── 플레이어 애니메이션 ───────── */
let nextLyricAt = 0, nextSingNote = 0;
function updatePlayer(dt, t) {
  const singing = isSinging();
  if (singing) {
    lastNoteAt = now;
    heat = Math.min(1, heat + dt * 0.05 * attractMult());
    if (!setStats) setStats = newSet();
    setStats.singT += dt;
    if (voice && t >= nextLyricAt) { say(playerSpeaker, pick(LINES.playerSing)); nextLyricAt = t + rand(4, 7); } // 합성 목소리일 때만 가사 말풍선
    if (t >= nextSingNote) { spawnNoteSprite('sing', true); nextSingNote = t + 0.45; }
  }
  mouth.scale.y = singing ? 0.5 + Math.abs(Math.sin(t * 9)) * 0.7 : 0.25;

  strum = Math.max(0, strum - dt * 7);
  const c = inst.cfg;
  if (c.motion === 'bow') {
    player.armR.rotation.set(c.armR[0], 0, c.armR[2] + bowDir * (1 - strum) * 0.25 - bowDir * 0.12);
  } else {
    player.armR.rotation.x = c.armR[0] + strum * 0.35;
    player.armR.rotation.z = c.armR[2] - strum * 0.12;
  }
  const playing = isPlaying();
  player.body.rotation.z = playing ? Math.sin(t * 2.4) * (0.02 + 0.03 * heat) : 0;
  player.head.rotation.x = singing ? -0.12 + Math.sin(t * 2) * 0.04 : playing ? 0.08 + Math.sin(t * 4.8) * 0.04 * heat : 0.03;
  player.body.position.y = -strum * 0.02;
}

/* ───────── 카메라: 끌어서 회전, 휠·핀치로 확대 ───────── */
const CAM_DEFAULT = { yaw: 0.42, pitch: 0.3, dist: 7.6 };
const cam = Object.assign({}, CAM_DEFAULT);
const camTarget = new V3(0, 0.75, -2.4);
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

/* ───────── 장소 이동 ───────── */
function enterLocation(id) {
  if (rec) { if (rec.mr) try { rec.mr.stop(); } catch (e) { /* 무시 */ } rec = null; }
  flyers.forEach((f) => f.mesh && scene.remove(f.mesh)); flyers.length = 0;
  if (setPending > 0) { setPending = 0; setEarn = 0; }
  while (pile.children.length) pile.remove(pile.children[0]);
  clearNpcs();
  S.loc = id;
  buildEnv(id);
  spawnCrowd();
  heat = 0; lastNoteAt = -99; setStats = null; applauded = true; nextStopAt = now + 2;
  resetChoir();
  $('#locName').textContent = `${env.L.emoji} ${env.L.name}`;
}
function travel(id) {
  const L = LOC[id];
  if (id === S.loc || S.money < L.fare) return;
  S.money -= L.fare; save();
  closePhone();
  const fade = $('#fade');
  fade.querySelector('p').textContent = `🚌 ${L.name}(으)로 가는 중…`;
  fade.hidden = false; requestAnimationFrame(() => fade.classList.add('on'));
  setTimeout(() => {
    enterLocation(id); save();
    fade.classList.remove('on');
    setTimeout(() => { fade.hidden = true; toast(`📍 ${L.name} 도착`); }, 500);
  }, 1300);
}

/* ───────── HUD·토스트 ───────── */
const introEl = $('#intro'), phoneEl = $('#phone');
function closeIntro() { introEl.hidden = true; ensureAudio(); }
function toggleIntro() { introEl.hidden = !introEl.hidden; }
$('#startBtn').addEventListener('click', closeIntro);
$('#helpBtn').addEventListener('click', () => { introEl.hidden = false; $('#startBtn').focus(); });
function toast(text) {
  const box = $('#toasts'), el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
}
const hud = { crowd: $('#crowdN'), state: $('#stateT'), money: $('#moneyT'), fol: $('#folT'), badge: $('#phoneBadge') };
let last = {};
function updateHud() {
  const c = npcs.reduce((s, n) => s + (n.state === 'listen' ? 1 : 0), 0);
  const p = isPlaying(), sing = isSinging();
  const st = sing ? (now - lastPluckAt < CFG.playHold ? '연주하며 노래' : '노래 중') : p ? '연주 중' : '쉬는 중';
  const vals = { c, st, m: S.money, f: followersCache, u: S.unseen };
  if (vals.c !== last.c) hud.crowd.textContent = c;
  if (vals.st !== last.st) { hud.state.textContent = st; document.body.classList.toggle('playing', p || sing); }
  if (vals.m !== last.m) hud.money.textContent = fmtWon(S.money);
  if (vals.f !== last.f) hud.fol.textContent = fmtCount(followersCache);
  if (vals.u !== last.u) { hud.badge.textContent = S.unseen; hud.badge.hidden = !S.unseen; }
  last = vals;
  const lv = singHeld ? (voice ? '100%' : clamp(micLevel / (CFG.micThreshold * 4), 0, 1) * 100 + '%') : '0%';
  if (lv !== lastLv) { lvls.forEach((e) => { e.style.width = lv; }); lastLv = lv; }
  let ht = '';
  if (choirOn()) ht = '🔥 떼창 중!';
  else if (hookCand && hookCand.count >= 2 && !hook) ht = `🎵 후렴 익히는 중 ${'●'.repeat(Math.min(hookCand.count, CFG.hookRepeats))}${'○'.repeat(Math.max(0, CFG.hookRepeats - hookCand.count))} 한 번 더!`;
  else if (hookCand && hookCand.count >= 2) ht = `🎵 새 후렴 익히는 중 ${'●'.repeat(Math.min(hookCand.count, CFG.hookRepeats))}${'○'.repeat(Math.max(0, CFG.hookRepeats - hookCand.count))}`;
  else if (hook && c < CFG.choirMinCrowd) ht = `🎤 관객이 후렴을 외웠어요. ${CFG.choirMinCrowd}명 이상 모이면 떼창 (지금 ${c}명)`;
  else if (hook) ht = '🎤 후렴을 치거나 📣 넘기기를 누르면 관객이 따라 불러요';
  if (ht !== lastHook) { hookEl.textContent = ht; hookEl.hidden = !ht; hookEl.classList.toggle('hot', ht.startsWith('🔥')); lastHook = ht; }
}
const hookEl = $('#hook');
let lastHook = null;
const lvls = [...document.querySelectorAll('.lvl')];
let lastLv = '';

/* ───────── 내 스마트폰 ───────── */
const phScreen = $('#phScreen');
let phView = 'home', phTab = 'feed', shopTab = 'instrument', feedFocus = null;
const videoUrls = new Map();
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function openPhone(view) {
  phoneEl.hidden = false; document.body.classList.add('phone-open');
  go(view || 'home');
  refreshPhone();
}
function closePhone() {
  phoneEl.hidden = true; document.body.classList.remove('phone-open');
  phScreen.querySelectorAll('video').forEach((v) => v.pause());
}
function go(view) {
  phView = view;
  if (view === 'sns' && phTab === 'feed') { S.unseen = 0; save(); }
  phScreen.querySelectorAll('video').forEach((v) => v.pause());
  phScreen.innerHTML = '';
  ({ home: renderHome, sns: renderSns, shop: renderShop, bus: renderBus })[view]();
  phScreen.scrollTop = 0;
}
$('#phoneBtn').addEventListener('click', () => (phoneEl.hidden ? openPhone() : closePhone()));
$('#folChip').addEventListener('click', () => { phTab = 'profile'; openPhone('sns'); });
$('#moneyChip').addEventListener('click', () => openPhone('shop'));
$('#phHome').addEventListener('click', () => go('home'));
$('#phClose').addEventListener('click', closePhone);
$('#phBack').addEventListener('click', () => (phView === 'home' ? closePhone() : go('home')));

function renderHome() {
  const w = el('div', 'ph-home');
  const widget = el('div', 'widget');
  widget.append(el('div', 'w-title', titleOf(followersCache)), el('div', 'w-handle', '@' + S.handle));
  const row = el('div', 'w-row');
  row.append(el('div', 'w-stat', `팔로워 ${fmtCount(followersCache)}`), el('div', 'w-stat', `💰 ${fmtWon(S.money)}`));
  const next = D.milestones.find((m) => followersCache < m);
  widget.append(row);
  if (next) {
    const bar = el('div', 'bar'), fill = el('i');
    const prev = D.milestones[D.milestones.indexOf(next) - 1] || 0;
    fill.style.width = clamp((followersCache - prev) / (next - prev), 0, 1) * 100 + '%';
    bar.append(fill);
    widget.append(el('div', 'w-goal', `다음 목표: 팔로워 ${fmtCount(next)}명`), bar);
  } else widget.append(el('div', 'w-goal', '🏆 팔로워 100만! 전설이 됐어요'));
  w.append(widget);
  const apps = el('div', 'apps');
  [['sns', '📷', D.sns.appName, S.unseen], ['shop', '🛍️', '상점'], ['bus', '🚌', '버스']].forEach(([v, icon, name, badge]) => {
    const b = el('button', 'app'); b.dataset.app = v;
    const ic = el('span', 'ic', icon); if (badge) ic.append(el('em', 'badge', badge));
    b.append(ic, el('span', 'nm', name));
    b.addEventListener('click', () => go(v));
    apps.append(b);
  });
  w.append(apps);
  phScreen.append(w);
}

function renderSns() {
  const head = el('div', 'sns-head');
  head.append(el('div', 'logo', D.sns.appName));
  const tabs = el('div', 'tabs');
  [['feed', '내 영상 피드'], ['profile', '내 프로필']].forEach(([k, label]) => {
    const b = el('button', phTab === k ? 'on' : '', label);
    b.addEventListener('click', () => { phTab = k; go('sns'); });
    tabs.append(b);
  });
  head.append(tabs);
  phScreen.append(head);
  if (phTab === 'profile') return renderProfile();
  const t = Date.now(), posts = S.posts.filter((p) => t >= p.live);
  const uploading = S.posts.length - posts.length;
  if (uploading) phScreen.append(el('div', 'uploading', `영상 ${uploading}개 업로드 중…`));
  if (!posts.length) {
    phScreen.append(el('div', 'empty', '아직 올라온 영상이 없어요. 핸드폰 든 사람이 앞에 서면 연주하고 노래해 보세요. 그 사람이 찍어서 여기에 올려요.'));
    return;
  }
  posts.forEach((p) => phScreen.append(postCard(p)));
  if (feedFocus) { const f = phScreen.querySelector(`[data-id="${feedFocus}"]`); feedFocus = null; if (f) setTimeout(() => f.scrollIntoView({ block: 'start' }), 0); }
}
function postCard(p) {
  const card = el('article', 'post'); card.dataset.id = p.id;
  const top = el('div', 'p-top');
  const av = el('span', 'av', p.handle[0].toUpperCase()); av.style.background = p.avatar;
  const who = el('div', 'who'); who.append(el('b', '', p.handle), el('small', '', LOC[p.loc] ? LOC[p.loc].name : ''));
  top.append(av, who);
  if (p.viral) top.append(el('span', 'hot', '🔥 인기'));
  const media = el('div', 'media');
  if (p.video) {
    const v = document.createElement('video');
    v.playsInline = true; v.loop = true; v.preload = 'none'; v.poster = p.thumb;
    media.append(v, el('span', 'play', '▶'));
    const load = () => {
      if (videoUrls.has(p.id)) { v.src = videoUrls.get(p.id); return Promise.resolve(true); }
      return vids.get(p.id).then((blob) => {
        if (!blob) { media.classList.add('expired'); return false; }
        const u = URL.createObjectURL(blob); videoUrls.set(p.id, u); v.src = u; return true;
      });
    };
    media.addEventListener('click', () => {
      if (!v.src) { load().then((ok) => ok && v.play()); return; }
      if (v.paused) { phScreen.querySelectorAll('video').forEach((o) => o !== v && o.pause()); v.play(); } else v.pause();
    });
    v.addEventListener('play', () => media.classList.add('playing'));
    v.addEventListener('pause', () => media.classList.remove('playing'));
  } else {
    const img = el('img'); img.src = p.thumb; img.alt = '영상 썸네일'; media.append(img, el('span', 'nov', '사진만 남았어요'));
  }
  const acts = el('div', 'acts');
  const like = el('button', 'like' + (p.myLike ? ' on' : ''), p.myLike ? '♥' : '♡');
  like.setAttribute('aria-label', '좋아요');
  like.addEventListener('click', () => { p.myLike = !p.myLike; like.textContent = p.myLike ? '♥' : '♡'; like.classList.toggle('on', p.myLike); like.classList.add('pop'); setTimeout(() => like.classList.remove('pop'), 300); save(); refreshCard(card, p); });
  const cbtn = el('button', 'cbtn', '💬'); cbtn.setAttribute('aria-label', '댓글');
  acts.append(like, cbtn, el('span', 'likes'));
  const cap = el('p', 'caption'); cap.append(el('b', '', p.handle + ' '), document.createTextNode(p.caption));
  const list = el('div', 'clist');
  const more = el('button', 'more');
  more.addEventListener('click', () => { card.classList.toggle('all'); refreshCard(card, p); });
  const form = el('form', 'cform');
  const input = el('input'); input.placeholder = '댓글 달기…'; input.maxLength = 80;
  const send = el('button', '', '게시'); send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    p.comments.push({ h: S.handle, text, at: Date.now(), me: true });
    p.comments.push({ h: Math.random() < 0.5 ? p.handle : genHandle(), text: '@' + S.handle + ' ' + pick(D.sns.comments.replyToMe), at: Date.now() + rand(2500, 7000) });
    input.value = ''; card.classList.add('all'); save(); refreshCard(card, p);
  });
  cbtn.addEventListener('click', () => input.focus());
  card.append(top, media, acts, cap, list, more, form);
  refreshCard(card, p);
  return card;
}
function refreshCard(card, p) {
  const t = Date.now();
  const likes = Math.round(p.likes * postProg(p, t)) + (p.myLike ? 1 : 0);
  card.querySelector('.likes').textContent = `좋아요 ${fmtCount(likes)}개`;
  const vis = p.comments.filter((c) => c.at <= t);
  const list = card.querySelector('.clist'), all = card.classList.contains('all');
  const shown = all ? vis : vis.slice(-2);
  if (list.dataset.n !== String(shown.length) + all) {
    list.dataset.n = String(shown.length) + all;
    list.innerHTML = '';
    shown.forEach((c) => { const r = el('p', 'cm' + (c.me ? ' me' : '')); r.append(el('b', '', c.h + ' '), document.createTextNode(c.text)); list.append(r); });
  }
  const more = card.querySelector('.more');
  more.hidden = vis.length <= 2;
  more.textContent = all ? '댓글 접기' : `댓글 ${vis.length}개 모두 보기`;
}
function renderProfile() {
  const t = Date.now(), live = S.posts.filter((p) => t >= p.live);
  const box = el('div', 'profile');
  const top = el('div', 'pf-top');
  top.append(el('span', 'av big', '🎸'));
  const stats = el('div', 'pf-stats');
  const totalLikes = live.reduce((s, p) => s + Math.round(p.likes * postProg(p, t)), 0);
  [['게시물', live.length], ['팔로워', followersCache], ['좋아요', totalLikes]].forEach(([k, v]) => { const s = el('div'); s.append(el('b', '', fmtCount(v)), el('small', '', k)); stats.append(s); });
  top.append(stats);
  const name = el('div', 'pf-name'); name.append(el('b', '', '@' + S.handle), el('small', '', titleOf(followersCache)));
  const edit = el('button', 'ghost', '이름 바꾸기');
  edit.addEventListener('click', () => {
    const v = (window.prompt('버스타그램 이름', S.handle) || '').trim().replace(/\s+/g, '_').slice(0, 20);
    if (v) { S.handle = v; save(); go('sns'); }
  });
  box.append(top, name, edit);
  box.append(el('p', 'pf-note', '팔로워는 관객이 올린 내 영상이 퍼지면서 늘어요. 노래와 연주를 많이, 관객이 많을 때, 앵콜 아저씨와 목마 탄 아이가 있을 때 반응이 좋아요.'));
  const grid = el('div', 'grid');
  live.forEach((p) => {
    const b = el('button', 'cell'); const img = el('img'); img.src = p.thumb; img.alt = '';
    b.append(img); if (p.viral) b.append(el('span', '', '🔥'));
    b.addEventListener('click', () => { phTab = 'feed'; feedFocus = p.id; go('sns'); });
    grid.append(b);
  });
  box.append(grid);
  const reset = el('button', 'danger', '처음부터 다시 하기');
  reset.addEventListener('click', () => {
    if (!window.confirm('돈, 아이템, 팔로워, 영상이 모두 지워져요. 처음부터 다시 할까요?')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ }
    vids.clear().then(() => location.reload());
  });
  box.append(reset);
  phScreen.append(box);
}

function renderShop() {
  const head = el('div', 'sns-head');
  head.append(el('div', 'logo plain', '상점'), el('div', 'wallet', `💰 ${fmtWon(S.money)}`));
  const tabs = el('div', 'tabs');
  [['instrument', '악기'], ['look', '꾸미기'], ['gear', '장비']].forEach(([k, label]) => {
    const b = el('button', shopTab === k ? 'on' : '', label);
    b.addEventListener('click', () => { shopTab = k; go('shop'); });
    tabs.append(b);
  });
  head.append(tabs);
  phScreen.append(head);
  const list = el('div', 'shop');
  const slots = { instrument: ['instrument'], look: ['hat', 'glasses', 'top'], gear: ['gear'] }[shopTab];
  D.items.filter((i) => slots.includes(i.slot)).forEach((it) => {
    const row = el('div', 'item');
    const owned = S.owned.includes(it.id), worn = S.eq[it.slot] === it.id;
    row.append(el('span', 'ic', it.icon));
    const info = el('div', 'info'); info.append(el('b', '', it.name), el('small', '', it.desc || ''));
    row.append(info);
    let btn;
    if (!owned) {
      btn = el('button', 'buy', it.price ? fmtWon(it.price) : '무료');
      btn.disabled = S.money < it.price;
      btn.title = btn.disabled ? `${fmtWon(it.price - S.money)} 더 필요해요` : '';
      btn.addEventListener('click', () => {
        if (S.money < it.price) return;
        S.money -= it.price; S.owned.push(it.id); S.eq[it.slot] = it.id; save(); applyLook();
        toast(`${it.icon} ${it.name} 구매하고 착용했어요`); go('shop');
      });
    } else if (worn) {
      const removable = it.slot === 'glasses' || it.slot === 'gear';
      btn = el('button', 'worn', removable ? '벗기' : '착용 중');
      btn.disabled = !removable;
      if (removable) btn.addEventListener('click', () => { S.eq[it.slot] = null; save(); applyLook(); go('shop'); });
    } else {
      btn = el('button', 'wear', '착용');
      btn.addEventListener('click', () => { S.eq[it.slot] = it.id; save(); applyLook(); go('shop'); });
    }
    row.append(btn);
    list.append(row);
  });
  phScreen.append(list);
}

function renderBus() {
  const head = el('div', 'sns-head');
  head.append(el('div', 'logo plain', '버스'), el('div', 'wallet', `💰 ${fmtWon(S.money)}`));
  phScreen.append(head);
  const list = el('div', 'bus');
  D.locations.forEach((L) => {
    const card = el('div', 'stop' + (L.id === S.loc ? ' here' : ''));
    const t = el('div', 'st-top'); t.append(el('span', 'ic', L.emoji), el('b', '', L.name));
    card.append(t, el('p', '', L.desc));
    const perks = el('div', 'perks'); L.perks.forEach((k) => perks.append(el('span', '', k)));
    card.append(perks);
    let btn;
    if (L.id === S.loc) btn = el('button', 'worn', '지금 여기 있어요');
    else {
      btn = el('button', 'buy', `🚌 ${fmtWon(L.fare)} 내고 이동`);
      if (S.money < L.fare) { btn.disabled = true; btn.textContent = `버스비 ${fmtWon(L.fare - S.money)} 부족`; }
      btn.addEventListener('click', () => travel(L.id));
    }
    btn.disabled = btn.disabled || L.id === S.loc;
    card.append(btn);
    list.append(card);
  });
  phScreen.append(list);
}
function refreshPhone() {
  if (phoneEl.hidden) return;
  $('#phClock').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (phView !== 'sns' || phTab !== 'feed') return;
  const t = Date.now(), ids = new Set([...phScreen.querySelectorAll('.post')].map((c) => c.dataset.id));
  if (S.posts.some((p) => t >= p.live && !ids.has(p.id))) { // 새 영상이 올라왔으면 다시 그림(재생 중이면 미룸)
    if (![...phScreen.querySelectorAll('video')].some((v) => !v.paused) && !phScreen.contains(document.activeElement)) { go('sns'); S.unseen = 0; }
    return;
  }
  phScreen.querySelectorAll('.post').forEach((card) => { const p = S.posts.find((q) => q.id === card.dataset.id); if (p) refreshCard(card, p); });
}

/* ───────── 루프 ───────── */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

applyLook();
enterLocation(S.loc);
snsTick();

const clock = new THREE.Clock();
let slowT = 0;
function step(dt) {
  now += dt;
  readMic();
  if (!isPlaying()) heat = Math.max(0, heat - dt * 0.12); else heat = Math.max(0, heat - dt * 0.02);
  updatePlayer(dt, now);
  updateCrowd(dt, now);
  updateFlyers(dt, now);
  updateNotes(dt);
  updateFloats(dt);
  updateHand();
  if (hist.length && now - hist[hist.length - 1].t > 30) { hist.length = 0; hookCand = null; }
  updateBubbles(now);
  env.tick(now);
  slowT += dt;
  if (slowT > 0.5) { slowT = 0; snsTick(); refreshPhone(); }
}
let paused = false;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (!paused) step(dt);
  if (rec) updateRecording(now);
  placeCamera();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// 디버그·테스트용
window.__busk = {
  S, npcs, noteOn, cam, camTarget, say, step, travel, enterLocation, openPhone, toast, applyLook, cfg: CFG,
  get heat() { return heat; }, get now() { return now; }, get rec() { return rec; }, set paused(v) { paused = v; },
  sing(v) { if (v) singDown(); else singUp(); },
  set micLevel(v) { micLevel = v; },
  get hook() { return hook; }, get hookCand() { return hookCand; }, choirOn, handDown, handUp,
  tick(dt) { step(dt); if (rec) updateRecording(now); },
};
})();
