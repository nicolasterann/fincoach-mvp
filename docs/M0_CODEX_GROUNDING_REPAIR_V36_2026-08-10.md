> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Bloque M0 — grounding post-write y autoridad observada v36

Fecha: 2026-08-10/11  
Estado: `M0_ABIERTO`, listo para una auditoría completa congelada de Claude  
Migraciones: 001–111 aplicadas; no hay migración nueva; próxima 112  
Contrato runtime: `m0-agent-eval-2026-08-10-grounding-repair-v36`

## Sello ejecutable

```text
bd3f6b701eca88c056911ed223a73331ef88a4f2d1a0382c166693300db24501
486 archivos
```

El sello usa el comando canónico de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md` y excluye docs,
`.env.local`, `.next` y secretos. Debe verificarse antes y después de la ronda.

## 1. Hallazgos de la auditoría v35

La muestra completa v35 dejó ME4 rojo después de escribir y verificar tres
pagos de tarjeta. La publicación agotó tres intentos con
`money_not_grounded`, devolvió HTTP 500 y no indicó qué figura había fallado.
`requested_amounts_omitted` no había disparado, por lo que los importes exigidos
sí estaban; el candidato más probable era una cifra adicional del contexto
anterior (por ejemplo, el sueldo que el usuario mencionó como procedencia), pero
esa hipótesis no era demostrable después del cleanup.

Claude encontró además una fuga de fuente en v35: la autoridad alternativa de
una operación observada no exigía que esa operación poseyera el pending que la
respuesta decía explicar, ni que sus assertions provinieran del estado de la
operación. Un id visible ajeno podía intentar lavar un contrato factual vacío.

## 2. Fix 1 — diagnóstico acotado y reparación de grounding

`replyMoneyGroundingFailures` sigue siendo una barrera determinista y estricta.
No se amplió la evidencia ni se autorizó una cifra nueva. Al fallar, v36 deriva
como máximo ocho diagnósticos con esta única forma:

```ts
{ value: number; reason: string; roles: string[] }
```

No contiene el segmento rechazado, mensaje del usuario, prompt, candidate JSON,
ids de entidades ni secretos. El resultado atraviesa `finalizeAgentReply`, se
persiste en el resultado/`last_error` de la operación y el E2E lo imprime antes
del cleanup. Por tanto, el siguiente rojo puede nombrar la cifra exacta sin
inferirla.

La única reparación recibe `FIGURAS RECHAZADAS POR GROUNDING` y debe eliminar
esas cifras, preservando la idea sin número. Sólo puede repetir una si la
evidencia de acciones liga explícitamente el mismo valor a entidad y rol. Tras
una escritura verificada, otra instrucción general obliga a tomar montos sólo de
`KIPU_EXECUTED_PLAN_DATA` o pending verificado; sueldo, saldo o contexto previo
pueden describirse como procedencia, pero no citarse con números sin receipt de
ese turno.

Esto no es una plantilla ni una lista de frases. El modelo conserva la redacción
y el razonamiento; el servidor limita únicamente qué cifras puede afirmar tras
mover dinero.

## 3. Fix 2 — autoridad observada ligada a su pending real

`validatePlannedAgentRequest` recibe el subconjunto
`inspectablePendingOperationIds`, derivado de filas `awaiting_input` con
`missingFields` y `pendingQuestion` durables. La excepción de completitud exige
ahora simultáneamente:

- `response_intent === "answer"`;
- al menos una operación observada y todas dentro del subconjunto pending;
- cero actions y cero missing fields nuevos;
- todas las assertions con `source` dentro de `openOperations`.

Una operación visible sin pending, una assertion de `financial_context` o un
`answer_and_act` siguen bajo el contrato canónico normal. No se añadió routing
por frase, capability financiera ni nuevo kind cualitativo.

## 4. Redes permanentes

- **IR265** prueba la autoridad válida y rechaza operación sin pending,
  assertion ajena, id invisible, action y missing field nuevos.
- **IR283** construye receipts de 50.60, 22.14 y 201.25 y una respuesta que
  añade 575.89. Exige que sólo 575.89 sea rechazada como `amount_absent`, que el
  diagnóstico llegue a la reparación y al E2E, y que el contexto amplio no se
  vuelva evidencia post-write.
- **M0M402–403** intentan lavar completitud con operación sin pending o
  assertion ajena.
- **M0M404–407** eliminan, respectivamente, el diagnóstico del resultado, su
  consumo por la reparación, la regla post-write y su captura antes del cleanup.
  Todos mueren por su detector nombrado.

## 5. Validación ya ejecutada por Codex

| Gate | Resultado |
|---|---:|
| `git diff --check` | limpio |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| Capture | **762/762**, exit 0 |
| Mutaciones M0 | **407/407**, exit 0, serial, cero residuo |
| PostgreSQL real corrida 1 | **73/73**, exit 0 |
| PostgreSQL real corrida 2 | **73/73**, exit 0 |
| Build con red | compilado, **36/36 páginas** |
| Modelo enfocado ME1–ME5 | **5/5**, exit 0 |

La primera invocación PostgreSQL dentro del sandbox falló por DNS antes de crear
usuario y no cuenta como medición. Las dos corridas con red fueron 73/73. El
primer build falló sólo al descargar Google Fonts; la repetición con red compiló.
No se ejecutó una muestra completa: se reservó exactamente una al auditor.

En la muestra enfocada ME4 escribió los tres pagos, dejó únicamente la entrada
ambigua pendiente y publicó la respuesta; ME5 explicó el dato faltante sin
consumir la operación original. El runner terminó con cleanup y el servidor fue
detenido.

## 6. Archivos funcionales modificados en v36

- `src/lib/ai/agent/kipu-agent.ts`
- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/m0-model-conversation-e2e.mjs`
- `scripts/qa/telegram-agent-regression-audit.mjs`

## 7. Auditoría solicitada a Claude

No editar código, prompt, fixtures ni aserciones en la primera pasada.

1. Verificar sello `bd3f6b701…b24501`, 486 archivos y diff limpio.
2. Auditar que el diagnóstico sólo contiene value/reason/roles, está acotado,
   se persiste antes del cleanup y nunca se vuelve evidencia de verdad.
3. Auditar que la reparación quita únicamente cifras rechazadas, mientras la
   regla post-write conserva al modelo como autor y restringe sólo montos sin
   receipt.
4. Auditar que la autoridad observada exige pending durable real y assertions
   de `openOperations`; una operación ajena no puede eximir hechos canónicos.
5. Ejecutar serialmente diff check, tsc, lint, capture **762/762**, mutaciones
   **407/407**, PostgreSQL **73/73×2** y build con red.
6. Borrar/recrear `.next`, levantar un servidor nuevo con `KIPU_AGENT_MODE=on`
   y verificar el handshake
   `m0-agent-eval-2026-08-10-grounding-repair-v36`.
7. Ejecutar **una sola muestra completa 22/22**. No repetir un rojo sobre este
   sello. Si cae, detenerse y reportar la razón tipada y
   `moneyGroundingFailures`; no cambiar assertions.
8. Verificar cleanup por identidad, Diners sólo lectura y hash final idéntico.

Un verde autoriza commit/deploy, no el cierre automático: después se verifica el
SHA desplegado, smoke productivo y revisión final del founder.

## Veredicto de Codex

Los dos hallazgos v35 están corregidos como invariantes generales, sin
hardcodear el transcript ni quitar autoridad semántica al modelo. ME4 y ME5
pasaron en la única muestra enfocada. **M0 permanece abierto** hasta el re-audit
congelado y la única muestra completa 22/22 de Claude sobre este sello.
