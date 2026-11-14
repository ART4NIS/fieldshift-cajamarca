# FieldShift Perú — Briefing Completo de Desarrollo
**NASA Space Apps Challenge 2026**
Sitio piloto: Cajamarca · Sierra Norte Peruana · 14–15 Nov 2026

---

## 00. El Reto: Field Shift — Adapting Farms with NASA Data

### Descripción oficial del reto

El reto **"Field Shift: Adapting Farms with NASA Data"** del NASA Space Apps Challenge 2026 pide a los equipos crear **herramientas de código abierto** que permitan a comunidades agrícolas —especialmente en regiones vulnerables al cambio climático— tomar decisiones informadas sobre qué cultivos plantar, cuándo plantarlos y cómo organizarlos en rotaciones inteligentes, utilizando datos reales de la NASA.

La premisa del reto es que los agricultores en muchas regiones del mundo ya están experimentando cambios en patrones de lluvia, heladas, temperatura y humedad del suelo. Sin acceso a datos ni a herramientas que los interpreten, deben tomar decisiones críticas de siembra "a ciegas". La NASA ha recopilado décadas de datos satelitales y climáticos que pueden cambiar esa ecuación.

### Lo que el reto pide específicamente

| Criterio de evaluación | Peso | Descripción |
|---|---|---|
| **Uso creativo de datos NASA** | 25% | Usar al menos un dataset de la NASA de forma central y no decorativa |
| **Relevancia del problema** | 25% | Que el problema sea real y la solución sea útil para comunidades agrícolas reales |
| **Calidad técnica** | 25% | Que funcione correctamente, sea reproducible y esté documentado |
| **Potencial de impacto** | 25% | Que pueda escalar, que sea de código abierto, que inspire a otros |

### Tipos de soluciones válidas según el reto

- Herramienta interactiva web o móvil para agricultores o técnicos agrícolas
- Dashboard de visualización de datos climáticos y agronómicos
- Sistema de recomendación de cultivos o rotaciones basado en datos satelitales
- API o biblioteca de código abierto que otros puedan reutilizar

### Por qué nuestra solución responde al reto

| Requisito del reto | Nuestra respuesta |
|---|---|
| Datos NASA centrales | NASA POWER (clima 1991–2024) + MODIS NDVI + SMAP humedad + SRTM elevación |
| Problema real | Agricultores de la sierra peruana pierden cosechas por heladas, sequías y degradación del suelo |
| Código abierto | Repositorio público en GitHub, licencia MIT |
| Escalable | La arquitectura de dos niveles permite cubrir cualquier punto de la sierra desde el primer día |
| Muestra vacíos de datos | La app incluye fichas de evidencia con advertencias explícitas sobre incertidumbre |

### Objetivos de nuestra solución (lo que queremos lograr)

1. **Objetivo principal:** Que un agricultor en Cajamarca pueda abrir la herramienta en su celular, marcar su parcela, responder 5 preguntas sobre sus prioridades, y obtener en menos de 30 segundos una comparación de 3 rotaciones de cultivo respaldada por datos reales de la NASA.

2. **Objetivo de datos:** Integrar como mínimo NASA POWER API (obligatorio), y si los datos llegan a tiempo, MODIS NDVI, SMAP humedad de suelo y SRTM pendiente para Cajamarca.

3. **Objetivo de transparencia:** Mostrar siempre la fuente de cada dato, el nivel de confianza de la recomendación, y qué información falta o no pudo verificarse con datos satelitales.

4. **Objetivo de escalabilidad:** Diseñar la arquitectura para que añadir nuevos puntos piloto (Huancayo, Puno, Cusco) sea tan simple como agregar un nuevo archivo JSON al repositorio.

5. **Objetivo de despliegue:** Demo en vivo en GitHub Pages con un enlace público que el jurado pueda abrir y probar durante la evaluación.

---

## 01. Objetivo y Alcance Mínimo

