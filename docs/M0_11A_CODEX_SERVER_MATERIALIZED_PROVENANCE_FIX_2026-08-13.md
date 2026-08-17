# M0.11A — provenance de valores materializados por el servidor

Fecha: 2026-08-13  
Estado: **CORREGIDO LOCALMENTE; M0.11A ABIERTO HASTA RE-AUDIT Y 24/24**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo en esta pasada: **no ejecutada (cero créditos)**

## 0. Sello entregado a Claude

Superficie ejecutable canónica:

```text
e2dc09becb1ecaf42d621cc55744c663d2417acafb70c0987d08eb38a1ecfdbc
492 archivos
```

El sello usa el comando canónico de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`; incluye `src/`,
`supabase/sql/`, `scripts/qa/` y configuración ejecutable, y excluye docs y
secretos.

## 1. Causa raíz confirmada

La auditoría de Claude sobre el sello `9c7cb8f8…` llegó a 13/24 y encontró una
contradicción entre dos contratos correctos por separado:

- `register_card_payment` con `paidInFull=true` omite deliberadamente
  `arguments.amount`; la migración 107 deriva el remanente vivo del corte bajo
  lock y no confía en una cifra del modelo;
- el registro `stored_fact` publicado al planner ofrece precisamente
  `register_card_payment.amount ← debt_accounts:<id>:full_payment_due`;
- el conjunto de provenance exigido por runtime se calculaba únicamente desde
  cifras presentes en `arguments`, por lo que esperaba `[]` y rechazaba la
  procedencia server-owned de `amount` como path desconocido.

El modelo no tenía una salida legal. Citar el corte se rechazaba; omitirlo
dejaba sin procedencia el valor económico que PostgreSQL iba a materializar.
ME16 falló antes de ejecutar y el resto fue cascada.

No era una frase no reconocida ni un caso de tarjeta que debiera rutearse. Era
una definición incompleta de qué valores monetarios existen en una acción.

## 2. Invariante nueva

El conjunto canónico de claims monetarios requeridos para una acción es:

1. cada path monetario numérico presente en sus argumentos; más
2. cada path que un verificador `stored_fact` registrado materializa cuando se
   cumple su precondición estructural tipada.

Una precondición no interpreta lenguaje. En el único caso nuevo actual:

```text
capability: register_card_payment
path: amount
required_when_argument_missing:
  argument_path: paidInFull
  equals: true
