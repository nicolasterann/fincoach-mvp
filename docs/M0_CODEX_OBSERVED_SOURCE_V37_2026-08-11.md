# Bloque M0 — source observado explícito v37

Fecha: 2026-08-11  
Estado: `M0_ABIERTO`, listo para una auditoría completa congelada de Claude  
Migraciones: 001–111 aplicadas; no hay migración nueva; próxima 112  
Contrato runtime: `m0-agent-eval-2026-08-10-observed-source-v37`

## Sello ejecutable

```text
e82f01047ef69a29922424dd2d8e0dd66eb005c0314fe6fcd7a600e97cf90474
486 archivos
```

## Hallazgo v36

La muestra completa v36 certificó la reparación monetaria de ME4 y terminó
21/22 sólo en ME5. La autoridad observada exigía que cada
`plan.assertions[i].source` comenzara por `openOperations`, pero el prompt sólo
enseñaba ejemplos de `financial_context` y `read_evidence`. Tras tres intentos,
el repair recibía el error factual genérico, no el campo que debía corregir.
IR265 usaba el token correcto escrito a mano, por lo que podía quedar verde sin
probar que el modelo conocía el protocolo.

## Reparación v37

`OPEN_OPERATION_ASSERTION_SOURCE_ROOT` y `openOperationAssertionSource()` son
la única fuente para prompt, validador y fixture. El prompt documenta:

```text
openOperations[<observed_operation_id>].<campo>
```

El validador no acepta sólo el nombre de la colección: exige que el source
nombre uno de los ids efectivamente declarados en `observed_operation_ids`. Si
falla, devuelve:

```text
plan.assertions[i].source must start with
openOperations[<one observed_operation_id>]
```

Ese reason entra al bucle acotado existente como `validation_error`, por lo que
el modelo puede converger sin adivinar. No hay compilación semántica, router por
frase, capability financiera ni fallback preescrito.

## Redes

- IR265 deriva el source válido con `openOperationAssertionSource`, usa el id
  desconocido en su propio source para aislar el guard de membresía y exige la
  ruta exacta para una assertion de `financial_context`.
- IR284 fija por nombre que prompt, validador y fixture comparten el contrato.
- M0M408 elimina la instrucción del prompt.
- M0M409 degrada la ruta diagnóstica a un error genérico.
- M0M410 desvía el constructor compartido a `financial_context`.
- M0M300/M0M401 fueron repuntadas para atacar una sola frontera; la primera
  pasada adversarial detectó correctamente que sus fixtures anteriores morían
  por la nueva barrera antes de alcanzar la mutación. Sólo la segunda corrida
  completa y limpia cuenta como evidencia final.

## Evidencia local

| Gate | Resultado |
|---|---:|
| `git diff --check` | limpio |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| Capture | **763/763**, exit 0 |
| Mutaciones M0 | **410/410**, exit 0, serial, cero residuo |
| PostgreSQL | sin cambios de esquema/writer; último **73/73×2** |
| Build con red | compilado, **36/36 páginas** |
| Modelo enfocado ME1–ME5 | **5/5**, exit 0 |

La corrida enfocada usó un servidor nuevo con handshake v37. ME4 escribió los
tres pagos y publicó; ME5 respondió el dato concreto sin consumir la operación
original. No se ejecutó una muestra completa 22/22.

## Archivos funcionales de v37

- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/telegram-agent-regression-audit.mjs`

## Auditoría solicitada a Claude

1. Verificar sello, 486 archivos y `NO_EDITS_DURING_AUDIT`.
2. Confirmar que prompt, validator y fixture consumen la fuente compartida; que
   el source liga un id observado real; y que el reason incluye
   `plan.assertions[i].source`.
3. Ejecutar serialmente diff, tsc, lint, capture **763/763**, mutaciones
   **410/410**, PostgreSQL **73/73×2** y build.
4. Levantar runtime nuevo y verificar
   `m0-agent-eval-2026-08-10-observed-source-v37`.
5. Ejecutar exactamente **una muestra completa 22/22**. No repetir un rojo sobre
   este sello ni cambiar assertions.
6. Verificar cleanup por identidad, Diners sólo lectura y hash final idéntico.

Un verde autoriza commit/deploy; M0 se cierra sólo después del SHA desplegado,
smoke productivo y revisión final del founder.
