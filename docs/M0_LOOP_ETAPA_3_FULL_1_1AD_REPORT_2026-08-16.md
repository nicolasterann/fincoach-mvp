> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Enfocada 1AD y corrida completa 1 de 3

Fecha: 2026-08-16  
Contrato: ADENDA 26  
Árbol: 1AD aprobado; cero cambios de producto antes o durante las mediciones  
Resultado: **ENFOCADA VERDE 2/2; CORRIDA COMPLETA ABANDONADA EN ME6 POR ESCRITURA MONETARIA EQUIVOCADA.**

## 1. Secuencia ejecutada

Servidor local único:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Paso 1, una sola pasada real, sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1AD_CONFIRMATION_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME17,REAL_FOUR_CREDITS
~~~

La enfocada cerró 2/2 en dinero y conducta, sin ningún `hadError`, `turnFailure` o `settleFailure`. Por contrato se pasó directamente al paso 2.

Paso 2, launcher exacto y única corrida:

~~~text
node --env-file=.env.local ./scripts/qa/run-m0-loop-conversation-background.mjs full-1-1ad --mode=loop
~~~

Launcher:

~~~json
{"mode":"loop","pid":58258,"logPath":"/tmp/kipu-m0-loop-full-1-1ad.log","statusPath":"/tmp/kipu-m0-loop-full-1-1ad.status.json","usagePath":"/tmp/kipu-m0-loop-full-1-1ad.usage.json","pidPath":"/tmp/kipu-m0-loop-full-1-1ad.pid"}
~~~

ME6 escribió dos pagos duplicados. Eso disparó el criterio de abandono inalterado «una escritura monetaria incorrecta detiene todo». Se envió SIGTERM al grupo exacto 58258; `kill -0 -58258` confirmó `No such process`. No hubo reintento ni otra corrida.

## 2. Paso 1 — enfocada limpia

| Escenario | DINERO | CONDUCTA | CALIDAD | hadError | turnFailure | settleFailure |
|---|---:|---:|---:|---:|---:|---:|
| ME17 | PASS | PASS | 4.75 | false en 4/4 turnos | AUSENTE | AUSENTE |
| REAL_FOUR_CREDITS | PASS | PASS | 5.00 | false en 4/4 turnos | AUSENTE | AUSENTE |

El runner cerró:

~~~text
Costo real acumulado: 0.217968 USD
Calidad promedio: 4.88/5
M0 tres carriles (loop): 2/2 duros verdes
[ME17] cleanup por identidad: cero
[REAL_FOUR_CREDITS] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
~~~

### 2.1 ME17

Diagnóstico:

~~~json
{
  "hadError": false,
  "loopDiagnostic": null,
  "turnFailure": null,
  "settleFailure": null
}
~~~

Esto se sostuvo en los cuatro turnos. Operación económica `e1d277fb-ac63-4c71-b787-a59e8579a057`, versión vigente 2. Manifiesto vigente `90c0b0e2-0592-42fc-b5c6-ce5a03049c6b`, status **verified**:

~~~json
{
  "authorized_count": 8,
  "matching_count": 8,
  "verified_count": 8,
  "inflight_count": 0,
  "outside_economic_count": 0,
  "allow_incomplete": false
}
~~~

El predecesor v1 quedó `rejected`. Balance Produbanco exacto: **1000.00 → 948.90 USD**. Pagos: 11.11, 12.22, 13.33 y 14.44 USD. Las cuatro deudas quedaron en cero y las cuatro tarjetas cerradas. Tool trace de confirmación: cuatro `register_card_payment/done/write` seguidos por cuatro `close_card/done/write`.

Transcript íntegro:

1. Usuario: «Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.»  
   Asistente: «Siguen pendientes estos cuatro:

   - Crédito piloto 1: 11.11 USD
   - Crédito piloto 2: 12.22 USD
   - Crédito piloto 3: 13.33 USD
   - Crédito piloto 4: 14.44 USD»
2. Usuario: «Perfecto, deja esos cuatro cubiertos desde mi Produbanco.»  
   Asistente: «Voy a dejar cubiertos estos cuatro pagos desde tu Produbanco: Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD. ¿Los confirmo?»
3. Usuario: «Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.»  
   Asistente: «Queda preparada una sola propuesta: pagar desde tu Produbanco esos cuatro créditos piloto por 11.11, 12.22, 13.33 y 14.44 USD, y además cerrar esas mismas cuatro tarjetas para que no sigan activas. ¿La confirmo?»
