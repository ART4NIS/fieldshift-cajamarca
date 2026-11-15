"""Convert the AppEEARS SRTM GeoTIFFs into small binary grids the browser can read.

For each pilot area in data/requests/appeears_srtm_areas.geojson, finds the GeoTIFF that covers it and writes:
    data/srtm/<pilot>.bin   elevation in meters, Int16 little-endian, row-major from north-west
    data/srtm/index.json    { pilot: { west, east, south, north, width, height, res_deg, file } }
js/api.js uses them to compute the 30 m slope at a clicked point inside a pilot area.

Usage (needs numpy and rasterio, see scripts/requirements.txt):
    python scripts/build_srtm_grids.py --input raw/appeears
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS_GEOJSON = ROOT / "data" / "requests" / "appeears_srtm_areas.geojson"
OUT_DIR = ROOT / "data" / "srtm"
NODATA = -32768


def load_areas() -> dict[str, tuple[float, float, float, float]]:
    areas = {}
    for feature in json.loads(AREAS_GEOJSON.read_text(encoding="utf-8"))["features"]:
        ring = feature["geometry"]["coordinates"][0]
        lons, lats = [p[0] for p in ring], [p[1] for p in ring]
        areas[feature["properties"]["id"]] = (min(lons), min(lats), max(lons), max(lats))
    return areas


def main() -> None:
    import numpy as np
    import rasterio

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=ROOT / "raw" / "appeears")
    args = parser.parse_args()
    tifs = sorted(p for p in args.input.rglob("*.tif") if "SRTMGL1_DEM" in p.name)
    if not tifs:
        raise SystemExit(f"No SRTMGL1_DEM GeoTIFF found in {args.input}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = {}
    for pilot, (min_lon, min_lat, max_lon, max_lat) in load_areas().items():
        center = ((min_lon + max_lon) / 2, (min_lat + max_lat) / 2)
        for tif in tifs:
            with rasterio.open(tif) as src:
                b = src.bounds
                if not (b.left <= center[0] <= b.right and b.bottom <= center[1] <= b.top):
                    continue
                if src.crs and not src.crs.is_geographic:
                    raise SystemExit(f"{tif.name}: expected a geographic (lat/lon) GeoTIFF, got {src.crs}")
                dem = src.read(1, masked=True)
                grid = dem.filled(NODATA).astype("<i2")
                res_x, res_y = src.res
                bounds = b
            (OUT_DIR / f"{pilot}.bin").write_bytes(grid.tobytes())
            index[pilot] = {
                "west": round(bounds.left, 7),
                "east": round(bounds.right, 7),
                "south": round(bounds.bottom, 7),
                "north": round(bounds.top, 7),
                "width": int(grid.shape[1]),
                "height": int(grid.shape[0]),
                "res_deg": round(float(res_x), 10),
                "nodata": NODATA,
                "file": f"data/srtm/{pilot}.bin",
            }
            valid = grid[grid != NODATA]
            print(f"  {pilot}: {grid.shape[1]}x{grid.shape[0]} from {tif.name}, elevation {valid.min()}-{valid.max()} m")
            if abs(res_x - res_y) > 1e-9:
                raise SystemExit(f"{tif.name}: non-square pixels are not supported")
            break
        else:
            print(f"  {pilot}: no GeoTIFF covers this area")

    meta = {
        "_meta": {
            "fuente": "SRTM SRTMGL1_NC.003 (30 m, Feb 2000) via NASA AppEEARS",
            "formato": "Int16 little-endian, row-major from the north-west corner; nodata = -32768",
        },
        "areas": index,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(index)} grids to {OUT_DIR}")


if __name__ == "__main__":
    main()
