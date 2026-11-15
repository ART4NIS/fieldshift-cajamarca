"""Sample Copernicus DEM 90 m on the selectable-area lattice for all of Peru.

Writes .cache/elev_points.json ("lat,lon" -> metres), the same cache that
scripts/build_selectable_area.mjs reads, so the whole-sierra area is built without
any Open-Meteo request.

Tiles are the public Copernicus GLO-90 COGs on AWS (no account, no quota). Each
1 x 1 degree tile is read remotely at its 4x overview (~360 m pixels, averaged),
so only a few hundred KB per tile are transferred. Ocean tiles do not exist and
their lattice points are stored as 0 m.

Usage:
    python scripts/build_dem_grid.py [--spacing 0.05]
"""

from __future__ import annotations

import argparse
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.errors import RasterioIOError
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "elev_points.json"
TILE_URL = ("/vsicurl/https://copernicus-dem-90m.s3.amazonaws.com/"
            "Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
            "Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
BOUNDARY = ROOT / "data" / "peru_boundary.geojson"
OVERVIEW = 4  # read 1200 px tiles as 300 px


def tile_url(lat0: int, lon0: int) -> str:
    """Tile whose south-west corner is (lat0, lon0)."""
    return TILE_URL.format(ns="S" if lat0 < 0 else "N", lat=abs(lat0),
                           ew="W" if lon0 < 0 else "E", lon=abs(lon0))


def js_num(x: float) -> str:
    """Format like JavaScript's String(number) for these values: -13.0 -> "-13", -0.0 -> "0"."""
    x = round(x, 4) + 0.0
    return str(int(x)) if x == int(x) else repr(x)


def lattice(lo: float, hi: float, step: float) -> list[str]:
    """Multiples of `step` in [lo, hi), formatted like the .mjs cache keys."""
    k0, k1 = math.ceil(lo / step - 1e-9), math.ceil(hi / step - 1e-9)
    return [js_num(k * step) for k in range(k0, k1)]


def sample_tile(lat0: int, lon0: int, step: float) -> dict[str, float]:
    lats = lattice(lat0, lat0 + 1, step)
    lons = lattice(lon0, lon0 + 1, step)
    try:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(tile_url(lat0, lon0)) as ds:
                size = ds.height // OVERVIEW
                arr = ds.read(1, out_shape=(size, size), resampling=Resampling.average)
                left, top = ds.bounds.left, ds.bounds.top
                res = (ds.bounds.right - left) / size
    except RasterioIOError:  # no tile: open ocean
        return {f"{a},{b}": 0.0 for a in lats for b in lons}
    out = {}
    for a in lats:
        row = min(size - 1, max(0, int((top - float(a)) / res)))
        for b in lons:
            col = min(size - 1, max(0, int((float(b) - left) / res)))
            v = float(arr[row, col])
            out[f"{a},{b}"] = round(v, 1) if np.isfinite(v) and v > -1000 else 0.0
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spacing", type=float, default=0.05, help="lattice step in degrees")
    args = parser.parse_args()

    # Bounding box of the boundary (it includes territorial sea), rounded out to whole-degree tile edges.
    ring = json.loads(BOUNDARY.read_text(encoding="utf-8"))["features"][0]["geometry"]["coordinates"][0]
    south = math.floor(min(y for _, y in ring) - args.spacing)
    north = math.ceil(max(y for _, y in ring) + args.spacing)
    west = math.floor(min(x for x, _ in ring) - args.spacing)
    east = math.ceil(max(x for x, _ in ring) + args.spacing)
    tiles = [(a, b) for a in range(south, north) for b in range(west, east)]
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    # Drop keys written by an earlier version in Python float style ("-13.0"); the .mjs never reads them.
    cache = {k: v for k, v in cache.items() if not any(p.endswith(".0") for p in k.split(","))}
    before = len(cache)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, part in enumerate(pool.map(lambda t: sample_tile(*t, args.spacing), tiles), 1):
            cache.update(part)
            if i % 20 == 0 or i == len(tiles):
                print(f"{i}/{len(tiles)} tiles", flush=True)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    print(f"cache: {before} -> {len(cache)} points")


if __name__ == "__main__":
    main()
