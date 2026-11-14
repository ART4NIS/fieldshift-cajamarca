"""Build the climate bias-correction block for a pilot site.

Compares NASA POWER (MERRA-2 based, ~0.5 deg grid) against SENAMHI PISCO
(station-interpolated grids) at the same point and writes, per calendar month:
- the mean temperature offset (PISCO - POWER) for Tmin and Tmax (PISCOt v1.1),
- a multiplicative precipitation factor (PISCO / POWER) (PISCOp v2.1),
- PISCO-derived frost statistics.

The result is merged into data/pilots/<pilot>.json under the "climate_bias"
key, so other sections (NDVI, SMAP, SRTM) written by other scripts are kept.

Usage:
    python scripts/build_climate_bias.py --pilot cajamarca --lat -7.16 --lon -78.51
"""

from __future__ import annotations

import argparse
import calendar
import json
import statistics
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
PISCO_URL = (
    "https://iridl.ldeo.columbia.edu/SOURCES/.SENAMHI/.HSR/.PISCO/.Temp/.v1p1/"
    ".{var}/.stable/.daily/X/{lon}/VALUE/Y/{lat}/VALUE/"
    "T/({start})/({end})/RANGEEDGES/T/exch/table:/text/text/:table/.tsv"
)
PISCO_PREC_URL = (
    "https://iridl.ldeo.columbia.edu/SOURCES/.SENAMHI/.HSR/.PISCO/.Prec/.v2p1/"
    ".stable/.monthly/.Prec/X/{lon}/VALUE/Y/{lat}/VALUE/"
    "T/({start})/({end})/RANGEEDGES/T/exch/table:/text/text/:table/.tsv"
)
# Below this monthly mean (mm) the ratio is too unstable: keep POWER as is.
MIN_RAIN_FOR_FACTOR_MM = 1.0
RAIN_FACTOR_LIMITS = (0.25, 4.0)
POWER_FILL = -999.0
# PISCOt v1.1 coverage ends in 2016; POWER starts in 1981.
DEFAULT_START, DEFAULT_END = 1991, 2016
FROST_THRESHOLD_C = 0.0
# 2 m air temperature below ~2 C is commonly used as a proxy for ground frost.
AGRO_FROST_THRESHOLD_C = 2.0

ROOT = Path(__file__).resolve().parent.parent


def http_get(url: str, timeout: int = 300) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "fieldshift-preprocess"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def fetch_power(lat: float, lon: float, start: int, end: int) -> dict[str, dict[str, float]]:
    query = urllib.parse.urlencode(
        {
            "parameters": "T2M_MIN,T2M_MAX",
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": f"{start}0101",
            "end": f"{end}1231",
            "format": "JSON",
        }
    )
    payload = json.loads(http_get(f"{POWER_URL}?{query}"))
    params = payload["properties"]["parameter"]
    return {
        "tmin": {k: v for k, v in params["T2M_MIN"].items() if v != POWER_FILL},
        "tmax": {k: v for k, v in params["T2M_MAX"].items() if v != POWER_FILL},
    }


def fetch_power_monthly_rain(lat: float, lon: float, start: int, end: int) -> dict[str, float]:
    """Monthly precipitation totals (mm/month) keyed YYYYMM; annual YYYY13 keys are dropped."""
    query = urllib.parse.urlencode(
        {
            "parameters": "PRECTOTCORR",
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": start,
            "end": end,
            "format": "JSON",
        }
    )
    payload = json.loads(http_get(f"{POWER_MONTHLY_URL}?{query}"))
    series = payload["properties"]["parameter"]["PRECTOTCORR"]
    out: dict[str, float] = {}
    for key, mm_per_day in series.items():
        year, month = int(key[:4]), int(key[4:])
        if month == 13 or mm_per_day == POWER_FILL:
            continue
        out[key] = mm_per_day * calendar.monthrange(year, month)[1]
    return out


def fetch_pisco_monthly_rain(lat: float, lon: float, start: int, end: int) -> dict[str, float]:
    """PISCOp v2.1 monthly precipitation (mm/month) keyed YYYYMM."""
    url = PISCO_PREC_URL.format(
        lat=lat,
        lon=lon,
        start=urllib.parse.quote(f"Jan {start}"),
        end=urllib.parse.quote(f"Dec {end}"),
    )
    text = http_get(url)
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"PISCO returned HTML instead of data for precipitation: {url}")
    series: dict[str, float] = {}
    for line in text.splitlines()[2:]:
        if not line.strip():
            continue
        raw_date, raw_value = line.split("\t")
        series[datetime.strptime(raw_date.strip(), "%b %Y").strftime("%Y%m")] = float(raw_value)
    return series


def rain_block(month: int, pisco_rain: dict[str, float], power_rain: dict[str, float]) -> dict:
    keys = [k for k in pisco_rain if int(k[4:]) == month and k in power_rain]
    pisco_mean = statistics.mean(pisco_rain[k] for k in keys)
    power_mean = statistics.mean(power_rain[k] for k in keys)
    if power_mean < MIN_RAIN_FOR_FACTOR_MM:
        factor = 1.0
    else:
        factor = min(max(pisco_mean / power_mean, RAIN_FACTOR_LIMITS[0]), RAIN_FACTOR_LIMITS[1])
    return {
        "lluvia_pisco_mm": round(pisco_mean, 1),
        "lluvia_power_mm": round(power_mean, 1),
        "lluvia_factor": round(factor, 3),
    }


