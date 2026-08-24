> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Bloque M0 — reparación de completitud canónica v33

Fecha: 2026-08-10  
Estado: **M0_ABIERTO — listo para una auditoría completa de Claude**  
Migraciones: **001–111 aplicadas; sin migración nueva; próxima 112**  
Contrato de runtime: `m0-agent-eval-2026-08-10-canonical-fallback-v33`

Sello canónico de la superficie ejecutable:
`3ae423e7d170b70953bb3b7f24824885ef8694793693da9a280f32c0933d8b60`
(486 archivos). Claude debe obtener exactamente ambos valores antes de auditar.

## Resumen ejecutivo

El informe v32 no era aprobable aunque sus gates deterministas estuvieran
verdes. La implementación declaraba un contrato de completitud, pero después de
una reparación fallida volvía a llamar al finalizador sin requisitos. Además,
varios `kind` cualitativos se consideraban cubiertos con sólo mencionar una
entidad, y una respuesta factual podía omitir el contrato entero.

La v33 corrige la clase sin convertir el agente en un router ni escribir una
respuesta por escenario:

- el LLM sigue entendiendo libremente la petición, planificando y redactando;
- la frontera determinista sólo se atribuye tres valores que realmente puede
  comprobar en texto libre: `money`, `date` y `entity`;
- para un contrato no vacío, el planner escribe también una respuesta natural
  de respaldo con slots tipados;
- el servidor rellena esos slots únicamente con valores canónicos presentes en
  evidencia verificada y vuelve a ejecutar todas las barreras con el contrato
  original;
- no existe ya una ruta que “resuelva” una omisión con
  `responseRequirements=[]`.

No se añadió ningún caso de negocio, frase o pregunta al runtime. Esta pasada
refuerza la separación de autoridades: modelo para semántica y lenguaje;
servidor para evidencia, cobertura y seguridad.

## Los tres defectos encontrados

### 1. El contrato se apagaba después de una reparación

El flujo v32 detectaba `response_requirements_omitted`, pedía una reparación y,
si ésta también omitía el hecho, preservaba/publicaba una candidata o la
re-finalizaba sin requisitos. Era exactamente el bypass que el contrato decía
haber eliminado.

### 2. Los `kind` cualitativos eran garantías falsas

`state`, `identity`, `pending` y `comparison` terminaban en una misma rama: si
la respuesta nombraba la entidad, el requisito quedaba cubierto. “Diners” no
prueba “está pagada”, “sigue pendiente” ni “vence primero”. El servidor fingía
entender un predicado que no verificaba.

### 3. Un plan factual podía optar por contrato vacío

`response_requirements` ausente se normalizaba a `[]`. No había una barrera que
ligara una respuesta factual personalizada —con `assertions`— a un contrato
canónico no vacío.

## Implementación

### A. Contrato mínimo y honesto

`AgentResponseRequirement.kind` admite ahora sólo:

- `money`: monto finito no negativo + moneda ISO de tres letras;
- `date`: fecha ISO `YYYY-MM-DD`;
- `entity`: referencia canónica + nombre probado en evidencia.

El `role` sigue siendo vocabulario libre. Una pregunta nueva no requiere una
variante nueva: el planner describe el papel del valor. Una comparación se
expresa por su resultado canónico —por ejemplo, la entidad que vence primero—,
no por una frase rígida. Los estados y explicaciones cualitativas permanecen en
la capa semántica del modelo; no se falsea una garantía determinista.

Los ids de requisito tienen forma cerrada (`[A-Za-z][A-Za-z0-9_-]{0,79}`), son
únicos y continúan limitados a seis. Un turno `no_op` no puede fabricar deuda de
respuesta. Una respuesta `answer`/`answer_and_act` con assertions personales y
sin dato faltante no puede declarar contrato vacío.

### B. Template redactado por el modelo, valores propiedad del servidor

`DurableAgentPlan` incorpora `response_template`. Para todo contrato no vacío:

- el planner redacta la oración completa;
- cada requisito aparece exactamente una vez como `[[requirement_id]]`;
- no se aceptan slots desconocidos, repetidos, mal formados o ausentes;
- un contrato vacío exige `response_template=null`.

Esto no es copy de producto. La redacción sigue siendo generada por el modelo
para esa petición y ese contexto. El servidor sólo sustituye los slots.

`renderResponseRequirementTemplate` obtiene los valores de evidencia
determinista:

- dinero: importe y moneda probados;
- fecha: fecha y rol de calendario probados;
- entidad: nombre resuelto desde la referencia canónica.

Si un slot no puede resolverse, el renderer falla cerrado. El texto renderizado
no se publica directamente: vuelve a `finalizeAgentReply` y atraviesa grounding
de dinero/fecha/entidad, recibos de mutación, pendientes, voz determinista y el
mismo arreglo original de `answerResponseRequirements`.

