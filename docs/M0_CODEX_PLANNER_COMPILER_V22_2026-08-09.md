# M0 v22 — semantic planner, deterministic mechanical compiler

Fecha: 2026-08-09
Estado: implementado y verificado sin gastar muestras del modelo. M0 sigue
ABIERTO hasta la auditoría externa congelada indicada al final.

## 1. Punto de partida

La auditoría externa v21 verificó que `truth-before-style` cerró su clase:
cero `semantic_voice_rejected`, cero advisories y las quince formas
adversariales de recibo se comportaron correctamente. PostgreSQL quedó 65/65
dos veces, capture 745/745, mutaciones 324/324 y build limpio.

La única falla fue ME10aa. El planner entendió la intención económica de
corregir una operación completa, pero agotó sus tres intentos reproduciendo la
coreografía mecánica exacta que el validador exige:

```text
atomic group grp_correct_two_expenses may replace movements only after one
exact whole-operation reversal
```

No se movió dinero, pero el usuario recibió HTTP 500 sin respuesta. Había dos
problemas distintos:

1. se usaba capacidad del modelo para copiar IDs de grupo/dependencia que el
   servidor puede derivar cuando la relación ya es inequívoca;
2. un fallo interno de forma se presentaba como silencio, aunque no era un dato
   que el usuario pudiera aportar.

## 2. Fix 1 — compilador mecánico mínimo

Archivo: `src/lib/ai/agent/agent-planner.ts`.

Añadí `compileWholeOperationCorrection(raw)`, consumido por el callback vivo de
`planKipuRequest` inmediatamente antes de `validatePlannedAgentRequest`.

El compilador sólo actúa si se cumplen todas estas condiciones:

- ya existe exactamente un `undo_agent_operation`;
- el undo ya trae un `targetOperationId` no vacío;
- ya existen uno o más `log_movement` individuales;
- el undo aparece antes y las acciones de corrección forman un bloque contiguo;
- no existe `log_movements_batch`;
- todas las dependencias tienen forma de arrays válidos;
- ya hay relación estructural: algún reemplazo depende del undo o todas las
  acciones de corrección comparten un único label de grupo declarado;
- ningún action ajeno usa uno de esos grupos.

Cuando todo eso es verdad, el servidor hace sólo dos cambios mecánicos:

1. pone el mismo `atomic_group` en el undo y sus reemplazos;
2. añade la dependencia directa al id del undo en cada reemplazo que no la
   tuviera.

No cambia `arguments`, `effects`, `state_witness`, `postconditions`, montos,
entidades ni target. No crea acciones ni reordena el plan. El candidato
compilado atraviesa después el validador estricto normal y todo el preflight de
PostgreSQL.

Permanece fail-closed: dos undos, acciones enteramente desagrupadas, batch,
intercalado o grupo compartido con una acción ajena vuelven sin cambios al
validador y son rechazados.

También hice diagnóstico el error del validador. Ahora informa, sólo
internamente, `reversals_in_group` y los ids de
`replacements_missing_direct_undo`, para que una reparación futura no tenga que
adivinar qué parte de la forma falló.

## 3. Fix 2 — un planner agotado no deja al usuario en silencio

Archivo: `src/lib/ai/agent/kipu-agent.ts`.

`failBeforeDurablePlan` sigue registrando primero el `agent_intake_failure` con
su razón tipada. Después pide **una** explicación al modelo primario. No hay
copy atribuido a Kipu escrito en TypeScript.

La redacción sólo se publica si `intakeFailureReplyIsHonest` y
`finalizeAgentReply` prueban todo esto:

- declara explícitamente que Kipu no hizo cambios;
- no inventa un dato faltante ni pide una confirmación imposible;
- no contiene una pregunta;
- no repite cifras/fechas sin evidencia;
- no afirma una escritura;
- pasa estructura, voz determinista y la barrera normal de publicación.

El texto puede invitar naturalmente a reintentar o reformular. Si el modelo o
la validación fallan, la entrega conserva el comportamiento retryable anterior;
nunca se sustituye por una frase canned.

El resultado publicable lleva `ok:true` porque hay una respuesta válida para el
canal, pero `outcome.hadError:true`: la metadata sigue diciendo que el trabajo
no se ejecutó y una captura/evidencia no puede confundirse con éxito.

## 4. Fix 3 — el runner de mutaciones exige baseline verde

Archivos:

- `scripts/qa/telegram-agent-regression-audit.mjs`
- `src/app/dev/capture-test/page.tsx`

Durante esta pasada actualicé el handshake a v22 antes que una aserción literal.
El capture baseline quedó rojo. El runner de mutaciones igual podía marcar como
muerto cualquier mutante cuyo detector coincidiera con ese rojo heredado.