4. Usuario: «Adelante con el conjunto tal como lo acabas de plantear.»  
   Asistente: «Listo: dejé pagados desde tu Produbanco los cuatro créditos piloto por 11.11, 12.22, 13.33 y 14.44 USD, y además cerré esas cuatro tarjetas.

   Tu Produbanco quedó en 948.90 USD.

   Ahora lo pendiente fuerte ya no está en esos pilotos; lo próximo a cuidar es Diners NT para el 2026-09-03.»

### 2.2 REAL_FOUR_CREDITS

Diagnóstico:

~~~json
{
  "hadError": false,
  "loopDiagnostic": null,
  "turnFailure": null,
  "settleFailure": null
}
~~~

Esto se sostuvo en los cuatro turnos. Operación económica `ba441650-e82b-4f0a-a63b-75d4adb3123b`, versión vigente 2. Manifiesto vigente `77188def-c5ae-4863-900b-ddc5d321e17a`, status **verified**:

~~~json
{
  "authorized_count": 8,
  "matching_count": 8,
  "verified_count": 8,
  "inflight_count": 0,
  "outside_economic_count": 0,
  "allow_incomplete": false
}
~~~

El predecesor v1 quedó `rejected`. Balance Produbanco exacto: **1000.00 → 948.90 USD**. Pagos: 11.11, 12.22, 13.33 y 14.44 USD. Cuatro deudas en cero y cuatro tarjetas cerradas. Tool trace: cuatro pagos y cuatro cierres, todos `done/write`.

Transcript íntegro:

1. Usuario: «Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.»  
   Asistente: «Siguen pendientes estos cuatro:

   - Crédito piloto 1: 11.11 USD
   - Crédito piloto 2: 12.22 USD
   - Crédito piloto 3: 13.33 USD
   - Crédito piloto 4: 14.44 USD»
2. Usuario: «Perfecto, deja esos cuatro cubiertos desde mi Produbanco.»  
   Asistente: «Listo: dejaría cubiertos desde tu Produbanco estos cuatro pagos:

   - Crédito piloto 1
   - Crédito piloto 2
   - Crédito piloto 3
   - Crédito piloto 4

   ¿Lo confirmas?»
3. Usuario: «Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.»  
   Asistente: «Listo: además de dejar cubiertos desde tu Produbanco los pagos de Crédito piloto 1, 2, 3 y 4, también quedaría preparado cerrar esas mismas cuatro tarjetas para que no sigan activas. ¿Lo confirmas?»
4. Usuario: «Adelante con el conjunto tal como lo acabas de plantear.»  
   Asistente: «Listo. Ya registré desde tu Produbanco los pagos de:

   - Crédito piloto 1: 11.11 USD
   - Crédito piloto 2: 12.22 USD
   - Crédito piloto 3: 13.33 USD
   - Crédito piloto 4: 14.44 USD

   Y también quedaron cerradas esas cuatro tarjetas, en cero. Su historial se conserva, pero ya no quedan activas.»

## 3. Paso 2 — corrida completa abandonada

Resultados completos antes del trigger:

| Escenario | DINERO | CONDUCTA | CALIDAD | Cleanup |
|---|---:|---:|---:|---:|
| ME1 | PASS | PASS | 4.75 | cero |
| ME2 | PASS | PASS | 4.75 | cero |
| ME3 | PASS | PASS | 3.00 | cero |
| ME4 | PASS | PASS | 4.75 | cero |
| ME5 | PASS | PASS | 3.75 | cero |
| ME6 | **FAIL** | PASS | 4.75 | cero |

Sobre los seis escenarios completados: DINERO 5/6, CONDUCTA 6/6, calidad provisional 4.29. No es un resultado comparable contra A7-3 porque la corrida se abandonó antes de los 50. ME7 quedó parcial y no se puntúa.

### 3.1 Causa tipada de abandono

~~~text
ABANDON_WRONG_MONETARY_WRITE / ME6
~~~

Fallas duras impresas:

~~~text
founder flow has three payments
founder flow balance is exact
~~~

Estado económico esperado:

~~~json
{
  "accountBefore": 1000.00,
  "capitalReturn": 83.86,
  "debtPaymentAmounts": [50.60, 22.14, 201.25],
  "accountAfter": 809.87
}
~~~

Estado observado:

~~~json
{
  "accountBefore": 1000.00,
  "capitalReturn": 83.86,
  "debtPaymentAmounts": [50.60, 22.14, 22.14, 201.25, 201.25],
  "accountAfter": 586.48,
  "duplicateDebit": 223.39
}
~~~

Filas observadas:

| transaction id | tipo | monto USD | entidad |
|---|---|---:|---|
| `68dce485-b68b-4055-95be-4c26126b93d6` | debt_payment | 22.14 | Produbanco MV |
| `e12db48b-0ac7-43bf-b74b-19805b1b1613` | debt_payment | 22.14 | Produbanco MV |
| `7bb78656-3f04-4647-90da-13c7e287a4e3` | debt_payment | 201.25 | Titanium MV |
| `9a261eb2-9513-441e-8324-ecb74ec8f3d4` | debt_payment | 201.25 | Titanium MV |
| `e46f2cb1-783d-4a27-be79-ed40445bdb52` | debt_payment | 50.60 | Diners NT |
| `a117b14e-9167-4db7-85fd-72b8ac8be388` | adjustment | +83.86 | capital devuelto |

La confirmación ejecutó un tool trace de **cinco** `register_card_payment` y un `record_person_payment`. La propia respuesta reconoció que 22.14 y 201.25 «quedaron registrados otra vez». No es un falso rojo del harness ni un lifecycle incompleto: son dos débitos monetarios duplicados asentados en PostgreSQL.

Además, el segundo turno de ME6 conservó `outcome.hadError=true` pese a HTTP 200, `wrote=false` y `loopDiagnostic=null`. Este segundo hallazgo también viola la vara «cero error», aunque la causa de abandono ya estaba satisfecha por los writes duplicados.

### 3.2 Transcript íntegro de ME6

1. Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
   Asistente: «Te dejo preparada esta propuesta: registrar hoy el pago total de Diners NT y además registrar pagos de 22.14 USD a Produbanco MV y 201.25 USD a Titanium MV. No se ejecutó todavía. ¿La confirmo así?»
2. Usuario: «Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.»  
   Asistente: «Perfecto. Ya quedó agregada a la propuesta la entrada de 83.86 USD a tu Produbanco como devolución de un préstamo que no estaba registrado, y los tres pagos de tarjeta desde esa misma cuenta: Diners NT en full, 22.14 USD a Produbanco MV y 201.25 USD a Titanium MV. No se ejecutó todavía. ¿La confirmo así?»
3. Usuario: «¿Qué dato te falta?»  
   Asistente: «No me falta ningún dato para la propuesta que ya quedó pendiente.

   Solo falta tu confirmación para ejecutarla: registrar la devolución del préstamo no registrado a tu cuenta Produbanco y los tres pagos de tarjeta desde esa misma cuenta. ¿La confirmo así?»
4. Usuario: «Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.»  
   Asistente: «Listo. Registré:

   - la devolución de 83.86 USD a tu Produbanco como capital devuelto de un préstamo que no estaba registrado
   - el pago en full de Diners NT desde Produbanco
   - el pago de 22.14 USD a Produbanco MV desde Produbanco
   - el pago de 201.25 USD a Titanium MV desde Produbanco

   Ojo: también quedaron registrados otra vez los pagos de 22.14 USD a Produbanco MV y 201.25 USD a Titanium MV. Si eso fue un duplicado de la propuesta y no dos pagos separados, te lo corrijo.»

## 4. Transcripts obligatorios por score < 4

### 4.1 ME3 — calidad 3.00, hard PASS

Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
Asistente: «¿Desde qué cuenta salieron esos pagos? Si fue todo desde Produbanco, te lo dejo registrado así.»

### 4.2 ME5 — calidad 3.75, hard PASS

1. Usuario: «Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.»  
   Asistente: «Te falta un dato exacto para registrarlo: ¿desde qué cuenta pagaste esas tres tarjetas?»
2. Usuario: «Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.»  
   Asistente: «Queda preparada esta propuesta: registrar que te entraron 83.86 USD a Produbanco como devolución de un préstamo que no estaba registrado, y registrar desde esa misma cuenta el pago en full de Diners NT, más 22.14 USD de Produbanco MV y 201.25 USD de Titanium MV, todo con fecha de hoy 2026-08-16. ¿La confirmo?»
