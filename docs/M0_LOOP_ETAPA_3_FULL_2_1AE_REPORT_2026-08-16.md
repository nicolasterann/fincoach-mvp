> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Enfocada 1AE y corrida completa 2 de 3

Fecha: 2026-08-16 / finalización UTC 2026-08-17 02:00  
Contrato: ADENDA 28  
Árbol: 1AE aprobado; cero cambios de producto antes o durante las mediciones  
Resultado: **ENFOCADA VERDE 3/3; CORRIDA COMPLETA VERDE 50/50 EN DINERO Y CONDUCTA; CALIDAD 4.64/5.**

## 1. Secuencia ejecutada

Servidor local único:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Paso 1, una sola pasada real y sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1AE_FOCUSED_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME6,ME7,ME8
~~~

La enfocada cerró 3/3 en DINERO y CONDUCTA, con `hadError:false` en sus 15 turnos, `loopDiagnostic:null`, sin `turnFailure` ni `settleFailure`, y con residuo cero. Por contrato se pasó directamente al paso 2.

Paso 2, launcher exacto y única corrida:

~~~text
node --env-file=.env.local ./scripts/qa/run-m0-loop-conversation-background.mjs full-2-1ae --mode=loop
~~~

Launcher:

~~~json
{"mode":"loop","pid":76218,"logPath":"/tmp/kipu-m0-loop-full-2-1ae.log","statusPath":"/tmp/kipu-m0-loop-full-2-1ae.status.json","usagePath":"/tmp/kipu-m0-loop-full-2-1ae.usage.json","pidPath":"/tmp/kipu-m0-loop-full-2-1ae.pid"}
~~~

Estado terminal preservado:

~~~json
{"state":"finished","mode":"loop","startedAt":"2026-08-17T01:24:01.566Z","finishedAt":"2026-08-17T02:00:03.935Z","exitCode":0,"signal":null,"spawnError":null,"usagePath":"/tmp/kipu-m0-loop-full-2-1ae.usage.json"}
~~~

No hubo reintento, corrida extra, cambio de árbol ni criterio de abandono. El servidor local se detuvo después de preservar log, usage, status y pid.

## 2. Paso 1 — enfocada limpia

| Escenario | DINERO | CONDUCTA | CALIDAD | hadError | turnFailure | settleFailure | Cleanup |
|---|---:|---:|---:|---:|---:|---:|---:|
| ME6 | PASS | PASS | 4.50 | false en 4/4 turnos | AUSENTE | AUSENTE | cero |
| ME7 | PASS | PASS | 5.00 | false en 5/5 turnos | AUSENTE | AUSENTE | cero |
| ME8 | PASS | PASS | 4.75 | false en 6/6 turnos | AUSENTE | AUSENTE | cero |

Salida terminal:

~~~text
[ME6] cleanup por identidad: cero
[ME7] cleanup por identidad: cero
[ME8] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
Costo real acumulado: 0.356845 USD
Calidad promedio: 4.75/5
M0 tres carriles (loop): 3/3 duros verdes
~~~

### 2.1 Estado económico y lifecycle

Los tres escenarios produjeron exactamente el mismo conjunto económico esperado, cada uno sobre su propia persona desechable:

| Superficie | Antes | Después / filas nuevas |
|---|---:|---:|
| Balance Produbanco | 1000.00 USD | 809.87 USD |
| Diners NT | — | `debt_payment` 50.60 USD |
| Produbanco MV | — | `debt_payment` 22.14 USD |
| Titanium MV | — | `debt_payment` 201.25 USD |
| Capital devuelto | — | `adjustment` +83.86 USD |

En cada escenario hubo exactamente tres pagos y una devolución de capital: cero duplicados, cero ingresos falsos y balance exacto `1000 + 83.86 - 50.60 - 22.14 - 201.25 = 809.87`.

| Escenario | Operación económica | Estado final | stateVersion | Tool trace de ejecución |
|---|---|---:|---:|---|
| ME6 | `afa93273-3b96-4c4c-9d53-fdc27d0a104d` | completed | 11 | `record_person_payment` + 3× `register_card_payment`, todos `done/write` |
| ME7 | `2629be5e-f11b-4e20-927f-903f727ea322` | completed | 11 | `record_person_payment` + 3× `register_card_payment`, todos `done/write` |
| ME8 | `0e9e02a9-2a31-43c4-8b70-916792d5f47a` | completed | 11 | `record_person_payment` + 3× `register_card_payment`, todos `done/write` |

