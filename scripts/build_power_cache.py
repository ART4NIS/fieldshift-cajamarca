"""Save NASA POWER monthly responses for pilot sites as an offline fallback.

js/api.js reads data/power_cache/<pilot>.json when the live POWER API fails, so the demo
keeps working without NASA POWER. The request matches buildPowerUrl() in js/api.js.

Usage:
    python scripts/build_power_cache.py              # every pilot in data/pilots_index.json
    python scripts/build_power_cache.py --pilot puno
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "pilots_index.json"
CACHE_DIR = ROOT / "data" / "power_cache"


def fetch(lat: float, lon: float, start: int = 1991, end: int = 2024) -> dict:
    query = urllib.parse.urlencode(
        {
            "parameters": "T2M,T2M_MIN,PRECTOTCORR",
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": start,
            "end": end,
            "format": "JSON",
        }
    )
    request = urllib.request.Request(
        f"{POWER_MONTHLY_URL}?{query}", headers={"User-Agent": "fieldshift-preprocess"}
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pilot", help="only this pilot id")
    args = parser.parse_args()

    pilots = json.loads(INDEX.read_text(encoding="utf-8"))["pilotos"]
    if args.pilot:
        pilots = [p for p in pilots if p["id"] == args.pilot]
        if not pilots:
            raise SystemExit(f"Pilot '{args.pilot}' not found in {INDEX.relative_to(ROOT)}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for pilot in pilots:
        body = fetch(pilot["lat"], pilot["lon"])
        # Keep only what api.js needs: geometry (cell elevation), parameters and the header.
        slim = {
            "geometry": body["geometry"],
            "properties": body["properties"],
            "header": body.get("header", {}),
        }
        out = CACHE_DIR / f"{pilot['id']}.json"
        out.write_text(json.dumps(slim, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"Wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
