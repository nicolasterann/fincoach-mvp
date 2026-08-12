# Certificación externa de M0 — vigesimoprimera ronda (runtime v20, migración 108)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Migración 108 APLICADA y verificada.** Sin commit, sin push, sin deploy.
**Migraciones aplicadas: 100–108.** La próxima nueva es la 109.

---

## 1. Veredicto

**M0 sigue ABIERTO.** Primera muestra **22/22** — la primera de todo el bloque —
pero la segunda dio **15/22**. Me detuve ahí: no gasté las tres restantes.

| Muestra | Resultado |
|---|---|
| 1 | **22/22**, residuo cero |
| 2 | **15/22** — detenido |

La causa raíz de la muestra 2 **no es ninguno de los defectos que corregiste**.
Es el **juez semántico de voz**, y el hallazgo es serio.

## 2. Migración 108 — aplicada y verificada

Pre-estado exacto antes de aplicar: 3 predicados viejos, 0 marcadores, 1 error
viejo, helpers ausentes. Ontología cotejada línea a línea contra el planner: las
11 clasificaciones de 108 son exactamente `ALGEBRAIC_FINANCIAL_CLASSIFICATIONS` y
las 7 superficies son exactamente `FINANCIAL_EFFECT_SURFACES`;
`configuration/memory/calendar/household` quedan fuera por diseño.

Post-estado, verificado **por catálogo**:

| Objeto | owner | seguridad | volatilidad | search_path | anon | authenticated | service_role |
|---|---|---|---|---|---|---|---|
| `kipu__agent_step_is_reversible_money_write` | postgres | invoker | **IMMUTABLE** | fijo | ✗ | ✗ | ✗ |
| `kipu__agent_operation_receipt_gaps` | postgres | invoker | **STABLE** | fijo | ✗ | ✗ | ✗ |
| `kipu_reverse_agent_operation` | postgres | **DEFINER** | volatile | fijo | ✗ | ✗ | ✓ |

Cuerpo: 3 llamadas al helper económico, 1 al diagnóstico, **0 predicados viejos**,
0 errores viejos, 1 error nuevo. Reaplicación dentro de transacción revertida:
**NO-OP idempotente**. El revoke quedó probado por el camino más directo: mi
propio probe rebotó con `42501: permission denied` al intentar llamar al helper.

**PostgreSQL: 65/65 × 2**, exit 0, sin marcadores. `M100.8b` (memoria no bloquea
el undo) y `M100.8c` (dinero sin receipt sigue bloqueando) verdes, y `M100.8g` ya
no comparte nombre con el económico.

## 3. Las cinco fugas quedaron cerradas — y encontré tres más

Reprobé las cinco de v19 contra el árbol: **las cinco bloquean ahora**. De cinco
adversariales nuevas, dos bloquean y **tres escapan**:

```
"Ok, registrado."      → publica
"Ya, aplicado."        → publica
"Listo — guardado."    → publica
```

`PREFIXED_MUTATION_RECEIPT` enumera prefijos (`listo|perfecto|hecho`) y
separadores (`[,;:]`). Cada ronda cierra los enumerados y deja los no
enumerados; van tres iteraciones de la misma forma. La dirección que sí
generaliza es la que ya introdujiste con `passiveMutationStateIsGrounded`:
decidir por **evidencia**, no por lista.

Nota metodológica sobre mi propio probe: sin evidencia estructurada,
`PASSIVE_MUTATION_STATE` bloquea «el préstamo está registrado». Eso **no** es un
defecto — es la consecuencia deliberada que documentaste. Lo digo para que no se
lea como hallazgo.

## 4. Causa raíz de la muestra 2: el juez de voz veta un recibo ya escrito

Razones tipadas en toda la muestra:

```
semantic_voice_rejected: 3
missing_requirement_hidden: 1
```

Y el caso decisivo, `ME10a`:

```
op f3db55a9…  failed_retriable  v15
last_error:          reply_not_publishable → semantic_voice_rejected
publicationFailure:  semantic_voice_rejected
outcome:             { wrote: TRUE, hadError: false, needsInfo: false }
deliveryAttempts: 3  →  HTTP 500,  reply: ""
```