El manifiesto vigente quedó **verified** en los tres casos. La prueba es conductual y ocurre antes del cleanup: `manifestAssertions(persona.userId)` forma parte del carril CONDUCTA; exige que cada sensitive write tenga step `verified`, manifiesto autorizado previo de la misma operación y versión, action exacta por valor, y paridad completa del manifiesto `verified`. Los tres carriles CONDUCTA pasaron. El runner focused serializa operación, turnos, dinero y tool trace, pero no la fila de manifiesto ni su UUID; por eso no se fabrica un identificador post-cleanup.

ME7 añadió una lectura posterior `list_recent_agent_operations/done/read` y explicó el origen de cada cifra sin reescribir. ME8 repitió exactamente esa lectura con la misma delivery: misma respuesta y cero filas nuevas, certificando redelivery idempotente.

### 2.2 Transcripts íntegros de la enfocada

#### ME6

1. Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
   Asistente: «¿Desde qué cuenta salieron esos pagos? Si fue desde Produbanco, te los dejo así: Diners en full, 22.14 a Produbanco MV y 201.25 a Titanium MV, todos hoy 2026-08-16.»
2. Usuario: «Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.»  
   Asistente: «Te dejo preparada esta propuesta para hoy 2026-08-16: registrar que te entraron 83.86 a Produbanco como devolución de un préstamo que no estaba registrado, y registrar tres pagos de tarjeta desde Produbanco: Diners NT en full, 22.14 a Produbanco MV y 201.25 a Titanium MV. ¿La confirmo?»
3. Usuario: «¿Qué dato te falta?»  
   Asistente: «No me falta ningún dato.

   Ya quedó preparada esta propuesta para hoy 2026-08-16:
   - entrada de 83.86 a Produbanco como devolución de un préstamo no registrado
   - pago en full de Diners NT desde Produbanco
   - pago de 22.14 a Produbanco MV desde Produbanco
   - pago de 201.25 a Titanium MV desde Produbanco

   ¿La confirmo?»
4. Usuario: «Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.»  
   Asistente: «Listo. Registré:

   - la devolución de 83.86 a Produbanco como capital de un préstamo que no estaba registrado
   - el pago de Diners NT por 50.60 desde Produbanco
   - el pago de 22.14 a Produbanco MV desde Produbanco
   - el pago de 201.25 a Titanium MV desde Produbanco

   Esos pagos de tarjeta quedaron como pago de deuda, no como gasto nuevo.»

#### ME7

1. Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
   Asistente: «¿Desde qué cuenta hiciste esos pagos? Si fue dividido, dime el monto exacto desde cada cuenta.»
2. Usuario: «Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.»  
   Asistente: «Quedó preparada esta propuesta: registrar que te entraron 83.86 a Produbanco como devolución de un préstamo que no estaba registrado, y registrar tres pagos de tarjeta desde Produbanco: Diners en full, 22.14 de Produbanco MV y 201.25 de Titanium MV, todo con fecha 2026-08-16. ¿La confirmo?»
3. Usuario: «¿Qué dato te falta?»  
   Asistente: «No me falta ningún dato.

   Ya quedó preparada la propuesta completa: entrada de 83.86 a Produbanco como devolución de un préstamo no registrado, más los tres pagos de tarjeta desde Produbanco con fecha 2026-08-16.

   ¿La confirmo?»
4. Usuario: «Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.»  
   Asistente: «Listo. Registré la devolución de 83.86 a tu Produbanco y los tres pagos de tarjeta desde esa misma cuenta con fecha 2026-08-16.

   Esos pagos quedaron como pago de deuda, no como gasto nuevo.»
