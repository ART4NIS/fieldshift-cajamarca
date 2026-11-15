# FieldShift Peru — Complete Development Brief

**NASA Space Apps Challenge 2026**
Pilot site: Cajamarca · Northern Peruvian Andes · November 14–15, 2026

This is the original project brief, translated into English for presentation. The project is now named **SowOrbit**. The README describes the current implementation; the requirements below record the initial plan.

---

## 00. The challenge: Field Shift — Adapting Farms with NASA Data

### Challenge description

The **Field Shift: Adapting Farms with NASA Data** challenge asks teams to build **open-source tools** that help farming communities, especially those vulnerable to climate change, make informed decisions about which crops to plant, when to plant them and how to organize smart rotations using real NASA data.

Farmers are already experiencing changes in rainfall, frost, temperature and soil moisture. Without access to data or tools that interpret them, they must make critical planting decisions with limited information. Decades of NASA satellite and climate observations can help.

### Evaluation criteria stated in the original brief

| Criterion | Weight | Description |
|---|---|---|
| **Creative use of NASA data** | 25% | At least one NASA dataset plays a central, substantive role |
| **Problem relevance** | 25% | A real problem and a useful solution for real farming communities |
| **Technical quality** | 25% | Working, reproducible and documented software |
| **Impact potential** | 25% | Scalable, open-source work that others can build on |

These are the criteria recorded in the team's brief; consult the official event rules to confirm the judging rubric.

### Eligible solution types described in the brief

- Interactive web or mobile tool for farmers or agricultural advisors.
- Climate and agronomic data dashboard.
- Satellite-based crop or rotation recommendation system.
- Reusable open-source API or library.

### How the proposed solution responds

| Requirement | Proposed response |
|---|---|
| NASA data at the core | NASA POWER (1991–2024 climate), plus MODIS NDVI, SMAP moisture and SRTM elevation |
| Real problem | Highland farmers lose crops to frost, drought and soil degradation |
| Open source | Public GitHub repository, MIT license |
| Scalable | Two-level architecture designed to cover highland points |
| Data gaps visible | Evidence reports explicitly disclose uncertainty |

### Objectives

1. A farmer in Cajamarca can open the tool on a phone, mark a plot, answer five priority questions, and compare three NASA-backed crop rotations in under 30 seconds.
2. Integrate NASA POWER as a minimum; add MODIS NDVI, SMAP soil moisture and SRTM slope for Cajamarca if delivered in time.
3. Always show data sources, recommendation confidence and information that satellite data could not verify.
4. Make new pilot sites (Huancayo, Puno, Cusco) easy to add through repository JSON files.
5. Publish a GitHub Pages demo the judges can open and test.

---

## 01. Objective and minimum scope

A browser-based tool, without a dedicated server, that lets Andean farmers select a highland point, state priorities and compare **three crop rotations** using real NASA data.

### Two levels

- **Level 1 — Open highlands:** points between 6°S and 16°S above 2,500 m. NASA POWER responds for the selected point; risk calendars and rotation comparisons work throughout the intended area.
- **Level 2 — Detailed pilots:** additional NDVI, soil moisture and slope charts for Cajamarca and optional sites if data arrive.

### Main pilot

| Field | Value |
|---|---|
| Location | Cajamarca, Cajamarca |
| Coordinates | Latitude −7.16, longitude −78.51 |
| Elevation | Approximately 2,750 m |
| SRTM tile | S08W079 |
| Reference rotation | Potato → Maize → Wheat → Fallow |

### Outside hackathon scope

- All-Peru coverage without regional agronomic validation.
- Trained AI or ML models.
- User accounts or a dedicated database.
- Native mobile app.
- Live market prices.
- ECOSTRESS and GRACE (mention as future work).

---

## 02. System architecture

```text
Farmer's browser
  ├─ Leaflet map → plot coordinates
  ├─ Priorities → five weights, 0–5
  ├─ Live NASA POWER API → temperature, rainfall, frost (1991–2024)
  ├─ Preprocessed static JSON
  │    ├─ data/pilots/cajamarca.json → MODIS + SMAP + SRTM (planned)
  │    ├─ data/pilots_index.json → available pilots
  │    └─ data/cultivos.json → eight-crop agronomic table
  ├─ scoring.js
  │    ├─ monthly crop indicators
  │    ├─ three rotations × five criteria × farmer weights
  │    └─ confidence: High / Medium / Low
  └─ Rendering
       ├─ risk calendar (Chart.js stacked bars in original plan)
       ├─ three-rotation comparison
       ├─ evidence reports and warnings
       └─ technical glossary
```