Ahora ejecuta el capture gate una vez antes de tocar archivos y aborta si no
está verde. IR269 y M0M333 fijan el propio preflight. Al escribir esa red caí
otra vez en la aserción débil conocida: la primera versión encontraba
`if (baseline.status !== 0)` dentro de la definición del mutante. La versión
final exige la secuencia ejecutable multilinea, no la cadena suelta.

También actualicé M0M126 al nuevo diagnóstico estructural del validador; el
mutante ya no depende del copy anterior del error.

## 5. Contrato de evaluación y criterio de cierre

Handshake nuevo:

```text
m0-agent-eval-2026-08-09-planner-compiler-v22
```

Retiré tanto el criterio viejo de cinco muestras como el criterio demasiado
optimista de una sola. La evidencia v20 (22/22 y luego 15/22 en el mismo árbol)
demuestra que una muestra puede ocultar varianza del planner primario, aunque el
juez de estilo ya no tenga veto.

El criterio actual son **dos** corridas completas 22/22 sobre el mismo árbol y
servidor congelados. Ante el primer rojo se detiene: no se reintenta hasta
cambiar el código. Dos muestras detectan varianza primaria sin volver a comprar
cinco votos de un crítico secundario.

## 6. Redes nuevas y mutaciones

IR267 prueba:

- la forma v21 (undo explícito + dos reemplazos contiguos con grupo declarado
  pero wiring incompleto) se compila y valida;
- los tres actions terminan en un solo grupo;
- ambos reemplazos dependen directamente del undo;
- dos undos no se compilan;
- acciones completamente desagrupadas no reciben una relación inventada;
- el runtime consume el resultado compilado, no el raw original.

IR268 prueba:

- explicación AI natural de no-acción;
- recibo falso rechazado;
- requisito inventado rechazado;
- cifra sin evidencia rechazada;
- voz determinísticamente inválida rechazada;
- el resultado seguro se consume dentro de `failBeforeDurablePlan` después de
  persistir el intake;
- no se salta `finalizeAgentReply`.

IR269 prueba el baseline verde obligatorio del mutation runner.

M0M325–333 muerden por nombre esos nueve cables.

## 7. Verificación ejecutada por Codex

| Batería | Resultado |
|---|---:|
| Capture gate | **748/748** |
| Mutaciones M0 | **333/333**, exit 0, baseline verde y restauración completa |
| PostgreSQL M0 disposable | **65/65**, exit 0 |
| `tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |
| `npm run build` con red | **Compiled successfully**, 36/36 páginas |
| Muestras pagadas del modelo | **0** |

La primera ejecución de PostgreSQL/build dentro del sandbox falló por DNS y
Google Fonts, respectivamente; no fue una medición de producto. Repetidos con
red habilitada: PostgreSQL 65/65 y build completo verde.

No hay migración 109. Las 100–108 siguen aplicadas; v22 es TypeScript, QA y
documentación.

## 8. Auditoría solicitada a Claude

No ajustar aserciones ni escribir código antes de completar la auditoría de
fuente. Revisar especialmente:

1. que las precondiciones del compilador no puedan agrupar un movimiento ajeno;
2. que sólo cambien `atomic_group` y la dependencia directa, y que el validator
   siga consumiendo el resultado;
3. que dos undos, batch, intercalado, ausencia total de relación y colisión de
   grupo permanezcan fail-closed;
4. que el fallback sea model-authored, registre intake primero, nunca fabrique
   un remedio del usuario y no pueda lavar un `finalizeAgentReply` negativo;
5. que `ok:true + hadError:true` se traduzca en respuesta visible sin presentar
   la operación/captura como completada;
6. que el mutation runner realmente rehúse un baseline rojo y M0M333 no pase por
   una cadena muerta dentro de su propia definición.

Luego ejecutar, en este orden y sin gastar muestras antes de tiempo:

1. capture 748/748;
2. mutaciones 333/333, seriales, cero residuo;
3. PostgreSQL 65/65 **dos veces**, cero residuo;
4. `tsc`, lint, diff y build con red;
5. borrar `.next`, arrancar un único servidor y confirmar handshake v22;
6. ejecutar **una** corrida del modelo;
7. si hay cualquier rojo, detenerse y reportar razón tipada, sin reintento;
8. sólo si da 22/22, ejecutar la segunda corrida contra el mismo árbol/servidor;
9. sólo con 22/22 ×2, ejecutar el smoke de los transcripts reales del founder.

Expectativa falsable para ME10aa: la operación debe contener exactamente un
`undo_agent_operation` y dos `log_movement` individuales, los tres en el mismo
grupo, cada reemplazo dependiendo del undo; el undo y ambos reemplazos deben
aterrizar atómicamente y el estado posterior debe satisfacer las aserciones
durables existentes. Si el modelo presenta una forma realmente ambigua, el
compilador debe abstenerse y el usuario debe recibir una explicación de
no-acción, nunca una escritura parcial ni un 500 vacío.

M0 sigue ABIERTO hasta esa auditoría externa. No hacer commit, push ni deploy
antes del veredicto.
