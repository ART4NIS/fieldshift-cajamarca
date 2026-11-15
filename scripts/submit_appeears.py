"""Submit the FieldShift AppEEARS requests (NDVI grid, NDVI + SMAP points, SRTM areas).

Credentials are read interactively (Earthdata username + password) and are
only sent to the AppEEARS login endpoint; nothing is stored on disk.

Usage:
    python scripts/submit_appeears.py                     # submit the NDVI grid task
    python scripts/submit_appeears.py --task srtm         # submit another task
    python scripts/submit_appeears.py --dry-run           # print the payload only
    python scripts/submit_appeears.py --status   # list your recent tasks
"""

from __future__ import annotations

import argparse
import base64
import csv
import getpass
import json
import urllib.error
import urllib.request
from pathlib import Path

API = "https://appeears.earthdatacloud.nasa.gov/api"
ROOT = Path(__file__).resolve().parent.parent
POINTS_CSV = ROOT / "data" / "requests" / "appeears_points.csv"
AREAS_GEOJSON = ROOT / "data" / "requests" / "appeears_srtm_areas.geojson"
PILOTS_INDEX = ROOT / "data" / "pilots_index.json"

# Grid offsets in degrees (0.04 deg ~ 4.4 km). The center point is skipped because
# it is the city itself; land cover decides later which points are farmland.
GRID_OFFSETS = (-0.08, -0.04, 0.0, 0.04, 0.08)
GRID_LAYERS = [
    ("MOD13Q1.061", "_250m_16_days_NDVI"),
    ("MOD13Q1.061", "_250m_16_days_pixel_reliability"),
    ("MCD12Q1.061", "LC_Type1"),
]

POINT_LAYERS = [
    ("MOD13Q1.061", "_250m_16_days_NDVI"),
    ("MOD13Q1.061", "_250m_16_days_pixel_reliability"),
    ("SPL3SMP_E.006", "Soil_Moisture_Retrieval_Data_AM_soil_moisture"),
    ("SPL3SMP_E.006", "Soil_Moisture_Retrieval_Data_AM_retrieval_qual_flag"),
]
AREA_LAYERS = [("SRTMGL1_NC.003", "SRTMGL1_DEM")]


def point_task() -> dict:
    with POINTS_CSV.open(encoding="utf-8") as fh:
        coords = [
            {
                "id": row["ID"],
                "category": row["Category"],
                "latitude": float(row["Latitude"]),
                "longitude": float(row["Longitude"]),
            }
            for row in csv.DictReader(fh)
        ]
    return {
        "task_type": "point",
        "task_name": "fieldshift-ndvi-smap",
        "params": {
            "dates": [{"startDate": "01-01-2015", "endDate": "12-31-2024"}],
            "layers": [{"product": p, "layer": l} for p, l in POINT_LAYERS],
            "coordinates": coords,
        },
    }


def grid_points() -> list[dict]:
    pilots = json.loads(PILOTS_INDEX.read_text(encoding="utf-8"))["pilotos"]
    points = []
    for pilot in pilots:
        for row, dlat in enumerate(GRID_OFFSETS):
            for col, dlon in enumerate(GRID_OFFSETS):
                if dlat == 0.0 and dlon == 0.0:
                    continue
                points.append({
                    "id": f"{pilot['id']}_r{row}c{col}",
                    "category": pilot["id"],
                    "latitude": round(pilot["lat"] + dlat, 4),
                    "longitude": round(pilot["lon"] + dlon, 4),
                })
    return points


def grid_task() -> dict:
    return {
        "task_type": "point",
        "task_name": "fieldshift-ndvi-grid",
        "params": {
            "dates": [{"startDate": "01-01-2015", "endDate": "12-31-2024"}],
            "layers": [{"product": p, "layer": l} for p, l in GRID_LAYERS],
            "coordinates": grid_points(),
        },
    }


def area_task() -> dict:
    return {
        "task_type": "area",
        "task_name": "fieldshift-srtm",
        "params": {
            # SRTM was acquired once, during this window only.
            "dates": [{"startDate": "02-11-2000", "endDate": "02-21-2000"}],
            "layers": [{"product": p, "layer": l} for p, l in AREA_LAYERS],
            "output": {"format": {"type": "geotiff"}, "projection": "geographic"},
            "geo": json.loads(AREAS_GEOJSON.read_text(encoding="utf-8")),
        },
    }


def request(method: str, path: str, token: str | None = None, body: dict | None = None,
            basic: tuple[str, str] | None = None) -> dict | list:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if basic:
        raw = f"{basic[0]}:{basic[1]}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    data = json.dumps(body).encode("utf-8") if body is not None else b""
    req = urllib.request.Request(f"{API}{path}", data=data if method == "POST" else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise SystemExit(f"AppEEARS {method} {path} failed ({err.code}): {detail}") from None


def login() -> str:
    user = input("Earthdata username: ").strip()
    password = getpass.getpass("Earthdata password (hidden): ")
    return request("POST", "/login", basic=(user, password))["token"]


TASKS = {"ndvi-grid": grid_task, "ndvi-smap": point_task, "srtm": area_task}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--task", choices=sorted(TASKS), default="ndvi-grid",
                        help="which task to submit (default: ndvi-grid)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true", help="print payloads, do not submit")
    group.add_argument("--status", action="store_true", help="list your recent tasks")
    args = parser.parse_args()

    tasks = [TASKS[args.task]()]
    if args.dry_run:
        print(json.dumps(tasks, indent=2))
        return

    token = login()
    try:
        if args.status:
            for task in request("GET", "/task?limit=10", token=token):
                print(f"{task['task_name']:<24} {task['status']:<12} {task['task_id']}")
            return
        for task in tasks:
            result = request("POST", "/task", token=token, body=task)
            print(f"Submitted {task['task_name']}: task_id={result.get('task_id')} "
                  f"status={result.get('status')}")
        print("You will get an email from AppEEARS when each task is done.")
    finally:
        request("POST", "/logout", token=token)


if __name__ == "__main__":
    main()
