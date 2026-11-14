"""Process AppEEARS outputs (MODIS NDVI, SMAP soil moisture, SRTM elevation) into pilot JSON.

Expected input (download every file of both AppEEARS requests into one folder):
    raw/appeears/
        fieldshift-ndvi-smap-MOD13Q1-061-results.csv      (point sample, NDVI)
        fieldshift-ndvi-smap-SPL3SMP-E-006-results.csv    (point sample, SMAP)
        SRTMGL1_NC.003_SRTMGL1_DEM_*.tif                  (area sample, GeoTIFF)
File names may differ: CSVs are recognised by their columns, GeoTIFFs by "SRTMGL1_DEM".

Output: merged into data/pilots/<id>.json under the keys "ndvi", "soil_moisture" and
"terrain" (other keys such as "climate_bias" are preserved).

Usage:
    pip install -r scripts/requirements.txt
    python scripts/process_appeears.py                  # reads raw/appeears/
    python scripts/process_appeears.py --input path/to/folder
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS_GEOJSON = ROOT / "data" / "requests" / "appeears_srtm_areas.geojson"

NDVI_LAYER = "_250m_16_days_ndvi"
NDVI_RELIABILITY_LAYER = "_250m_16_days_pixel_reliability"
SMAP_LAYER = "soil_moisture_retrieval_data_am_soil_moisture"
SMAP_QUAL_LAYER = "soil_moisture_retrieval_data_am_retrieval_qual_flag"

# MOD13Q1 pixel reliability: 0 = good, 1 = marginal, 2 = snow/ice, 3 = cloudy, -1 = fill.
NDVI_GOOD_RELIABILITY = {0, 1}
NDVI_VALID_RANGE = (-0.2, 1.0)
# SPL3SMP_E retrieval_qual_flag bit 0 = 0 means "retrieval recommended".
SMAP_RECOMMENDED_BIT = 1
SMAP_VALID_RANGE = (0.0, 0.7)
# Slope class used by the erosion rule and in the evidence cards.
STEEP_SLOPE_PCT = 25.0
METERS_PER_DEG_LAT = 110_540.0
METERS_PER_DEG_LON_EQUATOR = 111_320.0


# ---------------------------------------------------------------- CSV helpers

def find_column(header: list[str], layer: str) -> str | None:
    """AppEEARS names columns <PRODUCT>_<VERSION>_<layer>; match on the layer suffix."""
    for name in header:
        if name.lower().endswith(layer):
            return name
    return None


def read_rows(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), list(reader)


def to_float(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def linear_trend_per_year(points: list[tuple[int, float]]) -> float | None:
    if len(points) < 3:
        return None
    xs, ys = zip(*points)
    mx, my = statistics.mean(xs), statistics.mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else None


def monthly_summary(series: dict[str, list[tuple[date, float]]], digits: int) -> dict[str, dict]:
    """Per pilot: monthly climatology, annual means, trend and latest-year anomalies."""
    out: dict[str, dict] = {}
    for pilot, obs in series.items():
        if not obs:
            continue
        by_month: dict[int, list[float]] = defaultdict(list)
        by_year: dict[int, list[float]] = defaultdict(list)
        by_year_month: dict[tuple[int, int], list[float]] = defaultdict(list)
        for day, value in obs:
            by_month[day.month].append(value)
            by_year[day.year].append(value)
            by_year_month[(day.year, day.month)].append(value)

        climatology = {m: statistics.mean(v) for m, v in by_month.items()}
        annual = {y: statistics.mean(v) for y, v in sorted(by_year.items())}
        last_year = max(by_year)
        anomalies = [
            {
                "mes": m,
                "anomalia": round(statistics.mean(by_year_month[(last_year, m)]) - climatology[m], digits),
            }
            for m in range(1, 13)
            if (last_year, m) in by_year_month
        ]
        trend = linear_trend_per_year(list(annual.items()))
        out[pilot] = {
            "periodo": f"{min(by_year)}-{last_year}",
            "n_observaciones": len(obs),
            "mensual": [
                {"mes": m, "media": round(climatology[m], digits), "n": len(by_month[m])}
                for m in range(1, 13)
                if m in climatology
            ],
            "anual": [{"anio": y, "media": round(v, digits)} for y, v in annual.items()],
            "tendencia_por_anio": round(trend, digits + 2) if trend is not None else None,
            "anomalia_ultimo_anio": {"anio": last_year, "meses": anomalies},
        }
    return out


# ---------------------------------------------------------------- NDVI / SMAP

def process_ndvi(path: Path) -> dict[str, dict]:
    header, rows = read_rows(path)
    ndvi_col = find_column(header, NDVI_LAYER)
    rel_col = find_column(header, NDVI_RELIABILITY_LAYER)
    if not ndvi_col:
        raise ValueError(f"{path.name}: NDVI column not found")
    if not rel_col:
        print(f"  warning: {path.name} has no pixel_reliability column; keeping all NDVI values")

    raw = [to_float(r[ndvi_col]) for r in rows]
    # AppEEARS CSVs normally carry scaled NDVI (-0.2..1); fall back to the 0.0001 scale factor.
    scale = 0.0001 if any(v is not None and abs(v) > 1.5 for v in raw) else 1.0

    series: dict[str, list[tuple[date, float]]] = defaultdict(list)
    dropped = 0
    for row, value in zip(rows, raw):
        reliability = to_float(row[rel_col]) if rel_col else 0
        if value is None or reliability is None or int(reliability) not in NDVI_GOOD_RELIABILITY:
            dropped += 1
            continue
        value *= scale
        if not NDVI_VALID_RANGE[0] <= value <= NDVI_VALID_RANGE[1]:
            dropped += 1
            continue
        series[row["ID"]].append((date.fromisoformat(row["Date"][:10]), value))
    print(f"  NDVI: kept {sum(len(v) for v in series.values())} observations, dropped {dropped} (cloud/fill)")

    result = monthly_summary(series, digits=3)
    for block in result.values():
        block.update(
            {
                "fuente": "MODIS MOD13Q1.061 (250 m, 16 days) via NASA AppEEARS",
                "filtro": "pixel_reliability 0-1 (good/marginal)",
                "unidad": "NDVI (-1 a 1)",
            }
        )
    return result


def process_smap(path: Path) -> dict[str, dict]:
    header, rows = read_rows(path)
    sm_col = find_column(header, SMAP_LAYER)
    qual_col = find_column(header, SMAP_QUAL_LAYER)
    if not sm_col:
        raise ValueError(f"{path.name}: SMAP soil moisture column not found")
    if not qual_col:
        print(f"  warning: {path.name} has no retrieval_qual_flag column; keeping all values")

    series: dict[str, list[tuple[date, float]]] = defaultdict(list)
    dropped = 0
    for row in rows:
        value = to_float(row[sm_col])
        flag = to_float(row[qual_col]) if qual_col else 0
        if value is None or flag is None or int(flag) & SMAP_RECOMMENDED_BIT:
            dropped += 1
            continue
        if not SMAP_VALID_RANGE[0] <= value <= SMAP_VALID_RANGE[1]:
            dropped += 1
            continue
        series[row["ID"]].append((date.fromisoformat(row["Date"][:10]), value))
    print(f"  SMAP: kept {sum(len(v) for v in series.values())} observations, dropped {dropped} (quality/fill)")

    result = monthly_summary(series, digits=3)
    for block in result.values():
        block.update(
            {
                "fuente": "SMAP SPL3SMP_E.006 (9 km, AM overpass) via NASA AppEEARS",
                "filtro": "retrieval_qual_flag bit 0 = recommended",
                "unidad": "m3/m3",
            }
        )
    return result


# ---------------------------------------------------------------- SRTM

def load_areas() -> dict[str, tuple[float, float, float, float]]:
    """Pilot id -> (min_lon, min_lat, max_lon, max_lat) from the request GeoJSON."""
    areas = {}
    for feature in json.loads(AREAS_GEOJSON.read_text(encoding="utf-8"))["features"]:
        ring = feature["geometry"]["coordinates"][0]
        lons, lats = [p[0] for p in ring], [p[1] for p in ring]
        areas[feature["properties"]["id"]] = (min(lons), min(lats), max(lons), max(lats))
    return areas


def slope_percent(dem, res_x_deg: float, res_y_deg: float, lat: float):
    import numpy as np

    dx = abs(res_x_deg) * METERS_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat))
    dy = abs(res_y_deg) * METERS_PER_DEG_LAT
    gy, gx = np.gradient(dem, dy, dx)
    return np.hypot(gx, gy) * 100.0


def process_srtm(tifs: list[Path]) -> dict[str, dict]:
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds

    result = {}
    for pilot, (min_lon, min_lat, max_lon, max_lat) in load_areas().items():
        for tif in tifs:
            with rasterio.open(tif) as src:
                b = src.bounds
                if min_lon < b.left or max_lon > b.right or min_lat < b.bottom or max_lat > b.top:
                    continue
                if src.crs and not src.crs.is_geographic:
                    raise ValueError(f"{tif.name}: expected a geographic (lat/lon) GeoTIFF, got {src.crs}")
                window = from_bounds(min_lon, min_lat, max_lon, max_lat, transform=src.transform)
                dem = src.read(1, window=window, masked=True).astype("float64")
                res_x, res_y = src.res

            valid = dem.filled(np.nan)
            if np.isnan(valid).all():
                print(f"  SRTM {pilot}: {tif.name} covers the area but has no valid pixels")
                continue
            lat_center = (min_lat + max_lat) / 2
            slope = slope_percent(valid, res_x, res_y, lat_center)
            # Drop the outer ring (gradient edge effects) and any pixel touching nodata.
            slope = slope[1:-1, 1:-1]
            slope = slope[~np.isnan(slope)]
            elev = valid[~np.isnan(valid)]
            result[pilot] = {
                "fuente": "SRTM SRTMGL1_NC.003 (30 m, Feb 2000) via NASA AppEEARS",
                "area_km": round(
                    (max_lon - min_lon) * METERS_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat_center)) / 1000, 1
                ),
                "elevacion_m": {
                    "media": round(float(elev.mean())),
                    "min": round(float(elev.min())),
                    "max": round(float(elev.max())),
                },
                "pendiente_pct": {
                    "media": round(float(slope.mean()), 1),
                    "mediana": round(float(np.median(slope)), 1),
                    "p90": round(float(np.percentile(slope, 90)), 1),
                    "max": round(float(slope.max()), 1),
                },
                f"pct_area_pendiente_mayor_{int(STEEP_SLOPE_PCT)}": round(
                    float((slope > STEEP_SLOPE_PCT).mean() * 100), 1
                ),
            }
            print(f"  SRTM {pilot}: mean slope {result[pilot]['pendiente_pct']['media']} % from {tif.name}")
            break
        else:
            print(f"  SRTM {pilot}: no GeoTIFF covers this area")
    return result


# ---------------------------------------------------------------- main

def classify_csvs(folder: Path) -> tuple[list[Path], list[Path]]:
    ndvi, smap = [], []
    for path in sorted(folder.rglob("*.csv")):
        header, _ = read_rows(path) if path.stat().st_size < 200_000_000 else ([], [])
        if find_column(header, NDVI_LAYER):
            ndvi.append(path)
        elif find_column(header, SMAP_LAYER):
            smap.append(path)
    return ndvi, smap


def merge_into_pilots(sections: dict[str, dict[str, dict]]) -> list[str]:
    pilots = sorted({pid for section in sections.values() for pid in section})
    for pid in pilots:
        path = ROOT / "data" / "pilots" / f"{pid}.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"id": pid}
        for key, by_pilot in sections.items():
            if pid in by_pilot:
                data[key] = by_pilot[pid]
        data["satelital_actualizado"] = date.today().isoformat()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return pilots


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=ROOT / "raw" / "appeears")
    args = parser.parse_args()
    if not args.input.is_dir():
        raise SystemExit(f"Input folder not found: {args.input}")

    ndvi_files, smap_files = classify_csvs(args.input)
    tifs = sorted(p for p in args.input.rglob("*.tif") if "SRTMGL1_DEM" in p.name)
    print(f"Found {len(ndvi_files)} NDVI CSV, {len(smap_files)} SMAP CSV, {len(tifs)} SRTM GeoTIFF")

    sections: dict[str, dict[str, dict]] = {}
    for path in ndvi_files:
        sections.setdefault("ndvi", {}).update(process_ndvi(path))
    for path in smap_files:
        sections.setdefault("soil_moisture", {}).update(process_smap(path))
    if tifs:
        sections["terrain"] = process_srtm(tifs)

    if not any(sections.values()):
        raise SystemExit("Nothing to write: no recognisable AppEEARS outputs found")
    for pid in merge_into_pilots(sections):
        keys = [k for k, v in sections.items() if pid in v]
        print(f"Updated data/pilots/{pid}.json: {', '.join(keys)}")


if __name__ == "__main__":
    main()
