> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Bloque M0 — coherencia de preguntas pendientes v40

Fecha: 2026-08-11  
Estado: **ABIERTO — corrección local; pendiente re-audit disposable**  
Migraciones: **001–111 aplicadas; v40 no añade migración**  
Producción: `e91df36` (v38)  
Contrato: `m0-agent-eval-2026-08-11-pending-question-coherence-v40`

Sello ejecutable canónico:
`d4a7a2904546f13e55613b2238e8182acf330d6791a05def2bcdf2541ffde205`
(486 archivos).

## Qué encontró el re-audit de v39

Claude verificó por fuente y con 24/24 adversariales que la autoridad monetaria
server-owned de v39 es estricta. En una persona disposable, sin embargo, el
primer turno del fijo estable cayó en:

```text
stage: pending_question_contract
message: missing_requirement_hidden
```

La pregunta no se publicó y el usuario recibió una no-acción. El fijo variable
sí preguntó correctamente. No hubo escritura ni residuo.

La comparación con v38 no prueba que v39 causara el fallo: la rama de
`pending_question_contract` corre antes de
`serverVerifiedStoredMonetaryClaimPaths`, y los dos árboles usaron muestras
distintas del planner. Sí probó que existían dos huecos generales capaces de
producir exactamente ese resultado.

## Causa de clase 1 — un valor presente también podía declararse missing

El validador exigía que todo argumento REQUIRED omitido tuviera missing_field,
pero no comprobaba la inversa: el planner podía incluir `arguments.amount` y a
la vez declarar `missing_fields[].key="amount"`. Eso convierte un hecho durable
ya incorporado al plan en otra pregunta para el usuario.

### Fix

`suppliedMissingFieldError` recorre paths simples y anidados (`a.b[0].c`) sobre
las actions objetivo. Si un path contiene un valor válido, el plan se rechaza
con índice, key y action exactos; el repair acotado debe eliminar el missing o
eliminar realmente el argumento. `$response` queda fuera porque no representa
un argumento de tool.

El prompt enseña la misma regla. No conoce “arriendo”, gastos fijos ni frases.

## Causa de clase 2 — el matcher léxico podía borrar una pregunta útil

La pregunta original y un repair ya se comprobaban contra todos los pendientes,
pero un sinónimo o una forma distinta podía hacer que ambas fallaran pese a que
el contrato tipado sí era válido. El resultado era intake failure/no-acción.

### Fix

`canonicalPendingQuestion` es un último recurso, no el escritor principal:

1. el planner conserva el primer intento de lenguaje natural;
2. el modelo de repair conserva el segundo;
3. sólo si ambos fallan, se deduplican y enumeran TODOS los `answer_shape` del
   contrato validado;
4. esa pregunta vuelve a pasar por `finalizeAgentReply` con las mismas barreras;
5. si también falla, `failBeforeDurablePlan` persiste el diagnóstico y hasta
   ocho `missingFieldKeys` acotadas.

No inventa monto, entidad, clasificación, acción ni write claim. El scaffolding
es genérico y sólo transporta los answer shapes que el planner ya declaró.

## Cobertura

IR287 prueba:

- `amount` presente + missing `amount` ⇒ rechazo;
- `sourceAccountId` realmente ausente ⇒ permitido;
- fallback de una y varias formas ⇒ contiene todas y cruza
  `replyAcknowledgesPendingClarifications`;
- consumo real en validador y orquestador.

M0M413 neutraliza el consumo del veredicto de argumento ya suministrado.
M0M414 neutraliza la salida del fallback. Ambos mueren por IR287. M0M135 fue
re-anclado y sigue probando que un fallo total deja intake durable.

## Batería local

| Gate | Resultado |
|---|---:|
| Capture | **766/766** |
| Mutaciones M0 | **414/414**, exit 0, sin residuo |
| TypeScript | limpio |
| Lint | limpio |
| Build con red | **36/36**, compilado |
| `git diff --check` | limpio |
| PostgreSQL | sin cambios; último certificado **73/73 ×2** |
| Modelo | no repetido localmente |

## Auditoría solicitada a Claude

1. Auditar que `suppliedMissingFieldError` no confunda `false` o `0` válidos con
   ausencia, soporte arrays/objetos y no afecte `$response`.
2. Probar paths presentes, ausentes, vacíos y anidados contra funciones reales.
3. Auditar que el fallback sólo se alcanza después de los dos intentos naturales
   y que se re-finaliza con todas las barreras; no debe ser una salida directa.
4. Correr diff, tsc, lint, capture 766/766, mutaciones 414/414 y build. PG no
   cambió; puede reutilizar 73/73 ×2.
5. En una persona disposable con fijo estable ARS y cuenta ARS, ejecutar una
   sola muestra del transcript exacto:
   - «Hola, acabo de pagar el arriendo» ⇒ pregunta únicamente la cuenta;
   - «Desde mi cuenta Supervielle» ⇒ una escritura, cero tercera confirmación.
6. Probar fijo variable y monto explícito contradictorio: ambos deben seguir
   preguntando sin escribir.
7. Capturar plan/missing/pending/intake antes del cleanup si aparece un rojo;
   detenerse y no reintentar el mismo sello.
8. Limpiar por identidad y confirmar cero residuo.

No usar la cuenta del founder. Su operación/challenge v38 siguen pendientes. No
responder «sí»: ejecutaría el payload viejo. Sólo tras auditoría verde, deploy y
cancelación explícita de ese trabajo viejo debe repetirse el chat real.

## Veredicto de Codex

**M0 sigue abierto.** v39 permanece correcto. v40 elimina una contradicción
estructural del plan y un falso negativo de lenguaje sin reducir la autoridad
semántica del modelo ni añadir un caso por frase.
