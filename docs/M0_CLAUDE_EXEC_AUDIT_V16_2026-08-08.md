> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Certificación externa de M0 — decimoséptima ronda (runtime v16)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

**Me detuve en el paso 1 y NO gasté la muestra del modelo.** La auditoría de
fuente que pediste como primer paso encontró el defecto, y confirmarlo con una
corrida costaría créditos para aprender algo que el código ya demuestra.

---

## 1. Estado determinista: todo verde

| Paso | Resultado |
|---|---|
| Capture | **743/743** |
| Mutaciones M0 (serial) | **296/296**, exit 0, sin `anchor hits=0` |
| `tsc` · `git diff --check` · `node --check` | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.6s** |
| Contrato en fuente | `m0-agent-eval-2026-08-08-pending-capability-v16` |
| **Modelo** | **no ejecutado** (ver §3) |

## 2. La corrección del autor→target está bien hecha

`pendingClarificationTargetsCapability` es correcta y falsable: liga por
`toolName` cuando el challenge es del executor, y por intersección
`appliesToActionIds` ↔ `plan.actions[].capability` cuando el pendiente es del
planner; rechaza un id inexistente, un id de otra capacidad y una consulta por
otra capability. Sin excepción cableada a `agent_plan`. Es la generalización
correcta del hallazgo v15.

Y quitaste bien la cuarta pata: el helper ahora mide sólo los tres hechos que
el harness puede falsificar de forma independiente.

## 3. Por qué ME5 seguirá rojo: el target no existe en ese turno

El vínculo nuevo pregunta *«¿hay una acción de `record_person_payment` que este
pendiente bloquee?»*. En el escenario de ME4/ME5 **el plan correcto no tiene esa
acción**, porque el prompt del planner lo prohíbe explícitamente:

```
[agent-planner.ts:1461]
… Decir únicamente que una transferencia vino "de/por un préstamo" o que ese
préstamo no estaba registrado NO prueba la dirección. En ese caso pregunta si le
prestaron al usuario o si le devolvieron dinero que él había prestado. Como la
clasificación todavía es desconocida, NO INVENTES UNA ACTION/EFFECTS PARA ESA
ENTRADA: conserva las demás actions independientes y usa un missing_field
aplicado a "$response".
```

Y la regla general lo confirma
([:1503](src/lib/ai/agent/agent-planner.ts:1503)):

```
Usa ["$response"] sólo si el dato falta para responder y no para ejecutar
ninguna action.
```

`$response` es un valor de primera clase que el validador acepta explícitamente
([:1328](src/lib/ai/agent/agent-planner.ts:1328)):

```ts
appliesTo.some((id) => id !== "$response" && !actionIds.has(id))
```

Encadenando las tres cosas, en el turno de ME5:

| Pata del vínculo | Valor real | ¿Liga? |
|---|---|---|
| `pending.toolName === "record_person_payment"` | `"agent_plan"` (constante fija en los dos únicos constructores) | no |
| `appliesToActionIds` ∩ acciones con esa capability | `["$response"]`, que no es id de ninguna acción | no |

**Resultado: `false`.** El plan durable de esa operación contiene los tres pagos
de tarjeta y el ingreso; la entrada ambigua deliberadamente no tiene acción.

Es la misma forma del defecto v15, un nivel más adentro: **la aserción sólo puede
pasar si el planner desobedece su propia instrucción** y emite un
`record_person_payment` de dirección desconocida — exactamente lo que M0 prohíbe.
Arreglaste la confusión autor↔target, pero en este escenario el target no existe
por diseño.

### Qué mediría bien ME5

Lo que el check dice probar es «preguntar qué falta recibe la respuesta concreta
y **no consume la operación**». Eso son tres hechos durables que sí existen:

- `wrote === false` y `durableOperation.status === "awaiting_input"` (ya los
  tienes);
- **continuidad**: `durableOperation.id` igual al del turno anterior (ya lo
  tienes, y es la pata que de verdad prueba «no consume la operación»);
- que exista al menos una aclaración durable **no resuelta**, sin exigir a qué
  capability apunta — o, si quieres conservar la especificidad, aceptar el
  vínculo `$response` como «bloquea la respuesta, no una acción».

La tercera es la que hay que aflojar, y aflojarla no debilita nada: las otras dos
ya impiden que un turno que escribió o que abrió otra operación pase.

**No lo toqué.** Ajustar la aserción después de verla roja es lo que tu propio
informe prohíbe, y con más razón viniendo de mí.

## 4. Sobre no haber gastado la muestra

Tu paso 1 es «auditar la distinción autor→target», y ahí apareció. Gastar una
corrida completa para ver `ME5` en rojo confirmaría lo que el prompt, el
validador y los dos constructores ya demuestran. Si prefieres la confirmación
empírica antes de tocar nada, la ejecuto: es una decisión tuya sobre presupuesto,
no un juicio técnico pendiente.

Queda una salvedad honesta: **si el modelo desobedeciera la instrucción** y
emitiera igual la acción, `ME5` pasaría. Eso no invalida el diagnóstico — lo
agrava, porque entonces el check verde estaría premiando la conducta incorrecta.

## 5. Estado verificado

Árbol de 74 entradas, `git diff --check` limpio, sin commit ni deploy, sin
migración nueva. Residuo QA cero (0 `agent_operations`, 0 `receivables`, 0
marcadores, 0 transacciones huérfanas, 2 usuarios). **Cero créditos de modelo
gastados en esta ronda.**

## 6. Dónde está M0

Tres rondas seguidas sin un solo defecto de producto. Las veintidós conductas
funcionan; lo que falla es el instrumento de medición, y ya van cuatro
iteraciones sobre el mismo check.

Vale la pena decirlo porque sugiere un cambio de método, no otro parche: **ME4,
ME5 y ME6 son tres momentos de una misma conversación** —ambigüedad detectada,
pregunta concreta, aclaración resuelta— y su invariante compartida es que la
operación durable sobrevive intacta entre los tres y que el dinero sólo se mueve
cuando la dirección queda probada. Esa invariante se puede expresar con las
identidades y los contadores que ya llevan seis rondas estables, sin depender de
qué autor firmó el pendiente ni de a qué acción apunta. Cada vez que atamos la
aserción a la *forma interna* del pendiente, heredamos la próxima refactorización
del planner.
