import * as THREE from "three";

export const EARTH_R = 1;
const DEG = Math.PI / 180;

/** WGS84 lon/lat → Three.js Y-up sphere. lon=0, lat=0 is +X (Greenwich). */
export function lonLatToVector3(lon, lat, r = EARTH_R, target = new THREE.Vector3()) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return target.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

/** ECEF (+X Greenwich, +Y 90°E, +Z north) → Three.js (+X Greenwich, +Y north, +Z 90°W). */
export function ecefToThree(x, y, z, target = new THREE.Vector3()) {
  return target.set(x, z, -y);
}

/** J2000 equatorial vector → ECEF/Three using GMST hours. */
export function equatorialToThree(x, y, z, gmstHours, target = new THREE.Vector3()) {
  const th = gmstHours * 15 * DEG;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const ex = x * c + y * s;
  const ey = -x * s + y * c;
  return ecefToThree(ex, ey, z, target);
}

export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function vector3ToLonLat(v) {
  const r = v.length() || 1;
  const lat = Math.asin(Math.min(1, Math.max(-1, v.y / r))) / DEG;
  const theta = Math.atan2(v.z, -v.x) / DEG;
  return { lon: wrapLon(theta - 180), lat };
}

export function densifyRing(ring, maxDeg = 1.35) {
  if (!ring || ring.length < 2) return ring || [];
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push([a[0], a[1]]);
    let dlon = b[0] - a[0];
    if (dlon > 180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const dlat = b[1] - a[1];
    const dist = Math.hypot(dlon, dlat);
    const steps = Math.max(1, Math.ceil(dist / maxDeg));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      out.push([wrapLon(a[0] + dlon * t), a[1] + dlat * t]);
    }
  }
  return out;
}

export function polygonRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

export function fmtInt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("ru-RU");
}

export function fmtKm2(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} млн км²`;
  if (n >= 1000) return `${Math.round(n).toLocaleString("ru-RU")} км²`;
  return `${n.toFixed(1)} км²`;
}

export function density(pop, area) {
  if (!pop || !area) return "—";
  const d = pop / area;
  return d >= 10 ? `${Math.round(d).toLocaleString("ru-RU")} чел/км²` : `${d.toFixed(1)} чел/км²`;
}
