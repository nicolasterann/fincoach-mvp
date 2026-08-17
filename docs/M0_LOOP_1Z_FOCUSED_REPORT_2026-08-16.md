# M0 — Reproducción enfocada 1Z

Fecha: 2026-08-16  
Árbol: local, sin commit  
Contrato: ADENDA 18 / reproducción real enfocada posterior a 1Z  
Resultado: **ROJO — 2/4 escenarios duros verdes; no se lanzó ninguna corrida completa.**

## 1. Ejecución autorizada

Servidor local:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Única pasada real, sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1Z_FOCUSED_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME5,ME16,ME17,REAL_FOUR_CREDITS > docs/evidence/M0_LOOP_1Z_FOCUSED_2026-08-16.log 2>&1
~~~

Exit directo del runner: **1**. El servidor local fue detenido después del cierre del runner.

El launcher de corridas completas no se usó porque no expone el filtro `--scenario`; el runner público sí lo hace y ejecutó exactamente los cuatro escenarios autorizados. No hubo una segunda pasada.

## 2. Resultado por escenario

| Escenario | Dinero | Conducta | Calidad | Resultado duro |
|---|---:|---:|---:|---:|
| ME5 | PASS | PASS | 4.75 | VERDE |
| ME16 | PASS | PASS | 4.75 | VERDE |
| ME17 | FAIL | PASS | 4.50 | ROJO |
| REAL_FOUR_CREDITS | FAIL | PASS | 4.00 | ROJO |

Resumen del runner:

~~~text
Calidad promedio: 4.50/5
M0 tres carriles (loop): 2/4 duros verdes
FAILURES: ME17 | REAL_FOUR_CREDITS
~~~

## 3. Diagnóstico tipado de los dos rojos

Clase común: **`PRODUCT_LOOP/POST_WRITE_MANIFEST_SETTLEMENT_UNAVAILABLE`**.

En ME17 y REAL_FOUR_CREDITS ocurrió la misma frontera observable:

- la propuesta sucesora durable contiene exactamente ocho acciones: cuatro `register_card_payment` seguidas de cuatro `close_card`;
- el manifiesto propuesto y el observado al final conservan el mismo `id`, `operation_id`, conjunto de acciones y `manifest_hash`;
- las ocho acciones aparecen en `toolTrace` con `status:"done"`; no hubo re-emisión duplicada ni sucesor adicional;
- los cuatro pagos aterrizaron una sola vez por **11.11, 12.22, 13.33 y 14.44 USD**; Produbanco pasó exactamente de **1000.00 a 948.90**;
- los restantes checks de estado monetario, incluidos los cuatro cierres, pasaron; el único check de DINERO rojo en cada escenario fue `one four-action proposal becomes verified`;
- tras los writes, el manifiesto quedó `status:"executing"` y `verification:null`;
- el turno terminó con `outcome={wrote:true,hadError:true}`, `loopDiagnostic={stage:"turn",code:"unavailable"}` y la continuidad post-write.

La lectura acotada del producto ubica el fallo después de ejecutar los ocho writers y dentro de `settleDurableWork`, antes de que `kipu_verify_agent_loop_manifest` deje evidencia durable `verified`. La evidencia preservada no contiene el mensaje crudo que permitiría discriminar entre la verificación individual de un step y la verificación final del manifiesto; clasificarlo más estrechamente sería especulativo. No se instrumentó, no se reprodujo otra vez y no se modificó producto.

No disparó el criterio de escritura monetaria equivocada: la cantidad, dirección, saldo y cardinalidad de los pagos son exactos. Sí queda incumplido el invariante no-crash 1Z y la prueba durable de paridad del conjunto.

## 4. Evidencia y orden respecto del cleanup

- `docs/evidence/M0_LOOP_1Z_FOCUSED_2026-08-16.log`: salida íntegra, transcripts, jueces y diagnósticos. Cada transcript/diagnóstico se escribe antes de la línea de cleanup de su escenario; ME17 está antes de su cleanup en líneas 22–24 y REAL_FOUR_CREDITS en líneas 30–32.
- `docs/evidence/M0_LOOP_1Z_FOCUSED_2026-08-16.usage.json`: snapshot durable final de uso y costo.

El runner informó:

~~~text
[ME5] cleanup por identidad: cero
[ME16] cleanup por identidad: cero
[ME17] cleanup por identidad: cero
[REAL_FOUR_CREDITS] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
~~~

## 5. Uso y costo real

~~~text
loopUsage agregado: {"cachedInputTokens":664448,"calls":29,"inputTokens":738218,"outputTokens":2375}
Judge usage agregado: {"cachedInputTokens":0,"calls":4,"inputTokens":7137,"outputTokens":481}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":692}
Costo real acumulado: 0.391151 USD
~~~

El snapshot durable coincide: `actualUsd=0.391151`, actualizado a `2026-08-16T15:22:04.325Z`.

## 6. Parada contractual

No se lanzó la corrida completa 1 de 3, ni ninguna otra corrida o reintento. No hubo commit, push, deploy, DDL ni writes sobre la cuenta real del founder.

**Enfocada 1Z lista para Claude.**
