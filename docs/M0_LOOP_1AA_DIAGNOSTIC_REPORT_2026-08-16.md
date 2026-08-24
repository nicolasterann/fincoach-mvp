> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Enfocada de diagnóstico posterior a 1AA

Fecha: 2026-08-16  
Contrato: ADENDA 20  
Árbol: local, sin cambios durante la corrida  
Resultado: **ROJO — 0/2 escenarios duros verdes; no se lanzó ninguna corrida completa.**

## 1. Ejecución autorizada

Servidor local:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Única pasada real, sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1AA_DIAGNOSTIC_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME17,REAL_FOUR_CREDITS > docs/evidence/M0_LOOP_1AA_DIAGNOSTIC_2026-08-16.log 2>&1
~~~

Inicio observado: `2026-08-16T16:43:57Z`. Fin observado: `2026-08-16T16:47:32Z`. Exit directo del runner: **1**. El servidor se detuvo después de preservar y leer la evidencia. No hubo segunda pasada.

## 2. Resultado por escenario

| Escenario | Dinero | Conducta | Calidad | Resultado duro |
|---|---:|---:|---:|---:|
| ME17 | FAIL | PASS | 4.50 | ROJO |
| REAL_FOUR_CREDITS | FAIL | PASS | 4.50 | ROJO |

Resumen íntegro del runner:

~~~text
loopUsage agregado: {"cachedInputTokens":330112,"calls":15,"inputTokens":385953,"outputTokens":1583}
Judge usage agregado: {"cachedInputTokens":0,"calls":2,"inputTokens":4022,"outputTokens":250}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":683}
Costo real acumulado: 0.249235 USD
Calidad promedio: 4.50/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":3.37,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":4456512,"calls":203,"inputTokens":5210366,"outputTokens":21371},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":100550,"outputTokens":6250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":683}}}
M0 tres carriles (loop): 0/2 duros verdes
FAILURES: ME17 | REAL_FOUR_CREDITS
~~~

## 3. Diagnóstico tipado y settleFailure

La hipótesis pre-registrada `step_verify + KIPU_CONFLICT` por vencimiento del lease queda **REFUTADA en esta pasada**:

- el turno de confirmación de ME17 duró aproximadamente **41 s**;
- el de REAL_FOUR_CREDITS duró aproximadamente **40 s**;
- ambos están muy por debajo del lease de cinco minutos;
- ninguno emitió `KIPU_CONFLICT`.

La obligación de citar el `settleFailure` completo revela el hallazgo principal: **no existe `settleFailure` en ninguno de los dos rojos**. La evidencia literal es:

| Escenario | `loopDiagnostic` completo | `settleFailure` | sub-etapa | token | step_key | capability |
|---|---|---|---|---|---|---|
| ME17 | `{"code":"unavailable","stage":"turn"}` | **ausente** | no disponible | no disponible | no disponible | no disponible |
| REAL_FOUR_CREDITS | `{"code":"unavailable","stage":"turn"}` | **ausente** | no disponible | no disponible | no disponible | no disponible |

No se inventa una sub-etapa ni un token. La clase observada es:

`PRODUCT_LOOP/POST_WRITE_EXCEPTION_OUTSIDE_SETTLE_OBSERVABILITY`

La frontera queda acotada así:

1. En ambos escenarios las ocho tools aparecen `status:"done"`: cuatro `register_card_payment` y cuatro `close_card`.
2. Los cuatro pagos aterrizaron una vez por 11.11, 12.22, 13.33 y 14.44 USD; Produbanco pasó exactamente de 1000.00 a 948.90 y los checks de cierre pasaron.
3. El manifiesto no llegó a `verified`; REAL_FOUR_CREDITS lo observa `executing` con `verification:null`.
4. El catch exterior recibió el throw sin que `settleDurableWork` hubiera fijado su diagnóstico. Por control de flujo, el error ocurrió en la ventana post-write anterior al settle instrumentado. Como el `toolTrace` se agrega antes del refresh por write, las superficies todavía compatibles son el refresh posterior al último receipt o un paso posterior a la ejecución y anterior a `settleDurableWork` —incluida la completion de narración—. La evidencia no permite escoger honestamente entre ellas.

Esto no es el `step_verify` esperado por Claude y no prueba un defecto SQL/lease. La observabilidad 1AA funciona para throws dentro de `settleDurableWork`, pero estos dos throws no entraron en ese bloque.

## 4. Transcripts completos

### ME17

1. Usuario: «Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.»
   Asistente: identificó Crédito piloto 1–4 por 11.11, 12.22, 13.33 y 14.44 USD.
2. Usuario: «Perfecto, deja esos cuatro cubiertos desde mi Produbanco.»
   Asistente: propuso los cuatro pagos exactos y pidió confirmación.
3. Usuario: «Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.»
   Asistente: consolidó pagos + cierres y pidió una confirmación única.
4. Usuario: «Adelante con el conjunto tal como lo acabas de plantear.»
   Asistente: «No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.»

### REAL_FOUR_CREDITS

1. Usuario: «Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.»
   Asistente: identificó Crédito piloto 1–4 por 11.11, 12.22, 13.33 y 14.44 USD.
2. Usuario: «Perfecto, deja esos cuatro cubiertos desde mi Produbanco.»
   Asistente: dejó preparados los cuatro pagos y pidió confirmación.
3. Usuario: «Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.»
   Asistente: enumeró una propuesta única de cuatro pagos seguidos de cuatro cierres.
4. Usuario: «Adelante con el conjunto tal como lo acabas de plantear.»
   Asistente: «No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.»

La salida íntegra sin paráfrasis —incluidas las respuestas completas, los dos JSON `DIAGNÓSTICO`, manifiestos, hashes, toolTrace y cleanup— está preservada en el log de §5.

## 5. Evidencia preservada

- `docs/evidence/M0_LOOP_1AA_DIAGNOSTIC_2026-08-16.log` — 19.621 bytes; SHA-256 `1c585cdd186993c140d35558bd81570a749c0bc2b24e8a80b6a0cfcd0a5cce4a`.
- `docs/evidence/M0_LOOP_1AA_DIAGNOSTIC_2026-08-16.usage.json` — 457 bytes; SHA-256 `a5bee6a9a575a743c2c21c425deaed96e29696dcd23606f1714ec5a31cd5e8c3`.
- `docs/evidence/M0_LOOP_1AA_DIAGNOSTIC_2026-08-16.timing.txt` — timestamps del servidor y wall-time de cada turno; SHA-256 `e6808e255cb92427717b4d712f0b44d877b0b629b27347046c48f6c355a2a20a`.

El runner imprimió transcript y diagnóstico antes del cleanup de cada escenario. Después informó:

~~~text
[ME17] cleanup por identidad: cero
[REAL_FOUR_CREDITS] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
~~~

El snapshot durable final coincide con el stdout: `actualUsd=0.249235`, `updatedAt=2026-08-16T16:47:15.110Z`.

## 6. Parada contractual

No se implementó ningún fix, no se lanzó una corrida completa y no hubo reintento. No se hizo commit, push, deploy ni DDL, y no se escribió contra la cuenta real del founder.

**Enfocada de diagnóstico lista para Claude.**
