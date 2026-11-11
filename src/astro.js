import * as Astronomy from "astronomy-engine";
import * as THREE from "three";
import { equatorialToThree } from "./coords.js";

export const TASHKENT = { lat: 41.2995, lon: 69.2401, h: 455 };

const _sun = new THREE.Vector3();
const _moon = new THREE.Vector3();

export const TIME_SCALES = [
  { label: "пауза", factor: 0 },
  { label: "реально", factor: 1 },
  { label: "×60  (минута/сек)", factor: 60 },
  { label: "×1200 (20 мин/сек)", factor: 1200 },
  { label: "сутки / 12 сек", factor: 7200 },
];

export function makeClock(start = new Date()) {
  return { epoch: start.getTime(), originPerf: performance.now(), scale: 1 };
}

export function nowDate(clock) {
  const elapsed = (performance.now() - clock.originPerf) * clock.scale;
  return new Date(clock.epoch + elapsed);
}

export function setScale(clock, scale) {
  const current = nowDate(clock);
  clock.epoch = current.getTime();
  clock.originPerf = performance.now();
  clock.scale = scale;
}

export function astroState(date) {
  const time = Astronomy.MakeTime(date);
  const gmst = Astronomy.SiderealTime(time);
  const sunVec = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
  const moonVec = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
  equatorialToThree(sunVec.x, sunVec.y, sunVec.z, gmst, _sun).normalize();
  equatorialToThree(moonVec.x, moonVec.y, moonVec.z, gmst, _moon).normalize();
  const moonKm = Math.hypot(moonVec.x, moonVec.y, moonVec.z) * 149597870.7;
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, time);
  const observer = new Astronomy.Observer(TASHKENT.lat, TASHKENT.lon, TASHKENT.h);
  const sunEq = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  const moonEq = Astronomy.Equator(Astronomy.Body.Moon, time, observer, true, true);
  const sunHor = Astronomy.Horizon(time, observer, sunEq.ra, sunEq.dec, "normal");
  const moonHor = Astronomy.Horizon(time, observer, moonEq.ra, moonEq.dec, "normal");
  return {
    date,
    time,
    gmst,
    sunDir: _sun.clone(),
    moonDir: _moon.clone(),
    moonKm,
    moonPhase: illum.phase_fraction,
    sunAlt: sunHor.altitude,
    sunAz: sunHor.azimuth,
    moonAlt: moonHor.altitude,
    moonAz: moonHor.azimuth,
  };
}

export function fmtTime(date, tz) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function fmtHours(h) {
  const wrapped = ((h % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  const ss = Math.floor(((wrapped - hh) * 60 - mm) * 60);
  return `${String(hh).padStart(2, "0")}ч ${String(mm).padStart(2, "0")}м ${String(ss).padStart(2, "0")}с`;
}

export function moonPhaseName(frac) {
  if (frac < 0.03 || frac > 0.97) return "новолуние";
  if (frac < 0.22) return "молодой месяц";
  if (frac < 0.28) return "первая четверть";
  if (frac < 0.47) return "прибывающая";
  if (frac < 0.53) return "полнолуние";
  if (frac < 0.72) return "убывающая";
  if (frac < 0.78) return "последняя четверть";
  return "старый месяц";
}

export function fmtAltAz(alt, az) {
  const hemi = alt >= 0 ? "над горизонтом" : "под горизонтом";
  return `${alt.toFixed(1)}° ${hemi}, азимут ${az.toFixed(0)}°`;
}
