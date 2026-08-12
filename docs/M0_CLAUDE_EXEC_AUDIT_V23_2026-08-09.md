# Certificación externa de M0 — vigesimocuarta ronda (runtime v23)

**Fecha:** 2026-08-09 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva. Migraciones 100–108.**

---

## 1. Veredicto

**22/22 dos veces sobre el mismo árbol y el mismo servidor congelados.** Es la
primera vez en todo el bloque. Toda la frontera determinista está verde.

| Paso | Resultado |
|---|---|
| Capture | **750/750** |
| Mutaciones M0 (serial, baseline verde) | **342/342**, exit 0 |
| `tsc` · lint · `git diff --check` · `node --check` ×3 | limpios |
| PostgreSQL E2E | **65/65 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.9s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-09-intake-diagnostics-v23` |
| **Modelo, muestra 1** | **22/22** — 22 ok, 0 FALL, 0 BLOCKED |
| **Modelo, muestra 2** (árbol y servidor congelados) | **22/22** — 22 ok, 0 FALL, 0 BLOCKED |

**M0 NO queda cerrado por esta ronda.** Faltan dos cosas que no me corresponde
decidir ni ejecutar sin tu visto bueno — §5.

## 2. La causa raíz era real y la corrección es del tamaño correcto

El diagnóstico de Codex se sostiene: `register_card_payment` enseñaba `TRANSFER`
mientras la ontología exige `payment` con `cash/decrease + debt_liability/decrease`.
El modelo seguía correctamente una instrucción equivocada y el validador rechazaba
correctamente el álgebra resultante. No era falta de contexto ni varianza.

### El canonizador, probado adversarialmente

No me fié del informe: lo ejecuté con siete formas construidas por mí.

| Caso | Resultado |
|---|---|
| patas correctas etiquetadas `transfer` | **canoniza a `payment`** |
| dirección invertida (`cash/increase`) | **intacta** |
| superficie equivocada (`cash` en vez de `debt_liability`) | **intacta** |
| `owner: "counterparty"` | **intacta** |
| falta una pata | **intacta** |
| `record_person_payment` sin `inflowKind` probado | **intacta** |
| `log_movement` con `type` desconocido | **intacta** |

```
desviaciones: 0
```

Y en los siete casos verifiqué campo por campo que `owner`, `surface`,
`direction`, `amount_source`, `entity_ref`, `arguments`, `depends_on` y
`atomic_group` quedan **idénticos**: lo único que puede cambiar es
`effect.classification`, y sólo si `plannedActionEconomicContract` pasa después.
Una forma insegura vuelve sin tocar al validador estricto, que la rehúsa.

`canonicalSingleEconomicClassification` se deriva de **capability + enum tipado**
y devuelve `null` en cuanto el modo no está probado — no analiza frases.

### Los otros dos contratos

**Minimización del diagnóstico:** `agentIntakeFailureDiagnostic` es whitelist por
construcción — devuelve un objeto literal `{stage, code, message, attempts,
validationFailures}` y reconstruye cada `validationFailure` campo por campo
(`attempt` 1–3, `kind` de un enum de tres valores, `reason` truncada). No hay
spread del objeto de entrada, así que `rawCandidate`, prompt o mensaje crudo no
pueden atravesarla.

**Instrumento:** `EXPECTED = focusThrough === "ME3" ? 3 : 22`, y `BLOCKED` entra
en la misma condición de salida que `failures` — nunca cuenta verde y siempre
produce `exit 1`.

## 3. Estado verificado

Árbol de 90 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva.

**Residuo cero tras ambas muestras**, por identidad y no por conteo: 2 usuarios
(`nicolas.terann@gmail.com`, `navaspaulina@hotmail.com`), 0 `agent_operations`,
0 `agent_operation_steps`, 0 `agent_intake_failures`, 0 `receivables`, 0
marcadores de repago, **0 transacciones huérfanas**, 10 accounts, 22
debt_accounts, 39 transacciones — todas de los dos usuarios reales.
**Ninguna variación de la base real se atribuye a QA.**

## 4. Smoke: la parte que sí pude verificar

El primer punto del smoke es comprobable **sin ejecutar el agente**, leyendo el
estado durable del founder:

```
card_statement 2026-07-15  pending    ligado ✓  →  fact card_statement 50.60 USD
card_statement 2026-07-15  dismissed  ligado ✓
card_statement 2026-07-16  dismissed  ligado ✓
```

El corte de Diners que originó el incidente **sigue ligado a su hecho de 50,60
USD**. La ocurrencia no puede volver a preguntarse porque su satisfacción es
durable, no conversacional. Ese punto está verificado sobre datos reales.

## 5. Lo que falta, y por qué no lo hice

**No ejecuté el smoke interactivo contra la cuenta real del founder.** Los otros
dos puntos —«¿qué te falta?» y la dirección de una devolución— requieren
conversar con el agente **en modo escritura sobre tu cuenta de producción**. Eso
puede crear filas financieras reales en tu ledger, y es exactamente la clase de
acción que esta auditoría lleva veinte rondas evitando: la única vez que apareció
una escritura no atribuida en tus datos (Diners, −6,71) dediqué media ronda a
demostrar que no había sido mía.

Necesito tu visto bueno explícito, y hay tres formas de hacerlo:

1. **Persona disposable sembrada con tus datos reales** (mi recomendación):
   reproduce las tres conductas con tu configuración exacta y cero riesgo sobre
   producción.
2. **Contra tu cuenta real, sólo turnos de lectura** («¿qué dato te falta?»,
   «¿cuánto debo de Diners?»): sin escrituras, pero tampoco prueba la dirección
   económica de una devolución.
3. **Contra tu cuenta real con escrituras**, y las deshaces después. Es la prueba
   más fiel y la única que toca tu dinero.

Dime cuál y lo ejecuto.

**Y lo segundo:** el cierre exige una ronda independiente sobre el árbol
congelado por un auditor **que no lo haya tocado**. Yo lo toqué —el juez de voz,
TG-6c, M0M158, cinco correcciones del harness de PostgreSQL, la limpieza de una
persona disposable— así que esa ronda no puedo firmarla.

## 6. Dónde está M0

Con las dos muestras verdes, el bloque tiene por primera vez las tres patas que
pedía su propio criterio: **frontera de datos probada** (65/65 dos veces sobre
migraciones 100–108 aplicadas y verificadas por catálogo), **frontera de código
probada** (750 aserciones y 342 mutaciones que mueren por su test nombrado) y
**conducta conversacional reproducible** (22/22 dos veces sobre árbol congelado).

Vale la pena decir qué cambió para llegar aquí, porque no fue un fix: fue dejar
de discutir con el instrumento. Las rondas v13–v19 se fueron en aserciones que
medían palabras; desde que miden hechos durables —estado de operación, receipts,
refs de transacción, deltas exactos— el número dejó de moverse por redacción. Y
las tres últimas correcciones de producto fueron de la misma familia: un contrato
interno que se contradecía a sí mismo (la fecha ausente, el `write` sin recibo, el
`TRANSFER` que era `payment`). Ninguna necesitó inteligencia nueva del modelo;
todas necesitaron que el servidor dijera la verdad sobre sí mismo.

Queda el smoke real y una firma que no puede ser la mía.