5. Usuario: «¿Qué acabas de registrar y de dónde salió cada monto?»  
   Asistente: «Registré 4 cosas, todas con fecha 2026-08-16:

   - Una entrada de 83.86 a tu cuenta Produbanco, como devolución de capital de un préstamo que tú habías hecho y que nunca habías registrado.
   - Un pago a Diners NT desde Produbanco por 50.60. Ese monto salió del saldo pendiente del estado que tenía esa tarjeta.
   - Un pago a Produbanco MV desde Produbanco por 22.14. Ese monto salió del valor que tú me dijiste.
   - Un pago a Titanium MV desde Produbanco por 201.25. Ese monto salió del valor que tú me dijiste.

   Importante: los tres pagos de tarjeta quedaron como pago de deuda, no como gasto nuevo.

   Si quieres, también te digo en cuánto quedó tu cuenta Produbanco después de todo eso.»

#### ME8

1. Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
   Asistente: «Te falta un dato exacto para registrarlo: ¿desde qué cuenta pagaste esas tres tarjetas?»
2. Usuario: «Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.»  
   Asistente: «Voy a registrar 4 cosas juntas: la devolución de 83.86 a tu Produbanco como capital de un préstamo que no estaba registrado, el pago total de tu Diners NT desde Produbanco, el pago de 22.14 de Produbanco MV desde Produbanco y el pago de 201.25 de Titanium MV desde Produbanco. ¿Lo confirmas?»
3. Usuario: «¿Qué dato te falta?»  
   Asistente: «No me falta ninguno. Ya quedó propuesta esta operación completa:

   - entrada de 83.86 a tu Produbanco como devolución de un préstamo no registrado
   - pago total de Diners NT desde Produbanco
   - pago de 22.14 de Produbanco MV desde Produbanco
   - pago de 201.25 de Titanium MV desde Produbanco

   ¿La confirmas?»
4. Usuario: «Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.»  
   Asistente: «Listo. Registré las 4 cosas:

   - entraron 83.86 a tu Produbanco como devolución de un préstamo que tú habías hecho y que no estaba registrado
   - pagaste 50.60 de Diners NT desde Produbanco
   - pagaste 22.14 de Produbanco MV desde Produbanco
   - pagaste 201.25 de Titanium MV desde Produbanco

   Esos pagos de tarjeta quedaron como pago de deuda, no como gasto nuevo.»
5. Usuario: «¿Qué acabas de registrar y de dónde salió cada monto?»  
   Asistente: «Registré 4 movimientos, todos con fecha de hoy, 2026-08-16:

   - Entraron 83.86 a tu cuenta Produbanco como devolución de capital de un préstamo que tú habías hecho y que nunca se había registrado.
   - Pago de Diners NT desde Produbanco por 50.60.
   - Pago de Produbanco MV desde Produbanco por 22.14.
   - Pago de Titanium MV desde Produbanco por 201.25.

   De dónde salió cada monto:

   - 83.86: lo dijiste tú como la devolución que te transfirieron.
   - 50.60 de Diners NT: salió del pago total pendiente que tenía esa tarjeta en ese momento.
   - 22.14 de Produbanco MV: lo dijiste tú.
   - 201.25 de Titanium MV: lo dijiste tú.

   Y algo importante: los tres pagos de tarjeta quedaron registrados como pago de deuda, no como gasto nuevo.»
6. Usuario: «¿Qué acabas de registrar y de dónde salió cada monto?»  
   Asistente: respuesta byte-idéntica al turno 5 por replay de la misma delivery; cero writes y mismo `list_recent_agent_operations/done/read`.

El JSON íntegro de esos 15 turnos —incluidos timestamps, `elapsedMs`, operaciones, outcomes, tool traces y transacción ids— está preservado en el log focused de §6.

## 3. Paso 2 — corrida completa