Everything runs on the client in HTML and JavaScript. GitHub Pages serves the static files.

## 03. Technologies and libraries

| Layer | Tool | Version | Reason |
|---|---|---|---|
| Interface | HTML + CSS + vanilla JS | — | No build step |
| Interactive map | Leaflet.js | 1.9.4 | Lightweight, free OpenStreetMap |
| Charts | Chart.js | 4.4.4 | Bars, lines and radar |
| Preprocessing | Python 3 + pandas + rasterio + numpy | — | GeoTIFF processing and JSON export |
| Version control | Git + GitHub | — | Collaboration and deployment |
| Hosting | GitHub Pages | — | Free public demo |
| Live climate | NASA POWER REST API | v2 | Browser fetch without an API key |

**Do not use React or heavy frameworks during the hackathon.** Vanilla JavaScript, Chart.js and Leaflet are sufficient without bundler setup.

## 04. NASA data — what to use and how

### 4.1 NASA POWER — project core

The original brief proposed this climatology request:

```text
GET https://power.larc.nasa.gov/api/temporal/climatology/point
  ?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,EVPTRNS
  &community=AG&longitude=-78.51&latitude=-7.16&format=JSON
```

Implementation note: the project subsequently adopted the `monthly` endpoint and parameters documented in the README and `js/api.js`.

| Parameter | Variable | Purpose |
|---|---|---|
| Maximum temperature | T2M_MAX | Crop heat stress |
| Minimum temperature | T2M_MIN | Frost risk (original threshold < 0 °C) |
| Precipitation | PRECTOTCORR | Dry months and extreme rainfall |
| Evapotranspiration | EVPTRNS | Soil water balance |
| Solar radiation | ALLSKY_SFC_SW_DWN | Photosynthesis and growth |
| Relative humidity | RH2M | Disease conditions |

### 4.2 MODIS NDVI — request through AppEEARS immediately

- Product: **MOD13Q1**, NDVI every 16 days at 250 m.
- Period: 2015–2024.
- Portal: https://appeears.earthdatacloud.nasa.gov
- Request type: Point Sample, one request for all four points.

| Point | Latitude | Longitude | Priority |
|---|---|---|---|
| Cajamarca | −7.16 | −78.51 | Required on day 1 |
| Huancayo (Junín) | −12.07 | −75.21 | Day 2 if delivered |
| Puno | −15.84 | −70.02 | Day 2 if delivered |
| Cusco | −13.52 | −71.97 | Day 2 if delivered |

### 4.3 SMAP soil moisture

Request alongside MODIS. Original proposed product: **SPL3SMP.009**, surface soil moisture in m³/m³ at approximately 9 km. Variable: `Soil_Moisture_Retrieval_Data_AM_soil_moisture`. See the README for the product actually requested.

### 4.4 SRTM elevation and slope

| Point | SRTM tile | Priority |
|---|---|---|
| Cajamarca | S08W079 | Required on day 1 |
| Huancayo | S13W076 | Day 2 if time permits |
| Puno | S16W071 | Day 2 if time permits |
| Cusco | S14W073 | Day 2 if time permits |

Download: https://earthexplorer.usgs.gov (free Earthdata account required).

### 4.5 FAO GAEZ crop suitability

Use https://gaez.fao.org to research suitability, optimal temperature and water tolerance for Andean crops, then record consulted values in `cultivos.json`.

