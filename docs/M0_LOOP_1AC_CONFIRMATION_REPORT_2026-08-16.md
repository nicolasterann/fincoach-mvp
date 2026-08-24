> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Enfocada de confirmación posterior a 1AC

Fecha: 2026-08-16  
Contrato: ADENDA 24  
Árbol: producto 1AC aprobado; sin cambios de código, SQL, prompt, tools o harness antes/durante la pasada  
Resultado contractual: **ROJO — ambos escenarios volvieron a recovery por HTTP 400; no se lanzó la CORRIDA COMPLETA 1 de 3.**

## 1. Ejecución autorizada

Servidor local:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Única pasada real, sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME17,REAL_FOUR_CREDITS > docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.log 2>&1
~~~

Exit directo del runner: **0**. Ese exit refleja que sus carriles duros actuales imprimieron 2/2 PASS; no convierte en verde contractual dos turnos con `hadError:true`, recovery literal y `turnFailure=round_completion/BadRequestError_HTTP_400`. La enfocada era confirmatoria del fin de ese 400. Al persistir en ambos escenarios, se aplicó la rama de parada de ADENDA 24 y no se lanzó `full-1-1ac`.

El servidor local se detuvo después de preservar la evidencia. No hubo una segunda pasada.

## 2. Resultado agregado y discrepancia del gate

| Escenario | Dinero SQL | Conducta estructural del runner | Calidad | Confirmación 1AC | Motivo |
|---|---:|---:|---:|---:|---|
| ME17 | PASS | PASS | 4.50 | **ROJO** | recovery + `hadError:true` + HTTP 400 |
| REAL_FOUR_CREDITS | PASS | PASS | 4.50 | **ROJO** | recovery + `hadError:true` + HTTP 400 |

Salida íntegra del resumen del runner:

~~~text
loopUsage agregado: {"cachedInputTokens":330240,"calls":14,"inputTokens":360497,"outputTokens":1394}
Judge usage agregado: {"cachedInputTokens":0,"calls":2,"inputTokens":7044,"outputTokens":259}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":684}
Costo real acumulado: 0.183697 USD
Calidad promedio: 4.50/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":2.5,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":4458240,"calls":189,"inputTokens":4866710,"outputTokens":18819},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":176100,"outputTokens":6475},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":684}}}
M0 tres carriles (loop): 2/2 duros verdes
~~~

La salida `2/2 duros verdes` expone un hueco de medición: el carril CONDUCTA no pone rojo un recovery tipado con `hadError:true`. La vara de la corrida completa sí exige explícitamente cero recovery/error, y la expectativa A23/A24 de esta enfocada era «sin 400, narración normal». No se usó el hueco para consumir una corrida completa.

## 3. ME17

### 3.1 Diagnóstico tipado completo

~~~json
{
  "turnFailure": {
    "site": "round_completion",
    "token": "BadRequestError_HTTP_400"
  },
  "settleFailure": null,
  "loopDiagnostic": {
    "code": "unavailable",
    "stage": "turn",
    "turnFailure": {
      "site": "round_completion",
      "token": "BadRequestError_HTTP_400"
    }
  },
  "elapsedMs": 39992,
  "outcome": {
    "correctionBlocked": false,
    "hadError": true,
    "needsInfo": false,
    "wrote": true
  }
}
~~~

El SDK no aportó un `code` que cruzara la gramática cerrada de 1AC; por eso el token durable no tiene sufijo y permanece exactamente **`BadRequestError_HTTP_400`**. No se persiste ni infiere texto libre. `settleFailure` está ausente.

### 3.2 Manifiestos y versión vigente

- Operación: `568d3050-7e1a-43e1-a301-9ada6905a20d`; `currentPlanVersion=2`.
- Predecesor v1: manifiesto `b6dc4b3a-1b04-4e4a-95e4-90fdd68b0ad4`, status `rejected`, `verification=null`.
- Sucesor vigente v2: manifiesto `c14282a1-a0fb-46cd-8967-d1a5a939c8af`, hash `d7a823c22bee8273761e8f484f5ba5bf7760d2d48fecaebf40459494a1615209`, status **`verified`**.
- Counts vigentes: `authorized_count=8`, `matching_count=8`, `verified_count=8`, `inflight_count=0`, `outside_economic_count=0`, `allow_incomplete=false`.
- El evidence preserva las dos filas en `finalManifests`; el veredicto seleccionó v2 por valor de `plan_version`, no por posición.

### 3.3 Balances y writers

- Produbanco: **1000.00 → 948.90 USD**, delta exacto **−51.10 USD**.
- Pagos observados: **13.33, 12.22, 14.44 y 11.11 USD**; conjunto canónico **[11.11, 12.22, 13.33, 14.44]**.
- Los checks de estado exacto pasaron: cuatro deudas en **0.00** y cuatro tarjetas `closed`.

### 3.4 toolTrace del turno de confirmación

~~~json
[
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"}
]
~~~

### 3.5 Transcript íntegro

1. Usuario: `Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.`  
   Asistente: `Siguen pendientes estos cuatro:` seguido de Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD; ofreció calcular el total.
2. Usuario: `Perfecto, deja esos cuatro cubiertos desde mi Produbanco.`  
   Asistente: `Voy a dejar cubiertos estos cuatro pagos desde tu Produbanco: Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD. ¿Lo confirmas?`
3. Usuario: `Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.`  
   Asistente: `Queda preparada una sola propuesta con todo junto: pagar desde tu Produbanco Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD, y además cerrar esas mismas cuatro tarjetas para que no queden activas. ¿Lo confirmas?`