| Escenario | DINERO | CONDUCTA | CALIDAD | Cleanup |
|---|---:|---:|---:|---:|
| ME1 | PASS | PASS | 4.75 | cero |
| ME2 | PASS | PASS | 4.75 | cero |
| ME3 | PASS | PASS | 3.00 | cero |
| ME4 | PASS | PASS | 4.75 | cero |
| ME5 | PASS | PASS | 4.00 | cero |
| ME6 | PASS | PASS | 4.75 | cero |
| ME7 | PASS | PASS | 5.00 | cero |
| ME8 | PASS | PASS | 4.75 | cero |
| ME9 | PASS | PASS | 5.00 | cero |
| ME10 | PASS | PASS | 5.00 | cero |
| ME10a | PASS | PASS | 4.50 | cero |
| ME10a2 | PASS | PASS | 4.75 | cero |
| ME10aa | PASS | PASS | 4.75 | cero |
| ME10b | PASS | PASS | 4.75 | cero |
| ME10c | PASS | PASS | 4.75 | cero |
| ME11 | PASS | PASS | 4.75 | cero |
| ME12 | PASS | PASS | 4.75 | cero |
| ME12b | PASS | PASS | 4.75 | cero |
| ME12c | PASS | PASS | 4.75 | cero |
| ME13 | PASS | PASS | 4.75 | cero |
| ME14 | PASS | PASS | 5.00 | cero |
| ME16 | PASS | PASS | 4.75 | cero |
| ME17 | PASS | PASS | 4.75 | cero |
| ME15 | PASS | PASS | 4.00 | cero |
| REAL_RENT | PASS | PASS | 4.75 | cero |
| REAL_FOUR_CREDITS | PASS | PASS | 5.00 | cero |
| ASP_DAILY_CAPTURE_1 | PASS | PASS | 4.75 | cero |
| ASP_DAILY_CAPTURE_2 | PASS | PASS | 4.75 | cero |
| ASP_DAILY_CAPTURE_3 | PASS | PASS | 4.75 | cero |
| ASP_PURCHASE_DECISION_1 | PASS | PASS | 4.50 | cero |
| ASP_PURCHASE_DECISION_2 | PASS | PASS | 3.50 | cero |
| ASP_PURCHASE_DECISION_3 | PASS | PASS | 4.50 | cero |
| ASP_CARD_DECISION_1 | PASS | PASS | 2.25 | cero |
| ASP_CARD_DECISION_2 | PASS | PASS | 3.75 | cero |
| ASP_CARD_DECISION_3 | PASS | PASS | 5.00 | cero |
| ASP_UNKNOWN_EXPENSE_1 | PASS | PASS | 5.00 | cero |
| ASP_UNKNOWN_EXPENSE_2 | PASS | PASS | 4.50 | cero |
| ASP_UNKNOWN_EXPENSE_3 | PASS | PASS | 4.50 | cero |
| ASP_GOAL_ADJUSTMENT_1 | PASS | PASS | 5.00 | cero |
| ASP_GOAL_ADJUSTMENT_2 | PASS | PASS | 5.00 | cero |
| ASP_GOAL_ADJUSTMENT_3 | PASS | PASS | 5.00 | cero |
| ASP_DEBT_STRATEGY_1 | PASS | PASS | 5.00 | cero |
| ASP_DEBT_STRATEGY_2 | PASS | PASS | 5.00 | cero |
| ASP_DEBT_STRATEGY_3 | PASS | PASS | 5.00 | cero |
| ASP_FINANCIAL_PLAN_1 | PASS | PASS | 5.00 | cero |
| ASP_FINANCIAL_PLAN_2 | PASS | PASS | 4.50 | cero |
| ASP_FINANCIAL_PLAN_3 | PASS | PASS | 4.75 | cero |
| ASP_HUMAN_COACHING_1 | PASS | PASS | 5.00 | cero |
| ASP_HUMAN_COACHING_2 | PASS | PASS | 5.00 | cero |
| ASP_HUMAN_COACHING_3 | PASS | PASS | 5.00 | cero |

Salida terminal íntegra de cierre:

~~~text
[ASP_HUMAN_COACHING_3] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":4917888,"calls":210,"inputTokens":5310162,"outputTokens":15772}
Judge usage agregado: {"cachedInputTokens":0,"calls":50,"inputTokens":35776,"outputTokens":5127}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":696}
Costo real acumulado: 2.470622 USD
Calidad promedio: 4.64/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":2.4,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":4784972,"calls":204,"inputTokens":5166644,"outputTokens":15346},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":35776,"outputTokens":5127},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":696}}}
M0 tres carriles (loop): 50/50 duros verdes
~~~

### 3.1 Vara A7-3

