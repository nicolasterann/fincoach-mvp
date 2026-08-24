> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Enfocada de nombramiento posterior a 1AB

Fecha: 2026-08-16  
Contrato: ADENDA 22  
Árbol: producto 1AB aprobado; sin fixes de producto ni DDL durante esta entrega  
Resultado: **ROJO — 0/2 escenarios duros verdes; no se lanzó ninguna corrida completa.**

## 1. Ejecución autorizada

Servidor local:

~~~text
KIPU_AGENT_MODE=loop npm run dev
~~~

Única pasada real, sin reintentos:

~~~text
M0_LOOP_USAGE_STATUS_PATH=docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.usage.json node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --scenario=ME17,REAL_FOUR_CREDITS > docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.log 2>&1
~~~

Exit directo del runner: **1**. El servidor local se detuvo después de preservar y leer la evidencia. No hubo segunda pasada.

Antes de lanzar la corrida se añadió al harness enfocado únicamente la impresión pre-cleanup de `EVIDENCIA` y timestamps por turno, necesarios para este contrato. No se modificó producto, SQL, prompts, tools ni comportamiento del loop.

## 2. Resultado agregado

| Escenario | Dinero | Conducta | Calidad | Resultado duro |
|---|---:|---:|---:|---:|
| ME17 | FAIL | PASS | 3.50 | ROJO |
| REAL_FOUR_CREDITS | FAIL | PASS | 4.50 | ROJO |

Salida íntegra del resumen del runner:

~~~text
loopUsage agregado: {"cachedInputTokens":329216,"calls":14,"inputTokens":359581,"outputTokens":1421}
Judge usage agregado: {"cachedInputTokens":0,"calls":2,"inputTokens":3676,"outputTokens":275}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":690}
Costo real acumulado: 0.182803 USD
Calidad promedio: 4.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":2.47,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":4444416,"calls":189,"inputTokens":4854344,"outputTokens":19184},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":91900,"outputTokens":6875},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":644,"outputTokens":690}}}
M0 tres carriles (loop): 0/2 duros verdes
FAILURES: ME17 | REAL_FOUR_CREDITS
~~~

Ambos rojos caen en la lectura contractual **(c)** porque el carril DINERO quedó formalmente rojo en la aserción de lifecycle del manifiesto. Sin embargo, no hubo escritura monetaria equivocada: los cuatro pagos exactos y los cuatro cierres aterrizaron en ambos escenarios.

## 3. ME17

### 3.1 Diagnóstico tipado

Turno de confirmación:

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
  "elapsedMs": 42235,
  "outcome": {
    "correctionBlocked": false,
    "hadError": true,
    "needsInfo": false,
    "wrote": true
  }
}
~~~

La observabilidad 1AB nombra por primera vez el crash exterior: **`round_completion / BadRequestError_HTTP_400`**. `settleFailure` está ausente; no se inventa sub-etapa ni token de settle.

### 3.2 Manifiesto y verificación

- Operación: `05a436a3-1d7b-418f-a0c1-9f02c3a0f8b2`.
- Sucesor de ocho acciones observado antes de confirmar: manifiesto `fab33727-a0ee-44b3-92cc-f105ff5f596c`, hash `0cdc4e1b4226a26b3739489e6d97e224169a201d532730e52f3394381fd8dd23`, status `proposed`.
- El campo post-turno `finalManifest` preservado por el harness seleccionó la fila predecesora v1 `f34d13d2-a36d-45f5-a309-86c86feed6a1`: status **`rejected`**, `verification: null`; por tanto `authorized_count`, `verified_count`, `economic_count`, `outside_economic_count` y demás contadores son **no disponibles/null**.
- La consulta post-turno devolvía el conjunto de manifiestos de la operación, pero el evidence shape histórico persistió sólo `finalRows[0]`. Con cleanup ya ejecutado, el status y los contadores post-confirmación del sucesor no pueden reconstruirse honestamente. El gate reportó exactamente `one four-action proposal becomes verified` como fallo. No se afirma que el sucesor haya quedado `verified` ni `executing` sin evidencia.

### 3.3 Estado financiero exacto

- Produbanco: **1000.00 → 948.90 USD**, delta exacto **−51.10 USD**.
- Pagos nuevos observados: **13.33, 11.11, 14.44 y 12.22 USD**; conjunto canónico **[11.11, 12.22, 13.33, 14.44]**.
- Los checks `four exact card payments`, `four debts and cash settle exactly` y `all four cards are closed` pasaron: los cuatro saldos de tarjeta terminaron en **0.00** y las cuatro tarjetas en status **`closed`**.

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
   Asistente: `Siguen pendientes estos cuatro:` seguido de Crédito piloto 1 por 11.11 USD, 2 por 12.22 USD, 3 por 13.33 USD y 4 por 14.44 USD.
2. Usuario: `Perfecto, deja esos cuatro cubiertos desde mi Produbanco.`  
   Asistente: `Te propongo dejar cubiertos hoy, desde tu Produbanco, estos cuatro saldos completos: Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD. ¿Lo confirmas?`
3. Usuario: `Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.`  
   Asistente: `Te propongo hacer todo junto: pagar hoy desde tu Produbanco los cuatro saldos completos —Crédito piloto 1 por 11.11 USD, Crédito piloto 2 por 12.22 USD, Crédito piloto 3 por 13.33 USD y Crédito piloto 4 por 14.44 USD— y además cerrar esas mismas cuatro tarjetas para que no queden activas. ¿Lo confirmas?`
