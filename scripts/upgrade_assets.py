#!/usr/bin/env python3
"""Convert NASA sky + Earth textures and slim worldwide ADM1/cities."""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
PUB = ROOT / "public"
GEO = PUB / "geo"
TEX = PUB / "textures"
DATA = PUB / "data"

CA = {"KAZ", "UZB", "TJK"}


def pick_image(*names: str) -> Path | None:
    """First readable candidate wins — callers pass sources in preference order."""
    for name in names:
        p = CACHE / name
        if not p.exists() or p.stat().st_size < 1000:
            continue
        try:
            im = Image.open(p)
            im.load()
        except Exception:
            continue
        return p
    return None


def save_jpeg(im: Image.Image, dest: Path, size: tuple[int, int], quality: int = 88) -> None:
    im = im.convert("RGB")
    if im.size != size:
        im = im.resize(size, Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=quality, optimize=True, subsampling=1)


def convert_starmap() -> None:
    src = pick_image("starmap_nasa.jpg", "starmap_nasa_8k.jpg", "starmap_7680.jpg")
    if not src:
        raise SystemExit("no NASA starmap in .cache")
    im = Image.open(src).convert("RGB")
    # NASA SVS 4851 celestial: RA grows to the left. Flip so RA grows with +u,
    # matching Three.js SphereGeometry (u=0.5 → RA 0h / +X).
    im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Brightness(im).enhance(1.18)
    w = min(4096, im.size[0])
    h = w // 2
    save_jpeg(im, TEX / "starmap.jpg", (w, h), quality=90)
    print("starmap", im.size, "→", (w, h), f"{(TEX / 'starmap.jpg').stat().st_size / 1024:.0f} KiB")


def convert_earth() -> None:
    # SSS day has real oceans; three-globe Blue Marble paints bathymetry and looks flat.
    day = pick_image("earth_day_wm.jpg", "earth_day_globe.jpg", "earth_day_three.jpg")
    night = pick_image("earth_night_globe.jpg", "earth_night_wm.jpg", "earth_night_three.png")
    clouds = pick_image("earth_clouds_wm.jpg", "earth_clouds_three.png")
    if not day:
        raise SystemExit("no day map")
    dim = Image.open(day).convert("RGB")
    dim = ImageEnhance.Color(dim).enhance(1.12)
    dim = ImageEnhance.Contrast(dim).enhance(1.08)
    dim = dim.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))
    save_jpeg(dim, TEX / "earth_blue.jpg", (4096, 2048), quality=87)
    print("day", day.name, f"{(TEX / 'earth_blue.jpg').stat().st_size / 1024:.0f} KiB")

    if night:
        nim = Image.open(night).convert("RGB")
        nim = ImageEnhance.Brightness(nim).enhance(1.25)
        nim = ImageEnhance.Contrast(nim).enhance(1.15)
        save_jpeg(nim, TEX / "earth_night2.jpg", (4096, 2048), quality=86)
        print("night", night.name, f"{(TEX / 'earth_night2.jpg').stat().st_size / 1024:.0f} KiB")

    if clouds:
        cim = Image.open(clouds)
        if cim.mode not in ("L", "LA"):
            cim = cim.convert("L")
        else:
            cim = cim.convert("L")
        save_jpeg(cim.convert("RGB"), TEX / "earth_clouds.jpg", (2048, 1024), quality=85)
        print("clouds", clouds.name, f"{(TEX / 'earth_clouds.jpg').stat().st_size / 1024:.0f} KiB")


def perp_dist(p, a, b) -> float:
    x, y = p[0] - a[0], p[1] - a[1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    lab = math.hypot(dx, dy) or 1e-12
    return abs(x * dy - y * dx) / lab


def rdp(points: list, epsilon: float) -> list:
    n = len(points)
    if n < 5:
        return points
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        maxd = -1.0
        idx = i
        a, b = points[i], points[j]
        for k in range(i + 1, j):
            d = perp_dist(points[k], a, b)
            if d > maxd:
                maxd = d
                idx = k
        if maxd > epsilon:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    out = [p for p, k in zip(points, keep) if k]
    return out if len(out) >= 4 else points[:4]


def close_ring(ring: list) -> list:
    if not ring:
        return ring
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return ring


def simplify_ring(ring: list, epsilon: float) -> list:
    if not ring or len(ring) < 4:
        return ring
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    pts = [[float(p[0]), float(p[1])] for p in pts]
    simp = rdp(pts, epsilon)
    return close_ring(simp)


def simplify_geom(geom: dict, epsilon: float) -> dict | None:
    t = geom.get("type")
    if t == "Polygon":
        rings = []
        for i, ring in enumerate(geom.get("coordinates") or []):
            s = simplify_ring(ring, epsilon if i == 0 else epsilon * 1.4)
            if len(s) >= 4:
                rings.append(s)
        if not rings:
            return None
        return {"type": "Polygon", "coordinates": rings}
    if t == "MultiPolygon":
        polys = []
        for poly in geom.get("coordinates") or []:
            rings = []
            for i, ring in enumerate(poly):
                s = simplify_ring(ring, epsilon if i == 0 else epsilon * 1.4)
                if len(s) >= 4:
                    rings.append(s)
            if rings:
                polys.append(rings)
        if not polys:
            return None
        if len(polys) == 1:
            return {"type": "Polygon", "coordinates": polys[0]}
        return {"type": "MultiPolygon", "coordinates": polys}
    return None


def bbox_of(geom: dict) -> list[float]:
    minx = miny = 1e9
    maxx = maxy = -1e9
    coords = geom.get("coordinates") or []

    def walk(node):
        nonlocal minx, miny, maxx, maxy
        if not node:
            return
        if isinstance(node[0], (int, float)):
            x, y = float(node[0]), float(node[1])
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)
            return
        for c in node:
            walk(c)

    walk(coords)
    if minx > maxx:
        return [-180, -90, 180, 90]
    return [round(minx, 3), round(miny, 3), round(maxx, 3), round(maxy, 3)]