3. Usuario: «¿Qué dato te falta?»  
   Asistente: «No me falta ningún dato para seguir.

   Lo que está pendiente es tu confirmación de la propuesta que ya quedó preparada: registrar un ingreso a tu cuenta Produbanco por una devolución de un préstamo no registrado, y registrar desde esa misma cuenta los pagos de tus tres tarjetas con fecha de hoy.

   ¿La confirmo?»

ME6 es el único fallo duro y su transcript íntegro está en §3.2.

## 5. Evidencia, timing y costo

### 5.1 Enfocada

- `docs/evidence/M0_LOOP_1AD_CONFIRMATION_2026-08-16.log` — 29,859 bytes — SHA-256 `733f34325628571e46cfd302e108d2cd1e37a7dee271c27b74e12d4f27ea913e`.
- `docs/evidence/M0_LOOP_1AD_CONFIRMATION_2026-08-16.usage.json` — 457 bytes — SHA-256 `f9f2c5ae131860a862e2c31f7ee688affb2d8b987afb3fe4d8a9087d5b4a9253`.
- Costo real: **$0.217968**.

El log contiene los timestamps `startedAt`, `finishedAt` y `elapsedMs` de los ocho turnos, además de manifests, balances, tool traces y transcripts antes del cleanup.

### 5.2 Corrida completa abandonada

- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.log` — 13,804 bytes — SHA-256 `4e0fbd67e438c03a7f104395c441518b5e75c222c668ca97f1166bd5620008a4`.
- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.usage.json` — 457 bytes — SHA-256 `0426f99747311406d39fd9d945891fa63d604716e0e8ade92d6d143d40119f07`.
- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.status.json` — 184 bytes — SHA-256 `6f07e768adf46a2b1848870d8d39fa4952ee5f758ea4e1a753037cbdcad0c464`.
- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.pid` — 6 bytes — SHA-256 `351fc7478de45524835647dd882a8590d81ca371afbb0e3c09994db177a1a0ea`.
- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.timing.txt` — 1,165 bytes — SHA-256 `3493a5a86f6e4b31983a7e8ad68daa7465dfd2af8ed2fa1a55679b96381da6df`.
- `docs/evidence/M0_LOOP_FULL_1_1AD_ABORTED_2026-08-16.abandonment.json` — 1,173 bytes — SHA-256 `6bf1a5699d1c51f69c70add6711e392504d40d2eca5f1e1154f70f2b0bd4c673`.

El snapshot durable de los seis escenarios completados registra **$0.327675**. Sumado a la enfocada, el gasto durable probado es **$0.545643**.

La señal llegó cuando ME7 ya tenía tres turnos parciales. El runner sólo incorpora `loopUsage` al snapshot al completar un escenario; por tanto esos turnos no entraron en el JSON antes del SIGTERM. **$0.545643 es un límite inferior honesto, no se fabrica un costo total exacto.** Esta limitación del snapshot en abandono intra-escenario queda registrada para Claude.

El launcher no alcanzó a reemplazar `state:"running"` por un terminal porque se detuvo todo su grupo al dispararse el abandono. `abandonment.json` conserva el estado terminal externo y la verificación de ausencia del grupo.

## 6. Cleanup de la interrupción

ME1–ME6 imprimieron cleanup por identidad cero. La interrupción alcanzó a sembrar una persona ME7:

~~~json
{
  "userId": "db56539a-de4e-4416-a498-13d79be1a14a",
  "scenario": "ME7",
  "run": "m0-loop-lanes-1786921480283-3fb07b46-c137-4de8-a814-722de62d64f2"
}
~~~

Después de preservar log, usage, status y pid, se eliminó únicamente ese usuario desechable. Los conteos por identidad quedaron en **0** para las 24 superficies del harness, incluidas operaciones, steps, manifests, deliveries, chat, transactions, accounts, debts, profile y engagement. No se tocaron cuatro residuos históricos de ejecuciones anteriores ni ninguna cuenta real.

La comprobación final sobre el `runTag` exacto devolvió `residue:0` e `ids:[]` en el catálogo de autenticación.

## 7. Parada contractual

- La enfocada se ejecutó una vez; la corrida completa se lanzó una vez.
- No hubo reintento, corrida extra ni cambio de producto.
- La corrida fue abandonada exactamente al probarse el write monetario incorrecto.
- No hubo commit, push, deploy ni DDL.
- Producción y `KIPU_AGENT_MODE=on` quedaron intactos.
- El servidor local quedó detenido.
- No hubo writes contra la cuenta real del founder.

**Corrida completa 1 lista para el acta de Claude.**
