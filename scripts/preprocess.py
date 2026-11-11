#!/usr/bin/env python3
"""Slim GeoJSON, compute centroids/area, paint an equatorial star map."""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "public"
GEO = PUB / "geo"
DATA = PUB / "data"
TEX = PUB / "textures"

COUNTRY_KEEP = [
    "NAME",
    "NAME_RU",
    "NAME_EN",
    "ADMIN",
    "ISO_A3",
    "ISO_A2",
    "ISO_A2_EH",
    "POP_EST",
    "GDP_MD",
    "POP_YEAR",
    "GDP_YEAR",
    "ECONOMY",
    "INCOME_GRP",
    "SUBREGION",
    "CONTINENT",
    "LABEL_X",
    "LABEL_Y",
    "TYPE",
]


def rings_of(geom: dict) -> list[list[list[float]]]:
    t = geom.get("type")
    c = geom.get("coordinates") or []
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    return []


def densify_ring(ring: list, max_deg: float = 1.4) -> list:
    if not ring:
        return ring
    out = []
    n = len(ring)
    # drop closing duplicate if present
    if n > 1 and ring[0] == ring[-1]:
        n -= 1
    for i in range(n):
        a = ring[i]
        b = ring[(i + 1) % n]
        out.append([float(a[0]), float(a[1])])
        dlon = b[0] - a[0]
        if dlon > 180:
            dlon -= 360
        if dlon < -180:
            dlon += 360
        dlat = b[1] - a[1]
        dist = math.hypot(dlon, dlat)
        steps = int(math.ceil(dist / max_deg))
        for k in range(1, steps):
            t = k / steps
            lon = a[0] + dlon * t
            if lon > 180:
                lon -= 360
            if lon < -180:
                lon += 360
            out.append([lon, a[1] + dlat * t])
    return out


def centroid_and_area(geom: dict) -> tuple[float, float, float]:
    """Return lon, lat, area_km2 using spherical excess on outer rings."""
    R = 6371.0088
    best = (0.0, 0.0, 0.0)
    total_area = 0.0
    acc_lon = acc_lat = acc_w = 0.0
    for poly in rings_of(geom):
        if not poly:
            continue
        outer = poly[0]
        pts = [(p[0] * math.pi / 180.0, p[1] * math.pi / 180.0) for p in outer]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        # spherical excess
        n = len(pts)
        excess = 0.0
        clat = clon = 0.0
        for i in range(n):
            lon1, lat1 = pts[i - 1]
            lon2, lat2 = pts[i]
            dlon = lon2 - lon1
            excess += 2 * math.atan2(
                math.tan(dlon / 2) * math.sin((lat1 + lat2) / 2),
                math.cos((lat2 - lat1) / 2),
            )
            clon += (pts[i][0] + pts[i - 1][0]) / 2
            clat += (pts[i][1] + pts[i - 1][1]) / 2
        area = abs(excess) * R * R
        total_area += area
        w = max(area, 1.0)
        acc_lon += (clon / n) * 180 / math.pi * w
        acc_lat += (clat / n) * 180 / math.pi * w
        acc_w += w
    if acc_w:
        lon = acc_lon / acc_w
        if lon > 180:
            lon -= 360
        if lon < -180:
            lon += 360
        return lon, acc_lat / acc_w, total_area
    return best


