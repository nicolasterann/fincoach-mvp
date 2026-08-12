# Bloque M0 — adopción de hechos persistidos en el plan v41

Fecha: 2026-08-12  
Estado: **M0_ABIERTO — listo para re-audit externo y un único smoke disposable**  
Migraciones: **001–111 aplicadas; v41 no añade migración**  
Producción: **sigue en `e91df36` (v38)**  
Contrato local: `m0-agent-eval-2026-08-11-stored-plan-adoption-v41`

## Contexto y causa raíz

El primer chat real del founder después del deploy v38 fue:

1. «Hola, acabo de pagar el arriendo».
2. Kipu pidió la cuenta.
3. «Desde mi cuenta Supervielle».
4. Kipu pidió un tercer consentimiento genérico en vez de registrar.

v39 cerró el challenge redundante cuando el payload ya contiene un monto
server-owned exacto. v40 cerró missing-fields contradictorios y añadió una
pregunta canónica de último recurso. El re-audit de v40 encontró dos fronteras
que esos arreglos no alcanzaban:

- en dos muestras, el planner eligió correctamente `log_movement`, el
  `fixedExpenseId` de Arriendo y semántica expense, pero omitió `amount`, lo
  declaró missing y volvió a preguntárselo al usuario;
- la pregunta canónica para un pending `amount` no podía superar el cotejo
  léxico porque «monto» y «exacto» son stopwords y la key interna `amount` no
  debe aparecer en el copy.

No son casos de frase. Son una falta de paridad entre estado persistido, plan y
publicación.

## Fix 1 — compilador semánticamente subordinado

`compileStoredFixedExpenseAmounts` corre después de que el modelo creó el plan
y antes del validador estricto. Puede completar sólo una action que ya cumple:

- capability `log_movement`;
- `arguments.type === "expense"`;
- `fixedExpenseId` exacto ya seleccionado por el modelo;
- `amount` todavía ausente;
- catálogo financiero **completo**;
- exactamente una fila actual, activa y `isVariable=false`;
- monto positivo y moneda nativa válida;
- ninguna moneda incompatible ni cifra user-authored contradictoria en la
  operación/continuación.

Si todo verifica, añade únicamente `amount` y `currency`, cambia a
`amount_source="stored_fact"` las patas expense de esa action, retira sólo ese
target del missing `amount` y recompone el lifecycle de la pregunta. No cambia
capability, id, tipo, entidad, dirección, grouping, dependencias ni
postcondiciones. El candidato completo vuelve a pasar por
`compileCanonicalEconomicClassifications`, `compileWholeOperationCorrection` y
`validatePlannedAgentRequest`.

Fail-closed añadido durante la auditoría propia:

- un catálogo incompleto devuelve el plan byte-idéntico;
- un missing `amount` compartido con otra action conserva los targets que no
  pudieron compilarse;
- variable/inactivo/no-único, conflicto de moneda o monto contradictorio del
  usuario devuelven el plan byte-idéntico.

Esto no es un router. Ningún regex del mensaje decide «arriendo», herramienta o
fila. El modelo conserva la autoridad semántica; el servidor sólo adopta un
valor mecánico de la entidad exacta que el modelo ya eligió.

## Fix 2 — pregunta canónica verificada por construcción

La pregunta natural del modelo y su repair siguen pasando por
`replyAcknowledgesPendingClarifications`. Si ambas fallan, el servidor genera
una última pregunta con **todos** los `answer_shape` tipados. Esa forma pasa a
`finalizeAgentReply` con `pendingAcknowledgementVerifiedByConstruction=true`.

La bandera omite sólo el overlap léxico que no puede citar keys internas. No
omite sanitización, estructura, voz determinista, pregunta vaga, grounding de
dinero/calendario, claims de mutación, Saldo ni el resto del contrato de
publicación. Sólo ese call site usa `true`; todos los demás conservan el default
fail-closed.