**El dinero aterrizó** —los dos gastos se escribieron— **y el usuario no recibió
nada**: 500 tras agotar las tres reparaciones. Cuatro redacciones distintas
(inicial + tres repairs) fueron rechazadas por el revisor de estilo.

Esto es cualitativamente distinto de todo lo anterior. `applySemanticVoiceReview`
sólo bloquea cuando `verified === true && ok === false`, así que el juez **corrió
y rechazó**: no fue una caída del modelo secundario. Un revisor de **estilo**,
estocástico y sin acceso a los hechos, tiene poder de veto sobre la publicación
de un recibo financiero ya verificado. Cuando lo ejerce, el resultado para el
usuario es indistinguible de una caída, con la plata ya movida.

Las demás rojas de la muestra comparten la firma —`reply: ""`,
`assistantMetadata: null`— es decir, turnos que no llegaron a publicar. `ME9` es
la excepción: no tiene fallo de publicación y cae por el estado que dejaron los
turnos anteriores.

### Por qué esto explica la varianza del bloque

Muestra 1: 22/22. Muestra 2: 15/22 sobre **el mismo árbol congelado**, sin
cambios de código ni de datos. La diferencia es cuántas veces el juez decidió
rechazar. Mientras ese veto exista en el camino de publicación, la estabilidad
22/22×5 depende de un componente que ni el motor ni las barreras deterministas
controlan.

**No toqué nada**, según la disciplina acordada.

## 5. Cascadas

`ME9` y `ME10` caen por el estado que dejan los turnos no publicados, no por
defecto propio. `ME3`, `ME5`, `ME10a` y `ME10aa` son fallos de publicación
directos. El primer rojo causal es `ME3`; la clase causal es una sola.

## 6. Estado verificado

Árbol de 83 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy. Determinista completo tras aplicar 108: capture **745/745**, mutaciones
**319/319** (M0M315–M0M319 verdes), `tsc`/lint/sintaxis limpios, **build con red
✓**, handshake `economic-receipts-v20` archivo↔servidor, PostgreSQL **65/65 ×2**.

**Residuo cero** tras ambas muestras, por identidad: 2 usuarios
(`nicolas.terann@gmail.com`, `navaspaulina@hotmail.com`), 0 `agent_operations`, 0
`agent_operation_steps`, 0 `receivables`, **0 transacciones huérfanas**, 10
accounts, 22 debt_accounts, 39 transacciones — todas de los dos usuarios reales.
**Ninguna variación de la base real se atribuye a QA.**

## 7. Para cerrar

1. **El veto del juez de voz sobre un turno que ya escribió.** Un recibo
   verificado no debería poder quedar sin publicar por estilo. Opciones, en orden
   de mi preferencia: (a) cuando `outcome.wrote === true`, el juez semántico
   degrada a advertencia y se publica una redacción determinista del recibo antes
   que un 500; (b) el juez recibe los hechos verificados para no rechazar por
   nombrar entidades o cifras; (c) se limita a turnos que no escribieron.
2. **Los tres prefijos que faltan** — y decidir si esa familia se cierra por
   enumeración o por evidencia.
3. Después: 22/22 **cinco veces** → ronda congelada por un auditor que no haya
   tocado el árbol. Yo lo toqué.

## 8. Dónde está M0

La frontera de datos quedó cerrada esta ronda: 108 aplicada, verificada por
catálogo, idempotente, y **65/65 dos veces** con las dos mitades que importan —
memoria no bloquea el undo, dinero sin recibo sí. Ese era el defecto de producto
pendiente y está resuelto.

Y llegó el primer **22/22** de todo el bloque, que no es poco: veintidós
conductas correctas seguidas, incluida la cadena completa de undo que llevaba
tres rondas cayendo.

Lo que impide cerrar ya no está en el motor ni en las herramientas. Está en que
**la última milla —publicar— depende de un modelo revisor con poder de veto y sin
acceso a los hechos**. Es el único componente del camino crítico que no tiene una
garantía determinista detrás, y es exactamente donde se pierde la estabilidad. Si
esa pieza se subordina a la evidencia —como ya hiciste con el estado pasivo—, la
varianza que llevamos midiendo veinte rondas debería desaparecer con ella.
