> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 — consultas de estado observan; no fragmentan operaciones (v18)

Fecha: 2026-08-08  
Estado: **listo para auditoría externa; M0 sigue abierto hasta 22/22×5**  
Contrato: `m0-agent-eval-2026-08-08-operation-inspection-v18`  
Migración nueva: **ninguna**

## Hallazgo confirmado por la muestra v17

ME5 quedó 21/22 aunque el scope `"$response"` funcionó exactamente como estaba
previsto. La metadata hizo visible el defecto real:

- el turno «¿qué dato te falta?» tenía `wrote=false`;
- la operación de ese turno quedó `awaiting_input` con un plan vacío;
- su pending tenía `appliesToActionIds=["$response"]`;
- pero su `intentKey` contenía el ID de otra operación, la que realmente era
  dueña de la pregunta;
- la operación original seguía abierta y ME6 podía resolverla.

La consulta había copiado el missing-field ajeno dentro de una segunda operación
sin trabajo ejecutable. No era correcto quitar la comparación de identidad de
ME5 y aceptar basura durable, ni tampoco forzar `continuation_operation_id`: una
consulta de estado no aporta el dato faltante y no debe consumir/reversionar el
plan de la operación original.

## Decisión de producto

Un turno que pregunta por el estado de trabajo abierto tiene identidad propia,
pero es **read-only**:

1. crea su propia operación durable para replay y auditoría;
2. declara qué operaciones consulta mediante IDs tipados;
3. termina `completed` tras responder;
4. no cambia status, plan, versión ni pregunta de la operación observada;
5. usa el pending observado para impedir una respuesta vaga, pero no lo persiste
   como pending de la operación de lectura.

Esto mantiene las dos propiedades que parecían competir: cada delivery tiene
identidad durable y ninguna pregunta de estado fragmenta el trabajo pendiente.

## Implementación

### 1. `plan.observed_operation_ids`

El plan durable incorpora `observed_operation_ids`. El planner recibe reglas
explícitas: «¿qué falta?», «¿qué pasó?» y consultas equivalentes dejan
`continuation_operation_id=null`, nombran los IDs observados y responden sin
copiar `missing_fields` ni `pending_question`.

El validador:

- acepta sólo IDs de la lectura completa de operaciones abiertas;
- exige IDs únicos;
- prohíbe solaparlos con continuation, supersede o abandon;
- falla cerrado si el catálogo de operaciones fue incompleto;
- para una inspección sin acciones exige `answer`/`no_op` y cero missing-fields;
- detecta además la forma observada en v17: una clave
  `operation:<open-id>:...` copiada como missing-field de `"$response"`.

Los planes persistidos antes de v18 siguen siendo legibles: ausencia de la
propiedad se normaliza a `[]` durante recovery. Las muestras vivas activan
`requireObservedOperationIds`, así que omitir el campo es un rechazo reparable y
nunca una degradación silenciosa al comportamiento v17.

### 2. Propiedad del pending separada de publicación

`pendingClarificationsFromOperation` reconstruye la aclaración exacta que
pertenece a una operación abierta. El runtime divide ahora dos conjuntos:

- **operation pending:** missing-fields creados por el plan/ejecutor del turno
  actual; éstos sí controlan settlement y pueden dejarlo `awaiting_input`;
- **publication pending:** lo anterior más los pending de operaciones observadas;
  éstos obligan a la respuesta a explicar el dato concreto, pero nunca se
  guardan como missing state del turno de lectura.

La separación se conserva en la primera respuesta, los tres repairs acotados,
el catch y el resultado durable. Una respuesta vaga sigue fallando
`missing_requirement_hidden`; una respuesta correcta permite que el hijo quede
`completed`.

### 3. ME5 prueba ambas filas

ME5 ya no exige reutilizar el ID original. Ahora demuestra:

- cero writes y mismo conteo financiero;
- operación de consulta distinta y `completed`;
- `observed_operation_ids` contiene el ID original exacto;
- la consulta no publica pending propio;
- la operación original continúa `awaiting_input` con missing-field y pregunta
  concretos;
- la respuesta conserva la política de voz.

El detalle de fallo mantiene metadata y agrega la fila original leída de
PostgreSQL.

## Redes de falsificación

IR265 prueba por función y wiring:

- inspección válida;
- ID observado desconocido rechazado;
- missing-field copiado desde `operation:<id>` rechazado;
- inspección read-only que intenta quedar awaiting rechazada;
- child completed, parent awaiting y vínculo exacto en ME5;
- pending observado consumido por publicación pero no por settlement;
- instrucción del planner que prohíbe copiar el pending.

M0M299–M0M305 muerden respectivamente esas fronteras, incluida la obligación de
que toda muestra nueva declare el campo. Las mutaciones antiguas
de continuidad, pending por capability, replay y publicación siguen verdes.

## Verificación de Codex

- Capture: **744/744**.
- Mutaciones M0: **305/305**, seriales, exit 0 y restauración completa.
- TypeScript: limpio.
- Lint: limpio.
- Sintaxis de ambos runners: limpia.
- `git diff --check`: limpio.
- Cero llamadas al modelo y cero créditos API gastados.
- Sin migración, commit, push ni deploy.

## Secuencia solicitada a Claude

Mantener la disciplina de presupuesto:

1. Auditar la propiedad del pending, el nuevo campo tipado y los negativos de
   IR265.
2. Capture 744/744.
3. Mutaciones 305/305, seriales y sin residuo.
4. PostgreSQL 64/64 dos veces.
5. Borrar `.next`, compilar y confirmar handshake exacto
   `m0-agent-eval-2026-08-08-operation-inspection-v18` en fuente y servidor.
6. Ejecutar **una sola** muestra del modelo. Sólo si llega a 22/22, ejecutar las
   otras cuatro corridas de estabilidad sobre el mismo árbol congelado.

M0 sigue abierto hasta 22/22×5 y una ronda final independiente limpia.