4. Usuario: `Adelante con el conjunto tal como lo acabas de plantear.`  
   Asistente: `No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.`

## 4. REAL_FOUR_CREDITS

### 4.1 Diagnóstico tipado

Turno de confirmación:

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
  "elapsedMs": 43252,
  "outcome": {
    "correctionBlocked": false,
    "hadError": true,
    "needsInfo": false,
    "wrote": true
  }
}
~~~

También aquí el crash queda nombrado **`round_completion / BadRequestError_HTTP_400`** y `settleFailure` está ausente.

### 4.2 Manifiesto y verificación

- Operación: `0bc43229-6116-48bb-98c0-17b1a5a8b9ec`.
- Sucesor de ocho acciones observado antes de confirmar: manifiesto `f99ac2d1-c088-402a-89d7-59c33822ce93`, hash `41fb47cb5918e457e912b62c3d43a7ba28cf57c7b320ef1032dc6cc3cb72f748`, status `proposed`.
- El `finalManifest` preservado seleccionó la predecesora v1 `149f8ccd-a4e0-4f7b-b1eb-9497396d8743`: status **`rejected`**, `verification: null`; todos los verification counts quedan **no disponibles/null**.
- Aplica la misma limitación de captura: el shape persistió `finalRows[0]`, no todas las filas post-turno. El status post-confirmación del sucesor no quedó preservado y no se infiere. El fallo reportado fue exactamente `one four-action proposal becomes verified`.

### 4.3 Estado financiero exacto

- Produbanco: **1000.00 → 948.90 USD**, delta exacto **−51.10 USD**.
- Pagos nuevos observados: **13.33, 11.11, 12.22 y 14.44 USD**; conjunto canónico **[11.11, 12.22, 13.33, 14.44]**.
- Pasaron los checks de cuatro pagos exactos, saldo de caja/deudas y cierre: las cuatro deudas terminaron en **0.00** y las cuatro tarjetas en status **`closed`**.

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
   Asistente: `Siguen pendientes estos cuatro:` seguido de Crédito piloto 1 por 11.11 USD, 2 por 12.22 USD, 3 por 13.33 USD y 4 por 14.44 USD; añadió que podía calcular el total.
2. Usuario: `Perfecto, deja esos cuatro cubiertos desde mi Produbanco.`  
   Asistente: `Queda propuesta así: pagar hoy desde Produbanco los cuatro créditos piloto pendientes — 11.11, 12.22, 13.33 y 14.44 USD — para dejarlos cubiertos. ¿La confirmo?`
3. Usuario: `Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.`  
   Asistente: `Queda propuesta completa así: pagar hoy desde Produbanco los cuatro créditos piloto pendientes — 11.11, 12.22, 13.33 y 14.44 USD — y además cerrar esas mismas cuatro tarjetas para que no queden activas. ¿La confirmo?`
4. Usuario: `Adelante con el conjunto tal como lo acabas de plantear.`  
   Asistente: `No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.`

El JSON íntegro, sin la presentación Markdown anterior, está en las líneas `TRANSCRIPT`, `EVIDENCIA` y `DIAGNÓSTICO` del log preservado.

## 5. Timing

| Escenario | Turno 1 | Turno 2 | Turno 3 | Confirmación | Span observado |
|---|---:|---:|---:|---:|---:|
| ME17 | 10.621 s | 12.580 s | 11.590 s | **42.235 s** | 78.115 s |
| REAL_FOUR_CREDITS | 7.721 s | 9.994 s | 11.150 s | **43.252 s** | 73.264 s |

Los timestamps UTC exactos de inicio y fin de cada turno están en el archivo de timing y dentro del `EVIDENCIA` pre-cleanup.

## 6. Evidencia preservada y residuo

- `docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.log` — 33.525 bytes; SHA-256 `9a4de0bfab351f12a73c9fd88c7f1913069d9039e518691f18638631a4230e50`.
- `docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.usage.json` — 457 bytes; SHA-256 `d982fcb6c603b89926336b665b5eddb14d97b0d609c71616139942ec3cb26f0b`.
- `docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.server.log` — 2.542 bytes; SHA-256 `8f9acee24a64e17b906cce27821bb2af2ea3777236aa0ca1829354bcf3c9ff33`; incluye los dos POST de confirmación de 42–43 s.
- `docs/evidence/M0_LOOP_1AB_NAMING_2026-08-16.timing.txt` — 1.038 bytes; SHA-256 `57739d41256f7afdcdf920fad7af2b27de6ee06ab73dec3466e7d4afad6923fc`; timestamps exactos derivados del evidence pre-cleanup.

El snapshot durable cerró en `actualUsd=0.182803`, `updatedAt=2026-08-16T19:18:51.534Z` y coincide con stdout.

La evidencia de cada escenario se imprimió antes del cleanup. Luego el runner informó literalmente:

~~~text
[ME17] cleanup por identidad: cero
[REAL_FOUR_CREDITS] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero
~~~

## 7. Parada contractual

No se implementó ningún fix, no hubo reintento y no se lanzó ninguna corrida completa. No se hizo commit, push, deploy ni DDL; no se escribió contra la cuenta real del founder y producción quedó intacta.

**Enfocada de nombramiento lista para Claude.**
