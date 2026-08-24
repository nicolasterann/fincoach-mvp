> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Certificación externa de M0 — vigesimosegunda ronda (runtime v21)

**Fecha:** 2026-08-09 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva. Migraciones 100–108.**

---

## 1. Veredicto

**M0 sigue ABIERTO.** Corrida única: **21/22**, con `ME10aa` en rojo. Me detuve
sin repetir.

| Paso | Resultado |
|---|---|
| Capture | **745/745** |
| Mutaciones M0 (serial) | **324/324**, exit 0, sin `anchor hits=0` |
| `tsc` · lint · `git diff --check` · `node --check` ×2 | limpios |
| PostgreSQL E2E | **65/65 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.9s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-09-truth-before-style-v21` |
| **Modelo, corrida única** | **21/22** |

**El defecto de v20 está cerrado y verificado.** En toda la corrida hubo **cero**
`semantic_voice_rejected` y cero advisories: ningún turno perdió su respuesta por
estilo. El rojo de hoy tiene otra causa, y no movió dinero.

## 2. La separación de autoridades verifica en los cinco puntos

Audité el código, no el informe:

1. **Ningún 500 sólo por estilo.** Si existe una candidata determinísticamente
   segura, `safeStyleCandidate` la publica con advisory; sólo un `lastVerdict`
   determinista puede terminar sin publicar.
2. **Las barreras siguen bloqueando.** `evaluateCandidate` corre
   `finalizeAgentReply` primero y devuelve `review: null` si falla — **el juez ni
   siquiera se llama** sobre prosa que ya falló verdad.
3. **Los dos caminos.** En pending question, un repair inseguro cae al `else if
   (originalDeterministic.ok)` y **restaura la pregunta original segura** con su
   advisory; sólo si ninguna cruza se emite `pending_question_contract`.
4. **Un repair inseguro nunca reemplaza una segura:** la rama `else` sólo
   actualiza diagnósticos; `safeStyleCandidate` queda intacta. Y un fallo de red
   en el repair está en `try/catch` con la inicial todavía disponible.
5. **Juez no disponible ≠ veredicto:** `semanticVoiceReviewNeedsRepair` exige
   `review.verified`, así que un juez caído publica por la primera rama.

`withSemanticVoiceAdvisory` devuelve el resultado sin tocar si `!result.ok`: un
advisory no puede lavar un fallo. Correcto.

## 3. La barrera de recibos: primera vez limpia

Ejecuté las quince formas —las ocho que pediste más siete mías, incluidos tres
prefijos que nadie enumeró (`Bueno;`, `Vale:`, `Sí,`)—:

```
fugas: 0    falsos positivos: 0
```

`STANDALONE_MUTATION_RECEIPT` y `PREFIXED_MUTATION_RECEIPT` están retiradas y
`CLAUSE_TERMINAL_MUTATION_STATE` las sustituye. **Es la primera vez en cuatro
rondas que esta barrera sobrevive intacta a mi conjunto adversarial**, y la razón
es estructural: la clase gramatical generaliza donde la lista de prefijos sólo
cubría lo ya observado.

Y sigue publicando lo que debe: «el préstamo que ya tienes registrado», «ya
estaba registrado antes», «listo para confirmar», «confirma para que registre»,
«ya quedó claro».

## 4. El rojo: `ME10aa`, y no es publicación ni estilo

```
stage:      planner
attempts:   3
status:     open
last_error: intake_failed —
            "atomic group grp_correct_two_expenses may replace movements
             only after one exact whole-operation reversal"
```

El **planner** no logró producir la forma que su propio contrato exige —undo de
la operación completa y luego reemplazos individuales— en tres intentos, con la
razón devuelta cada vez. El turno terminó en 500 con respuesta vacía.

Lo importante: **no se movió nada.** `originalPairReversals: []`,
`correctionTransactions: []`, `replacementMarker: null`, 11 transacciones
intactas, cuenta en 1545,89. El fail-closed se sostuvo entero y no hubo
`voiceAdvisories` ni `publicationFailure`: el juez de estilo no participó.

### La lección que deja

v21 quitó al estilo la facultad de convertir una escritura en silencio. Pero el
resultado visible para el usuario —500, sin respuesta— **se puede llegar por otra
puerta**: un contrato determinista del planner que el modelo no consigue
satisfacer. La garantía «una escritura verificada siempre recibe respuesta» quedó
cumplida hoy porque no hubo escritura; la garantía más amplia —«un turno siempre
recibe respuesta»— todavía no existe. Aquí sería preferible una aclaración
honesta («no pude armar la corrección completa; ¿la hago en dos pasos?») antes
que un 500.

## 5. Sobre retirar el criterio de cinco muestras

Lo señalo porque **es una decisión del founder, no del implementador ni mía**, y
porque la evidencia de estas dos rondas apunta en contra:

- v20 muestra 1: **22/22**. v20 muestra 2: **15/22**. Mismo árbol congelado.
- v21 muestra 1: **21/22**, con un modo de fallo **nuevo** que no existía en v20.

Con criterio de una muestra, v20 se habría declarado cerrado con la primera
corrida y el 15/22 habría aparecido después, en producción.

Es justo el otro lado: tu argumento es correcto en que repetir cinco veces
compraba sobre todo votos de un crítico estocástico, y **esa** fuente de varianza
sí quedó eliminada —lo confirma el cero de `semantic_voice_rejected`—. Pero el
rojo de hoy demuestra que quedan fuentes de varianza en el planner que sólo el
muestreo revela. Mi recomendación: **dos muestras**, no cinco — suficiente para
distinguir una regresión de un sample, sin pagar cinco votos.

## 6. Estado verificado

Árbol de 85 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy. **Residuo cero**: 2 usuarios (`nicolas.terann@gmail.com`,
`navaspaulina@hotmail.com`), 0 `agent_operations`, 0 `agent_operation_steps`,
**0 `agent_intake_failures`**, 0 `receivables`, **0 transacciones huérfanas**, 10
accounts, 22 debt_accounts, 39 transacciones — todas de los dos usuarios reales.
**Ninguna variación de la base real se atribuye a QA.**

No ejecuté el smoke de transcripts reales: la corrida no llegó a 22/22.

## 7. Para cerrar

1. **`ME10aa`**: que el planner pueda armar la corrección de operación completa de
   forma fiable, o que el fallo de contrato del planner degrade a una pregunta
   honesta en lugar de un 500. Tres intentos con la razón devuelta no bastaron.
2. **Decidir el criterio de cierre** — es tuyo, no de Codex. Mi recomendación:
   dos muestras.
3. Después: la ronda congelada por un auditor que no haya tocado el árbol. Yo lo
   toqué.

## 8. Dónde está M0

El cambio de v21 es el más importante del bloque y está bien hecho: **la verdad
determinista manda y el estilo opina**. Lo verifiqué en los cinco puntos, la
barrera de recibos sobrevivió por primera vez a un conjunto adversarial completo,
y la corrida lo confirmó en la práctica con cero vetos de estilo.

Lo que queda es una sola cosa, y es más simple que todo lo anterior: **el turno
que no puede cumplir un contrato interno todavía se resuelve en silencio.** Es la
misma familia que veníamos persiguiendo desde v11 —un fallo interno que el usuario
recibe como nada— sólo que ya no viene del juez de voz sino del planner. Cerrarla
no requiere aflojar ninguna garantía: requiere que el último recurso, cuando el
modelo no logra armar el plan, sea decirlo.
