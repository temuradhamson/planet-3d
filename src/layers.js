import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import earcut from "earcut";
import {
  densifyRing,
  lonLatToVector3,
  polygonRings,
  EARTH_R,
} from "./coords.js";
import { admFact, countryFact, displayAdminName } from "./data.js";

const CA = new Set(["KAZ", "UZB", "TJK"]);
const _n = new THREE.Vector3();

export async function loadLayers(onProgress) {
  onProgress?.("границы стран");
  const countries = await fetchJson("/geo/countries.min.geojson");
  onProgress?.("области Центральной Азии");
  const adm1 = await fetchJson("/geo/ca-adm1.min.geojson");
  onProgress?.("районы KZ / UZ / TJ");
  const adm2 = await fetchJson("/geo/ca-adm2.min.geojson");
  onProgress?.("карточки демографии");
  const meta = await fetchJson("/data/meta.json");
  return { countries, adm1, adm2, meta };
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

  const adm1Fills = new THREE.Group();
  adm1Fills.name = "adm1-fills";
  const adm1Lines = buildLineGroup(data.adm1.features, {
    color: 0xe4c27a,
    opacity: 0.85,
    radius: EARTH_R * 1.0042,
    maxDeg: 0.7,
  });
  for (const f of data.adm1.features) {
    const p = f.properties;
    const extra = admFact(p.iso, p.name, "adm1");
    const mesh = polygonMesh(f.geometry, EARTH_R * 1.0036, {
      color: p.iso === "UZB" ? 0x7ee0ff : p.iso === "KAZ" ? 0xe4c27a : 0xf0a0c0,
      opacity: 0.18,
      maxDeg: 0.65,
    });
    if (!mesh) continue;
    mesh.userData = {
      kind: "adm1",
      iso: p.iso,
      name: displayAdminName(p.iso, p.name),
      nameEn: p.name,
      pop: extra.pop || null,
      areaKm2: p.areaKm2,
      lon: p.lon,
      lat: p.lat,
      extra,
    };
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
    labels.add(
      makeLabel(displayAdminName(p.iso, p.name), p.lon, p.lat, "adm1", 1.028)
    );
  }
  const adm2LabelObjs = [];
  for (const f of data.adm2.features) {
    const p = f.properties;
    const obj = makeLabel(displayAdminName(p.iso, p.name), p.lon, p.lat, "adm2", 1.026);
    obj.visible = false;
    labels.add(obj);
    adm2LabelObjs.push(obj);
  }

  group.add(countryFills, countryLines, adm1Fills, adm1Lines, adm2Fills, adm2Lines, labels);

  return {
    group,
    countryFills,
    countryLines,
    adm1Fills,
    adm1Lines,
    adm2Fills,
    adm2Lines,
    labels,
    adm2LabelObjs,
    pickables: [...countryFills.children, ...adm1Fills.children, ...adm2Fills.children],
    index: buildSearchIndex(data),
  };
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
    const title = displayAdminName(p.iso, p.name);
    const extra1 = admFact(p.iso, p.name, "adm1");
    rows.push({
      kind: "adm1",
      iso: p.iso,
      title,
      sub: p.name,
      lon: p.lon,
      lat: p.lat,
      dist: 1.55,
      pop: extra1.pop || null,
      areaKm2: p.areaKm2,
      q: `${title} ${p.name} ${p.iso}`.toLowerCase(),
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
      // drop sliver triangles that span the dateline
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
  layers.adm1Lines.visible = dist < 4.2;
  layers.countryFills.visible = dist > 1.7;
  layers.countryLines.material.opacity = dist > 2.4 ? 0.42 : 0.22;

  const camDir = camera.position.clone().normalize();
  const proj = new THREE.Vector3();
  const taken = [];
  const ranked = [];
  for (const obj of layers.labels.children) {
    const facing = obj.position.clone().normalize().dot(camDir);
    const kind = obj.userData.kind;
    let show = facing > 0.22;
    if (kind === "country") show = show && dist < 4.6 && dist > 2.05;
    if (kind === "adm1") show = show && dist < 2.65 && dist > 1.62 && facing > 0.32;
    if (kind === "adm2") show = show && dist < 1.52 && facing > 0.72;
    obj.visible = false;
    if (show) ranked.push({ obj, facing, kind });
  }
  ranked.sort((a, b) => {
    const w = { country: 3, adm1: 2, adm2: 1 };
    return w[b.kind] - w[a.kind] || b.facing - a.facing;
  });
  let adm2n = 0;
  for (const { obj, kind } of ranked) {
    if (kind === "adm2" && adm2n >= 22) continue;
    proj.copy(obj.position).project(camera);
    const x = (proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-proj.y * 0.5 + 0.5) * window.innerHeight;
    const pad = kind === "adm2" ? 28 : 52;
    if (taken.some((p) => Math.abs(p.x - x) < pad && Math.abs(p.y - y) < 16)) continue;
    obj.visible = true;
    taken.push({ x, y });
    if (kind === "adm2") adm2n += 1;
  }
}

const _ray = new THREE.Raycaster();
_ray.params.Line = { threshold: 0.01 };

export function pick(layers, camera, ndc) {
  _ray.setFromCamera(ndc, camera);
  const dist = camera.position.length();
  const set = [];
  if (dist < 2.05) set.push(...layers.adm2Fills.children);
  if (dist < 2.9) set.push(...layers.adm1Fills.children);
  set.push(...layers.countryFills.children);
  const hits = _ray.intersectObjects(set, false);
  return hits[0]?.object || null;
}

let _hover = null;
export function setHover(mesh) {
  if (_hover === mesh) return _hover;
  if (_hover) {
    _hover.material.opacity = _hover.userData._op ?? _hover.material.opacity;
  }
  _hover = mesh;
  if (mesh) {
    mesh.userData._op = mesh.material.opacity;
    mesh.material.opacity = Math.min(0.55, mesh.material.opacity + 0.28);
  }
  return mesh;
}
