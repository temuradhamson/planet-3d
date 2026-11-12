import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { astroState, makeClock, nowDate, setScale } from "./astro.js";
import { lonLatToVector3 } from "./coords.js";
import { assetUrl } from "./asset.js";
import { admFact, CA_FOCUS, countryFact, WORLD_VIEW } from "./data.js";
import { createGlobe, updateAstroVisuals } from "./globe.js";
import { buildLayers, loadLayers, pick, setHover, updateLayerLod } from "./layers.js";
import { bindSearch, bindTimeScale, bindUI, hideLoader, renderClock, setLoader, showCard } from "./ui.js";

const canvas = document.getElementById("globe");
const app = document.getElementById("app");
const ui = bindUI();

function viewSize() {
  const w = Math.max(app.clientWidth, window.innerWidth, document.documentElement.clientWidth, 1);
  const h = Math.max(app.clientHeight, window.innerHeight, document.documentElement.clientHeight, 1);
  return { w, h };
}

function pointerNdc(e, target) {
  const rect = canvas.getBoundingClientRect();
  target.x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  target.y = -((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  return target;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer({ element: document.getElementById("labels") });
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);

const { w: startW, h: startH } = viewSize();
const camera = new THREE.PerspectiveCamera(42, startW / startH, 0.05, 600);
placeCamera(WORLD_VIEW.lon, WORLD_VIEW.lat, WORLD_VIEW.dist);
applySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 1.12;
controls.maxDistance = 12;
controls.enablePan = false;
controls.zoomSpeed = 0.85;
controls.rotateSpeed = 0.55;
controls.target.set(0, 0, 0);

const clock = makeClock(new Date());
const fly = {
  active: false,
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  fromDir: new THREE.Vector3(),
  toDir: new THREE.Vector3(),
  fromLen: 0,
  toLen: 0,
  start: 0,
  dur: 900,
};
const _flyDir = new THREE.Vector3();

const ndc = new THREE.Vector2();
let layers = null;
let globe = null;
let lastCard = 0;

init().catch((err) => {
  console.error(err);
  setLoader(ui, `Ошибка загрузки: ${err.message}`);
});

async function init() {
  setLoader(ui, "текстуры Земли и неба");
  const textures = await loadTextures();
  globe = createGlobe(textures);
  scene.add(globe.root);

  const geo = await loadLayers((msg) => setLoader(ui, msg));
  setLoader(ui, "рисую границы и города");
  layers = buildLayers(geo);
  scene.add(layers.group);

  bindSearch(ui, layers.index, (row) => {
    flyTo(row.lon, row.lat, row.dist);
    const extra =
      row.kind === "country"
        ? countryFact(row.iso)
        : row.kind === "city"
          ? row.extra || {}
          : admFact(row.iso, row.sub, row.kind) || admFact(row.iso, row.title, row.kind);
    showCard(ui, {
      kind: row.kind,
      iso: row.iso,
      name: row.title,
      nameEn: row.sub,
      lon: row.lon,
      lat: row.lat,
      pop: row.pop,
      areaKm2: row.areaKm2,
      gdpMd: row.gdpMd,
      extra,
    });
  });
  bindTimeScale(ui, (factor) => setScale(clock, factor));
  ui.btnIn.addEventListener("click", () => zoomBy(0.82));
  ui.btnOut.addEventListener("click", () => zoomBy(1.22));
  ui.btnCa.addEventListener("click", () => flyTo(CA_FOCUS.lon, CA_FOCUS.lat, CA_FOCUS.dist));
  ui.btnReset.addEventListener("click", () => flyTo(WORLD_VIEW.lon, WORLD_VIEW.lat, WORLD_VIEW.dist));

  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("click", onClick);
  window.addEventListener("resize", applySize);
  window.visualViewport?.addEventListener("resize", applySize);
  new ResizeObserver(applySize).observe(app);
  window.addEventListener("keydown", onKey);

  hideLoader(ui);
  flyTo(CA_FOCUS.lon, CA_FOCUS.lat, CA_FOCUS.dist);
  renderer.setAnimationLoop(tick);
}

function loadTextures() {
  const loader = new THREE.TextureLoader();
  const load = (url, srgb = true) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (t) => {
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 16;
          resolve(t);
        },
        undefined,
        reject
      );
    });
  const optional = (url, srgb = true) =>
    load(url, srgb).catch(() => null);
  return Promise.all([
    load(assetUrl("textures/earth_blue.jpg")),
    load(assetUrl("textures/earth_night2.jpg")),
    load(assetUrl("textures/earth_normal.jpg"), false),
    load(assetUrl("textures/earth_spec.jpg"), false),
    load(assetUrl("textures/moon.jpg")),
    load(assetUrl("textures/starmap.jpg")),
    optional(assetUrl("textures/earth_clouds.jpg")),
  ]).then(([day, night, normal, spec, moon, starmap, clouds]) => ({
    day,
    night,
    normal,
    spec,
    moon,
    starmap,
    clouds,
  }));
}