4. Usuario: `Adelante con el conjunto tal como lo acabas de plantear.`  
   Asistente: `No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.`

## 4. REAL_FOUR_CREDITS

### 4.1 Diagnóstico tipado completo

~~~json
{
  "turnFailure": {
    "site": "round_completion",
    "token": "BadRequestError_HTTP_400"
  },
  "settleFailure": null,
  "loopDiagnostic": {
    "code": "unavailable",
    "stage": "turn",
    "turnFailure": {
      "site": "round_completion",
      "token": "BadRequestError_HTTP_400"
    }
  },
  "elapsedMs": 41019,
  "outcome": {
    "correctionBlocked": false,
    "hadError": true,
    "needsInfo": false,
    "wrote": true
  }
}
~~~

Misma clase exacta: **`round_completion / BadRequestError_HTTP_400`**, sin slug durable del proveedor y sin `settleFailure`.

### 4.2 Manifiestos y versión vigente

- Operación: `2cdb366e-cbee-43cc-8e02-026181bb5113`; `currentPlanVersion=2`.
- Predecesor v1: manifiesto `8fce913d-9d2a-4de9-a164-f176a85b215b`, status `rejected`, `verification=null`.
- Sucesor vigente v2: manifiesto `df3d9d53-e3e2-471d-990e-ab1c4f4977e5`, hash `0ad9a0a5995d94a936c591bc01e70c740c9a640dadd3af63ae6a59982fce153b`, status **`verified`**.
- Counts vigentes: `authorized_count=8`, `matching_count=8`, `verified_count=8`, `inflight_count=0`, `outside_economic_count=0`, `allow_incomplete=false`.
- `finalManifests` preserva predecesor y sucesor; el selector vigente eligió correctamente v2.

### 4.3 Balances y writers

- Produbanco: **1000.00 → 948.90 USD**, delta exacto **−51.10 USD**.
- Pagos observados: **11.11, 13.33, 12.22 y 14.44 USD**; conjunto canónico **[11.11, 12.22, 13.33, 14.44]**.
- Los checks exactos pasaron: cuatro deudas en **0.00** y cuatro tarjetas `closed`.

### 4.4 toolTrace del turno de confirmación

~~~json
[
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"register_card_payment","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"},
  {"effect":"write","name":"close_card","status":"done"}
]
~~~

### 4.5 Transcript íntegro

1. Usuario: `Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.`  
   Asistente: `Siguen pendientes estos cuatro créditos piloto:` seguido de Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD; ofreció calcular el total.
2. Usuario: `Perfecto, deja esos cuatro cubiertos desde mi Produbanco.`  
   Asistente: `Listo: dejé preparados estos cuatro pagos desde tu Produbanco:` seguido de los cuatro créditos y montos exactos; cerró con `¿Los confirmo así?`
3. Usuario: `Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.`  
   Asistente: `Quedó preparado todo junto: pagar desde tu Produbanco los cuatro créditos piloto por 11.11, 12.22, 13.33 y 14.44 USD, y además cerrar esas mismas cuatro tarjetas para que no sigan activas; en las cuatro te voy a cerrar cuentas con saldo pendiente que quedarían cubiertas por esos pagos. ¿Lo confirmo así?`
4. Usuario: `Adelante con el conjunto tal como lo acabas de plantear.`  
   Asistente: `No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.`

El JSON íntegro está en las líneas `TRANSCRIPT` y `EVIDENCIA` del log preservado.

## 5. Timing

| Escenario | Turno 1 | Turno 2 | Turno 3 | Confirmación | Span observado |
|---|---:|---:|---:|---:|---:|
| ME17 | 8.310 s | 13.989 s | 12.781 s | **39.992 s** | 76.268 s |
| REAL_FOUR_CREDITS | 8.017 s | 12.079 s | 12.563 s | **41.019 s** | 75.314 s |

Los timestamps UTC exactos están en el evidence pre-cleanup y en el archivo de timing.

## 6. Evidencia preservada y costo

- `docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.log` — 30.009 bytes; SHA-256 `a935781afc4993645b8f566f55fd1ca167ebe53f3a7dbc56ba3f8b381b780e45`.
- `docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.usage.json` — 457 bytes; SHA-256 `ebabf3f93fe4e1fd202b56603ad0216fa12a2ad72f0fee99fda48995542c9311`.
- `docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.server.log` — 2.326 bytes; SHA-256 `4e5488c4c5e703e3cf41a43865284c0ae0cd223d4b06a40a546962cfa47eb5d4`.
- `docs/evidence/M0_LOOP_1AC_CONFIRMATION_2026-08-16.timing.txt` — 960 bytes; SHA-256 `a6b858db2faa063d29f3bd2c3b216b7e3e0017603bd893b0057346442a896656`.

Snapshot durable final: `actualUsd=0.183697`, `updatedAt=2026-08-16T21:14:11.120Z`. Coincide con stdout. La evidencia de cada escenario fue emitida al log antes del cleanup; luego el runner informó:

~~~text
[ME17] cleanup por identidad: cero
[REAL_FOUR_CREDITS] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
~~~

## 7. Parada contractual

- No se lanzó `run-m0-loop-conversation-background.mjs full-1-1ac --mode=loop`.
- No hubo reintento ni corrida extra.
- No se implementó ningún fix.
- No hubo commit, push, deploy ni DDL.
- No se escribió contra la cuenta real del founder; sólo personas desechables con residuo cero.
- Producción y `KIPU_AGENT_MODE=on` quedaron intactos.

**Enfocada 1AC lista para Claude.**