## Redes nuevas y autocorrección del instrumento

- **IR287**: un fallback de `amount` falla el matcher léxico pero publica bajo
  la prueba por construcción; el mismo texto sin esa prueba sigue rechazado.
- **IR288**: adopción exacta; lifecycle source-only; ejecución cuando ya existe
  source; variable, contradicción e incompletitud intactas; missing compartido
  preserva su target no compilable; paridad con el verificador v39.
- **M0M415**: fuerza la pregunta canónica a volver al matcher imposible.
- **M0M416**: desconecta el compilador de adopción.
- **M0M417**: deriva moneda pero elimina el monto.

La primera pasada del runner reveló dos anclas históricas obsoletas. Después de
repuntarlas, M0M282 sobrevivió porque IR263 afirmaba que la línea de consumo
existía, no que el veredicto se usara. IR263 ahora llama a la frontera real:
una respuesta que oculta el pendiente debe fallar exactamente con
`missing_requirement_hidden`, mientras una que lo explica cruza esa barrera.
La red completa quedó verde recién después de esa corrección.

## Batería local sobre el árbol final

| Gate | Resultado |
|---|---:|
| `git diff --check` | limpio |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| Capture | **767/767** |
| Mutaciones M0 | **417/417**, exit 0, sin anchor miss ni residuo |
| PostgreSQL | sin cambio de SQL; última batería **73/73 ×2** |
| Build con red | **Compiled successfully, 36/36 páginas** |

Sello ejecutable:
`8a725ad895a2c66362ed1c0f9e2aaf77bdae8036c03e073f05aec34146526cd0`
(486 archivos con el protocolo canónico).

No ejecuté una muestra de modelo ni escribí en PostgreSQL. No apliqué
migraciones, no hice commit/push/deploy y no toqué la cuenta del founder.

## Auditoría pedida a Claude — presupuesto acotado

1. Sellar primero el árbol y comprobar el hash/contrato v41.
2. Auditar por fuente y adversariales:
   - catálogo incompleto;
   - fijo variable/inactivo/no-único;
   - monto/moneda contradictorios;
   - dos acciones que comparten missing amount y sólo una es compilable;
   - el compilador no cambia ningún campo fuera de monto/moneda,
     amount_source y lifecycle exacto;
   - sólo la pregunta canónica usa el bypass de overlap y toda otra barrera
     sigue activa.
3. Repetir la batería determinista sólo sobre el sello.
4. Gastar **una sola** muestra, enfocada en persona disposable con forma del
   founder:
   - ARS; cuenta `Banco Supervielle`;
   - fijo estable `Arriendo` = 1.010.786,70 ARS;
   - fijo variable `Luz` como control negativo;
   - turno 1: «Hola, acabo de pagar el arriendo» ⇒ pregunta **sólo la cuenta**;
   - turno 2: «Desde mi cuenta Supervielle» ⇒ escribe inmediatamente el monto
     durable exacto, completa la operación y **no pide monto ni una tercera
     confirmación**;
   - control variable ⇒ pregunta monto, nunca lo deriva;
   - saldo/ledger/receipt coinciden exactamente y cleanup por identidad es cero.
5. Detenerse en el primer rojo con plan, missing fields, pregunta, intake y
   receipt tipados. No repetir el mismo sello buscando verde.

## Estado productivo importante

Producción sigue en v38. La operación real `ad2c093e…` permanece
`awaiting_input` con el payload viejo. **No responderle «sí»**: podría ejecutar
esa propuesta. No cancelarla ni tocarla durante el smoke disposable; su cleanup
se decide únicamente después de que v41 quede auditado y desplegado.

## Veredicto de Codex

La causa de v40 está corregida localmente con una invariante general, no con un
caso de arriendo. **M0 sigue abierto** hasta el smoke externo exacto. Un verde
autoriza commit/deploy del árbol sellado; después se cancela de forma explícita
la propuesta productiva vieja y el founder repite el chat real.
