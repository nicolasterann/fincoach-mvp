> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0.11A — compilador de objetivo semántico y cierre anti-bot

> **HISTÓRICO, SUPERADO POR LA PASADA SUSTRACTIVA.** La auditoría de este
> diseño llegó a 12/24: todavía exigía al modelo demasiadas dimensiones
> mecánicas. El relevo vigente es
> `docs/M0_11A_CODEX_SUBTRACTIVE_SEMANTIC_PLAN_2026-08-14.md`.

Fecha: 2026-08-14  
Autor de la implementación: Codex  
Estado: listo para auditoría congelada; **no se autodeclara cerrado**  
Producción: sin cambios; continúa sirviendo v44  
Migraciones: 001–115 aplicadas; esta pasada no agrega DDL

## 1. Por qué esta pasada existe

La 115 y el primer circuito anti-bot cumplieron una propiedad de seguridad:
un rechazo secundario ya no producía una respuesta vacía ni un HTTP 500. La
muestra de Claude demostró que eso no era todavía producto aceptable:

- 15/24;
- cinco de veinte turnos terminaron en `publicationRecovery`;
- dos eran `planner exhausted its bounded read/replan passes`;
- tres no conservaban una causa legible;
- los cinco fueron etiquetados `model_unavailable` aunque el proveedor estaba
  sano.

Una frase genérica que conserva la conversación tampoco resuelve la necesidad
del usuario. En Kipu, un circuito breaker es una red de seguridad y una señal
de release roja; no es inteligencia exitosa. Esta pasada ataca la causa: el
modelo vuelve a poseer el significado y runtime deja de pedirle que fabrique
bookkeeping que puede derivar por sí mismo.

## 2. Nueva frontera de autoridad

### El modelo decide

- el objetivo y la interpretación del usuario;
- qué relación semántica tiene la entrega con trabajo previo;
- qué acciones y entidades representan ese objetivo;
- qué hechos reales siguen ambiguos;
- qué valor dicho por el usuario prueba un argumento concreto;
- la pregunta, explicación, confirmación y recibo en lenguaje natural.

### El servidor compila o verifica

- ids de continuación/observación/abandono;
- deltas de pending antes/después;
- targets de missing-fields contra actions o `$response`;
- `source_ref`, testigo y binding durable de una cifra user-stated;
- procedencia completa de stored facts;
- hashes, manifests, CAS, locks, preflight, receipts y postcondiciones.

Ningún compilador inspecciona la frase del usuario para elegir intención. No hay
rutas por “arriendo”, “crédito”, “sí”, nombres de cuentas ni transcripts. Los
compiladores no pueden crear acciones, entidades, importes, efectos o hechos
faltantes; su salida cruza el validador y el preflight originales.

## 3. Cambios implementados

### 3.1 Objetivo estable e interpretación enriquecible entre reads

`AgentSemanticGoal` conserva `goal`, la interpretación inicial y la relación
semántica con una operación anterior. El primer pase válido que solicita una
lectura fija el objetivo y esa relación. Los pases posteriores reciben
`SEMANTIC_GOAL`: runtime impide sustituir el objetivo o el target durable, pero
permite y exige que el modelo refine `interpretation` con la evidencia nueva.
Congelar también la interpretación habría sido otra forma de rigidez robótica.

El tercer pase es síntesis, no otra oportunidad de aplazar: debe consumir
`READ_EVIDENCE` y devolver respuesta, acción o una pregunta por evidencia que
sólo el usuario puede aportar. Una lectura idéntica a evidencia ya disponible se
rechaza con capability/action exacta. Si no converge, el diagnóstico conserva
los intentos y razones; ya no aparece un agotamiento vacío.

### 3.2 Lifecycle compilado desde significado

`compileSemanticOperationLifecycle` consume la clase y target elegidos por el
modelo y deriva desde `openOperations`:

- `continuation_operation_id`;
- `observed_operation_ids`;
- `abandon_operation_ids`;
- `consumed_pending_keys` y `remaining_pending_keys`.

No interpreta lenguaje ni altera actions. `operationTransitionContractError`
sigue verificando el before/after durable.

### 3.3 Missing targets compilados

`compileMissingFieldTargets` liga un missing real a actions cuyo schema carece
de ese path. Sólo usa `$response` cuando el modelo declaró la ambiguity del mismo
hecho. El modelo sigue decidiendo que el hecho es ambiguo; runtime sólo evita
que deba adivinar ids mecánicos.

### 3.4 Procedencia mecánica compilada

Para `stored_fact`, el modelo devuelve `provenance=[]`; runtime genera toda la
procedencia desde el action/entity ya elegidos y el catálogo completo.

Para `user_stated`, el modelo declara únicamente la asociación semántica
`{path, kind:"user_stated", quote}`. Runtime localiza esa cita:

1. en la entrega actual; o
2. en exactamente una entrega de autoridad de la operación continuada.

Después genera `source_ref`, witness y derivación nula. No busca en todo el
historial. Un número verdadero pero ajeno —incluido 552,77— no obtiene autoridad
por estar presente: sin asociación semántica declarada, el plan queda intacto y
el validador lo rehúsa.

`derived` sigue fuera de A y fail-closed hasta M0.11B.

### 3.5 Lenguaje natural sin autoridad léxica

Una pregunta model-authored ya validada contra `missing_fields` no vuelve a
pasar por tokens o regex españoles. Runtime verifica lifecycle, ownership y
verdad; el modelo decide cómo preguntar. Las funciones léxicas históricas se
mantienen sólo para sondas adversariales y compatibilidad, no en la ruta viva de
publicación.

### 3.6 Recovery con causa real de extremo a extremo

`AgentPublicationRecovery` distingue:

- `planner_intake_failed`;
- una negativa determinista de publicación;
- `response_model_unavailable`;
- `turn_exception`.

Cada fila lleva `{source, stage, code, detail, validationFailures}` acotado. El
replay dejó de hacer un cast sin validar: parsea el diagnóstico y normaliza una
sola vez el alias legacy `model_unavailable`. Un recovery moderno sin diagnóstico
se rechaza. El handler también emite `turn_exception`, nunca “caída del modelo”
para un fallo interno.

El circuito breaker sigue existiendo para evitar silencio, pero cualquier uso
es rojo transversal en el E2E. No se promete “reintento en 10 minutos”: no hay
un worker durable con `next_attempt_at`, y una promesa sin scheduler sería copy
falsa. A sólo cierra si la ruta normal llega a 24/24 con cero recoveries.

## 4. Seguridad que no se relajó

- La clase 552,77 sigue rehusada.
- `user_stated` queda ligado a una entrega durable exacta, no al historial.
- Stored facts se re-derivan bajo la frontera ya auditada; una etiqueta del
  modelo no concede autoridad.
- La igualdad manifest autorizado/preparado/ejecutado/asentado/verificado no
  cambia.
- Writers, SQL, RLS, locks, preflight y receipt ownership no cambian.
- Preguntar naturalmente no concede permiso de ejecución.
- Una candidata compilada cruza el mismo validador estricto.
- M0.11B no se adelantó: no hay selectores geográficos, conjuntos derivados ni
  balance targets nuevos.

## 5. Red determinista nueva

- **IR312 / M0M479:** objetivo/relación estables, interpretación enriquecible y
  lifecycle mecánico.
- **IR313 / M0M480:** targets de missing-fields derivados sin inventar facts.
- **IR314 / M0M469+481:** quote semántica, entrega exacta y negativo 552,77.
- **IR315 / M0M470+482+483:** síntesis final, goal lock y causa de intake real.
- **IR316 / M0M282+484:** cero autoridad española por tokens en la ruta viva.
- **IR317 / M0M485+486:** diagnóstico tipado en replay y handler.

