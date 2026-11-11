import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { astroState, makeClock, nowDate, setScale } from "./astro.js";
import { lonLatToVector3 } from "./coords.js";
import { admFact, CA_FOCUS, countryFact, WORLD_VIEW } from "./data.js";
import { createGlobe, updateAstroVisuals } from "./globe.js";
import { buildLayers, loadLayers, pick, setHover, updateLayerLod } from "./layers.js";
import { bindSearch, bindTimeScale, bindUI, hideLoader, renderClock, setLoader, showCard } from "./ui.js";

const canvas = document.getElementById("globe");
const ui = bindUI();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer({ element: document.getElementById("labels") });
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 600);
placeCamera(WORLD_VIEW.lon, WORLD_VIEW.lat, WORLD_VIEW.dist);

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
const fly = { active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1.1 };

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
  layers = buildLayers(geo);
  scene.add(layers.group);

  bindSearch(ui, layers.index, (row) => {
    flyTo(row.lon, row.lat, row.dist);
    const extra =
      row.kind === "country"
        ? countryFact(row.iso)
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
  window.addEventListener("resize", onResize);
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
          t.anisotropy = 8;
          resolve(t);
        },
        undefined,
        reject
      );
    });
  return Promise.all([
    load("/textures/earth_blue.jpg"),
    load("/textures/earth_night2.jpg"),
    load("/textures/earth_normal.jpg", false),
    load("/textures/earth_spec.jpg", false),
    load("/textures/moon.jpg"),
    load("/textures/starmap.jpg"),
  ]).then(([day, night, normal, spec, moon, starmap]) => ({
    day,
    night,
    normal,
    spec,
    moon,
    starmap,
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
    fly.t += 0.016 / fly.dur;
    const k = 1 - Math.pow(1 - Math.min(1, fly.t), 3);
    camera.position.lerpVectors(fly.from, fly.to, k);
    if (fly.t >= 1) fly.active = false;
  }
  controls.update();
  if (layers) updateLayerLod(layers, camera);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function onMove(e) {
  if (!layers) return;
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  const mesh = pick(layers, camera, ndc);
  const hovered = setHover(mesh);
  renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
  if (hovered) showCard(ui, hovered.userData);
}

function onClick(e) {
  if (!layers) return;
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  const mesh = pick(layers, camera, ndc);
  if (!mesh) return;
  const d = mesh.userData;
  const dist = d.kind === "adm2" ? 1.26 : d.kind === "adm1" ? 1.5 : 2.15;
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

function zoomBy(k) {
  const v = camera.position.clone();
  const len = v.length();
  const next = THREE.MathUtils.clamp(len * k, controls.minDistance, controls.maxDistance);
  v.setLength(next);
  fly.from.copy(camera.position);
  fly.to.copy(v);
  fly.t = 0;
  fly.dur = 0.35;
  fly.active = true;
}

function flyTo(lon, lat, dist) {
  lonLatToVector3(lon, lat, dist, fly.to);
  fly.from.copy(camera.position);
  fly.t = 0;
  fly.dur = 0.9;
  fly.active = true;
}

function placeCamera(lon, lat, dist) {
  lonLatToVector3(lon, lat, dist, camera.position);
  camera.lookAt(0, 0, 0);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