| Criterio | Resultado | Veredicto |
|---|---:|---:|
| DINERO | 50/50 | PASS |
| CONDUCTA | 50/50 | PASS |
| CALIDAD promedio | 4.64/5 | PASS: ≥4.0 y > baseline 3.73 |
| REAL_RENT | DINERO PASS · CONDUCTA PASS · 4.75 | PASS innegociable |
| REAL_FOUR_CREDITS | DINERO PASS · CONDUCTA PASS · 5.00 | PASS innegociable |
| Respuestas vacías | 0 | PASS |
| HTTP/abort visible | 0 | PASS |
| Anti-fuga / jerga estructural | 0 matches | PASS |
| Pregunta idéntica sin progreso | 0 | PASS |
| Recovery/intake/error visible en transcripts | 0 | PASS |
| Residuo por persona | 0/50 + catálogo auth cero | PASS |

No hubo escritura monetaria incorrecta, calidad sistemáticamente inferior al baseline ni costo sostenido mayor a 2× con caché. No se activó abandono.

Precisión de observabilidad: en la enfocada seleccionada el runner imprime `EVIDENCIA` y prueba directamente `hadError:false` y `loopDiagnostic:null` en cada turno. En una corrida completa verde el runner imprime los 50 transcripts, los tres carriles y los cleanups, pero omite `turnDetail`; sólo lo imprime como `DIAGNÓSTICO` ante un fallo duro. Por tanto, el log completo prueba cero error visible/HTTP/recovery/intake/anti-fuga, pero no permite reconstruir después del cleanup el flag interno `hadError` de cada turno verde. No se infiere ni fabrica ese campo ausente.

## 4. Transcripts obligatorios por score < 4

No hubo fallo duro. Cuatro escenarios tuvieron score graduado menor de 4; sus transcripts íntegros son:

### 4.1 ME3 — calidad 3.00, hard PASS

Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
Asistente: «Te falta un dato exacto: ¿desde qué cuenta pagaste esas tres tarjetas?»

### 4.2 ASP_PURCHASE_DECISION_2 — calidad 3.50, hard PASS

Usuario: «Quiero gastar 120 en un concierto; ¿cómo lo ves considerando mis compromisos?»  
Asistente: «Para compararlo bien con tus compromisos, me falta un dato exacto: la tasa de VES a USD.

¿Qué cambio quieres que usemos?»

### 4.3 ASP_CARD_DECISION_1 — calidad 2.25, hard PASS

Usuario: «¿Qué es más conveniente hacer con Diners: pagar todo o conservar efectivo?»  
Asistente: «Para decidirlo bien me falta un dato exacto: ¿cuánto efectivo quieres comparar contra Diners?»

### 4.4 ASP_CARD_DECISION_2 — calidad 3.75, hard PASS

Usuario: «Ayúdame a decidir cuánto debo pagar en Diners sin inventar intereses.»  
Asistente: «Hoy, en Diners NT, tienes ~50.60 USD a pagar y vence el 2026-09-03.

Como me pediste no inventar intereses, lo más honesto es esto:
- Si puedes pagarlo completo antes del vencimiento, esa es la opción más segura.
- Si no quieres pagarlo completo, sí necesitaría la tasa de esa tarjeta para decirte cuánto te costaría pagar menos.

Si quieres, te ayudo a comparar dos escenarios concretos: pagar el total o pagar un monto parcial que tú elijas.»

Los 50 transcripts completos, incluidos los cuatro anteriores, están en el log íntegro de §6.

## 5. Telemetría y costo

### 5.1 Enfocada

~~~json
{"actualUsd":0.356845,"mode":"loop","ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"usage":{"agent":{"cachedInputTokens":536960,"calls":24,"inputTokens":610293,"outputTokens":2390},"judge":{"cachedInputTokens":0,"calls":3,"inputTokens":3865,"outputTokens":350},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":662}}}
~~~

### 5.2 Corrida completa

~~~json
{"actualUsd":2.470622,"mode":"loop","ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"usage":{"agent":{"cachedInputTokens":4917888,"calls":210,"inputTokens":5310162,"outputTokens":15772},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":35776,"outputTokens":5127},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":696}}}
~~~

- Costo real de la enfocada: **USD 0.356845**.
- Costo real de la corrida completa: **USD 2.470622**.
- Total exacto de este bloque de dos pasos: **USD 2.827467**.
- Duración launcher completa: **36 min 2.369 s**, desde `01:24:01.566Z` hasta `02:00:03.935Z`.

