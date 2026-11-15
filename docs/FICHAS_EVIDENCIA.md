# Evidence reports

Document review: November 14, 2026. Reports for A, B and C are stored in `data/fichas.json` and displayed with each result. Each benefit links to a source and its scope through identifiers. Text is the team's synthesis, not verbatim quotations. Original publication titles are retained for traceable citations.

## What the research supports

- FAO good agricultural practices framework, annex ii and vi: ground cover, residues and legumes as management principles. It does not test these three sequences in Cajamarca.
- FAO crop water needs, introduction and section 3.3.4: water requirements depend on climate, species and growth stage. It does not establish a particular percentage of water savings for C relative to A.
- INIA Chile faba bean factsheet: potential as green manure and a nitrogen source; its context does not validate grain harvest or forage use in Peru. It warns against forage use in that context, in contrast with the model's value.
- INIA Peru annual associated pastures record and abstract (2021): oats, vetch and peas for highland livestock feed. It does not test sequence B.
- FAO Ecocrop, Andean lupin: nitrogen fixation, young-plant sensitivity to frost and excess moisture. It does not validate the engine's estimated water requirement.
- INIA Peru vetch record and abstract (2013): forage use in Junín. It does not establish suitability at every point in the highlands.

Titles, consulted links, sections and limitations are in `data/fichas.json`. For the two INIA Peru publications, institutional records and abstracts were consulted; no figures are attributed to the full texts.

## Climate evidence and estimates

`api.js` reports the source actually used (online or cached), whether a correction was applied, and the PISCO reference period. Reports display these alongside the current score and confidence level. POWER is queried for 1991–2024; this interval must not be confused with a pilot's correction period.

Water, nitrogen, ground cover and income values in `cultivos.json` retain `estimado: true`. Researching agronomic mechanisms does not validate those parameters. MODIS and SMAP do not yet contribute to results. Slope uses point SRTM data where available, with Copernicus DEM and pilot-area statistics as fallbacks; if unavailable, the engine uses an estimated 18 %. Reports in `js/ficha.js` disclose the actual slope source.

Reports do not hardcode scores, rankings, confidence levels or frost months. Engine-specific warnings remain visible. Yield, fertilizer savings and profitability are not guaranteed. A local trial and technical review remain pending.

## Content review

When adding or editing a report, check that its ID matches a rotation, every source identifier exists, and each benefit is supported by the cited section. Keep general documentary evidence, queried climate data and estimated parameters distinct.

English is the presentation language. Preserve internal identifiers, publication titles and source URLs when translating or updating content.
