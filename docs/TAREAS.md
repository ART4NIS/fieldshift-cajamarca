# Plan del equipo — FieldShift Cajamarca

NASA Space Apps 2026 · Field Shift · 14–15 nov. Las tareas marcadas con **YA** van primero.

## Ya está hecho

- `scripts/build_climate_bias.py` y `data/pilots/cajamarca.json`: corrección de temperatura de NASA POWER con PISCO (SENAMHI) y estadísticas de heladas por mes.
- `data/requests/`: archivos listos para los dos pedidos de AppEEARS.
- Verificado: NASA POWER acepta llamadas desde el navegador (CORS). Usar el endpoint `monthly`, no `climatology`.

> **Hallazgo clave:** NASA POWER no registra ninguna helada en Cajamarca entre 1991 y 2024, y sus mínimas salen 2–4 °C más altas que las de PISCO. La app aplica una corrección mensual y usa un umbral de helada de 2 °C a 2 m.

## Contratos entre piezas

**`cultivos.json`** (Ing. de Reglas lo escribe; todos lo leen)

```json
{ "id": "haba", "nombre": "Haba", "meses_siembra": [10, 11], "duracion_meses": 6,
  "temp_opt_min": 7, "temp_opt_max": 22, "temp_dano_helada": -2,
  "agua_mm_ciclo": 300, "tolerancia_sequia": "media", "cobertura_suelo": 0.7,
  "fija_n_kg_ha": 100, "forraje": 1, "ingresos": "medio",
  "fuente": "FAO GAEZ / INIA", "estimado": true }
```

**Clima mensual** (`api.js` lo produce; `scoring.js` lo usa)

```js
// 12 elementos (mes 1..12), ya corregidos y en mm/mes
// tmed: POWER T2M + corrección; tmin_abs: POWER T2M_MIN (mínimo absoluto del mes) + corrección
// prob_helada: fracción 0-1 de años con Tmin < 2 °C (pilotos: pct_years_frost_2 / 100)
{ mes, tmed, tmin_abs, lluvia_mm, lluvia_cv, prob_helada }
```

**Resultado del motor** (`scoring.js` lo produce; `charts.js` y `ui.js` lo usan)

```js
{ rotacion: "A", total: 0-100, criterios: { agua, suelo, erosion, forraje, clima }, confianza: "Medio", avisos: [] }
```

## 1. Científico de Datos — `feature/data-processing`

| # | Tarea | Listo cuando |
|---|---|---|
| 1 | **YA** Lanzar los 2 pedidos de AppEEARS (NDVI + SMAP por punto; SRTM por área) | Ambos en "Queued" o "Processing" |
| 2 | Guardar `data/power_cache/cajamarca.json` (POWER `monthly` 1991–2024) como plan B | `api.js` lo puede leer |
| 3 | Correr `build_climate_bias.py` para Huancayo, Puno y Cusco | 4 archivos en `data/pilots/` |
| 4 | Crear `data/pilots_index.json` (`id`, `nombre`, `lat`, `lon`, `disponible`) | El mapa dibuja los pilotos |
| 5 | `scripts/process_appeears.py`: NDVI filtrado por `pixel_reliability` 0–1 (promedio mensual + tendencia), SMAP filtrado por `qual_flag` (promedio + anomalía), SRTM pendiente media y máxima (%) | `cajamarca.json` tiene `ndvi`, `soil_moisture` y `terrain` |
| 6 | Si a las 13:00 AppEEARS no entregó: NDVI de Giovanni como imagen | PNG en `docs/` |

## 2. Desarrollador Web — `feature/ui-map`

| # | Tarea | Listo cuando |
|---|---|---|
| 1 | **YA** Activar GitHub Pages y sumar a los otros 3 al repo | Todos hacen push y Pages responde |
| 2 | `index.html` con 4 pasos: mapa → prioridades → resultados → glosario, más el aviso "apoya, no reemplaza al técnico local" | Se ve en 360 px sin scroll horizontal |
| 3 | Mapa Leaflet 1.9.4: clic marca la parcela, pilotos desde `pilots_index.json`, latitud entre −6 y −16 | Al hacer clic aparecen lat/lon |
| 4 | Validar altitud ≥ 2 500 m con `geometry.coordinates[2]` de POWER | Un punto en Lima muestra advertencia |
| 5 | `js/api.js`: POWER `monthly`, quitar claves `YYYY13`, mm/día → mm/mes, EVPTRNS ÷ 2.45 → mm, aplicar `climate_bias`, usar `power_cache` si falla | Devuelve los 12 meses del contrato |
| 6 | Panel de prioridades: 5 sliders 0–5 con texto simple | Mover un slider recalcula |
| 7 | `js/charts.js` (Chart.js 4.4.4): calendario de riesgos y radar de rotaciones | Se ven con datos de prueba |
| 8 | Primer deploy a las 17:00 | El link público abre |

## 3. Ing. de Reglas — `feature/scoring-engine`

| # | Tarea | Listo cuando |
|---|---|---|
| 1 | **YA** Completar `data/cultivos.json` (8 cultivos, FAO GAEZ / INIA, `estimado: true` si no hay fuente) | Todos los campos con fuente |
| 2 | `data/rotaciones.json`: las 3 rotaciones como calendario de 24 meses | Cada mes tiene cultivo o "descanso" |
| 3 | `js/scoring.js` paso 2: puntaje 0–100 por cultivo y mes (helada, agua, temperatura) | Funciones puras, sin DOM |
| 4 | Pasos 3–4: 5 criterios normalizados 0–100 (más alto = mejor) y promedio ponderado | Pesos en 0 no dividen por 0 |
| 5 | Paso 5: confianza **Alto** (piloto con NDVI+SMAP+SRTM), **Medio** (POWER corregido), **Bajo** (POWER sin corregir), más `avisos[]` | Cada resultado trae ambos |
| 6 | `test.html` con casos fijos de Cajamarca | B o C superan a A con peso de suelo alto |

## 4. Comunicador — `feature/rotation-cards`

| # | Tarea | Listo cuando |
|---|---|---|
| 1 | **YA** Confirmar la hora de cierre en Perú y crear la página del proyecto en Space Apps | Página en borrador |
| 2 | Fichas de evidencia de las 3 rotaciones en lenguaje simple | `data/fichas.json` |
| 3 | Explicar el sesgo de heladas de POWER y la corrección con PISCO | En fichas y en una diapositiva |
| 4 | Glosario (§14 del brief) a `data/glosario.json` | La app lo muestra |
| 5 | README completo (datasets, demo, scripts, uso de IA) | Cumple el checklist §11 |
| 6 | Día 2: 10 diapositivas, guion y video de 3–5 min | Video en YouTube |

## Puntos de sincronización

- **13:00** — ¿Llegó AppEEARS? Integrar `api.js` con `scoring.js`.
- **17:00** — Primer deploy: merge a `main`.
- **21:00** — Decidir qué entra al demo y qué queda como trabajo futuro.
