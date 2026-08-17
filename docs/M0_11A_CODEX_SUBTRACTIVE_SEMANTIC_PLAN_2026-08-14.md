# M0.11A — relevo sustractivo: significado en el modelo, mecánica en runtime

Fecha: 2026-08-14  
Estado: **IMPLEMENTADO LOCALMENTE; LISTO PARA AUDITORÍA CONGELADA**  
Commit/push/deploy: **ninguno**  
Muestra pagada en esta pasada: **ninguna (cero créditos)**

## 0. Sello entregado a Claude

Superficie ejecutable canónica:

```text
e56c955360f7cdcb1e31718ba5a9835cc9bf79c632e9b3f6e941cad716721e7c
493 archivos
```

Runtime esperado:

```text
m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a
```

El sello usa el comando de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`: incluye `src/`,
`supabase/sql/`, `scripts/qa/` y configuración ejecutable; excluye docs y
secretos. Este informe no altera el sello.

## 1. Por qué esta pasada no es la ronda once del mismo patrón

El último audit quedó en 12/24. El diagnóstico de Claude fue correcto: un turno
debía producir simultáneamente transición, targets, effects, provenance por
path, ids, grupos, dependencias, manifests, witnesses, postconditions,
missing-fields, response requirements y template. Un gasto ordinario implicaba
unas cuarenta obligaciones de wire. Cada contrato era defendible aislado; el
modelo de probabilidades conjunto no lo era.

Esta pasada no agrega otro contrato al JSON anterior. Lo reemplaza en el camino
vivo por una interfaz semántica pequeña y cuenta la resta en el gate:

```text
antes:  ~20 campos raíz/plan + ~9 por action + formas anidadas ≈ 40 obligaciones
ahora:  6 raíz + 3 unidad + 3 step = 12 obligaciones para un write ordinario
límite: 14; el capture falla si vuelve a crecer
```

No se declara A cerrada por ese conteo. Es una condición falsable previa a los
gates funcionales: si la forma vuelve a crecer, una muestra verde no la salva.

## 2. Nueva frontera de autoridad

### 2.1 Lo que decide el modelo

El planner conserva el catálogo completo y decide:

- el objetivo y la interpretación del usuario;
- cómo se relaciona el turno con trabajo durable anterior;
- capability y argumentos públicos;
- qué steps forman una sola promesa todo-o-nada;
- ambigüedades reales y su pregunta natural;
- qué hechos canónicos debe incluir una respuesta;
- el cambio observable esperado por entidad;
- una cita textual exacta, local a cada step, cuando un valor fue dicho por el
  usuario y no puede derivarse del estado vivo.

Wire exacto del modelo:

```text
root = goal · interpretation · relation · execution_units · ambiguities · answer_needs
unit = steps · expected_change · confirmation_prompt
step = capability · arguments · evidence
```

No existe pre-router de relevancia ni selección léxica de tools. Las 122
capabilities siguen disponibles en cada decisión.

### 2.2 Lo que ya no fabrica el modelo

Runtime crea y valida:

- action ids;
- effects y patas contables completas;
- provenance, paths y source refs;
- lifecycle y targets de missing fields;
- CAS, manifests, hashes y state witnesses;
- atomic groups y dependencies;
- postconditions y projected state durable;
- response requirement ids, fuentes y template;
- receipts y comparación autorizado/preparado/ejecutado/verificado/asentado.

El prompt estricto anterior permanece sólo como artefacto histórico exportado
para fixtures/mutantes. No tiene call sites vivos. `IR318` exige una sola
declaración audit-only y que la muestra real use exclusivamente
`semanticPlannerSystemPrompt`.

## 3. Compilación mecánica server-side

`compileSemanticAgentPlan` transforma el objetivo semántico en el envelope
durable estricto antes de preflight:

1. valida la forma cerrada 6/3/3;
2. valida capability y argumentos contra el catálogo completo;
3. deriva la ontología económica desde capability + modo + argumentos;
4. añade patas que son contabilidad, no intención —por ejemplo un expense
   siempre contiene salida de caja/deuda y `expense_recognition/increase`;
5. contrasta todas las superficies materiales derivadas con
   `expected_change`;
6. materializa atomicidad desde la unidad semántica elegida por el modelo;
7. deriva provenance y lifecycle;
8. reentra al validador, preflight, locks, writers y verificación de manifiesto
   ya auditados.

Un write con `expected_change=[]` se rehúsa. Una entidad, superficie o dirección
que no coincide con el writer se rehúsa. Derivar mecánica no convierte una
interpretación errónea en una escritura válida.

### 3.1 Atomicidad

Runtime no agrupa porque dos pasos compartan cuenta, capability o mensaje. La
unidad todo-o-nada la decide el modelo como parte del resultado que el usuario
autoriza. N steps de una unidad se convierten en un grupo/dependency chain;
unidades separadas siguen independientes.

### 3.2 Evidencia y la clase 552,77

La evidencia `user_stated` es local al step. El modelo elige un fragmento
exacto por significado; no nombra path, source, delivery ni hash. Runtime:

- deriva qué monetary path necesita prueba;
- exige que la cita pertenezca a la entrega durable actual o a exactamente una
  entrega de autoridad de la misma operación;
- liga cita, action y path;
- no auto-promueve un número sólo porque aparece en el mensaje o en el contexto.

Dos steps con importes iguales no pueden compartir las citas de la unidad. Sin
cita semántica, 552,77 sigue sin autoridad. Los `stored_fact` no necesitan cita:
se releen y revalidan bajo la frontera server-owned existente. `derived` sigue
fuera de la interfaz viva hasta M0.11B.

## 4. Read/replan y errores

La primera semántica válida fija objetivo y relación durable a través de reads
internos. El modelo puede enriquecer interpretación y completar el plan con
`READ_EVIDENCE`, pero el pass final no puede volver a pedir el mismo read ni
postergar síntesis.

La frontera pública de `runKipuAgent` normaliza cualquier `ok:false` que no sea
inflight a una causa tipada. Eso evita rutas sin diagnóstico, pero no maquilla
el release: una respuesta vacía, error, jerga interna o
`agentPublicationRecovery` sigue contando rojo. Sólo tres resultados normales
son aceptables:

1. se hizo y se verificó;
2. falta una ambigüedad real y Kipu pregunta exactamente cuál;
3. una restricción real lo impide y Kipu explica la alternativa concreta.

Un airbag genérico no cuenta como inteligencia exitosa.

## 5. Catálogo y costo

El catálogo completo no se filtró. Se movió, junto con el prompt semántico, a
un mensaje `system` estático que precede a cualquier byte dinámico. Así el
proveedor puede cachear el prefijo sin introducir un router de relevancia.

Cada turn expone y el E2E agrega:

```text
calls
promptTokens
cachedPromptTokens
completionTokens
staticPrefixCharacters
dynamicInputCharacters
```

`turnDetail()` incluye la misma telemetría cuando un check falla. Claude debe
reportar los valores reales de la única muestra; no debe inferir ahorro sólo
por la estructura.

## 6. Instrumento conversacional

`scripts/qa/m0-model-conversation-e2e.mjs` ya no importa
`planKipuRequest`, `validatePlannedAgentRequest` ni ninguna forma privada del
planner. Conversa por HTTP y juzga PostgreSQL, lifecycle, manifests, writes,
preguntas y residuo. Las paráfrasis son sondas, no un catálogo de frases. La
convergencia es por efecto económico observable, no por JSON o copy.

Los checks semánticos de préstamos antes directos ahora son turnos reales:
capital devuelto, fondos prestados, devolución registrada, préstamo saliente,
ambigüedad y no-acción se prueban por estado final.

ME16 y ME17 siguen siendo las sondas de M0.11A:

- una referencia natural al conjunto ejecuta cuatro pagos bajo una identidad;
- una confirmación natural autoriza un manifiesto sensible completo una sola
  vez, sin challenges por tool ni frase mágica.

## 7. Redes nuevas

Capture IR318–IR327:

- `IR318`: 6/3/3, gasto 12 y cero uso vivo del prompt legacy;
- `IR319`: expense deriva caja/deuda + reconocimiento completo;
- `IR320`: 552,77 sin cita no obtiene provenance;
- `IR321`: expected state refuta dirección incorrecta;
- `IR322`: una unidad de N steps conserva atomicidad;
- `IR323`: todo false sale tipado;
- `IR324`: catálogo estático y telemetría de cache/costo consumida por E2E;
- `IR325`: E2E black-box, sin import del planner;
- `IR326`: write sin estado observable no compila;
- `IR327`: evidencia local por step, sin préstamo entre montos iguales.

Mutantes M0M487–M0M496 matan exactamente esas diez fronteras. Se retiraron del
catálogo sólo mutantes de la ontología vieja que exigían al modelo el wire que
esta pasada elimina; no se retiró ningún detector de money, ownership, replay,
undo, lock, lectura completa o publicación.

## 8. Validación local entregada

```text
git diff --check                  exit 0
npx tsc --noEmit                 exit 0
npm run lint                     exit 0
node --check E2E                 exit 0
capture                          806/806
mutaciones M0                    490/490, exit 0
PostgreSQL E2E #1                82/82, exit 0
PostgreSQL E2E #2                82/82, exit 0
npm run build                    36/36, exit 0
```

El primer intento de PostgreSQL/build dentro del sandbox no tuvo DNS; no llegó
a crear persona ni compilar fuentes remotas. Se repitió con red habilitada: las
dos corridas PostgreSQL completas dieron 82/82 y el build compiló en 3,0 s.

No se cambió SQL en esta pasada. Migraciones 112–115 ya estaban aplicadas. No
se ejecutó modelo, no se tocó la cuenta del founder, no hubo commit, push o
deploy.

## 9. Auditoría congelada solicitada a Claude

### 9.1 Precondición sustractiva — antes de gastar créditos

1. Recalcular `e56c9553…21e7c`, 493 archivos y `git diff --check`.
2. Ejecutar/leer `semanticPlannerObligationCounts()` y exigir exactamente
   root=6, unit=3, step=3, ordinaryWrite=12, máximo 14.
3. Confirmar que el prompt vivo enseña sólo esos campos y que el prompt legacy
   tiene cero call sites.
4. Confirmar que ninguna nueva rama inspecciona frases, nombres de cuentas,
   casos financieros o regex del mensaje para decidir capability, entidad,
   atomicidad o autorización.
5. Confirmar catálogo completo y sin filtro, ubicado antes del input dinámico.

Si cualquiera falla, detenerse antes de la muestra: la pasada no fue
sustractiva.

### 9.2 Revisión de fuente obligatoria

1. Probar que effects, provenance, ids, lifecycle, manifests, dependencies,
   witnesses, postconditions y response wire nacen sólo en runtime.
2. Probar que `expected_change` cubre todas las superficies materiales y que un
   write sin proyección falla.
3. Probar que cada cita se limita a su step y a una entrega durable exacta.
4. Reejecutar explícitamente la refutación 552,77 y stored-fact fail-closed.
5. Probar unidad de 1, 4 y hasta el límite de steps, además de unidades
   independientes; autorización debe igualar ejecución a posteriori.
6. Confirmar que el response model conserva cero tools.
7. Confirmar que lecturas incompletas, writers, locks, undo, replay y receipts
   no se relajaron.
8. Confirmar que el E2E no importa planner/validator ni aserta el envelope.
9. Confirmar que `agentPublicationRecovery`, error, vacío o jerga hacen rojo.

### 9.3 Gates en orden

Ejecutar sin editar:

```bash
git diff --check
npx tsc --noEmit
npm run lint
node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs
node ./scripts/qa/telegram-agent-regression-audit.mjs
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
npm run build
```

Esperado: 806/806, 490/490, 82/82×2, build 36/36, cero anchor miss,
FALL, ABORT, residuo o restauración divergente.

### 9.4 Única muestra pagada

Levantar servidor limpio con `KIPU_AGENT_MODE=on`, verificar el handshake exacto
y lanzar una sola vez:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs m0-11a-subtractive-semantic-plan
```

Esperar el status del proceso detached. Un timeout del cliente no autoriza otra
muestra del mismo sello.

Requerido simultáneamente:

- 24/24, cobertura 24, exit 0;
- cero FALL, BLOCKED, ABORT;
- cero error final, respuesta vacía, jerga, intake failure o recovery;
- ME3, ME4, ME5, ME12/12b/12c, ME16 y ME17 verdes juntos;
- `Planner usage` presente, con calls/input/cache/output y caracteres
  estáticos/dinámicos reportados sin redondearlos;
- authorized=prepared=executed=settled=verified en manifests;
- cleanup/residuo cero por identidad.

Ante un rojo: detenerse, conservar la causa tipada y la telemetría, no repetir
el sello buscando verde.

## 10. Veredicto de Codex

**La pasada sustractiva está completamente implementada localmente. M0.11A
queda abierta sólo hasta la auditoría congelada y la única muestra real 24/24 de
Claude.**

Un verde autoriza commit/deploy/smoke productivo y prueba del founder. No
autoriza mezclar M0.11B: selección por conjuntos, geografía de entidades y
derivaciones masivas bajo lock siguen siendo el siguiente substage explícito.
