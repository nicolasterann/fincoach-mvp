> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Bloque M0 — diagnóstico de intake recuperado v38

Fecha: 2026-08-11  
Estado: **ABIERTO — observabilidad reparada; una muestra completa externa decide el siguiente paso**  
Migraciones: **001–111 aplicadas; v38 no añade migración**  
Contrato runtime: `m0-agent-eval-2026-08-11-intake-reporting-v38`

Sello ejecutable canónico:
`314ac4f742dd9988fc22a8a3bf105adf14a032ee60b1760799d5631878d38d40`
(486 archivos).

## Por qué existe v38

La muestra completa externa de v37 certificó el nuevo contrato de source: el
planner real emitió cinco assertions con
`openOperations[<observed_operation_id>].<field>` y el turno read-only conservó
la operación original. Sin embargo, ME4 cayó en el fallback seguro de intake y
dejó ME5–ME10 como `BLOCKED`.

El producto sí había producido la causa tipada. Cuando el endpoint devuelve un
HTTP 200 con una explicación honesta de no-acción, `turn()` copia
`assistantMetadata.agentIntakeFailure` y las filas durables acotadas a
`turn.intakeDiagnostic`. El reporter `turnDetail()` sólo inspeccionaba
`turn.error.intakeFailures`, que existe en la rama HTTP-error. Después del
cleanup de la persona disposable, la causa de ME4 quedaba irrecuperable.

No hay evidencia suficiente para cambiar planner, validador o ejecución. v38
repara únicamente el instrumento para que una muestra cara produzca un
diagnóstico accionable.

## Cambio implementado

### 1. El detalle consume el diagnóstico que ya capturaba

`scripts/qa/m0-model-conversation-e2e.mjs` añade a `turnDetail()`:

```js
successfulIntakeFailure: turn?.intakeDiagnostic ?? null
```

La rama HTTP-error se conserva como `intakeFailures`. No se cambia cuándo un
turno falla, cuándo se recupera, qué escribe ni qué recibe el usuario.

El objeto consumido ya está acotado por construcción:

- metadata de intake: stage/code/message/attempts/validationFailures;
- como máximo tres filas durables con delivery_key, stage, attempts, status y
  last_error;
- error de lectura, si lo hubiera.

No contiene candidate JSON, prompt ni mensaje crudo.

### 2. Red permanente

- IR270 ahora exige tanto captura como consumo.
- IR285 nombra específicamente el camino HTTP 200 y fija stage, attempts y
  validationFailures antes del cleanup.
- M0M411 reemplaza el consumo por `null`; debe morir por IR285.
- El handshake sube a `intake-reporting-v38` para impedir medir un servidor
  compilado con el reporter anterior.

## Qué no cambió

- planner y prompt;
- validador de planes;
- lifecycle de operaciones;
- writers y preflight;
- grounding, completitud y publicación;
- PostgreSQL y migraciones;
- fixtures o criterios económicos de ME1–ME22.

Por eso v38 no afirma haber corregido la causa de ME4: hace que su próxima
aparición se nombre con precisión. Corregirla sin ese dato volvería a ser un
parche por inferencia.

## Verificación local

| Gate | Resultado |
|---|---:|
| Capture | **764/764**, exit 0 |
| Mutaciones M0 | **411/411**, exit 0, serial, cero residuo |
| TypeScript | limpio |
| `git diff --check` | limpio |
| PostgreSQL | sin cambio funcional; último árbol: **73/73 ×2** |
| Muestra completa del modelo | **reservada para Claude** |

El sello anterior se calculó después de completar lint y build sobre el árbol
documental definitivo; `docs/ROADMAP.md` registra el mismo valor.

## Auditoría solicitada a Claude

1. Sellar el árbol y verificar que no cambia durante la ronda.
2. Auditar que `turnDetail()` lee ambos caminos:
   `turn.intakeDiagnostic` para HTTP 200 recuperado y
   `turn.error.intakeFailures` para HTTP-error.
3. Confirmar que el diagnóstico sigue siendo whitelist/acotado y no incluye
   prompt, candidate JSON ni mensaje del usuario.
4. Correr en serie diff, tsc, lint, capture **764/764**, mutaciones
   **411/411**, PostgreSQL **73/73×2** y build.
5. Levantar servidor nuevo y verificar handshake v38.
6. Comprar **una sola** muestra completa ME1–ME22.
7. Si da 22/22, autorizar commit/deploy. Si ME4 vuelve a fallar, detenerse y
   reportar literalmente `successfulIntakeFailure` (stage, code, attempts y
   validationFailures). No repetir la muestra ni tocar producto hasta tener esa
   causa.

## Veredicto de Codex

**M0 sigue abierto.** El bloqueo inmediato de v37 no era un defecto económico
diagnosticable sino una fuga del instrumento. v38 la cierra con un cambio
mínimo y falsable. El próximo muestreo queda reservado al auditor para que el
presupuesto compre información nueva o un cierre, nunca otro rojo opaco.