**If AppEEARS fails:** use Giovanni (https://giovanni.gsfc.nasa.gov) for a chart without downloading files. The risk calendar can still run on NASA POWER alone.

## 05. Planned repository layout

```text
fieldshift-cajamarca/
├── data/
│   ├── cultivos.json
│   ├── pilots/
│   │   ├── cajamarca.json
│   │   ├── huancayo.json
│   │   ├── puno.json
│   │   └── cusco.json
│   └── pilots_index.json
├── js/
│   ├── api.js
│   ├── scoring.js
│   ├── charts.js
│   └── ui.js
├── css/style.css
├── scripts/
│   ├── process_srtm.py
│   └── process_appeears.py
├── index.html
└── README.md
```

Pilot JSON files contain preprocessed NDVI, SMAP and SRTM data when available. See the live repository for filenames and modules added during implementation.

## 06. Crop table — `cultivos.json`

Eight priority crops for the Peruvian highlands. Values below are planning estimates requiring validation.

| Crop | Nitrogen fixation | Forage | Water (mm/cycle) | Drought tolerance | Income |
|---|---|---|---|---|---|
| Potato | No | No | 500 | Low | High |
| Maize | No | Partial | 450 | Medium | Medium |
| Wheat | No | No | 350 | Medium | Medium |
| Faba bean | Approximately 100 kg N/ha | Yes | 300 | Medium | Medium |
| Andean lupin (tarwi) | Approximately 80 kg N/ha | No | 280 | High | Medium |
| Barley | No | Yes | 300 | Medium | Low |
| Forage oats | No | Yes | 320 | Medium | Low |
| Common vetch (Vicia sativa) | Approximately 60 kg N/ha | Yes | 250 | High | Low |

## 07. Three rotations to compare

### A — Traditional (reference)

**Potato → Maize → Wheat → Fallow**

A Cajamarca reference rotation with high estimated water and nutrient demand, no cultivated nitrogen-fixing legume, and potentially bare soil for 3–4 dry-season months.

### B — Nitrogen+ (with legumes)

**Potato → Faba bean → Barley → Forage oats**

Faba bean has an estimated nitrogen contribution of approximately 100 kg N/ha/year in the initial proposal. Oats provide cover and dairy livestock feed, relevant to Cajamarca's livestock tradition. Potential fertilizer savings require validation.

### C — Water efficient (resilient)

**Potato → Andean lupin → Wheat → Common vetch**

Andean lupin fixes nitrogen and has estimated drought tolerance. Vetch provides green cover, potentially reducing erosion and adding organic matter. The initial proposal assumes lower water use than A and notes a growing market for tarwi; neither establishes local profitability or water savings.

### Evidence report fields

| Field | Content | Source |
|---|---|---|
| Why suggested? | Simple explanation | Rules engine + crop table |
| NASA evidence | Chart with suitable period highlighted | NASA POWER |
| Potential benefits | Nitrogen, erosion, water, income | Crop table + FAO GAEZ |
| Information gaps | What satellites could not verify | Explicit disclosure |
| Risks to review | What a local advisor should validate | Team-authored content |
| Confidence | High / Medium / Low | Rules engine |

## 08. Rules engine — `scoring.js`

A transparent statistical rules engine without machine learning. These formulas describe the initial plan; consult the implementation for current calculations.

### Step 1: Monthly NASA POWER indicators

```js
// Per month:
// prob_helada: fraction of years with T2M_MIN below the frost threshold
// lluvia_avg: mean precipitation
// lluvia_cv: coefficient of rainfall variation
// deficit_hidrico: rainfall minus evapotranspiration
// temp_media: (T2M_MAX + T2M_MIN) / 2
```

### Step 2: Crop/month score

```text
score = 100 − frost penalty − water penalty − temperature penalty
```

Output: 0–100 for each month in the crop cycle.

### Step 3: Five rotation criteria

| Criterion | Initial calculation | Source |
|---|---|---|
| Water savings | Sum of crop water needs × (1 − cover) | Crop table |
| Soil health | Nitrogen fixation + mean ground cover | Crop table |
| Erosion risk | Cover × (1 − normalized slope) | SRTM + crop table |
| Forage / income | Sum of forage crops | Crop table |
| Climate resilience | Mean crop-cycle climate score | NASA POWER |

### Step 4: Weighted total

```text
rotation score = Σ(criterion × farmer weight) / Σ(weights)
```

Weights range from 0–5; final scores range from 0–100.

### Step 5: Confidence

The initial brief proposed High for measured NASA POWER/SMAP data, Medium if a criterion uses crop-table estimates, and Low when SMAP or SRTM are missing. Later implementation uses locally corrected climate and satellite availability as described in `docs/TAREAS.md` and the current code. Internal enum values remain `Alto`, `Medio`, `Bajo`; presentation labels are English.

## 09. Two-day schedule

**First 20 minutes:** create an Earthdata account, submit AppEEARS requests and create the GitHub repository.

### Day 1 — November 14

| Time | Task |
|---|---|
| 08:00–08:30 | Earthdata accounts; MODIS + SMAP requests for Cajamarca and three optional points; GitHub repository |
| 08:30–09:00 | Assign team roles |
| 09:00–11:00 | NASA POWER script + crop table; HTML map and priorities |
| 11:00–13:00 | Rules engine and risk calendar |
| 13:00–14:00 | Lunch; check AppEEARS delivery |
| 14:00–17:00 | Rotation comparison, evidence reports and glossary |
| 17:00–18:00 | First GitHub Pages deployment |
| 18:00–21:00 | Integrate MODIS, SMAP and SRTM if delivered; start presentation |

### Day 2 — November 15

| Time | Task |
|---|---|
| 08:00–10:00 | Integrate satellite data, polish charts, verify Cajamarca |
| 10:00–12:00 | Test three locations; fix errors; check mobile layout |
| 12:00–14:00 | Record a 3–5 minute demo with OBS or Loom |
| 14:00–16:00 | Ten slides: problem, solution, NASA data, demo, rotations, logic, future work and team |
| 16:00–17:00 | Complete Space Apps project page |
| 17:00 | Final submission with time to spare |

Confirm the actual local event deadline; these are team planning times.

## 10. GitHub and deployment

1. Create public repository `fieldshift-cajamarca` with an MIT license.
2. Enable GitHub Pages: Settings → Pages → branch `main`, root folder → Save.
3. Demo URL: `https://[username].github.io/fieldshift-cajamarca/`.

### Team workflow

```bash
git checkout -b feature/scoring-engine
git add .
git commit -m "feat: NASA POWER scoring engine"
git push origin feature/scoring-engine
# Open a pull request, review and merge into main.
# GitHub Pages updates automatically.
```

| Role | Suggested branch |
|---|---|
| Data + Python | feature/data-processing |
| Interface + map | feature/ui-map |
| Rules engine | feature/scoring-engine |
| Content + reports | feature/rotation-cards |

### Minimum README

Include the project name, a crop-rotation decision-support description, NASA datasets actually used, the live demo URL, Cajamarca coordinates (−7.16, −78.51), and the MIT license. Distinguish planned datasets from integrated ones.

## 11. Space Apps submission checklist

**Verify the exact closing time for the local event in Peru.**

- [ ] Project name.
- [ ] One-paragraph description.
- [ ] YouTube demo video (3–5 minutes).
- [ ] GitHub repository link.
- [ ] Live GitHub Pages demo link.
- [ ] List of NASA datasets used.
- [ ] AI use declaration: whether and how it was used.
- [ ] References and sources.

## 12. Contingency plans

| Risk | Fallback |
|---|---|
| AppEEARS takes over six hours | NASA POWER-only demo; Giovanni NDVI image in slides |
| POWER fails live | Save pilot response as a cache and load it from `api.js` |
| No internet during demo | Serve static files locally with `python -m http.server 8000`; prepare external assets and data ahead of time |
| Incomplete agronomic data | Use consulted FAO/INIA values, mark estimates and disclose information gaps |
| A member leaves | Minimum MVP: POWER + crop table + three rotations; no AppEEARS or Python needed at runtime |

## 13. Team roles

| Role | Responsibilities |
|---|---|
| **Data scientist** | Python, AppEEARS, NASA POWER, crop table and satellite JSON files |
| **Web developer** | HTML, Leaflet, Chart.js, priorities and responsive layout |
| **Rules engineer** | Scoring engine, confidence and evidence reports |
| **Communicator** | Demo video, slides, README, Space Apps page and farmer-facing text |

With three people, combine data science and rules engineering. With two, one handles data and logic, the other interface and presentation.

## 14. App glossary

| Technical term | Simple explanation |
|---|---|
| NDVI | A number from −1 to 1 indicating vegetation greenness. Values closer to 1 generally indicate greener, more vigorous vegetation. |
| Evapotranspiration | Water lost from soil and plants through evaporation and transpiration; indicates water use. |
| Soil moisture anomaly | Whether soil is wetter or drier than usual for that time and location. |
| Frost risk | How often temperatures fall to the frost threshold in a given month, based on historical data. The implementation uses a preventive threshold below 2 °C at 2 m above ground. |
| Water balance | Rainfall minus evaporative loss; negative means a deficit. |
| Satellite vs. field data | Satellites describe an area; a weather station measures a particular point. Combining both can improve reliability. |

The working, expanded glossary is in `data/glosario.json`.

---

**The tool supports farmers; it does not replace their knowledge or that of local agricultural advisors. Include this notice in the interface.**

*FieldShift Cajamarca / SowOrbit · NASA Space Apps Challenge 2026 · Original brief generated November 14, 2026; English edition November 15, 2026.*
