# Fichas de evidencia

Revisión documental: 14 de noviembre de 2026. Las fichas de A, B y C están en `data/fichas.json` y aparecen en un desplegable de cada resultado. Cada beneficio enlaza mediante identificadores con una fuente y su alcance. Los textos son una síntesis del equipo, no citas textuales.

## Qué respalda la investigación

- FAO, marco de buenas prácticas, anexo ii y vi: cobertura, residuos y leguminosas como principios de manejo. No prueba estas tres secuencias en Cajamarca.
- FAO, necesidades hídricas, introducción y sección 3.3.4: el agua requerida depende del clima, la especie y su etapa. No permite afirmar que C ahorre un porcentaje determinado frente a A.
- INIA Chile, ficha de haba: potencial como abono verde y aporte de nitrógeno; su contexto no valida una cosecha de grano ni el uso forrajero en Perú. Advierte falta de utilización forrajera en ese contexto, en contraste con el valor del modelo.
- INIA Perú, registro y resumen de pastos asociados (2021): uso de avena, vicia y arveja para alimentación ganadera en la sierra. No prueba la secuencia B.
- FAO Ecocrop, tarwi: fijación de nitrógeno, sensibilidad de plantas jóvenes a heladas y al exceso de humedad. No valida la demanda hídrica estimada del motor.
- INIA Perú, registro y resumen de vicia (2013): uso de la leguminosa como forraje en Junín. No demuestra aptitud en cualquier punto de la sierra.

Los títulos, enlaces consultados, secciones y límites están en `data/fichas.json`. Para las dos publicaciones de INIA Perú se consultaron sus registros y resúmenes institucionales; no se atribuyen cifras al texto completo.

## Evidencia climática y estimaciones

`api.js` entrega la fuente realmente utilizada (en línea o copia guardada), si hubo corrección y el período de referencia de PISCO. La ficha muestra estos datos junto con el puntaje y la confianza del resultado actual. POWER se consulta para 1991–2024; no se confunde ese intervalo con el período de corrección del piloto.

Las cifras de agua, nitrógeno, cobertura e ingresos de `cultivos.json` conservan `estimado: true`. Investigar mecanismos agronómicos no valida esos parámetros. El resultado actual no usa MODIS, SMAP ni pendiente SRTM; se explica que la pendiente es una estimación de 18 %. Al integrar esos productos deberá actualizarse ese texto en `js/evidence.js` y el contexto del motor.

No se fijan puntajes, orden de recomendación, confianza ni meses de helada en las fichas. Los avisos específicos del motor siguen visibles en la tarjeta. No se promete rendimiento, ahorro de fertilizante ni rentabilidad. Un ensayo local y la revisión de un técnico siguen pendientes.

## Revisión de contenido

Al añadir o modificar una ficha, comprobar que su ID corresponde a una rotación, que cada identificador de fuente existe y que el beneficio tiene respaldo en la sección citada. Mantener separados el respaldo documental general, los datos climáticos consultados y los parámetros estimados.
