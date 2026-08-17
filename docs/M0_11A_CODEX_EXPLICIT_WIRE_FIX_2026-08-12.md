# M0.11A — contrato wire explícito para el planner

Fecha: 2026-08-12  
Estado: **CORREGIDO LOCALMENTE; 112–113 APLICADAS; M0.11A ABIERTO**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo en este sello: **no ejecutada**

Sello canónico de la superficie ejecutable:

```text
e7c18d47bd7ad9d20765d2b5d6b3fe3e32b2e47d5a92a15d37d4c9a30d537bb3
490 archivos
```

El sello usa el comando de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`; no incluye
documentación ni secretos.

## 1. Hallazgo de Claude que origina esta pasada

Claude aplicó y auditó la 113. La batería determinista quedó verde y
PostgreSQL terminó **78/78 dos veces**. La muestra del modelo fue terminada por
el límite de diez minutos del cliente después de 14 checks; no fue relanzada.
Los resultados parciales ya probaron una regresión grave y consistente:

- el modelo agregaba provenance a `occurredAtISO`, `receivableIds` y
  `targetOperationId`, que no son dinero;
- omitía `movements.0.amount` en batches anidados;
- varias reparaciones no lograban ligar `operation_transition` al target
  estructural correcto;
- otras omitían `authorization_prompt` cuando el manifiesto sí requería una
  segunda entrega;
- al reparar esos rechazos, algunos candidatos perdían el contrato canónico de
  respuesta.

El dinero falló cerrado y no hubo escrituras. La arquitectura del manifiesto no
fue refutada; la interfaz con el modelo sí: el servidor exigía protocolos que
el prompt describía sólo de forma abstracta. Era la misma clase que v34 y v37:
el modelo debía adivinar wire interno en vez de dedicar inferencia al usuario.

## 2. Principio de la corrección

No se añadió una frase, un caso financiero ni un router. El contrato ahora
cumple esta invariante:

> toda estructura que el planner deba emitir se publica desde la misma fuente
> que después la valida, y todo rechazo devuelve el path o conjunto exacto que
> debe reparar.

El modelo sigue decidiendo intención, entidad, transición, procedencia,
atomicidad semántica y lenguaje. El servidor sólo compila o verifica mecánica
que puede probar.

## 3. Correcciones implementadas

### 3.1 Provenance: una sola ontología de paths monetarios

`src/lib/capture/amount-evidence.ts` exporta ahora
`monetaryPathTemplatesFromSchema(schema)`. La función recorre el JSON Schema y
usa exactamente `MONEY_KEYS`/`NON_MONEY_KEYS`, la misma ontología que
`monetaryClaimsFromToolArgs(arguments)` usa sobre el payload real.

Cada capability que recibe el planner incluye:

```text
monetaryProvenancePathTemplates
```

Ejemplos de la regla general:

- schema `amount:number` → template `amount`;
- schema `movements[].amount:number` → template
  `movements[].amount`;
- payload con dos filas → paths concretos `movements.0.amount` y
  `movements.1.amount`;
- fechas, porcentajes, ids y arrays de ids no aparecen.

No se duplica el catálogo completo dentro del system prompt: ya viaja junto a
cada capability. Esto evita aumentar innecesariamente tokens/costo por turno.
El prompt enseña cómo convertir `[]` al índice concreto.

`actionProvenanceContractError` ya no devuelve un síntoma por intento. Antes de
validar la fuente, compara el conjunto entero y reporta:

```text
expected paths
missing paths
non_monetary_or_unknown paths
```

Después conserva todas las barreras previas:

- `user_stated` debe probarse contra el quote exacto de una entrega durable
  exacta de la operación;
- el monto 552,77 de contexto no puede ocupar el pago 45;
- `stored_fact` sólo entra por un verificador executor-side existente;
- `derived` sigue rehusado hasta que B añada un verificador bajo lock.

También se corrigió el comentario del tipo: el wire concreto usa
`movements.0.amount`, no una notación distinta.

### 3.2 Lifecycle: tabla compartida entre prompt y validador

`operationTransitionWireContractForPlanner()` se deriva de los mismos sets que
usa `operationTransitionContractError`:

- kinds que exigen `target_operation_id`;
- kinds cuyo target debe igualar `continuation_operation_id`;
- kinds que exigen `continuation_operation_id=null`;
- forma read-only de `observed`;
- forma payload-free de `confirmed`;
- cierre durable de `rejected`/`abandoned`.

Los rechazos nombran el path exacto. Además se cerró una divergencia encontrada
durante esta pasada: el prompt decía que `observed`, `rejected` y `abandoned`
no continúan la operación, pero el runtime sólo lo exigía para `new` y
`unrelated`. Ahora la misma fuente exige null en los cinco kinds. Una inspección
read-only ya no puede consumir accidentalmente el trabajo observado.

### 3.3 Segunda entrega: policy compartida y rechazo accionable

La policy dejó de vivir como una función opaca. Una sola fuente declara:

- capabilities que siempre requieren segunda entrega;
- reglas condicionales sobre argumentos;
- reasons tipados por `action_id`.

`manifestAuthorizationPolicyForPlanner()` muestra esa policy al modelo y
`manifestSecondDeliveryReasons()` la ejecuta. El nuevo
`authorizationPromptContractError()` exige:

- una pregunta natural única cuando alguna action coincide, nombrando en el
  error los action ids/reglas exactos;
- `null` cuando ninguna coincide.

No se valida una frase de confirmación. La siguiente entrega sigue siendo
interpretada libremente por el modelo y autoriza bajo CAS el manifiesto exacto.

### 3.4 Reparación acotada conserva dimensiones ajenas

El prompt de repair ahora ordena explícitamente conservar requirements y slots
ya válidos durante una reparación de payload/transición/autorización. También
le ordena consumir el contrato wire compartido y no adivinar propiedades.
Cada candidato reparado sigue pasando por el validador completo; no hay waiver.

### 3.5 Muestra larga desacoplada del timeout del auditor

Archivo nuevo:

```text
scripts/qa/run-m0-model-e2e-background.mjs
```

Lanza el runner original como worker detached, hereda el entorno y escribe en
`/tmp` un log, pid y status JSON con el exit real. No cambia fixtures, handshake,
cleanup ni criterio 24/24. Evita que un límite del shell mate una muestra válida
y deje una persona residual; tampoco justifica repetir un sello rojo.

## 4. Cobertura permanente

### IR300

Prueba contra las funciones reales que:

- un batch expone sólo `movements[].amount`;
- dos filas exigen exactamente `movements.0.amount` y
  `movements.1.amount`;
- `occurredAtISO` es reportado como extra no monetario;
- el faltante y el sobrante llegan juntos al repair;
- el catálogo se consume dentro de cada capability del prompt.

### IR301

Prueba que:

- la tabla lifecycle compartida contiene el contrato exacto;
- `modified` no puede apuntar a una operación distinta de la continuación;
- `observed` no puede consumir la operación inspeccionada;
- cuatro `close_card` requieren una sola autorización de manifiesto;
- un plan ordinario requiere `authorization_prompt=null`;
- prompt y validador consumen las mismas funciones.

### Mutantes M0M441–448

Matan, uno por uno:

1. catálogo de schema desconectado de `MONEY_KEYS`;
2. templates omitidos del capability catalog;
3. diagnóstico de provenance reducido a un subconjunto;
4. tabla lifecycle no consumida por el prompt;
5. `modified` contra otra continuación;
6. policy de segunda entrega oculta al planner;
7. manifiesto sensible sin pregunta;
8. inspección `observed` que consume la operación.

## 5. Validación local

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| capture | **780/780**, exit 0 |
| mutaciones M0 completas, seriales | **447/447**, exit 0 |
| build con red, `.next` reconstruido | **36/36 páginas**, exit 0 |
| `node --check` del launcher | limpio |
| `git diff --check` | limpio |

El primer build dentro del sandbox falló sólo al resolver Google Fonts. Se
repitió con red autorizada y compiló 36/36. La advertencia NFT de
`capture-test/page.tsx` ya existía y no impidió el build.

No repetí PostgreSQL porque no cambió SQL, store ni RPC después del **78/78×2**
de Claude. No ejecuté el modelo para reservar la única muestra al re-audit
congelado. No toqué la cuenta del founder, no apliqué migraciones, y no hice
commit, push ni deploy.

## 6. Auditoría solicitada a Claude

### Fuente antes de gastar modelo

1. Sellar el árbol y confirmar el hash/490 archivos de este informe.
2. Probar adversarialmente `monetaryPathTemplatesFromSchema` contra schemas
   simples, arrays anidados, fechas, porcentajes, ids, `anyOf` y opcionales.
3. Para al menos `log_movement`, `log_movements_batch`,
   `record_person_payment` y `undo_agent_operation`, confirmar que el campo
   publicado al planner coincide con los claims del payload real.
4. Verificar que un set incompleto o con extras devuelve todos los paths en un
   solo rechazo, y que source/quote/stored/derived siguen fail-closed.
5. Repetir expresamente el adversarial 552,77: saldo verdadero del contexto
   usado como monto de pago debe rehusarse.
6. Comparar la tabla de `operationTransitionWireContractForPlanner` contra cada
   rama del validador; probar target incorrecto y continuation no nula.
7. Comparar `manifestAuthorizationPolicyForPlanner`,
   `manifestSecondDeliveryReasons` y `authorizationPromptContractError`;
   verificar una y N acciones, ordinary null y sensitive non-null.
8. Confirmar por búsqueda que ninguna rama nueva lee frases del usuario,
   nombres financieros, regex de confirmación o casos del fixture.

### Gates

9. Ejecutar tsc, lint, capture **780/780**, mutaciones **447/447**,
   `git diff --check` y build con red.
10. PostgreSQL no cambió, pero para una ronda de release puede repetirse
    **78/78×2**; no aplicar otra migración. Las 112–113 ya están aplicadas.
11. Borrar `.next`, levantar un servidor nuevo y confirmar handshake
    `m0-agent-eval-2026-08-12-explicit-wire-m0-11a`.

### Una sola muestra pagada

12. Lanzarla desde el principio en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs explicit-wire-audit
```

13. Esperar el status `finished`; esperado **24/24**, exit 0, cero FALL,
    BLOCKED, ABORT y residuo.
14. Si hay rojo, no repetir el sello. Capturar los tres intentos tipados,
    candidato, operación, manifiesto, transición y steps antes del cleanup.
15. Verificar residuo por identidad, detener servidor y confirmar sello final
    idéntico.

## 7. Veredicto de Codex

**Las causas reportadas por Claude están corregidas como contrato de clase, no
como casos del transcript. M0.11A sigue ABIERTO hasta que Claude complete una
única muestra 24/24 sobre este sello.**

M0.11B sigue pendiente y no fue adelantado: selectores de conjuntos, atributos
geográficos y derivaciones masivas pertenecen a B.
