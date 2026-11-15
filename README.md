# SowOrbit 🌾

Herramienta de apoyo a decisiones para rotaciones de cultivo en la sierra peruana usando datos NASA.
Proyecto para el NASA Space Apps Challenge 2026 — reto *Field Shift: Adapting Farms with NASA Data*.
El repositorio conserva el nombre inicial del proyecto, FieldShift Cajamarca.

El agricultor marca su parcela en el mapa, indica qué le importa más (agua, suelo, erosión, forraje, clima) y recibe una comparación de 3 rotaciones de cultivo con un calendario de riesgos de helada y sequía, el nivel de confianza del resultado y las fuentes de cada dato.

## Qué ofrece la interfaz

- **Parcela y prioridades en una pantalla:** mapa satelital con buscador de pueblos y un panel con las 5 prioridades.
- **Resultados en dos columnas:** una tarjeta por rotación a la izquierda; a la derecha, la ficha de la rotación elegida, con su explicación en palabras simples, la rotación año por año con fotos, los puntajes por criterio y los gráficos.
- **Confianza por color:** verde (alta), amarillo (media) y rojo (baja), siempre junto al texto.
- **Fichas en PDF:** una ficha o las tres en un solo archivo.
- **Glosario** con buscador y temas.
- **Tema oscuro por defecto**, con un botón para pasar al claro.

## 🌍 Demo en vivo

https://art4nis.github.io/fieldshift-cajamarca/

Si después de una actualización la página no carga, recárguela sin caché (Ctrl+Shift+R).

## 🛰 Datos que usa la app hoy

| Dato | Fuente | Para qué se usa |
|---|---|---|
| Clima mensual y diario 1991–2024 (T2M, T2M_MIN, PRECTOTCORR) | **NASA POWER** (API en vivo) | Núcleo del motor: temperatura, lluvia y frecuencia de heladas por mes |
| Corrección local de temperatura y lluvia | SENAMHI PISCOt v1.1 y PISCOp v2.1, vía IRI/LDEO Climate Data Library | Corrige el sesgo de POWER, que subestima las heladas en la sierra |
| Pendiente junto a los pilotos | **NASA SRTM** SRTMGL1_NC.003 (30 m), vía NASA AppEEARS | Pendiente en el punto cuando cae dentro del recorte de unos 5 km alrededor de un piloto, y qué parte de esa zona tiene laderas fuertes |
| Altitud y pendiente en el resto del área | Copernicus DEM 90 m, vía la API de elevación de Open-Meteo | Verifica que el punto esté sobre 2 500 m y calcula la pendiente fuera de los recortes SRTM |
| Lagos | OpenStreetMap (ODbL) | Impide marcar el Titicaca o Junín como parcela |
| Imagen del mapa | Esri World Imagery (satélite, por defecto), NASA GIBS Blue Marble y OpenStreetMap | Fondo del mapa; el usuario elige la capa |
| Fotos de los cultivos | Wikimedia Commons (autor y licencia en `data/imagenes_cultivos.json` y en cada ficha) | Ilustran cada año de la rotación; son fotos de referencia, no de la parcela |
| Búsqueda de lugares | OpenStreetMap Nominatim | Ubica un pueblo o distrito por su nombre (1 búsqueda por segundo, sin autocompletar) |

Datasets NASA activos: NASA POWER (clima, núcleo del motor) y SRTM (pendiente junto a los pilotos).

### Descargado pero todavía sin usar

Los dos pedidos de AppEEARS (`scripts/submit_appeears.py`) ya llegaron. MODIS y SMAP no se muestran por estas razones:

- **MODIS MOD13Q1.061 (NDVI, 250 m):** los puntos pedidos son el centro de cada ciudad, así que el NDVI mide techos y calles (0,1 a 0,3), no chacras. Hay que volver a pedirlo en puntos o áreas agrícolas.
- **SMAP SPL3SMP_E.006 (humedad del suelo, 9 km):** en los 4 pilotos solo el 32 % de los días tiene valor, y ninguno trae la calidad recomendada (algo habitual en terreno montañoso). `scripts/process_appeears.py` los descarta todos.