def slim_countries():
    src = json.loads((GEO / "countries-50m.geojson").read_text())
    out_feats = []
    meta = {}
    for f in src["features"]:
        p = f.get("properties") or {}
        iso = p.get("ISO_A3") or p.get("ADM0_A3")
        if not iso or iso in ("-99", "ATA"):
            # keep Antarctica out of picking but draw borders later if wanted
            if iso != "ATA":
                continue
        props = {k: p.get(k) for k in COUNTRY_KEEP}
        if not props.get("ISO_A2") or props["ISO_A2"] == "-99":
            props["ISO_A2"] = p.get("ISO_A2_EH") or ""
        lon, lat, area = centroid_and_area(f["geometry"])
        if p.get("LABEL_X") is not None:
            lon, lat = float(p["LABEL_X"]), float(p["LABEL_Y"])
        props["CEN_LON"] = round(lon, 4)
        props["CEN_LAT"] = round(lat, 4)
        props["AREA_KM2"] = round(area, 1)
        out_feats.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})
        meta[iso] = {
            "iso2": props.get("ISO_A2"),
            "name": props.get("NAME"),
            "nameRu": props.get("NAME_RU"),
            "nameEn": props.get("NAME_EN"),
            "admin": props.get("ADMIN"),
            "pop": props.get("POP_EST"),
            "gdpMd": props.get("GDP_MD"),
            "popYear": props.get("POP_YEAR"),
            "gdpYear": props.get("GDP_YEAR"),
            "economy": props.get("ECONOMY"),
            "income": props.get("INCOME_GRP"),
            "subregion": props.get("SUBREGION"),
            "continent": props.get("CONTINENT"),
            "lon": props["CEN_LON"],
            "lat": props["CEN_LAT"],
            "areaKm2": props["AREA_KM2"],
        }
    out = {"type": "FeatureCollection", "features": out_feats}
    (GEO / "countries.min.geojson").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return meta


def slim_admin(files: list[tuple[str, str]], level: str):
    feats = []
    meta = []
    for iso, path in files:
        src = json.loads(Path(path).read_text())
        for f in src["features"]:
            p = f.get("properties") or {}
            name = p.get("shapeName") or ""
            lon, lat, area = centroid_and_area(f["geometry"])
            props = {
                "name": name,
                "iso": iso,
                "shapeISO": p.get("shapeISO") or "",
                "shapeID": p.get("shapeID") or "",
                "level": level,
                "lon": round(lon, 4),
                "lat": round(lat, 4),
                "areaKm2": round(area, 1),
            }
            geom = f["geometry"]
            # light densify not stored — runtime densifies outlines
            feats.append({"type": "Feature", "properties": props, "geometry": geom})
            meta.append(props)
    out = {"type": "FeatureCollection", "features": feats}
    (GEO / f"ca-{level}.min.geojson").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    )
    return meta


def galactic_b(ra_deg: float, dec_deg: float) -> float:
    a_ngp = math.radians(192.85948)
    d_ngp = math.radians(27.12825)
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    sinb = math.sin(dec) * math.sin(d_ngp) + math.cos(dec) * math.cos(d_ngp) * math.cos(
        ra - a_ngp
    )
    sinb = max(-1.0, min(1.0, sinb))
    return math.degrees(math.asin(sinb))


def galactic_l(ra_deg: float, dec_deg: float) -> float:
    a_ngp = math.radians(192.85948)
    d_ngp = math.radians(27.12825)
    l_ncp = math.radians(122.93192)
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    cosb_sin_dl = math.cos(dec) * math.sin(ra - a_ngp)
    cosb_cos_dl = math.sin(dec) * math.cos(d_ngp) - math.cos(dec) * math.sin(d_ngp) * math.cos(
        ra - a_ngp
    )
    l = l_ncp - math.atan2(cosb_sin_dl, cosb_cos_dl)
    return math.degrees(l) % 360


