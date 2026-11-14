"""Build the monthly climate input for the rules engine from NASA POWER + pilot corrections.

This is the Python reference of what js/api.js must produce in the browser:
    { mes, tmed, tmin_abs, lluvia_mm, lluvia_cv, prob_helada }  x 12

Corrections come from data/pilots/<pilot>.json ("climate_bias", see build_climate_bias.py):
    tmed      = mean(POWER T2M)         + (tmin_bias + tmax_bias) / 2
    tmin_abs  = mean(POWER T2M_MIN)     + tmin_bias      (T2M_MIN monthly = absolute monthly min)
    lluvia_mm = mean(POWER PRECTOTCORR * days_in_month) * lluvia_factor
    prob_helada = pct_years_frost_2 / 100

Usage:
    python scripts/build_climate_fixture.py --pilot cajamarca
"""

from __future__ import annotations

import argparse
import calendar
import json
import statistics
import urllib.parse
import urllib.request
from pathlib import Path

POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
POWER_FILL = -999.0
ROOT = Path(__file__).resolve().parent.parent


def fetch_power_monthly(lat: float, lon: float, start: int, end: int) -> dict:
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
        return json.loads(response.read().decode("utf-8"))["properties"]["parameter"]


def build(pilot: dict, power: dict) -> list[dict]:
    bias = {row["month"]: row for row in pilot["climate_bias"]["monthly"]}
    out = []
    for month in range(1, 13):
        keys = [
            k for k in power["T2M"]
            if int(k[4:]) == month and power["T2M"][k] != POWER_FILL
        ]
        b = bias[month]
        rain = [
            power["PRECTOTCORR"][k] * calendar.monthrange(int(k[:4]), month)[1] * b["lluvia_factor"]
            for k in keys
        ]
        rain_mean = statistics.mean(rain)
        out.append(
            {
                "mes": month,
                "tmed": round(statistics.mean(power["T2M"][k] for k in keys)
                              + (b["tmin_bias"] + b["tmax_bias"]) / 2, 2),
                "tmin_abs": round(statistics.mean(power["T2M_MIN"][k] for k in keys) + b["tmin_bias"], 2),
                "lluvia_mm": round(rain_mean, 1),
                "lluvia_cv": round(statistics.pstdev(rain) / rain_mean, 3) if rain_mean > 0 else 0.0,
                "prob_helada": round(b["pct_years_frost_2"] / 100, 3),
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pilot", required=True)
    parser.add_argument("--start", type=int, default=1991)
    parser.add_argument("--end", type=int, default=2024)
    parser.add_argument("--out", type=Path, help="default: tests/fixtures/<pilot>_clima.json")
    args = parser.parse_args()

    pilot = json.loads((ROOT / "data" / "pilots" / f"{args.pilot}.json").read_text(encoding="utf-8"))
    power = fetch_power_monthly(pilot["lat"], pilot["lon"], args.start, args.end)
    clima = build(pilot, power)

    out = args.out or ROOT / "tests" / "fixtures" / f"{args.pilot}_clima.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fuente": (
            f"NASA POWER monthly {args.start}-{args.end} corrected with climate_bias "
            f"(SENAMHI PISCO) from data/pilots/{args.pilot}.json"
        ),
        "clima": clima,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}")
    for row in clima:
        print(f"  {row}")


if __name__ == "__main__":
    main()