Sin NDVI ni humedad del suelo, el nivel de confianza nunca llega a "Alto".

## 🏔 Zonas con datos

Hay 22 pilotos repartidos por la sierra (lista en `data/pilots_index.json`). Se puede marcar cualquier punto de la sierra del Perú sobre 2 500 m (área verde del mapa):

- **Piloto (≤ 10 km):** corrección PISCO precalculada en `data/pilots/<id>.json`.
- **Otro punto del área:** la corrección PISCO se calcula en el navegador para ese punto (puede tardar hasta un minuto la primera vez y luego queda guardada).
- **Si ese cálculo falla:** se usa la corrección del piloto más cercano, se avisa la distancia y la confianza baja.

Agregar un piloto es agregar su entrada en `data/pilots_index.json` y generar su corrección y su caché de POWER con los scripts de abajo. El área no depende de los pilotos.

## ⚙️ Cómo reproducirlo

Es un sitio estático sin servidor ni bundler (Leaflet y Chart.js por CDN). Para correrlo localmente basta con un servidor estático en la raíz del repositorio.

```bash
npm install                                                              # d3-contour, solo para el script del área
npm test                                                                 # tests del motor, la API y el mapa
npm run bump                                                             # nueva versión de los .js, el .css y los datos antes de cada deploy

python scripts/build_climate_bias.py --pilot cajamarca --lat -7.16 --lon -78.51   # corrección PISCO de un piloto
python scripts/build_climate_fixture.py --pilot cajamarca                         # entrada mensual de referencia del motor
python scripts/build_power_cache.py                                               # caché de NASA POWER de los pilotos

python scripts/build_dem_grid.py                       # elevación Copernicus DEM de todo el Perú (sin cuota)
node scripts/build_selectable_area.mjs --whole-sierra  # área verde: sierra del Perú > 2 500 m
node scripts/build_water_mask.mjs           # máscara de lagos desde OpenStreetMap

# Salidas de AppEEARS en raw/appeears/ (no se suben al repo); requieren numpy y rasterio
pip install -r scripts/requirements.txt
python scripts/process_appeears.py          # estadísticas de terreno SRTM en data/pilots/<id>.json
python scripts/build_srtm_grids.py          # recortes SRTM 30 m para el navegador en data/srtm/
```

Los scripts de Python usan solo la biblioteca estándar.

## Fichas de evidencia

Cada resultado incluye una ficha con beneficios posibles, fuentes agronómicas, límites y preguntas para el técnico local. Contenido en `data/fichas.json`; alcance de la investigación y mantenimiento en [docs/FICHAS_EVIDENCIA.md](docs/FICHAS_EVIDENCIA.md).

## Límites

- Los parámetros de los cultivos son estimaciones de literatura, todavía sin validar en campo.
- El clima describe la zona y lo que pasó en años anteriores; no es un pronóstico.
- "Helada" significa una mínima bajo 2 °C medida a 2 m del suelo.
- La herramienta apoya, no reemplaza, al técnico agrario local.

## Uso de IA

Sí. Usamos un asistente de programación con IA (Claude Code, de Anthropic) para escribir y revisar parte del código y de los tests. El equipo tomó las decisiones de diseño y de datos y verificó los resultados.

## Referencias

- NASA POWER — https://power.larc.nasa.gov/
- SENAMHI PISCO (PISCOt v1.1, PISCOp v2.1) — https://iridl.ldeo.columbia.edu/SOURCES/.SENAMHI/.HSR/.PISCO/
- Open-Meteo Elevation API — https://open-meteo.com/en/docs/elevation-api
- Copernicus DEM GLO-90 — https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model
- OpenStreetMap — https://www.openstreetmap.org/copyright
- Nominatim (política de uso) — https://operations.osmfoundation.org/policies/nominatim/
- Esri World Imagery — https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
- NASA GIBS — https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
- NASA AppEEARS — https://appeears.earthdatacloud.nasa.gov/

## Equipo

Plan de trabajo y tareas por persona: [docs/TAREAS.md](docs/TAREAS.md)

## Licencia

MIT