def fetch_pisco(var: str, lat: float, lon: float, start: int, end: int) -> dict[str, float]:
    url = PISCO_URL.format(
        var=var,
        lat=lat,
        lon=lon,
        start=urllib.parse.quote(f"1 Jan {start}"),
        end=urllib.parse.quote(f"31 Dec {end}"),
    )
    text = http_get(url)
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"PISCO returned HTML instead of data for {var}: {url}")
    series: dict[str, float] = {}
    # First two lines are the column header and the units header.
    for line in text.splitlines()[2:]:
        if not line.strip():
            continue
        raw_date, raw_value = line.split("\t")
        day = datetime.strptime(raw_date.strip(), "%d %b %Y").strftime("%Y%m%d")
        series[day] = float(raw_value)
    return series


def monthly_block(month: int, pisco: dict, power: dict) -> dict:
    mm = f"{month:02d}"
    days = sorted(k for k in pisco["tmin"] if k[4:6] == mm and k in power["tmin"])
    if not days:
        raise RuntimeError(f"No overlapping days for month {mm}")
    years = sorted({d[:4] for d in days})

    def mean(series: dict, keys: list[str]) -> float:
        return statistics.mean(series[k] for k in keys)

    tmax_days = [k for k in days if k in pisco["tmax"] and k in power["tmax"]]
    frost_years = sum(
        any(pisco["tmin"][d] < FROST_THRESHOLD_C for d in days if d[:4] == y) for y in years
    )
    agro_frost_years = sum(
        any(pisco["tmin"][d] < AGRO_FROST_THRESHOLD_C for d in days if d[:4] == y) for y in years
    )

    return {
        "month": month,
        "n_days": len(days),
        "tmin_pisco_mean": round(mean(pisco["tmin"], days), 2),
        "tmin_power_mean": round(mean(power["tmin"], days), 2),
        "tmin_bias": round(mean(pisco["tmin"], days) - mean(power["tmin"], days), 2),
        "tmax_pisco_mean": round(mean(pisco["tmax"], tmax_days), 2),
        "tmax_power_mean": round(mean(power["tmax"], tmax_days), 2),
        "tmax_bias": round(mean(pisco["tmax"], tmax_days) - mean(power["tmax"], tmax_days), 2),
        "tmin_pisco_abs_min": round(min(pisco["tmin"][d] for d in days), 2),
        "pct_days_below_0": round(
            100 * sum(pisco["tmin"][d] < FROST_THRESHOLD_C for d in days) / len(days), 2
        ),
        "pct_days_below_2": round(
            100 * sum(pisco["tmin"][d] < AGRO_FROST_THRESHOLD_C for d in days) / len(days), 2
        ),
        "pct_years_frost_0": round(100 * frost_years / len(years), 1),
        "pct_years_frost_2": round(100 * agro_frost_years / len(years), 1),
    }


def merge_into_pilot(path: Path, pilot: str, lat: float, lon: float, block: dict) -> None:
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data.setdefault("id", pilot)
    data.setdefault("lat", lat)
    data.setdefault("lon", lon)
    data["climate_bias"] = block
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pilot", required=True, help="pilot id, e.g. cajamarca")
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--start", type=int, default=DEFAULT_START)
    parser.add_argument("--end", type=int, default=DEFAULT_END)
    args = parser.parse_args()

    print(f"Fetching NASA POWER daily {args.start}-{args.end}...")
    power = fetch_power(args.lat, args.lon, args.start, args.end)
    print("Fetching SENAMHI PISCOt v1.1 tmin/tmax...")
    pisco = {
        "tmin": fetch_pisco("tmin", args.lat, args.lon, args.start, args.end),
        "tmax": fetch_pisco("tmax", args.lat, args.lon, args.start, args.end),
    }
    print("Fetching NASA POWER monthly and SENAMHI PISCOp v2.1 precipitation...")
    power_rain = fetch_power_monthly_rain(args.lat, args.lon, args.start, args.end)
    pisco_rain = fetch_pisco_monthly_rain(args.lat, args.lon, args.start, args.end)

    block = {
        "description": (
            "Monthly corrections for NASA POWER: add tmin_bias/tmax_bias to temperatures "
            "(bias = PISCO - POWER) and multiply precipitation by lluvia_factor "
            "(PISCO / POWER). Frost statistics come from PISCO daily Tmin at 2 m."
        ),
        "period": f"{args.start}-{args.end}",
        "generated": date.today().isoformat(),
        "confidence": "estimated",
        "sources": {
            "power": "NASA POWER daily API, community AG, T2M_MIN/T2M_MAX",
            "pisco": "SENAMHI PISCOt v1.1 stable daily, via IRI/LDEO Climate Data Library",
            "power_rain": "NASA POWER monthly API, community AG, PRECTOTCORR",
            "pisco_rain": "SENAMHI PISCOp v2.1 stable monthly, via IRI/LDEO Climate Data Library",
        },
        "caveats": [
            "PISCO is a station-interpolated grid, not a direct station record.",
            "2 m air temperature is warmer than ground surface; frost below 2 C at 2 m is a proxy.",
            "The precipitation factor corrects the monthly climatology only; single years "
            "agree only moderately between POWER and PISCO.",
        ],
        "monthly": [
            {**monthly_block(m, pisco, power), **rain_block(m, pisco_rain, power_rain)}
            for m in range(1, 13)
        ],
    }

    out = ROOT / "data" / "pilots" / f"{args.pilot}.json"
    merge_into_pilot(out, args.pilot, args.lat, args.lon, block)
    print(f"Wrote {out.relative_to(ROOT)}")
    for row in block["monthly"]:
        print(
            f"  {row['month']:02d}  tmin_bias={row['tmin_bias']:+.2f}  "
            f"tmax_bias={row['tmax_bias']:+.2f}  rain_factor={row['lluvia_factor']:.2f}  "
            f"frost<2C years={row['pct_years_frost_2']}%"
        )


if __name__ == "__main__":
    main()