def epsilon_for(area: float) -> float:
    if area >= 800_000:
        return 0.16
    if area >= 80_000:
        return 0.09
    if area >= 8_000:
        return 0.05
    if area >= 800:
        return 0.03
    return 0.018


def slim_world_adm1() -> int:
    src = json.loads((CACHE / "ne_admin1.geojson").read_text())
    ca_src = json.loads((GEO / "ca-adm1.min.geojson").read_text())
    feats = []
    for f in ca_src["features"]:
        p = f["properties"]
        p["detail"] = "ca"
        p["bbox"] = bbox_of(f["geometry"])
        if not p.get("nameRu"):
            p["nameRu"] = p.get("name")
        feats.append(f)
    skipped = 0
    for f in src["features"]:
        p = f.get("properties") or {}
        iso = p.get("adm0_a3") or ""
        if iso in CA or iso in ("ATA", "-99", ""):
            continue
        area = float(p.get("area_sqkm") or 0)
        geom = simplify_geom(f["geometry"], epsilon_for(area))
        if not geom:
            skipped += 1
            continue
        name = p.get("name") or ""
        props = {
            "name": name,
            "nameEn": p.get("name_en") or name,
            "nameRu": p.get("name_ru") or name,
            "iso": iso,
            "iso2": p.get("iso_a2") or "",
            "type": p.get("type_en") or p.get("type") or "",
            "admin": p.get("admin") or "",
            "lon": round(float(p.get("longitude") or 0), 4),
            "lat": round(float(p.get("latitude") or 0), 4),
            "areaKm2": round(area, 1) if area else None,
            "labelrank": int(p.get("labelrank") or 99),
            "level": "adm1",
            "detail": "ne",
        }
        props["bbox"] = bbox_of(geom)
        feats.append({"type": "Feature", "properties": props, "geometry": geom})
    out = {"type": "FeatureCollection", "features": feats}
    dest = GEO / "world-adm1.min.geojson"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print("world-adm1", len(feats), "skipped", skipped, f"{dest.stat().st_size / 1024:.0f} KiB")
    return len(feats)


def slim_cities() -> int:
    src = json.loads((CACHE / "ne_places.geojson").read_text())
    rows = []
    for f in src["features"]:
        p = f.get("properties") or {}
        iso = p.get("ADM0_A3") or ""
        if iso in ("ATA", "-99", ""):
            continue
        pop = int(p.get("POP_MAX") or 0)
        rank = int(p.get("SCALERANK") or 99)
        feat = p.get("FEATURECLA") or ""
        cap = 0
        if "Admin-0" in feat and "capital" in feat.lower():
            cap = 2
        elif p.get("ADM0CAP") in (1, True) or feat == "Admin-0 capital":
            cap = 2
        elif "Admin-1" in feat:
            cap = 1
        keep = (
            pop >= 80_000
            or rank <= 6
            or cap == 2
            or (iso in CA and (pop >= 30_000 or rank <= 8 or cap))
        )
        if not keep:
            continue
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or [p.get("LONGITUDE"), p.get("LATITUDE")]
        lon = float(coords[0] if coords else p.get("LONGITUDE") or 0)
        lat = float(coords[1] if coords and len(coords) > 1 else p.get("LATITUDE") or 0)
        name = p.get("NAME_RU") or p.get("NAME") or ""
        rows.append(
            {
                "name": name,
                "nameEn": p.get("NAME") or p.get("NAMEASCII") or name,
                "iso": iso,
                "adm1": p.get("ADM1NAME") or "",
                "pop": pop or None,
                "lon": round(lon, 4),
                "lat": round(lat, 4),
                "rank": rank,
                "cap": cap,
                "tz": p.get("TIMEZONE") or "",
                "feat": feat,
            }
        )
    rows.sort(key=lambda r: (-(r["pop"] or 0), r["rank"]))
    dest = GEO / "world-cities.min.json"
    dest.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    print("cities", len(rows), f"{dest.stat().st_size / 1024:.0f} KiB")
    return len(rows)


def main() -> None:
    TEX.mkdir(parents=True, exist_ok=True)
    GEO.mkdir(parents=True, exist_ok=True)
    convert_starmap()
    convert_earth()
    n1 = slim_world_adm1()
    n2 = slim_cities()
    print("done adm1", n1, "cities", n2)


if __name__ == "__main__":
    main()
