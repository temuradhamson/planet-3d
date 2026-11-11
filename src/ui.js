import { density, fmtInt, fmtKm2 } from "./coords.js";
import {
  fmtAltAz,
  fmtHours,
  fmtTime,
  moonPhaseName,
  TIME_SCALES,
} from "./astro.js";

export function bindUI() {
  return {
    loader: document.getElementById("loader"),
    loaderText: document.getElementById("loader-text"),
    card: document.getElementById("card"),
    kind: document.getElementById("card-kind"),
    title: document.getElementById("card-title"),
    sub: document.getElementById("card-sub"),
    stats: document.getElementById("card-stats"),
    fact: document.getElementById("card-fact"),
    local: document.getElementById("clk-local"),
    utc: document.getElementById("clk-utc"),
    sidereal: document.getElementById("clk-sidereal"),
    sun: document.getElementById("clk-sun"),
    moon: document.getElementById("clk-moon"),
    search: document.getElementById("search"),
    results: document.getElementById("search-results"),
    timescale: document.getElementById("timescale"),
    timescaleLabel: document.getElementById("timescale-label"),
    btnIn: document.getElementById("btn-in"),
    btnOut: document.getElementById("btn-out"),
    btnCa: document.getElementById("btn-ca"),
    btnReset: document.getElementById("btn-reset"),
  };
}

export function setLoader(ui, text) {
  if (text) ui.loaderText.textContent = text;
}

export function hideLoader(ui) {
  ui.loader.classList.add("gone");
  setTimeout(() => ui.loader.remove(), 600);
}

export function renderClock(ui, astro) {
  ui.local.textContent = fmtTime(astro.date, "Asia/Tashkent");
  ui.utc.textContent = fmtTime(astro.date, "UTC");
  ui.sidereal.textContent = fmtHours(astro.gmst);
  ui.sun.textContent = fmtAltAz(astro.sunAlt, astro.sunAz);
  ui.moon.textContent = `${Math.round(astro.moonPhase * 100)}% · ${moonPhaseName(astro.moonPhase)}`;
}

const KIND_RU = { country: "страна", adm1: "область / регион", adm2: "район" };
const ISO_RU = { KAZ: "Казахстан", UZB: "Узбекистан", TJK: "Таджикистан" };

export function showCard(ui, data) {
  if (!data) {
    ui.card.hidden = true;
    return;
  }
  ui.card.hidden = false;
  ui.kind.textContent = KIND_RU[data.kind] || data.kind;
  ui.title.textContent = data.name;
  const bits = [];
  if (data.nameEn && data.nameEn !== data.name) bits.push(data.nameEn);
  if (data.iso && data.kind !== "country") bits.push(ISO_RU[data.iso] || data.iso);
  if (data.iso && data.kind === "country") bits.push(data.iso);
  ui.sub.textContent = bits.join(" · ");

  const extra = data.extra || {};
  const pop = extra.pop || data.pop;
  const area = data.areaKm2;
  const rows = [
    ["население", pop ? fmtInt(pop) : "—"],
    ["площадь", fmtKm2(area)],
    ["плотность", density(pop, area)],
  ];
  if (extra.capital) rows.push(["столица / центр", extra.capital]);
  if (extra.languages) rows.push(["языки", extra.languages]);
  if (extra.medianAge) rows.push(["медианный возраст", extra.medianAge]);
  if (extra.fertility) rows.push(["суммарная рождаемость", extra.fertility]);
  if (extra.urban) rows.push(["городское население", extra.urban]);
  if (data.gdpMd) rows.push(["ВВП", `${fmtInt(data.gdpMd)} млн $`]);
  if (data.economy) rows.push(["экономика", String(data.economy).replace(/^\d+\.\s*/, "")]);
  if (data.subregion) rows.push(["регион", data.subregion]);

  ui.stats.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
  ui.fact.textContent =
    extra.fact ||
    (data.kind === "adm2"
      ? "Районный уровень: площадь посчитана по границе geoBoundaries, население — если есть в карточке родителя."
      : "");
}

export function bindSearch(ui, index, onPick) {
  let active = -1;
  const render = (q) => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) {
      ui.results.hidden = true;
      ui.results.innerHTML = "";
      return;
    }
    const hits = index.filter((r) => r.q.includes(s)).slice(0, 12);
    ui.results.hidden = hits.length === 0;
    ui.results.innerHTML = hits
      .map(
        (r, i) =>
          `<li data-i="${i}" class="${i === 0 ? "active" : ""}">${r.title}<small>${r.sub}</small></li>`
      )
      .join("");
    ui.results._hits = hits;
    active = 0;
  };
  ui.search.addEventListener("input", () => render(ui.search.value));
  ui.search.addEventListener("keydown", (e) => {
    const hits = ui.results._hits || [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(hits.length - 1, active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active]);
      ui.results.hidden = true;
      return;
    } else return;
    [...ui.results.children].forEach((li, i) => li.classList.toggle("active", i === active));
  });
  ui.results.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const hits = ui.results._hits || [];
    const row = hits[Number(li.dataset.i)];
    if (row) onPick(row);
    ui.results.hidden = true;
  });
}

export function bindTimeScale(ui, onChange) {
  const apply = () => {
    const i = Number(ui.timescale.value);
    ui.timescaleLabel.textContent = TIME_SCALES[i].label;
    onChange(TIME_SCALES[i].factor);
  };
  ui.timescale.addEventListener("input", apply);
  apply();
}