Una herramienta web que corra en el navegador, sin servidor propio, que permita al agricultor andino marcar cualquier punto de la sierra peruana, declarar sus prioridades y recibir una comparación de **3 rotaciones de cultivo** respaldada por datos reales de la NASA.

### Enfoque de dos niveles

- **Nivel 1 — Sierra libre:** el usuario marca cualquier punto entre los paralelos 6°S y 16°S sobre los 2 500 m s.n.m. NASA POWER responde en vivo para ese punto. El calendario de riesgos y la comparación de rotaciones funcionan en *toda la sierra*.
- **Nivel 2 — Puntos piloto detallados:** para Cajamarca (y los puntos opcionales si los datos llegan) se muestran gráficos adicionales de NDVI, humedad de suelo y pendiente.

### Sitio piloto principal
| Campo | Valor |
|---|---|
| Ubicación | Cajamarca, Cajamarca |
| Coordenadas | Lat: -7.16 · Lon: -78.51 |
| Altitud | ~2 750 m s.n.m. |
| Tile SRTM | S08W079 |
| Rotación base | Papa → Maíz → Trigo → Descanso |

### Fuera del alcance (no tocar en el hackathon)
- Cobertura de todo Perú sin validación agronómica por región
- Modelos de IA o ML entrenados
- Cuentas de usuario / base de datos propia
- App móvil nativa
- Precios de mercado en vivo
- ECOSTRESS y GRACE (mencionarlos como trabajo futuro)

---

## 02. Arquitectura del Sistema

```
Navegador del agricultor
    │
    ├─ Mapa (Leaflet) ──► el usuario marca su parcela (lat/lon)
    │
    ├─ Panel de prioridades ──► pesos del agricultor (0–5 por criterio)
    │
    ├─ NASA POWER API (fetch en vivo)
    │       └─ Temperatura, lluvia, heladas 1991–2024
    │
    ├─ JSON estáticos (preprocesados con Python)
    │       ├─ data/pilots/cajamarca.json   (MODIS + SMAP + SRTM)
    │       ├─ data/pilots_index.json       (lista de pilotos disponibles)
    │       └─ data/cultivos.json           (tabla agrónoma: 8 cultivos)
    │
    ├─ Motor de reglas (scoring.js)
    │       ├─ Calcula indicadores mensuales por cultivo
    │       ├─ Puntúa 3 rotaciones × 5 criterios × peso del agricultor
    │       └─ Asigna nivel de confianza (Alto / Medio / Bajo)
    │
    └─ Renderizado
            ├─ Calendario de riesgos (Chart.js — barras apiladas)
            ├─ Tabla comparativa 3 rotaciones
            ├─ Fichas de evidencia y advertencias
            └─ Glosario de términos técnicos
```

Todo corre en el cliente (HTML + JS). No hay backend. GitHub Pages sirve los archivos estáticos.

---

## 03. Tecnologías y Librerías

| Capa | Herramienta | Versión | Por qué |
|---|---|---|---|
| Interfaz base | HTML + CSS + JS (vanilla) | — | Sin build steps, listo en minutos |
| Mapa interactivo | Leaflet.js | 1.9.4 | Ligero, OpenStreetMap gratuito |
| Gráficos | Chart.js | 4.4.4 | Barras, líneas y radar con una sola librería |
| Preprocesamiento | Python 3 + pandas + rasterio + numpy | — | Leer GeoTIFF de SRTM/SMAP y exportar JSON |
| Control de versiones | Git + GitHub | — | Colaboración y despliegue automático |
| Despliegue | GitHub Pages | — | Gratis, enlace público para el jurado |
| Clima en vivo | NASA POWER API (REST) | v2 | Sin clave, llamada desde `fetch()` en el browser |

> **No usar React ni frameworks pesados.** Sin tiempo para configurar bundlers. Vanilla JS con Chart.js y Leaflet es suficiente para ganar.

---

## 04. Datos NASA — Qué Usar y Cómo

