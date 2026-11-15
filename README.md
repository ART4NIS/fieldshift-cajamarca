# SowOrbit 🌾

A decision-support tool for crop rotations in the Peruvian highlands using NASA data.
Built for the NASA Space Apps Challenge 2026 — *Field Shift: Adapting Farms with NASA Data*.
The repository retains the project's original name, FieldShift Cajamarca.

Farmers mark their plot on the map, set their priorities (water, soil, erosion, forage and climate), and compare three crop rotations with a frost and drought risk calendar, confidence levels and data sources.

## Interface

- **Plot and priorities on one screen:** satellite map with town search and five priority sliders.
- **Results in two columns:** rotation cards on the left; the selected rotation's report on the right, with a plain-language explanation, a year-by-year sequence with photos, criterion scores and charts.
- **Confidence colors:** green (high), yellow (medium) and red (low), always accompanied by text.
- **PDF reports:** download one rotation or all three in a single file.
- **Glossary:** searchable terms organized by topic and alphabetized in English.
- **Dark theme by default**, with a light-theme toggle.
- **English presentation:** interface, reports, glossary and project documentation are in English. Internal data keys and identifiers retain their original names for compatibility. Original publication titles and place names are retained where appropriate.

## 🌍 Live demo

https://art4nis.github.io/fieldshift-cajamarca/

If the page does not load after an update, refresh without the cache (Ctrl+Shift+R).

## 🛰 Data currently used

| Data | Source | Use |
|---|---|---|
| Monthly and daily climate, 1991–2024 (T2M, T2M_MIN, PRECTOTCORR) | **NASA POWER**, live API | Core engine inputs: temperature, rainfall and monthly frost frequency |
| Local temperature and rainfall correction | SENAMHI PISCOt v1.1 and PISCOp v2.1, via IRI/LDEO Climate Data Library | Corrects POWER bias, which underestimates frost in the highlands |
| Slope near pilot sites | **NASA SRTM** SRTMGL1_NC.003 (30 m), via NASA AppEEARS | Point slope within a roughly 5 km crop around a pilot, and the share of steep terrain in that area |
| Elevation and slope elsewhere | Copernicus DEM 90 m, via Open-Meteo Elevation API | Checks elevation above 2,500 m and calculates slope outside the SRTM crops |
| Lakes | OpenStreetMap (ODbL) | Prevents selecting Lake Titicaca or Lake Junín as farmland |
| Map imagery | Esri World Imagery (satellite, default), NASA GIBS Blue Marble and OpenStreetMap | User-selectable map background |
| Crop photos | Wikimedia Commons (author and license in `data/imagenes_cultivos.json` and each report) | Reference photos for each rotation year; not photos of the user's plot |
| Place search | OpenStreetMap Nominatim | Finds a town or district by name (one search per second, no autocomplete) |

Active NASA datasets: NASA POWER (climate, central to the engine) and SRTM (slope near pilot sites).

### Downloaded but not yet used

Both AppEEARS requests (`scripts/submit_appeears.py`) have arrived. MODIS and SMAP are not displayed for the following reasons:

- **MODIS MOD13Q1.061 (NDVI, 250 m):** the requested points are city centers, so NDVI measures roofs and streets (0.1–0.3), not farmland. A new request should target agricultural points or areas.
- **SMAP SPL3SMP_E.006 (soil moisture, 9 km):** only 32 % of days have values at the four pilot sites, and none meet the recommended quality level, a common issue in mountainous terrain. `scripts/process_appeears.py` discards them all.

Without NDVI and soil moisture, confidence never reaches “High”.

## 🏔 Coverage

There are 22 pilot sites across the highlands (see `data/pilots_index.json`). Any point within the Peruvian highlands above 2,500 m can be selected in the map's green area:

- **Pilot site (≤ 10 km):** precalculated PISCO correction in `data/pilots/<id>.json`.
- **Another point within the area:** a point-specific PISCO correction is calculated in the browser. The first calculation may take up to a minute; it is then cached.
- **If calculation fails:** the nearest pilot's correction is used, its distance is disclosed, and confidence is reduced when it exceeds the fallback trust distance.

To add a pilot, add its entry to `data/pilots_index.json` and generate its correction and POWER cache using the scripts below. Coverage does not depend on the pilots.

## ⚙️ Reproduce locally

This is a static site without a backend or bundler (Leaflet and Chart.js load from CDNs). Run a static server at the repository root:

```bash
python -m http.server 8000
# Open http://localhost:8000
```

Development and data processing:

```bash
npm install                              # d3-contour, used by the coverage-area script
npm test                                 # engine, API and map tests
npm run bump                             # update JS, CSS and data asset versions before deployment

python scripts/build_climate_bias.py --pilot cajamarca --lat -7.16 --lon -78.51
python scripts/build_climate_fixture.py --pilot cajamarca  # reference monthly engine input
python scripts/build_power_cache.py                       # pilot NASA POWER caches

python scripts/build_dem_grid.py                       # Copernicus DEM elevation across Peru
node scripts/build_selectable_area.mjs --whole-sierra  # green area: Peruvian highlands > 2,500 m
node scripts/build_water_mask.mjs                      # OpenStreetMap lake mask

# AppEEARS outputs belong in raw/appeears/ (not committed); processing needs numpy and rasterio
pip install -r scripts/requirements.txt
python scripts/process_appeears.py          # SRTM terrain statistics in data/pilots/<id>.json
python scripts/build_srtm_grids.py          # browser-ready SRTM 30 m crops in data/srtm/
```

Climate preprocessing scripts use the Python standard library; raster processing requires the packages in `scripts/requirements.txt`.

## Evidence reports

Each result includes potential benefits, agronomic sources, limitations and questions for a local advisor. Content lives in `data/fichas.json`; research scope and maintenance guidance are in [docs/FICHAS_EVIDENCIA.md](docs/FICHAS_EVIDENCIA.md).

## Limitations

- Crop parameters are literature-based estimates, not yet field-validated.
- Climate data describe the area and past years; they are not a forecast.
- “Frost” is a risk proxy: a minimum below 2 °C measured 2 m above ground.
- The tool supports, but does not replace, a local agricultural advisor.

## AI use

Yes. The team used an AI coding assistant (Anthropic's Claude Code) to write and review parts of the code and tests. OpenAI Codex assisted with English translation and related verification. The team made design and data decisions and verified results.

## References

- NASA POWER — https://power.larc.nasa.gov/
- SENAMHI PISCO (PISCOt v1.1, PISCOp v2.1) — https://iridl.ldeo.columbia.edu/SOURCES/.SENAMHI/.HSR/.PISCO/
- Open-Meteo Elevation API — https://open-meteo.com/en/docs/elevation-api
- Copernicus DEM GLO-90 — https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model
- OpenStreetMap — https://www.openstreetmap.org/copyright
- Nominatim usage policy — https://operations.osmfoundation.org/policies/nominatim/
- Esri World Imagery — https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
- NASA GIBS — https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
- NASA AppEEARS — https://appeears.earthdatacloud.nasa.gov/

## Team

Work plan and responsibilities: [docs/TAREAS.md](docs/TAREAS.md).

## License

MIT