IR268 fue recableado: `changed=false` y `user_action=null` se validan por
estructura, no por frases que “suenen a no-write”. IR271 volvió a apuntar al
pipeline vigente después de insertar el compilador de procedencia.

## 6. Validación local de Codex

- `git diff --check`: limpio;
- `npx tsc --noEmit`: exit 0;
- `npm run lint`: exit 0;
- capture: **796/796**;
- mutaciones M0: **485/485**, seriales, cero supervivientes/anchor miss y
  restauración byte a byte;
- build: **36/36** páginas, compilación exitosa con red.

La numeración llega a M0M486 pero el total es 485: M0M34 no existe en el
catálogo histórico. No es un caso omitido por esta pasada.

No se ejecutó la muestra del modelo: se reserva el crédito para una única
medición congelada de Claude. Esta pasada no cambió PostgreSQL; la frontera
vigente ya fue auditada en 82/82×2 después de aplicar la 115, y Claude debe
repetirla por disciplina de release antes de gastar la muestra.

## 7. Auditoría solicitada a Claude

### 7.1 Sello

- hash: `dd40a7e9f5fa187e727e77caf38f03f5f17583ca58533cfa7ce9aef718216557`
- archivos: `493`
- runtime: `m0-agent-eval-2026-08-14-semantic-objective-m0-11a`

Verificar hash al inicio, después de mutaciones y al final. No editar el árbol.

### 7.2 Revisión de fuente obligatoria

1. Confirmar que los tres compiladores no inspeccionan el mensaje para elegir
   intención ni agregan/eliminan actions/effects/importes/entidades.
2. Confirmar que el lock se aplica sólo al objetivo y relación durable después
   de una primera semántica válida; `interpretation` debe poder enriquecerse con
   `READ_EVIDENCE` y el último pass no admite otro read.
3. Confirmar que `user_stated` requiere quote del modelo + una entrega durable
   exacta; una cifra meramente presente no se autoautoriza.
4. Confirmar que stored facts siguen re-derivándose y `derived` sigue oculto y
   fail-closed.
5. Confirmar que las preguntas vivas no usan matcher léxico español.
6. Confirmar que todo recovery nuevo lleva causa tipada y que replay/handler no
   vuelven a `model_unavailable` genérico.
7. Confirmar que cualquier recovery continúa contando rojo en el modelo E2E.

### 7.3 Orden de gates

1. `git diff --check`
2. `npx tsc --noEmit`
3. `npm run lint`
4. `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs`
5. `node ./scripts/qa/telegram-agent-regression-audit.mjs` — solo, serial
6. `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs` ×2;
   esperar 82/82 ambas veces
7. borrar `.next` fuera del árbol sellado y `npm run build`
8. levantar un servidor limpio, confirmar el runtime anterior y ejecutar una
   única muestra en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs m0-11a-semantic-objective
```

Esperar el status final del mismo pid. Un timeout del cliente no autoriza otra
muestra.

### 7.4 Criterio de aceptación

- 24/24;
- ME16 y ME17 verdes en la misma corrida;
- cero FALL/BLOCKED/ABORT;
- cero respuesta vacía, error final o jerga interna;
- cero `agentPublicationRecovery` / anti-bot recovery;
- residuo cero por identidad;
- hash final idéntico.

Ante un rojo: detenerse, conservar la causa tipada y no repetir el mismo sello.

## 8. Qué viene después

Un verde de esta auditoría cierra técnicamente **M0.11A** y autoriza
commit/deploy/smoke/founder review del árbol exacto. Después comienza
**M0.11B**: selectores por conjuntos, atributos geográficos/institución,
derivaciones locked y targets masivos con proyección/drift. B amplía lo que Kipu
puede hacer; no debe reabrir la frontera semántica que A acaba de fijar.

Sin commit, push ni deploy.
