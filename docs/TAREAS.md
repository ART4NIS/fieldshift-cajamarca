# Team plan — FieldShift Cajamarca / SowOrbit

NASA Space Apps 2026 · Field Shift · November 14–15. Tasks marked **NOW** come first.

This is the original work plan, not a current completion report. Consult the README and implementation for the latest status. English is the presentation language; internal filenames and data contracts retain their original identifiers.

## Already completed when this plan was written

- `scripts/build_climate_bias.py` and `data/pilots/cajamarca.json`: NASA POWER temperature correction with PISCO (SENAMHI) and monthly frost statistics.
- `data/requests/`: files ready for both AppEEARS requests.
- Verified: NASA POWER accepts browser requests (CORS). Use the `monthly` endpoint, not `climatology`.

> **Key finding:** NASA POWER records no frost in Cajamarca between 1991 and 2024, and its minimum temperatures are 2–4 °C higher than PISCO. The app applies a monthly correction and uses a frost risk threshold of 2 °C at 2 m above ground.
>
> **Rainfall:** POWER gives 464 mm/year versus 556 mm from PISCOp (SENAMHI). It underestimates the rainy season (March: −39 %) and overestimates the dry season. A monthly factor corrects this.

## Component contracts

**`cultivos.json`** (written by the rules engineer; read by everyone)

```json
{ "id": "haba", "nombre": "Faba bean", "meses_siembra": [10, 11], "duracion_meses": 6,
  "temp_opt_min": 7, "temp_opt_max": 22, "temp_dano_helada": -2,
  "agua_mm_ciclo": 300, "tolerancia_sequia": "media", "cobertura_suelo": 0.7,
  "fija_n_kg_ha": 100, "forraje": 1, "ingresos": "medio",
  "estimado": true }
```

All crops currently cite “Team estimate (pending validation)” in `_meta.fuente`. For a crop whose parameters are validated with FAO or INIA, record the actual consulted source in `fuente` and set `estimado: false`. Do not mark an entire crop as validated if some parameters remain estimates.

**Monthly climate** (produced by `api.js`; consumed by `scoring.js`)

```js
// 12 records (months 1..12), corrected and in mm/month.
// tmed: POWER T2M + correction; tmin_abs: POWER T2M_MIN + correction.
// lluvia_mm: POWER PRECTOTCORR × days in month × rainfall factor (PISCOp / POWER).
// prob_helada: fraction 0–1 of years with Tmin < 2 °C; pilots use pct_years_frost_2 / 100.
{ mes, tmed, tmin_abs, lluvia_mm, lluvia_cv, prob_helada }
```

**Engine result** (produced by `scoring.js`; consumed by `charts.js` and `ui.js`)

```js
{ rotacion: "A", total: 0-100, criterios: { agua, suelo, erosion, forraje, clima }, confianza: "Medio", avisos: [] }
// Confidence enum values remain Alto / Medio / Bajo internally; labels are shown in English.
```

## 1. Data scientist — `feature/data-processing`

| # | Task | Done when |
|---|---|---|
| 1 | **NOW** Submit both AppEEARS requests (NDVI + SMAP point samples; SRTM area) | Both are Queued or Processing |
| 2 | ✅ `data/power_cache/<pilot>.json` for four pilots (`scripts/build_power_cache.py`) | App tested with POWER unavailable |
| 3 | ✅ Run `build_climate_bias.py` for Huancayo, Puno and Cusco | Four files in `data/pilots/` |
| 4 | ✅ `data/pilots_index.json` with four pilots | Map displays pilots |
| 5 | `scripts/process_appeears.py`: NDVI filtered by `pixel_reliability` 0–1 (monthly mean + trend), SMAP by `qual_flag` (mean + anomaly), SRTM mean and maximum slope (%) | `cajamarca.json` contains `ndvi`, `soil_moisture` and `terrain` |
| 6 | If AppEEARS has not delivered by 13:00, export NDVI from Giovanni as an image | PNG in `docs/` |

## 2. Web developer — `feature/ui-map`

| # | Task | Done when |
|---|---|---|
| 1 | **NOW** Enable GitHub Pages and add the other three members | Everyone can push; Pages responds |
| 2 | `index.html`: map → priorities → results → glossary, with advisor disclaimer | Fits 360 px without horizontal scrolling |
| 3 | Leaflet 1.9.4: click to mark plot, pilots from `pilots_index.json`, latitude −6 to −16 | Click displays coordinates |
| 4 | Validate elevation ≥ 2,500 m using POWER `geometry.coordinates[2]` | A Lima point shows a warning |
| 5 | `js/api.js`: POWER `monthly` (`T2M`, `T2M_MIN`, `PRECTOTCORR`), remove `YYYY13`, convert mm/day to mm/month, apply temperature and rainfall corrections, use cache on failure; reference: `scripts/build_climate_fixture.py` | Returns the 12-month contract matching the Cajamarca fixture |
| 6 | Five priority sliders, 0–5, with simple labels | Moving a slider recalculates results |
| 7 | `js/charts.js` (Chart.js 4.4.4): risk calendar and rotation radar | Displays test data |
| 8 | First deployment at 17:00 | Public link opens |

## 3. Rules engineer — `feature/scoring-engine`

| # | Task | Done when |
|---|---|---|
| 1 | ✅ `data/cultivos.json` created with team estimates. **Pending:** validate with FAO / INIA; record real sources and validation status | No value cites an unconsulted source |
| 2 | `data/rotaciones.json`: three rotations as a 24-month calendar (original plan) | Every month has a crop or fallow |
| 3 | `js/scoring.js`, step 2: 0–100 crop/month score (frost, water, temperature) | Pure functions, no DOM |
| 4 | Steps 3–4: five normalized criteria, 0–100 (higher = better), weighted average | All-zero weights do not divide by zero |
| 5 | Step 5: confidence High (pilot with NDVI + SMAP + SRTM), Medium (corrected POWER), Low (uncorrected POWER), plus warnings | Every result contains both |
| 6 | `test.html` with fixed Cajamarca cases | B or C beats A when soil is highly weighted |

## 4. Communicator — `feature/rotation-cards`

| # | Task | Done when |
|---|---|---|
| 1 | **NOW** Confirm the closing time in Peru and create the Space Apps project page | Draft page exists |
| 2 | Plain-language evidence reports for all three rotations | `data/fichas.json` |
| 3 | Explain POWER frost bias and PISCO correction | Included in reports and one slide |
| 4 | Brief §14 glossary in `data/glosario.json` | Displayed by the app |
| 5 | Complete README (datasets, demo, scripts, AI use) | Meets brief §11 checklist |
| 6 | Day 2: ten slides, script and a 3–5 minute video | Video on YouTube |

## Synchronization points

- **13:00:** Has AppEEARS delivered? Integrate `api.js` with `scoring.js`.
- **17:00:** First deployment: merge into `main`.
- **21:00:** Decide what goes into the demo and what remains future work.