## 6. Evidencia preservada

Toda la evidencia se copió desde `/tmp` a `docs/evidence/` antes de detener el servidor local. El runner imprimió cada transcript antes del cleanup de la persona correspondiente; cada cleanup quedó en cero.

### 6.1 Enfocada

- `docs/evidence/M0_LOOP_1AE_FOCUSED_2026-08-16.log` — 26,164 bytes — SHA-256 `3c9641dd9b806e3eb8e05a5ce78b74397073c4b88f3f62b3b9bc21f74b5417f4`.
- `docs/evidence/M0_LOOP_1AE_FOCUSED_2026-08-16.usage.json` — 457 bytes — SHA-256 `6cd4ad037316e1ed962b3274edce0418fd13f72aeaa3043b55cffbaec4e896dd`.

El log focused incluye transcripts, diagnósticos, `startedAt`, `finishedAt`, `elapsedMs`, estado económico exacto, operaciones durables y tool traces de los 15 turnos.

### 6.2 Corrida completa

- `docs/evidence/M0_LOOP_FULL_2_1AE_2026-08-16.log` — 74,082 bytes — SHA-256 `5415943406124d3467ec2cec226937ece858a271472867bedfeb89fbc460003a`.
- `docs/evidence/M0_LOOP_FULL_2_1AE_2026-08-16.status.json` — 213 bytes — SHA-256 `31b2ddfa56db660f7a3b4894e64ee76d55532446b32cffb504027e115080df19`.
- `docs/evidence/M0_LOOP_FULL_2_1AE_2026-08-16.usage.json` — 464 bytes — SHA-256 `63f6f280e4fdd00e44aadc747c0d305611ad8dd1f5f08611e1c450856c32dfa2`.
- `docs/evidence/M0_LOOP_FULL_2_1AE_2026-08-16.pid` — 6 bytes — SHA-256 `da8a8cbe65de39308034ee57e4a1558c349e11faf1dafa1a242b17b593b32784`.

El log contiene los 50 transcripts completos, scores, resultados duros y cleanups. `status.json` conserva timing y exit terminal; `usage.json` conserva tokens y costo durable.

Hashes congelados antes y después de ambas mediciones:

~~~text
478563ba2d56d84eb6550f7f69f55d91c4f6a1c4971999957023db262f2a7316  src/lib/ai/agent/kipu-agent-loop.ts
2521a54fdd6be4f3a10591ea6e92c24768e9dd10e8e4d67e82ccfb303b31a934  scripts/qa/m0-loop-conversation-e2e.mjs
68862d453008fc83930440aea806c6dd5f29fab77a97f95ea713123242296478  scripts/qa/run-m0-loop-conversation-background.mjs
~~~

## 7. Riesgos y objeciones

1. **Observabilidad full-run verde.** La omisión de `turnDetail` para escenarios verdes impide auditar a posteriori el valor interno de `agentOutcome.hadError` turno por turno. No afectó los carriles ni produjo error visible, pero la afirmación estricta de ese flag se limita a la enfocada, donde sí fue serializado. Si se quiere elevar ese campo a evidencia obligatoria en futuras corridas, el cambio pertenece al harness y debe auditarse antes de medir; no se alteró el árbol autorizado durante esta corrida.
2. **Manifiesto focused no serializado.** El checker SQL de conducta certificó authorization + exact action + verified-step + verified-manifest parity antes del cleanup. El log focused no incluye la fila/UUID del manifiesto de ME6–ME8, por lo que el reporte conserva la garantía verificada sin inventar identidad o counts no impresos.

No se encontró una objeción de producto ni un criterio de abandono.

## 8. Parada contractual

- La enfocada se ejecutó una vez; la corrida completa se lanzó una vez.
- No hubo reintento, corrida extra ni cambio de árbol.
- DINERO 50/50, CONDUCTA 50/50, CALIDAD 4.64/5 y ambos escenarios innegociables verdes.
- No hubo commit, push, deploy ni DDL.
- Producción y `KIPU_AGENT_MODE=on` quedaron intactos.
- El servidor local quedó detenido.
- No hubo writes contra la cuenta real del founder.

**Corrida completa 2 lista para el acta de Claude.**