```

La regla no agrega una acción, no elige tarjeta, no decide intención y no
inserta `amount` en el payload. Sólo reconoce que la ejecución de una acción ya
elegida y validada producirá un monto desde un hecho durable exacto.

Sin una autoridad server-owned coincidente, el claim no se sintetiza. Un
`stored_fact` escrito por el modelo no se convierte en autoridad por
autodeclaración.

## 3. Implementación

### 3.1 Una sola fuente para prompt, compilador y validador

`agent-operation-authority.ts` ahora posee:

- `requiredMonetaryClaimsForAction`;
- la condición estructural `required_when_argument_missing` dentro de cada
  `StoredFactVerifierDefinition`;
- `storedFactMaterializesMissingPath`, que sólo materializa un claim si existe
  una autoridad exacta emitida por el servidor para capability, path, entidad,
  moneda y valor.

La misma función se consume en dos puntos críticos:

- `compileStoredFactProvenance`, para normalizar únicamente la procedencia de
  una acción que el modelo ya eligió;
- `actionProvenanceContractError`, para calcular el conjunto exacto que se
  verifica en runtime.

El prompt se genera desde el mismo registro y enseña explícitamente la unión:
paths presentes más paths materializados. Ya no existe una forma que el
catálogo invite y el validador prohíba.

### 3.2 Fail-closed preservado

- Full payment: `amount` sigue ausente de arguments; provenance exacta del corte
  vivo es obligatoria y se revalida contra la tarjeta elegida.
- Partial payment: el `amount` explícito sigue siendo `user_stated`, ligado a
  la entrega durable exacta. El monto full guardado no lo reemplaza.
- Catálogo/autoridad ausente: no se crea un claim server-owned.
- Tarjeta, moneda, valor o `source_ref` distintos: el verifier no aplica.
- El guard de la 107, CAS, lock, monto de corte, ledger leg y postcondiciones no
  se tocaron.
- El caso 552,77 conserva su rechazo: una cifra visible en contexto no se
  convierte en procedencia del usuario ni stored fact de la acción.

## 4. Matriz determinista de formas legales

Claude pidió cruzar `capability × forma monetaria legal` antes de comprar otra
muestra. IR309 hace ese cruce mecánicamente, no como catálogo de transcripts:

1. recorre todos los `KIPU_TOOL_SCHEMAS`;
2. obtiene cada template monetario de la ontología compartida;
3. materializa un path concreto, incluidos arrays anidados;
4. exige que el cálculo canónico encuentre exactamente ese claim;
5. recorre además toda regla registrada que materializa un path ausente.

Adversariales nombrados dentro de IR309:

- `paidInFull=true`, sin `amount`, con autoridad exacta ⇒ requiere `amount`;
- la provenance exacta valida;
- omitir esa provenance reporta `missing=[amount]`;
- parcial explícito con quote durable exacta valida como `user_stated`;
- full sin autoridad no inventa un claim;
- el compilador agrega sólo provenance y mantiene `arguments.amount` ausente;
- prompt, compilador y validador consumen la fuente compartida.

Mutantes nuevos:

- **M0M466:** desactiva la condición estructural del full;
- **M0M467:** hace que runtime vuelva a mirar sólo arguments presentes;
- **M0M468:** hace que el compilador ignore los claims materializados;
- **M0M469:** vuelve a enseñar en el prompt la regla vieja.

Los cuatro mueren por IR309. El total efectivo del runner es **468/468**.

## 5. Runtime y migraciones

Runtime esperado:

```text
m0-agent-eval-2026-08-13-server-materialized-provenance-m0-11a
```

La migración 114 fue aplicada y verificada por Claude antes de este fix.
PostgreSQL demostró ambos sentidos con M114.1/M114.2. Esta pasada no modificó
SQL ni reescribió las migraciones 112–114.

## 6. Validación de Codex

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio, exit 0 |
| `npm run lint` | limpio, exit 0 |
| capture | **788/788**, exit 0 |
| mutaciones M0 | **468/468**, exit 0, cero anchor miss, restauración byte a byte |
| PostgreSQL E2E | **80/80×2**, exit 0 |
| `npm run build` | **36/36 páginas**, compilado |
| `git diff --check` | limpio |
| modelo | **no ejecutado; cero créditos** |

El warning conocido de tracing de `next.config.ts → capture-test` sigue siendo
no bloqueante; el build compiló y generó las 36 páginas.

## 7. Auditoría solicitada a Claude

Claude debe congelar el sello indicado en el relevo y no editar código,
fixtures ni aserciones.

### Fuente

1. Confirmar que prompt, `compileStoredFactProvenance` y
   `actionProvenanceContractError` consumen
   `requiredMonetaryClaimsForAction`.
2. Confirmar que la condición para materializar un path ausente vive en el
   registro tipado y no inspecciona lenguaje.
3. Confirmar que `paidInFull=true` mantiene `amount` ausente del payload.
4. Confirmar que ninguna autoridad model-authored basta para crear el claim.
5. Barrer los demás verificadores y demostrar que ninguno materializa un path
   que no declaró.

### Adversariales

- full exacto con autoridad de la tarjeta elegida;
- full sin autoridad, con tarjeta distinta, moneda distinta, monto distinto o
  corte cubierto/sin remanente;
- parcial explícito igual y distinto al full;
- mismo monto perteneciente a otra tarjeta;
- un path monetario anidado de otra capability;
- prueba explícita de que 552,77 sigue rehusada.

### Gates y stopping rule

1. tsc, lint, diff check;
2. capture **788/788**;
3. mutaciones **468/468**;
4. PostgreSQL **80/80 dos veces**;
5. build limpio;
6. servidor nuevo y handshake exacto;
7. una sola muestra completa en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs server-materialized-provenance-audit
```

Esperado: **24/24**, exit 0, cero FALL/BLOCKED/ABORT/residuo. Deben pasar
juntos ME4, ME10aa, ME10c, ME13, ME16 y ME17. En ME16 verificar que las cuatro
acciones `paidInFull` quedan bajo un solo manifiesto y que una confirmación
natural ejecuta el conjunto exacto una sola vez.

Ante el primer rojo se detiene la ronda, se conserva la causa tipada y no se
repite el mismo sello buscando verde.

## 8. Veredicto de Codex

La regresión 13/24 tenía una causa de clase y queda corregida en la fuente
compartida que define los valores monetarios de una acción. No se añadió una
ruta por frase, tarjeta, transcript ni check. M0.11A sigue **ABIERTO** sólo hasta
el re-audit congelado y una muestra real 24/24.

No hay commit, push ni deploy. M0.11B sigue fuera de alcance.