def paint_starmap(path: Path, w: int = 2048, h: int = 1024):
    rnd = random.Random(42)
    px = bytearray(w * h * 3)
    # milky way band + bulge at galactic center (RA 266.4, Dec -28.94)
    for y in range(h):
        dec = 90.0 - (y + 0.5) / h * 180.0
        for x in range(w):
            ra = (x + 0.5) / w * 360.0
            b = galactic_b(ra, dec)
            l = galactic_l(ra, dec)
            # distance along plane from galactic center (l=0)
            dl = min(abs(l), abs(l - 360))
            band = math.exp(-((b / 9.5) ** 2))
            bulge = math.exp(-((dl / 38.0) ** 2)) * math.exp(-((b / 7.0) ** 2))
            dust = 0.55 + 0.45 * math.sin(math.radians(l * 3.0 + b * 0.4))
            # faint blue airglow
            r = 4 + 10 * band * dust + 28 * bulge
            g = 5 + 12 * band * dust + 22 * bulge
            bch = 10 + 18 * band + 16 * bulge
            # dark dust lane
            if abs(b) < 2.2 and 330 < l or l < 40:
                r *= 0.45
                g *= 0.4
                bch *= 0.5
            i = (y * w + x) * 3
            px[i] = int(min(255, r))
            px[i + 1] = int(min(255, g))
            px[i + 2] = int(min(255, bch))
    # stars
    n_stars = 14000
    for _ in range(n_stars):
        # more stars in the band
        ra = rnd.random() * 360.0
        # sinusoidal density in dec
        dec = math.degrees(math.asin(rnd.random() * 2 - 1))
        if rnd.random() < 0.55:
            # reject far from plane sometimes
            if abs(galactic_b(ra, dec)) > 18 and rnd.random() < 0.7:
                continue
        mag = rnd.expovariate(0.55)
        mag = min(mag, 7.5)
        bright = max(0.15, 1.15 * (10 ** (-0.32 * mag)))
        x = int(ra / 360.0 * w) % w
        y = int((90.0 - dec) / 180.0 * h)
        y = max(0, min(h - 1, y))
        # spectral
        t = rnd.random()
        if t < 0.15:
            col = (180, 200, 255)
        elif t < 0.55:
            col = (255, 248, 240)
        elif t < 0.85:
            col = (255, 214, 170)
        else:
            col = (255, 170, 140)
        rad = 1 if mag > 2.2 else 2
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy > rad * rad:
                    continue
                xx = (x + dx) % w
                yy = max(0, min(h - 1, y + dy))
                fall = 1.0 / (1.0 + dx * dx + dy * dy)
                i = (yy * w + xx) * 3
                px[i] = min(255, int(px[i] + col[0] * bright * fall))
                px[i + 1] = min(255, int(px[i + 1] + col[1] * bright * fall))
                px[i + 2] = min(255, int(px[i + 2] + col[2] * bright * fall))
    img = Image.frombytes("RGB", (w, h), bytes(px))
    img = img.filter(ImageFilter.GaussianBlur(radius=0.45))
    img.save(path, "JPEG", quality=88, optimize=True)


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    TEX.mkdir(parents=True, exist_ok=True)
    countries = slim_countries()
    adm1 = slim_admin(
        [
            ("KAZ", GEO / "kaz-adm1.geojson"),
            ("UZB", GEO / "uzb-adm1.geojson"),
            ("TJK", GEO / "tjk-adm1.geojson"),
        ],
        "adm1",
    )
    adm2 = slim_admin(
        [
            ("KAZ", GEO / "kaz-adm2.geojson"),
            ("UZB", GEO / "uzb-adm2.geojson"),
            ("TJK", GEO / "tjk-adm2.geojson"),
        ],
        "adm2",
    )
    meta = {"countries": countries, "adm1": adm1, "adm2": adm2}
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    paint_starmap(TEX / "starmap.jpg")
    print(
        "countries",
        len(countries),
        "adm1",
        len(adm1),
        "adm2",
        len(adm2),
        "starmap",
        (TEX / "starmap.jpg").stat().st_size,
    )
    for p in [
        GEO / "countries.min.geojson",
        GEO / "ca-adm1.min.geojson",
        GEO / "ca-adm2.min.geojson",
        DATA / "meta.json",
        TEX / "starmap.jpg",
    ]:
        print(p.name, f"{p.stat().st_size/1024:.1f} KiB")


if __name__ == "__main__":
    main()