### 4.1 NASA POWER — API en vivo (núcleo del proyecto)

```
GET https://power.larc.nasa.gov/api/temporal/climatology/point
    ?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,EVPTRNS
    &community=AG
    &longitude=-78.51
    &latitude=-7.16
    &format=JSON
```

| Parámetro | Variable | Para qué sirve |
|---|---|---|
| Temperatura máxima | `T2M_MAX` | Estrés por calor en cultivos |
| Temperatura mínima | `T2M_MIN` | Riesgo de helada (< 0 °C) |
| Precipitación | `PRECTOTCORR` | Meses secos y lluvias extremas |
| Evapotranspiración | `EVPTRNS` | Balance hídrico del suelo |
| Radiación solar | `ALLSKY_SFC_SW_DWN` | Fotosíntesis y crecimiento |
| Humedad relativa | `RH2M` | Condiciones para enfermedades |

### 4.2 MODIS — NDVI (AppEEARS, pedir HOY con todos los puntos)

- **Producto:** MOD13Q1 — NDVI cada 16 días, 250 m de resolución
- **Período:** 2015–2024
- **Portal:** https://appeears.earthdatacloud.nasa.gov
- **Tipo:** Point Sample — un solo pedido con los 4 puntos

| Punto | Lat | Lon | Día |
|---|---|---|---|
| Cajamarca | -7.16 | -78.51 | Día 1 (obligatorio) |
| Huancayo (Junín) | -12.07 | -75.21 | Día 2 si llega |
| Puno | -15.84 | -70.02 | Día 2 si llega |
| Cusco | -13.52 | -71.97 | Día 2 si llega |

### 4.3 SMAP — Humedad del suelo (mismo pedido que MODIS)

- **Producto:** SPL3SMP.009 — humedad superficial (m³/m³), ~9 km
- **Variable:** `Soil_Moisture_Retrieval_Data_AM_soil_moisture`

### 4.4 SRTM — Elevación y pendiente

| Punto | Tile SRTM | Cuándo |
|---|---|---|
| Cajamarca | `S08W079` | Día 1 (obligatorio) |
| Huancayo | `S13W076` | Día 2 si hay tiempo |
| Puno | `S16W071` | Día 2 si hay tiempo |
| Cusco | `S14W073` | Día 2 si hay tiempo |

Descarga: https://earthexplorer.usgs.gov (requiere cuenta Earthdata gratuita)

### 4.5 FAO GAEZ — Aptitud de cultivos

Portal: https://gaez.fao.org — buscar cada cultivo para la zona andina peruana y extraer manualmente aptitud, temperatura óptima y tolerancia hídrica hacia `cultivos.json`.