### C. Una reparación, luego fallback canónico; nunca waiver

El reply normal conserva una única reparación dirigida. Si ambos textos
omiten un hecho fundamentado:

1. se renderiza el template del planner con evidencia oficial;
2. se finaliza con el contrato original, no con `[]`;
3. sólo un `fallbackResult.ok` se puede publicar;
4. si el template o cualquier barrera falla, el turno queda fail-closed con la
   causa tipada anterior.

`withOmittedRequirementAdvisory` fue eliminado. Una omisión ya no se transforma
en advisory ni se lava por estilo.

### D. Compatibilidad

No hace falta migración: el plan durable ya es JSON y el campo es opcional para
lectura histórica. Verifiqué producción en modo sólo lectura: **0 operaciones
abiertas** y **0 planes vivos con requisitos sin template**, por lo que no hay
una continuación v29–v32 que pueda quedar sin fallback al desplegar.

## Cobertura agregada o endurecida

### Capture gate

- IR279: monto/fecha ligados a entidad y rol; una referencia de entidad que la
  evidencia no resuelve no es un hecho fundamentado.
- IR280: límite, tipos canónicos, slots exactos, guard de contrato factual,
  renderer canónico, consumo real y ausencia de waiver.
- IR281: comparación expresada como entidad ganadora; ref y nombre deben ser la
  misma identidad.
- IR282: `state`, `pending` y `count` se rechazan en vez de fingirse cubiertos;
  un turno que pregunta sigue sin heredar el contrato de la respuesta.

### Mutaciones nuevas

- M0M382: apaga el guard de contrato factual vacío.
- M0M383: valida pero no persiste el template.
- M0M384: vuelve a finalizar el fallback con `[]`.
- M0M385: acepta un money requirement con entidad desconocida.
- M0M386: acepta nombre y ref de entidades distintas.
- M0M387: conserva un placeholder no resuelto.

También se reforzó M0M375: ya no basta con que el nombre del renderer exista en
el archivo; IR280 fija el `if` ejecutable completo que activa el fallback. La
primera versión de esa mutación sobrevivió y obligó a corregir la red.

## Verificación realizada por Codex

| Gate | Resultado |
|---|---:|
| Capture | **761/761**, exit 0 |
| Mutaciones M0 | **387/387**, exit 0, restauración limpia |
| PostgreSQL real | **73/73 ×2**, exit 0, persona desechable limpia |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `git diff --check` | exit 0 sobre el árbol final |
| `npm run build` con red | compiló, **36/36** páginas |
| Modelo enfocado ME1–ME3 | **3/3**, exit 0 |

El primer intento del E2E PostgreSQL falló por DNS del sandbox antes de crear
usuario; se repitió con red habilitada y terminó 73/73. El primer build falló
únicamente al descargar Geist; con red habilitada compiló correctamente.

No ejecuté la muestra completa de 22 checks. La reservo para Claude: una sola
muestra sobre servidor limpio y handshake v33 aporta más evidencia que volver a
comprar un verde antes del audit.

## Archivos de esta pasada

- `src/lib/ai/agent/agent-operation-store.ts`
- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/kipu-agent.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/telegram-agent-regression-audit.mjs`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/ROADMAP.md`
- `docs/AI_NATIVE_ARCHITECTURE.md`
- `scripts/qa/README.md`

## Instrucciones de auditoría para Claude

No cambies código, fixtures ni aserciones durante la primera pasada.

1. Audita primero la fuente y trata como bloqueante cualquiera de estas fugas:
   - un kind determinista fuera de `money|date|entity`;
   - contrato no vacío sin template exacto;
   - fallback publicado sin `fallbackResult.ok`;
   - cualquier `finalizeAgentReply` del fallback con `[]`;
   - cualquier rama que publique la candidata incompleta como advisory;
   - un valor del template tomado del planner en vez de evidencia verificada;
   - un plan factual con assertions que pueda aceptar contrato vacío.
2. Ejecuta en serie: diff check, tsc, lint, capture 761/761, mutaciones
   387/387, PostgreSQL 73/73 dos veces y build con red.
3. Borra `.next`, levanta un servidor nuevo con `KIPU_AGENT_MODE=on` y confirma
   el handshake `canonical-fallback-v33` antes de gastar modelo.
4. Ejecuta **una sola** muestra completa del modelo. Si no da 22/22, detente y
   reporta la primera causa tipada; no repitas sobre el mismo árbol.
5. Si da 22/22, verifica residuo por identidad y emite el veredicto sobre este
   árbol. No commit, push ni deploy sin autorización del founder.

## Veredicto de Codex

La reparación v33 está implementada y la evidencia local es verde. **M0 no se
declara cerrado todavía**: falta el full model E2E y el re-audit de Claude. No
hay migración por aplicar.
