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
| Altitud y pendiente | Copernicus DEM 90 m, vía la API de elevación de Open-Meteo | Verifica que el punto esté sobre 2 500 m y calcula la pendiente del punto |
| Lagos | OpenStreetMap (ODbL) | Impide marcar el Titicaca o Junín como parcela |
| Imagen del mapa | Esri World Imagery (satélite, por defecto), NASA GIBS Blue Marble y OpenStreetMap | Fondo del mapa; el usuario elige la capa |
| Fotos de los cultivos | Wikimedia Commons (autor y licencia en `data/imagenes_cultivos.json` y en cada ficha) | Ilustran cada año de la rotación; son fotos de referencia, no de la parcela |
| Búsqueda de lugares | OpenStreetMap Nominatim | Ubica un pueblo o distrito por su nombre (1 búsqueda por segundo, sin autocompletar) |

NASA POWER es el único dataset NASA activo en la versión actual. La altitud y la pendiente vienen de Copernicus, no de SRTM.

### Pendiente de integrar

Los pedidos a AppEEARS ya están enviados (`scripts/submit_appeears.py`); su procesamiento está en el PR #2 y todavía no hay datos en la app:

- MODIS MOD13Q1.061 (NDVI, 250 m)
- SMAP SPL3SMP_E.006 (humedad del suelo, 9 km)
- SRTM SRTMGL1_NC.003 (elevación y pendiente, 30 m)

Mientras falten, el nivel de confianza nunca llega a "Alto".

## 🏔 Zonas con datos

Pilotos: Cajamarca (-7.16, -78.51), Huancayo, Puno y Cusco. Se puede marcar cualquier punto de la sierra sobre 2 500 m a menos de 100 km de un piloto (área verde del mapa):

- **Piloto (≤ 10 km):** corrección PISCO precalculada en `data/pilots/<id>.json`.
- **Otro punto del área:** la corrección PISCO se calcula en el navegador para ese punto (puede tardar hasta un minuto la primera vez y luego queda guardada).
- **Si ese cálculo falla:** se usa la corrección del piloto más cercano, se avisa la distancia y la confianza baja.

Agregar un piloto es agregar su JSON en `data/pilots/` y su entrada en `data/pilots_index.json`, y regenerar el área.

## ⚙️ Cómo reproducirlo

Es un sitio estático sin servidor ni bundler (Leaflet y Chart.js por CDN). Para correrlo localmente basta con un servidor estático en la raíz del repositorio.

```bash
npm install                                                              # d3-contour, solo para el script del área
npm test                                                                 # tests del motor, la API y el mapa
npm run bump                                                             # nueva versión de los .js, el .css y los datos antes de cada deploy

python scripts/build_climate_bias.py --pilot cajamarca --lat -7.16 --lon -78.51   # corrección PISCO de un piloto
python scripts/build_climate_fixture.py --pilot cajamarca                         # entrada mensual de referencia del motor
python scripts/build_power_cache.py                                               # caché de NASA POWER de los pilotos

node scripts/build_selectable_area.mjs      # área verde: sierra > 2 500 m a < 100 km de un piloto
node scripts/build_water_mask.mjs           # máscara de lagos desde OpenStreetMap
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
