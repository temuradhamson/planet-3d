import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import earcut from "earcut";
import {
  densifyRing,
  lonLatToVector3,
  polygonRings,
  vector3ToLonLat,
  EARTH_R,
} from "./coords.js";
import { assetUrl } from "./asset.js";
import { admFact, countryFact, displayAdminName } from "./data.js";

const CA = new Set(["KAZ", "UZB", "TJK"]);
const _n = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_R);

export async function loadLayers(onProgress) {
  onProgress?.("границы стран");
  const countries = await fetchJson(assetUrl("geo/countries.min.geojson"));
  onProgress?.("области мира");
  const adm1 = await fetchJson(assetUrl("geo/world-adm1.min.geojson"));
  onProgress?.("районы KZ / UZ / TJ");
  const adm2 = await fetchJson(assetUrl("geo/ca-adm2.min.geojson"));
  onProgress?.("города");
  const cities = await fetchJson(assetUrl("geo/world-cities.min.json"));
  onProgress?.("карточки демографии");
  const meta = await fetchJson(assetUrl("data/meta.json"));
  return { countries, adm1, adm2, cities, meta };
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export function buildLayers(data) {
  const group = new THREE.Group();
  group.name = "overlays";

  const countryFills = new THREE.Group();
  countryFills.name = "country-fills";
  const countryLines = buildLineGroup(data.countries.features, {
    color: 0xb7d4ff,
    opacity: 0.42,
    radius: EARTH_R * 1.0032,
    maxDeg: 1.6,
  });
  countryLines.name = "country-borders";

  for (const f of data.countries.features) {
    const p = f.properties;
    const iso = p.ISO_A3;
    const isCA = CA.has(iso);
    const mesh = polygonMesh(f.geometry, EARTH_R * 1.0024, {
      color: isCA ? 0xe4c27a : 0x7ea7d6,
      opacity: isCA ? 0.16 : 0.045,
      maxDeg: isCA ? 0.9 : 1.8,
    });
    if (!mesh) continue;
    mesh.userData = {
      kind: "country",
      iso,
      name: p.NAME_RU || p.NAME,
      nameEn: p.NAME_EN || p.NAME,
      pop: p.POP_EST,
      areaKm2: p.AREA_KM2,
      gdpMd: p.GDP_MD,
      lon: p.CEN_LON,
      lat: p.CEN_LAT,
      subregion: p.SUBREGION,
      continent: p.CONTINENT,
      economy: p.ECONOMY,
      income: p.INCOME_GRP,
      extra: countryFact(iso),
    };
    countryFills.add(mesh);
  }

  const caAdm1 = data.adm1.features.filter((f) => CA.has(f.properties.iso));
  const worldAdm1 = data.adm1.features.filter((f) => !CA.has(f.properties.iso));

  const adm1Fills = new THREE.Group();
  adm1Fills.name = "adm1-fills";
  const adm1Lines = buildLineGroup(data.adm1.features, {
    color: 0xe4c27a,
    opacity: 0.55,
    radius: EARTH_R * 1.0042,
    maxDeg: 0.85,
  });
  adm1Lines.name = "adm1-borders";
  for (const f of caAdm1) {
    const p = f.properties;
    const extra = admFact(p.iso, p.name, "adm1");
    const mesh = polygonMesh(f.geometry, EARTH_R * 1.0036, {
      color: p.iso === "UZB" ? 0x7ee0ff : p.iso === "KAZ" ? 0xe4c27a : 0xf0a0c0,
      opacity: 0.18,
      maxDeg: 0.65,
    });
    if (!mesh) continue;
    mesh.userData = adm1UserData(p, extra);
    adm1Fills.add(mesh);
  }

  const adm2Fills = new THREE.Group();
  adm2Fills.name = "adm2-fills";
  const adm2Lines = buildLineGroup(data.adm2.features, {
    color: 0xd5e8ff,
    opacity: 0.55,
    radius: EARTH_R * 1.0048,
    maxDeg: 0.55,
  });
  for (const f of data.adm2.features) {
    const p = f.properties;
    const extra = admFact(p.iso, p.name, "adm2");
    const mesh = polygonMesh(f.geometry, EARTH_R * 1.0044, {
      color: 0x9ad4ff,
      opacity: 0.07,
      maxDeg: 0.55,
    });
    if (!mesh) continue;
    mesh.userData = {
      kind: "adm2",
      iso: p.iso,
      name: displayAdminName(p.iso, p.name),
      nameEn: p.name,
      areaKm2: p.areaKm2,
      lon: p.lon,
      lat: p.lat,
      extra,
    };
    adm2Fills.add(mesh);
  }

  const cities = buildCities(data.cities);
  const highlight = makeHighlight();

  const labels = new THREE.Group();
  labels.name = "labels";
  const caLabels = [
    { name: "Казахстан", lon: 66.9, lat: 48.3, kind: "country" },
    { name: "Узбекистан", lon: 64.2, lat: 41.4, kind: "country" },
    { name: "Таджикистан", lon: 71.0, lat: 38.7, kind: "country" },
  ];
  for (const L of caLabels) labels.add(makeLabel(L.name, L.lon, L.lat, L.kind, 1.035));
  for (const f of data.adm1.features) {
    const p = f.properties;
    const important = CA.has(p.iso) || (p.labelrank != null && p.labelrank <= 2);
    if (!important) continue;
    const title = p.nameRu && /[А-Яа-яЁё]/.test(p.nameRu) ? p.nameRu : displayAdminName(p.iso, p.name);
    labels.add(makeLabel(title, p.lon, p.lat, "adm1", 1.028));
  }
  const adm2LabelObjs = [];
  for (const f of data.adm2.features) {
    const p = f.properties;
    const obj = makeLabel(displayAdminName(p.iso, p.name), p.lon, p.lat, "adm2", 1.026);
    obj.visible = false;
    labels.add(obj);
    adm2LabelObjs.push(obj);
  }
  for (const c of data.cities) {
    const major = c.cap === 2 || (c.pop || 0) >= 1_000_000 || c.rank <= 3 || (CA.has(c.iso) && (c.pop || 0) >= 120_000);
    if (!major) continue;
    const obj = makeLabel(c.name, c.lon, c.lat, "city", 1.009);
    obj.userData.pop = c.pop || 0;
    obj.userData.cap = c.cap || 0;
    obj.userData.rank = c.rank || 99;
    obj.visible = false;
    labels.add(obj);
  }

  group.add(
    countryFills,
    countryLines,
    adm1Fills,
    adm1Lines,
    adm2Fills,
    adm2Lines,
    cities.points,
    highlight,
    labels
  );

  return {
    group,
    countryFills,
    countryLines,
    adm1Fills,
    adm1Lines,
    adm2Fills,
    adm2Lines,
    cityPoints: cities.points,
    cityIndex: cities.index,
    highlight,
    labels,
    adm2LabelObjs,
    worldAdm1,
    pickables: [...countryFills.children, ...adm1Fills.children, ...adm2Fills.children],
    index: buildSearchIndex(data),
  };
}

function adm1UserData(p, extra) {
  const ru = p.nameRu && /[А-Яа-яЁё]/.test(p.nameRu) ? p.nameRu : displayAdminName(p.iso, p.name);
  return {
    kind: "adm1",
    iso: p.iso,
    name: ru,
    nameEn: p.nameEn || p.name,
    pop: extra.pop || null,
    areaKm2: p.areaKm2,
    lon: p.lon,
    lat: p.lat,
    extra: {
      ...extra,
      capital: extra.capital,
      fact: extra.fact || (p.type ? `${p.admin || p.iso} · ${p.type}` : extra.fact),
    },
    type: p.type,
    admin: p.admin,
  };
}

function buildCities(rows) {
  const pos = [];
  const col = [];
  const index = [];
  for (const c of rows) {
    lonLatToVector3(c.lon, c.lat, EARTH_R * 1.006, _n);
    pos.push(_n.x, _n.y, _n.z);
    if (c.cap === 2) col.push(1.0, 0.86, 0.42);
    else if ((c.pop || 0) > 3_000_000) col.push(0.95, 0.95, 1.0);
    else col.push(0.75, 0.85, 1.0);
    index.push(c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const points = new THREE.Points(
    g,
    new THREE.PointsMaterial({
      size: 0.007,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      sizeAttenuation: true,
      map: citySprite(),
      alphaTest: 0.2,
    })
  );
  points.name = "cities";
  points.renderOrder = 4;
  return { points, index };
}

function citySprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(220,235,255,0.9)");
  grd.addColorStop(1, "rgba(180,210,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cityUserData(c) {
  const cap =
    c.cap === 2 ? "столица страны" : c.cap === 1 ? "центр региона" : c.feat || "";
  return {
    kind: "city",
    iso: c.iso,
    name: c.name,
    nameEn: c.nameEn,
    pop: c.pop,
    lon: c.lon,
    lat: c.lat,
    extra: {
      capital: cap || undefined,
      fact: [c.adm1, c.tz].filter(Boolean).join(" · "),
    },
  };
}

function makeHighlight() {
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x7ee0ff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
  );
  line.name = "adm1-highlight";
  line.visible = false;
  line.renderOrder = 5;
  return line;
}

function setHighlight(layers, feature) {
  const line = layers.highlight;
  if (!feature) {
    line.visible = false;
    return;
  }
  const rings = polygonRings(feature.geometry);
  if (!rings.length) {
    line.visible = false;
    return;
  }
  const outer = densifyRing(rings[0][0], 0.45);
  const pos = [];
  for (const [lon, lat] of outer) {
    lonLatToVector3(lon, lat, EARTH_R * 1.005, _n);
    pos.push(_n.x, _n.y, _n.z);
  }
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry();
  line.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  line.visible = true;
}

function buildSearchIndex(data) {
  const rows = [];
  for (const f of data.countries.features) {
    const p = f.properties;
    rows.push({
      kind: "country",
      iso: p.ISO_A3,
      title: p.NAME_RU || p.NAME,
      sub: p.NAME_EN || p.ADMIN,
      lon: p.CEN_LON,
      lat: p.CEN_LAT,
      dist: 2.4,
      pop: p.POP_EST,
      areaKm2: p.AREA_KM2,
      gdpMd: p.GDP_MD,
      q: `${p.NAME_RU} ${p.NAME} ${p.NAME_EN} ${p.ADMIN} ${p.ISO_A3} ${p.ISO_A2}`.toLowerCase(),
    });
  }
  for (const f of data.adm1.features) {
    const p = f.properties;
    const title =
      p.nameRu && /[А-Яа-яЁё]/.test(p.nameRu) ? p.nameRu : displayAdminName(p.iso, p.name);
    const extra1 = admFact(p.iso, p.name, "adm1");
    rows.push({
      kind: "adm1",
      iso: p.iso,
      title,
      sub: p.admin ? `${p.nameEn || p.name} · ${p.admin}` : p.name,
      lon: p.lon,
      lat: p.lat,
      dist: 1.55,
      pop: extra1.pop || null,
      areaKm2: p.areaKm2,
      q: `${title} ${p.name} ${p.nameEn || ""} ${p.nameRu || ""} ${p.iso} ${p.admin || ""}`.toLowerCase(),
    });
  }
  for (const f of data.adm2.features) {
    const p = f.properties;
    const title = displayAdminName(p.iso, p.name);
    rows.push({
      kind: "adm2",
      iso: p.iso,
      title,
      sub: `${p.iso} · район`,
      lon: p.lon,
      lat: p.lat,
      dist: 1.28,
      areaKm2: p.areaKm2,
      q: `${title} ${p.name} ${p.iso}`.toLowerCase(),
    });
  }
  for (const c of data.cities) {
    rows.push({
      kind: "city",
      iso: c.iso,
      title: c.name,
      sub: [c.nameEn !== c.name ? c.nameEn : "", c.adm1, c.iso].filter(Boolean).join(" · "),
      lon: c.lon,
      lat: c.lat,
      dist: 1.22,
      pop: c.pop,
      extra: {
        capital: c.cap === 2 ? "столица страны" : c.cap === 1 ? "центр региона" : undefined,
        fact: [c.adm1, c.tz].filter(Boolean).join(" · "),
      },
      q: `${c.name} ${c.nameEn} ${c.adm1} ${c.iso}`.toLowerCase(),
    });
  }
  return rows;
}

function makeLabel(text, lon, lat, kind, r) {
  const el = document.createElement("div");
  el.className = `label3d ${kind}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  lonLatToVector3(lon, lat, EARTH_R * r, obj.position);
  obj.userData = { kind, lon, lat };
  return obj;
}

function polygonMesh(geom, radius, { color, opacity, maxDeg }) {
  const { positions, indices } = triangulate(geom, radius, maxDeg);
  if (!indices.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  m.renderOrder = 2;
  return m;
}

function triangulate(geom, radius, maxDeg) {
  const positions = [];
  const indices = [];
  const push = (lon, lat) => {
    lonLatToVector3(lon, lat, radius, _n);
    positions.push(_n.x, _n.y, _n.z);
  };
  for (const rings of polygonRings(geom)) {
    if (!rings?.length) continue;
    const dense = rings.map((ring, i) => densifyRing(ring, i === 0 ? maxDeg : maxDeg * 1.4));
    const verts = [];
    const holes = [];
    for (let i = 0; i < dense.length; i++) {
      if (i > 0) holes.push(verts.length / 2);
      for (const [lon, lat] of dense[i]) {
        verts.push(lon, lat);
      }
    }
    if (verts.length < 6) continue;
    let tris;
    try {
      tris = earcut(verts, holes, 2);
    } catch {
      continue;
    }
    const base = positions.length / 3;
    for (let i = 0; i < verts.length; i += 2) push(verts[i], verts[i + 1]);
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      const b = tris[i + 1];
      const c = tris[i + 2];
      const lons = [verts[a * 2], verts[b * 2], verts[c * 2]];
      const span = Math.max(...lons) - Math.min(...lons);
      if (span > 180) continue;
      indices.push(base + a, base + b, base + c);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices,
  };
}

function buildLineGroup(features, { color, opacity, radius, maxDeg }) {
  const positions = [];
  for (const f of features) {
    for (const rings of polygonRings(f.geometry)) {
      const outer = densifyRing(rings[0], maxDeg);
      if (outer.length < 2) continue;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        let dlon = Math.abs(b[0] - a[0]);
        if (dlon > 180) continue;
        lonLatToVector3(a[0], a[1], radius, _n);
        positions.push(_n.x, _n.y, _n.z);
        lonLatToVector3(b[0], b[1], radius, _n);
        positions.push(_n.x, _n.y, _n.z);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  lines.renderOrder = 3;
  return lines;
}

export function updateLayerLod(layers, camera) {
  const dist = camera.position.length();
  const close = dist < 2.05;
  const mid = dist < 2.9;
  layers.adm2Fills.visible = close;
  layers.adm2Lines.visible = close;
  layers.adm1Fills.visible = mid;
  layers.adm1Lines.visible = dist < 4.4;
  layers.adm1Lines.material.opacity = dist < 2.8 ? 0.7 : dist < 3.6 ? 0.42 : 0.22;
  layers.countryFills.visible = dist > 1.7;
  layers.countryLines.material.opacity = dist > 2.4 ? 0.42 : 0.22;
  if (layers.cityPoints) {
    layers.cityPoints.visible = dist < 2.2;
    layers.cityPoints.material.size = dist < 1.45 ? 0.0042 : dist < 1.75 ? 0.0058 : 0.0075;
  }

  const camDir = camera.position.clone().normalize();
  const proj = new THREE.Vector3();
  const taken = [];
  const ranked = [];
  for (const obj of layers.labels.children) {
    const facing = obj.position.clone().normalize().dot(camDir);
    const kind = obj.userData.kind;
    let show = facing > 0.22;
    if (kind === "country") show = show && dist < 4.6 && dist > 2.05;
    if (kind === "adm1") show = show && dist < 2.55 && dist > 1.58 && facing > 0.52;
    if (kind === "adm2") show = show && dist < 1.52 && facing > 0.72;
    if (kind === "city") {
      const pop = obj.userData.pop || 0;
      const cap = obj.userData.cap || 0;
      const need = cap === 2 ? 2.15 : pop >= 5e6 ? 1.92 : pop >= 1e6 ? 1.68 : 1.48;
      show = show && dist < need && facing > 0.55;
    }
    obj.visible = false;
    if (show) ranked.push({ obj, facing, kind, pop: obj.userData.pop || 0 });
  }
  ranked.sort((a, b) => {
    const w = { country: 4, city: 3, adm1: 2, adm2: 1 };
    const aw = w[a.kind] || 0;
    const bw = w[b.kind] || 0;
    if (a.kind === "city" && b.kind === "city") return b.pop - a.pop || b.facing - a.facing;
    return bw - aw || b.facing - a.facing;
  });
  let adm2n = 0;
  let cityn = 0;
  let adm1n = 0;
  for (const { obj, kind } of ranked) {
    if (kind === "adm2" && adm2n >= 18) continue;
    if (kind === "city" && cityn >= 16) continue;
    if (kind === "adm1" && adm1n >= 14) continue;
    proj.copy(obj.position).project(camera);
    const x = (proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-proj.y * 0.5 + 0.5) * window.innerHeight;
    const pad = kind === "adm2" || kind === "city" ? 36 : 70;
    if (taken.some((p) => Math.abs(p.x - x) < pad && Math.abs(p.y - y) < 16)) continue;
    obj.visible = true;
    taken.push({ x, y });
    if (kind === "adm2") adm2n += 1;
    if (kind === "city") cityn += 1;
    if (kind === "adm1") adm1n += 1;
  }
}

const _ray = new THREE.Raycaster();
_ray.params.Line = { threshold: 0.01 };
_ray.params.Points = { threshold: 0.03 };

export function pick(layers, camera, ndc) {
  _ray.setFromCamera(ndc, camera);
  const dist = camera.position.length();

  if (dist < 2.35 && layers.cityPoints?.visible) {
    const ch = _ray.intersectObject(layers.cityPoints, false);
    if (ch[0] && ch[0].index != null) {
      const c = layers.cityIndex[ch[0].index];
      if (c) {
        setHighlight(layers, null);
        return wrapPick(cityUserData(c));
      }
    }
  }

  const set = [];
  if (dist < 2.05) set.push(...layers.adm2Fills.children);
  if (dist < 2.9) set.push(...layers.adm1Fills.children);
  set.push(...layers.countryFills.children);
  const hits = _ray.intersectObjects(set, false);
  const mesh = hits[0]?.object || null;
  if (mesh && mesh.userData.kind !== "country") {
    setHighlight(layers, null);
    return mesh;
  }

  if (dist < 3.05) {
    const ll = rayLonLat(camera, ndc);
    if (ll) {
      const feat = findAdm1(layers.worldAdm1, ll.lon, ll.lat);
      if (feat) {
        const extra = admFact(feat.properties.iso, feat.properties.name, "adm1");
        setHighlight(layers, feat);
        return wrapPick(adm1UserData(feat.properties, extra));
      }
    }
  }

  setHighlight(layers, null);
  return mesh;
}

function rayLonLat(camera, ndc) {
  _ray.setFromCamera(ndc, camera);
  if (!_ray.ray.intersectSphere(_sphere, _hit)) return null;
  return vector3ToLonLat(_hit);
}

function inBBox(lon, lat, b) {
  if (!b || b.length < 4) return true;
  const [minx, miny, maxx, maxy] = b;
  if (lat < miny || lat > maxy) return false;
  if (maxx >= minx) return lon >= minx && lon <= maxx;
  return lon >= minx || lon <= maxx;
}

function findAdm1(features, lon, lat) {
  for (const f of features) {
    const p = f.properties;
    if (!inBBox(lon, lat, p.bbox)) continue;
    if (pointInFeature(f.geometry, lon, lat)) return f;
  }
  return null;
}

function pointInFeature(geom, lon, lat) {
  for (const rings of polygonRings(geom)) {
    if (!rings?.length) continue;
    if (!pointInRing(lon, lat, rings[0])) continue;
    let hole = false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lon, lat, rings[i])) {
        hole = true;
        break;
      }
    }
    if (!hole) return true;
  }
  return false;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    let xi = ring[i][0];
    let xj = ring[j][0];
    const yi = ring[i][1];
    const yj = ring[j][1];
    if (xi - lon > 180) xi -= 360;
    if (xi - lon < -180) xi += 360;
    if (xj - lon > 180) xj -= 360;
    if (xj - lon < -180) xj += 360;
    const denom = yj - yi;
    if (denom === 0) continue;
    const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function wrapPick(userData) {
  return { isProxy: true, material: { opacity: 0 }, userData };
}

function samePick(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ua = a.userData || {};
  const ub = b.userData || {};
  return ua.kind === ub.kind && ua.name === ub.name && ua.iso === ub.iso;
}

let _hover = null;
export function setHover(mesh) {
  if (samePick(_hover, mesh)) return _hover;
  if (_hover && !_hover.isProxy && _hover.material && _hover.userData._op != null) {
    _hover.material.opacity = _hover.userData._op;
  }
  _hover = mesh;
  if (mesh && !mesh.isProxy && mesh.material) {
    mesh.userData._op = mesh.material.opacity;
    mesh.material.opacity = Math.min(0.55, mesh.material.opacity + 0.28);
  }
  return mesh;
}
