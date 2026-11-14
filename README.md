# FieldShift Cajamarca 🌾

Herramienta de apoyo a decisiones para rotaciones de cultivo en la sierra peruana usando datos NASA.
Proyecto para el NASA Space Apps Challenge 2026 — reto *Field Shift: Adapting Farms with NASA Data*.

## 🛰 Datasets NASA utilizados

- NASA POWER API (clima mensual y diario 1991–2024)
- MODIS MOD13Q1.061 (NDVI vegetación, 250 m)
- SMAP SPL3SMP_E.006 (humedad del suelo, 9 km)
- SRTM SRTMGL1_NC.003 (elevación y pendiente, 30 m)

Validación local de temperatura: SENAMHI PISCOt v1.1 (vía IRI/LDEO Climate Data Library).

## 🌍 Demo en vivo

https://art4nis.github.io/fieldshift-cajamarca/ (disponible tras el primer deploy)

## 🏔 Sitio piloto

Cajamarca, Perú (-7.16, -78.51)

## Preprocesamiento

```bash
python scripts/build_climate_bias.py --pilot cajamarca --lat -7.16 --lon -78.51
```

Genera `data/pilots/cajamarca.json` con la corrección mensual de temperatura (PISCO − POWER) y estadísticas de heladas.

## Equipo

Plan de trabajo y tareas por persona: [docs/TAREAS.md](docs/TAREAS.md)

## Licencia

MIT