function tick() {
  const astro = astroState(nowDate(clock));
  updateAstroVisuals(globe, astro);
  if (performance.now() - lastCard > 250) {
    renderClock(ui, astro);
    lastCard = performance.now();
  }
  if (fly.active) {
    const u = Math.min(1, (performance.now() - fly.start) / fly.dur);
    const k = 1 - Math.pow(1 - u, 3);
    _flyDir.copy(fly.fromDir).lerp(fly.toDir, k);
    if (_flyDir.lengthSq() < 1e-8) _flyDir.copy(fly.toDir);
    else _flyDir.normalize();
    const len = fly.fromLen + (fly.toLen - fly.fromLen) * k;
    camera.position.copy(_flyDir).multiplyScalar(len);
    camera.lookAt(0, 0, 0);
    if (u >= 1) {
      camera.position.copy(fly.to);
      camera.lookAt(0, 0, 0);
      fly.active = false;
      controls.enabled = true;
    }
  } else {
    controls.update();
  }
  if (layers) updateLayerLod(layers, camera);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function onMove(e) {
  if (!layers) return;
  pointerNdc(e, ndc);
  const mesh = pick(layers, camera, ndc);
  const hovered = setHover(mesh);
  renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
  if (hovered) showCard(ui, hovered.userData);
}

function onClick(e) {
  if (!layers) return;
  pointerNdc(e, ndc);
  const mesh = pick(layers, camera, ndc);
  if (!mesh) return;
  const d = mesh.userData;
  const dist = d.kind === "city" ? 1.22 : d.kind === "adm2" ? 1.26 : d.kind === "adm1" ? 1.5 : 2.15;
  flyTo(d.lon, d.lat, dist);
  showCard(ui, d);
}

function onKey(e) {
  if (e.target === ui.search) return;
  if (e.key === "+" || e.key === "=") zoomBy(0.82);
  if (e.key === "-" || e.key === "_") zoomBy(1.22);
  if (e.key === "f" || e.key === "F") flyTo(CA_FOCUS.lon, CA_FOCUS.lat, CA_FOCUS.dist);
  if (e.key === "0") flyTo(WORLD_VIEW.lon, WORLD_VIEW.lat, WORLD_VIEW.dist);
}

function beginFly(toVec, dur) {
  if (!Number.isFinite(toVec.x) || toVec.lengthSq() < 1e-6) return;
  fly.from.copy(camera.position);
  fly.to.copy(toVec);
  fly.fromLen = fly.from.length();
  fly.toLen = fly.to.length();
  fly.fromDir.copy(fly.from).normalize();
  fly.toDir.copy(fly.to).normalize();
  fly.start = performance.now();
  fly.dur = dur;
  fly.active = true;
  controls.enabled = false;
}

function zoomBy(k) {
  const v = camera.position.clone();
  const len = v.length();
  const next = THREE.MathUtils.clamp(len * k, controls.minDistance, controls.maxDistance);
  v.setLength(next);
  beginFly(v, 350);
}

function flyTo(lon, lat, dist) {
  lonLatToVector3(lon, lat, dist, fly.to);
  beginFly(fly.to, 900);
}

function placeCamera(lon, lat, dist) {
  lonLatToVector3(lon, lat, dist, camera.position);
  camera.lookAt(0, 0, 0);
}

function applySize() {
  const { w, h } = viewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
}