**Plan B si AppEEARS falla:** Giovanni (https://giovanni.gsfc.nasa.gov) genera gráficos sin descargar archivos. El calendario de riesgos sigue funcionando solo con NASA POWER.

---

## 05. Estructura del Repositorio

```
fieldshift-cajamarca/
├── data/
│   ├── cultivos.json             ← tabla agrónoma de los 8 cultivos
│   ├── pilots/
│   │   ├── cajamarca.json        ← NDVI + SMAP + SRTM · Día 1
│   │   ├── huancayo.json         ← si llegan los datos · Día 2
│   │   ├── puno.json             ← si llegan los datos · Día 2
│   │   └── cusco.json            ← si llegan los datos · Día 2
│   └── pilots_index.json         ← lista de puntos con coords
├── js/
│   ├── api.js                    ← llama a NASA POWER, maneja errores
│   ├── scoring.js                ← motor de reglas y puntuación
│   ├── charts.js                 ← renderiza gráficos con Chart.js
│   └── ui.js                     ← manipulación del DOM, eventos
├── css/
│   └── style.css
├── scripts/                      ← scripts Python de preprocesamiento
│   ├── process_srtm.py
│   └── process_appeears.py
├── index.html                    ← página principal
└── README.md
```

---

## 06. Tabla de Cultivos — `cultivos.json`

Los 8 cultivos prioritarios para la sierra peruana:

| Cultivo | Fija N | Forraje | Agua (mm/ciclo) | Tolerancia sequía | Ingresos |
|---|---|---|---|---|---|
| Papa | No | No | 500 | Baja | Alto |
| Maíz | No | Parcial | 450 | Media | Medio |
| Trigo | No | No | 350 | Media | Medio |
| Haba | Sí (~100 kg N/ha) | Sí | 300 | Media | Medio |
| Tarwi | Sí (~80 kg N/ha) | No | 280 | Alta | Medio |
| Cebada | No | Sí | 300 | Media | Bajo |
| Avena forrajera | No | Sí | 320 | Media | Bajo |
| Vicia sativa | Sí (~60 kg N/ha) | Sí | 250 | Alta | Bajo |

---

## 07. Las 3 Rotaciones a Comparar

### Rotación A — Tradicional (actual)
**Papa → Maíz → Trigo → Descanso**
- Rotación típica de Cajamarca
- Alta demanda de agua y nutrientes
- No fija nitrógeno
- Campo desnudo 3–4 meses en estación seca

### Rotación B — Nitrógeno+ (con leguminosas)
**Papa → Haba → Cebada → Avena forrajera**
- Haba fija ~100 kg N/ha/año
- Avena cubre suelo y alimenta el ganado lechero
- Cajamarca tiene fuerte tradición ganadera: el forraje suma valor real
- Reduce fertilizante sintético necesario

### Rotación C — Agua Eficiente (resiliente)
**Papa → Tarwi → Trigo → Vicia sativa**
- Tarwi fija nitrógeno y tolera la estación seca de Cajamarca
- Vicia sativa es cobertura verde: reduce erosión y agrega materia orgánica
- Menor consumo de agua total que la rotación actual
- Tarwi tiene mercado creciente como superalimento

### Fichas de evidencia (lo que muestra la app por cada rotación)

| Campo | Contenido | Fuente |
|---|---|---|
| ¿Por qué se sugiere? | Texto en lenguaje simple | Motor de reglas + cultivos.json |
| Evidencia NASA | Gráfico con período óptimo marcado | NASA POWER |
| Beneficios esperados | Nitrógeno, erosión, agua, ingresos | cultivos.json + FAO GAEZ |
| Vacíos de información | Qué no se verificó con datos satelitales | Transparencia explícita |
| Riesgos a revisar | Lo que un técnico local debe validar | Redacción del equipo |
| Nivel de confianza | 🟢 Alto / 🟡 Medio / 🔴 Bajo | Motor de reglas |

---

## 08. Motor de Reglas — `scoring.js`

Motor estadístico transparente, sin ML.

### Paso 1: Indicadores mensuales (NASA POWER)
```javascript
indicadores[mes] = {
  prob_helada:     // % de años donde T2M_MIN < 0 °C
  lluvia_avg:      // PRECTOTCORR promedio (mm)
  lluvia_cv:       // coef. variación (incertidumbre)
  deficit_hidrico: // lluvia_avg - EVPTRNS_avg
  temp_media:      // (T2M_MAX + T2M_MIN) / 2
}
```

### Paso 2: Puntaje por cultivo × mes
```javascript
score_mes = 100
  - penalidad_helada(prob_helada, cultivo.temp_helada)
  - penalidad_agua(deficit_hidrico, cultivo.agua_mm_ciclo)
  - penalidad_temperatura(temp_media, cultivo.temp_opt_min/max)
// Resultado: 0–100 por mes durante el ciclo del cultivo
```

### Paso 3: Puntaje de rotación × 5 criterios

| Criterio | Cómo se calcula | Dato fuente |
|---|---|---|
| Ahorro de agua | Suma de agua_mm_ciclo × (1 − cobertura) | cultivos.json |
| Salud del suelo | N fijado + cobertura_suelo promedio | cultivos.json |
| Riesgo de erosión | Cobertura × (1 − pendiente_norm) | SRTM + cultivos.json |
| Forraje / Ingresos | Suma de cultivos con forraje=true | cultivos.json |
| Resiliencia climática | Score climático promedio del ciclo | NASA POWER |

### Paso 4: Puntaje final ponderado
```javascript
score_rotacion = Σ (criterio_i × peso_agricultor_i) / Σ pesos
// peso_agricultor_i: 0–5, elegido por el usuario
// Resultado final: 0–100 por rotación
```

### Paso 5: Nivel de confianza
```javascript
"Alto"   // usa solo datos medidos (NASA POWER, SMAP)
"Medio"  // algún criterio usa valores estimados de cultivos.json
"Bajo"   // falta SMAP o SRTM, solo NASA POWER disponible
```

---

## 09. Cronograma de 2 Días

> ⚠️ **Antes de cualquier otra cosa (primeros 20 minutos):** Crear cuenta en Earthdata, lanzar pedidos en AppEEARS y crear el repositorio en GitHub.

### DÍA 1 — Viernes 14 Nov

| Hora | Tarea |
|---|---|
| 08:00–08:30 | 🚨 Crear cuentas Earthdata · AppEEARS pedido MODIS+SMAP para Cajamarca + 3 puntos opcionales · GitHub repo |
| 08:30–09:00 | Repartir roles del equipo |
| 09:00–11:00 | Script Python NASA POWER + cultivos.json · HTML base con mapa Leaflet y panel de prioridades |
| 11:00–13:00 | Motor de reglas (scoring.js) · Calendario de riesgos con Chart.js |
| 13:00–14:00 | Almuerzo · Verificar si datos de Cajamarca llegaron en AppEEARS |
| 14:00–17:00 | Tabla comparativa 3 rotaciones · Fichas de evidencia · Glosario |
| 17:00–18:00 | ✅ Primer despliegue en GitHub Pages |
| 18:00–21:00 | Integrar MODIS, SMAP y SRTM si llegaron · Avanzar presentación |

### DÍA 2 — Sábado 15 Nov

| Hora | Tarea |
|---|---|
| 08:00–10:00 | Integrar datos satelitales + pulir gráficos · Verificar todo funciona para Cajamarca |
| 10:00–12:00 | Testing con 3 ubicaciones distintas · Corregir errores · Responsive en móvil |
| 12:00–14:00 | Grabar video demo (3–5 min) con OBS o Loom |
| 14:00–16:00 | Diapositivas (10 slides): Problema · Solución · Datos NASA · Demo · Rotaciones · Lógica · Trabajo futuro · Equipo |
| 16:00–17:00 | 🚨 Completar página del proyecto en Space Apps |
| 17:00 | ✅ ENTREGA FINAL con margen de tiempo |

---

## 10. Configuración GitHub + Despliegue

### Pasos

1. **Crear repositorio:** `fieldshift-cajamarca` · Público · Licencia MIT
2. **Habilitar GitHub Pages:** Settings → Pages → Branch: `main` / `(root)` → Save
3. **URL del demo:** `https://[usuario].github.io/fieldshift-cajamarca/`

### Flujo de trabajo del equipo
```bash
# Cada persona trabaja en su rama
git checkout -b feature/scoring-engine
git add .
git commit -m "feat: motor de puntuación con NASA POWER"
git push origin feature/scoring-engine
# Crear Pull Request → revisar → merge a main
# GitHub Pages actualiza automáticamente
```

### Ramas sugeridas

| Rol | Rama |
|---|---|
| Datos + Python | `feature/data-processing` |
| Interfaz + mapa | `feature/ui-map` |
| Motor de reglas | `feature/scoring-engine` |
| Contenido + fichas | `feature/rotation-cards` |

### README.md mínimo requerido
```markdown
# FieldShift Cajamarca 🌾
Herramienta de apoyo a decisiones para rotaciones de cultivo
en la sierra peruana usando datos NASA.

## 🛰 Datasets NASA utilizados
- NASA POWER API (clima diario 1991–2024)
- MODIS MOD13Q1 (NDVI vegetación)
- SMAP SPL3SMP (humedad suelo)
- SRTM (elevación y pendiente)

## 🌍 Demo en vivo
https://[usuario].github.io/fieldshift-cajamarca/

## 🏔 Sitio piloto
Cajamarca, Perú (-7.16, -78.51)

## Licencia
MIT
```

---

## 11. Checklist de Entrega — Space Apps

> ⚠️ Verificar la hora exacta de cierre del evento local en Perú.

- [ ] Nombre del proyecto
- [ ] Descripción corta (1 párrafo)
- [ ] Video demo en YouTube (3–5 min)
- [ ] Enlace al repositorio en GitHub
- [ ] Enlace al demo en vivo (GitHub Pages)
- [ ] Lista de datasets NASA usados
- [ ] ¿Usaron IA? (sí/no y cómo)
- [ ] Referencias y fuentes

---

## 12. Planes de Contingencia

| Riesgo | Plan B |
|---|---|
| AppEEARS tarda más de 6 h | Solo NASA POWER para el demo. NDVI desde Giovanni como imagen estática en diapositivas. |
| NASA POWER API falla en vivo | Guardar respuesta del piloto como `power_cache.json`. `api.js` la usa si el fetch falla. |
| Sin internet durante el demo | `python -m http.server 8000` localmente. Todo es estático. |
| Datos agronómicos incompletos | Usar valores de FAO e INIA, marcarlos como "estimado". Muestra los vacíos de información (lo que el reto pide). |
| Miembro del equipo abandona | MVP mínimo: NASA POWER + cultivos.json + 3 rotaciones. No requiere AppEEARS ni Python. |

---

## 13. Roles del Equipo

| Rol | Responsabilidades |
|---|---|
| **Científico de Datos** | Script Python · AppEEARS · NASA POWER · cultivos.json · JSONs de NDVI, SMAP y SRTM |
| **Desarrollador Web** | index.html · Leaflet mapa · Chart.js gráficos · Panel de prioridades · Diseño responsive |
| **Ing. de Reglas** | scoring.js · Motor de puntuación · Nivel de confianza · Fichas de evidencia |
| **Comunicador** | Video demo · Diapositivas · README · Página Space Apps · Textos para el agricultor |

> **Si son 3 personas:** Rol Ing. de Reglas + Científico de Datos lo hace la misma persona.
> **Si son 2 personas:** Una hace datos + lógica, la otra hace interfaz + presentación.

---

## 14. Glosario para la App

| Término técnico | Explicación simple |
|---|---|
| NDVI | Número del -1 al 1 que dice qué tan verde y sano está el campo. Más cerca de 1 = más vegetación verde y vigorosa. |
| Evapotranspiración | Cuánta agua pierde el suelo y las plantas entre el sol y la respiración de las hojas. Indica cuánta agua "consume" el campo. |
| Anomalía de humedad | Si el suelo tiene más o menos agua de lo normal para esa época del año en ese lugar. |
| Riesgo de helada | Qué tan probable es que la temperatura baje a 0 °C o menos en un mes, según los últimos 30 años. |
| Balance hídrico | Diferencia entre el agua que cae (lluvia) y la que se evapora. Negativo = déficit. |
| Dato satelital vs. en campo | El satélite ve desde 500 km y da un promedio del área. La estación meteorológica mide exactamente en un punto. Los dos juntos son más confiables que uno solo. |

---

> **Recuerda:** La herramienta apoya al agricultor — no reemplaza su conocimiento ni el de los técnicos locales. Incluir ese aviso en la interfaz es un punto explícito del reto.

---
*FieldShift Cajamarca · NASA Space Apps Challenge 2026 · Generado el 14 Nov 2026*
