# QA con usuario disposable

## Capture gate sin servidor local

Ejecuta el mismo `runChecks()` de `/dev/capture-test` sin abrir un puerto ni
descargar fuentes de `next/font`:

```bash
node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs
```

El runner transpila únicamente la página TSX del gate; todas las funciones
financieras importadas siguen siendo las del código real.

## Bloque M0 — inteligencia operacional general del agente

La implementación local está en
`docs/M0_IMPLEMENTATION_CHECKPOINT_2026-07-31.md`. Las migraciones 100–107
están **APLICADAS** (2026-08-02/03); la 105 eliminó la deriva con el reloj del
proceso y PostgreSQL volvió a 62/62 dos veces. La 103
hace seguro el cast del monto legacy y la 104 conserva la pregunta exacta de
planes READY parciales. La 106 está **APLICADA**: alinea
`account:<uuid>`/`debt_account:<uuid>`/`goal:<uuid>` con el UUID resuelto por el
preflight sin aceptar un tipo de recurso distinto. Ver
`docs/M0_EXTERNAL_AUDIT_2026-08-02.md`,
`docs/M0_CLAUDE_EXEC_AUDIT_2026-08-03.md` y el relevo vigente
`docs/M0_CLAUDE_SNAPSHOT_READ_V24_2026-08-09.md`. Las 107–111 están
APLICADAS; la sonda memoria+dinero ya forma parte de la batería PostgreSQL.
La 109 convierte la lectura de operaciones abiertas en un solo snapshot
PostgreSQL (RPC `kipu_read_open_agent_operations`, CAP+1 contado), la 110
saca el mensaje crudo de `agent_intake_failures` conservando fingerprint e
identidad, y la 111 lleva el archivo completado al mismo contrato (scan de
candidatos + bundle ops/steps, cada uno en un statement).

Auditor adversarial local (muta y restaura archivos; nunca correrlo en paralelo
con otro mutation runner):

```bash
node ./scripts/qa/telegram-agent-regression-audit.mjs
```

Resultado esperado en M0 loop: **497/497**, exit 0 y residuo cero. El runner primero exige
un capture baseline verde; no ejecuta mutantes sobre un detector ya rojo.
La numeración histórica conserva huecos de mutantes retirados u obsoletos; por
eso el id mayor es M0M503 y el total real es 497.
Capture esperado en el mismo árbol: **823/823**. IR267 prueba que la coreografía
inequívoca de una corrección completa se compila sin inventar intención y que
las formas ambiguas siguen fallando; IR268 prueba que un planner agotado produce
lenguaje AI seguro de no-acción en vez de un 500 o una pregunta imposible;
IR269 fija el preflight del propio runner. IR270 prueba que los tres rechazos de
intake sobreviven al cleanup como diagnóstico acotado sin filtrar candidatos,
prompts o mensajes crudos y que la cascada se reporta como BLOCKED. IR271 prueba que una
capability inequívoca sólo puede canonizar la etiqueta contable redundante de
una forma económica ya correcta; patas o direcciones incorrectas quedan intactas
y el validador las rehúsa. IR272 fija el snapshot único de la lectura abierta
(RPC, CAP+1, membresía, reloj del statement y ausencia de los lectores
paginados viejos); IR273 fija que la fila de intake no lleva el mensaje crudo.
IR276 fija el snapshot único del archivo completado (111: scan CAP+1(120) en un
statement, bundle con identidad terminal verificada y guard de membresía en
ambos lectores); IR277 fija el ternario de queryMatched. IR278 fija que un
rechazo de undo conserva su rama KIPU_* acotada en el receipt durable y que el
harness de ME9 captura los steps de corrección y target antes del cleanup.
IR279/IR280/IR281/IR282 fijan el CONTRATO DE COMPLETITUD v34/v35: el planner declara
sólo money/date/entity canónicos y además escribe el template natural de
respaldo; la frontera verifica los hechos contra el texto ligados a entidad y
rol; un requisito sin evidencia jamás se exige; y, si la reparación vuelve a
omitir, el fallback sólo sustituye slots por valores verificados y conserva el
contrato original. El wire contract es explícito y discriminado
(`money={amount,currency}`, `date={date}`, `entity={name}`); el reparador recibe
la ruta exacta rechazada. Un requisito sólo es fundamentado si valor y entidad
comparten ventana de evidencia. Un slot no fundamentado se vuelve incertidumbre
tipada dentro del template del modelo, sin ocultar los demás hechos y sin
reutilizar el valor no probado. M0M382–M0M398 impiden volver a contrato vacío,
perder el template, finalizar con `[]`, aceptar entidades no probadas, ocultar
el schema al planner, degradar el diagnóstico o reinyectar un valor no probado.
IR265 + M0M399–401 fijan la autoridad alternativa de una inspección cualitativa:
sólo `answer` read-only cuyas operaciones observadas poseen pending durable y
cuyas assertions provienen de `openOperations` puede usar ese pending en lugar
de inventar un requisito money/date/entity;
`answer_and_act` y una respuesta sin operación observada siguen obligadas por
el contrato factual normal.
IR283 + M0M402–407 fijan el cierre v36: un `money_not_grounded` conserva sólo la
cifra, razón y roles acotados; esa evidencia llega a la reparación y al detalle
del E2E antes del cleanup; después de una escritura no se amplía la evidencia
determinista con el contexto financiero anterior, y un id observado sin pending
o con assertions de otra fuente no puede lavar el contrato canónico.
IR284 + M0M408–410 fijan v37: el prompt enseña el mismo constructor de source que
el validador consume, el rechazo devuelve `plan.assertions[i].source` y el
fixture deriva su source de esa fuente compartida. Una referencia debe nombrar
uno de los `observed_operation_ids`, no sólo comenzar por `openOperations`.
IR270/IR285 + M0M411 fijan v38: un intake failure que se recupera con una
respuesta segura HTTP 200 no desaparece del detalle. El runner ya capturaba su
metadata acotada y filas durables; ahora `turnDetail` debe consumir ese campo
antes del cleanup, igual que consume la rama HTTP-error.
IR286 + M0M412 fijan v39: el monto exacto de un fijo estable puede venir de
autoridad server-owned después de que el usuario sólo complete la cuenta, sin
pedir un tercer consentimiento. El bypass es por path monetario verificado, no
por frase: variable, catálogo incompleto, monto/moneda divergentes o una cifra
contradictoria del usuario conservan `unstated_amount`.
IR287 + M0M413–414 fijan v40: un missing_field no puede volver a pedir un path
que ya está presente en la action validada; si la pregunta natural y su repair
fallan el matcher de cobertura, la última pregunta contiene todos los
`answer_shape` tipados y vuelve a cruzar la frontera determinista en vez de
degradar a no-acción. M0M135 también sigue fijando el intake durable si ni esa
pregunta puede publicarse.
IR287/IR288 + M0M415–417 fijan v41: la pregunta canónica generada desde cada
`answer_shape` omite únicamente el matcher léxico que no puede citar keys
internas, pero conserva todas las demás barreras; y el planner adopta el
monto/moneda de un fijo estable sólo después de seleccionar la action y el id
exactos. Una lectura incompleta, fijo variable/inactivo/no-único, moneda o cifra
contradictoria dejan el plan intacto. Si un missing compartido todavía bloquea
otra action, sólo se retira el target compilado. M0M282 ahora prueba el consumo
funcional de pendientes en publicación, no la mera presencia de una línea.
IR289 + M0M418–421 fijan v42: una entidad nombrada por el usuario en la raíz de
la operación durable puede completar un turno posterior que sólo aporta otro
dato; sin esa autoridad la elección sigue desafiada, y una entidad distinta en
el turno actual refuta la heredada. El vínculo de un fijo consume mensajes de
usuario + monto validado y no una descripción escrita por el modelo.
IR290 + M0M422–424 fijan v43 sin rutas de lenguaje: bounded repair recibe una
salida segura para acciones económicas inválidas, preserva las acciones
independientes y distingue operación durable de dependencia atómica. Un
`log_movement` agrupado sin undo no invita a inventar una reversión; una pata
sin identidad económica vuelve a missing `$response`.
IR291 + M0M425–430 fijan v44: los errores internos se reparan por dimensión y
no pueden inventar una pregunta; `$response` sólo representa una ambiguity de
evidencia del usuario ya declarada, con key y reason ligados. La red también
prueba el lado de libertad: una ambigüedad real preexistente sí puede seguir
hasta una pregunta útil.
IR292–IR302 y M0M431–452 fijan M0.11A. La unidad de autorización es un
manifiesto durable de operación —una o N acciones— y no un challenge por tool.
La confirmación declara una transición sobre el manifiesto exacto ya mostrado;
no vuelve a interpretar ni regenerar payloads. El servidor verifica procedencia
tipada (`user_stated` contra la entrega durable exacta y `stored_fact` contra el
hecho bloqueado), contrato estructural de lifecycle, anti-loop, CAS, política de
atomicidad y la igualdad durable entre autorizado y ejecutado. Un monto de
contexto no ligado —incluido el caso histórico 552,77— sigue rehusado. La 112
está APLICADA. La 113 también está APLICADA: conserva la igualdad del
manifiesto y hace observable si falló el conjunto autorizado, preparado,
coincidente, ejecutado, asentado o verificado.
IR302 fija además que un writer que ya asentó su step dentro de la transacción
de dominio no recibe un segundo receipt del orquestador, y que ME9/ME10aa/
ME10b/ME10c/ME17 prueban el lifecycle del manifiesto en vez del challenge por
tool anterior.
IR274 fija la paridad del recibo del lote (monto+entidad por fila, o la
respuesta veraz muere en money_not_grounded con el dinero escrito); IR275 fija
que un miss del filtro semántico se declara como miss y degrada a las
recientes sin filtrar — jamás como ausencia del historial.

Las migraciones **105–115 están APLICADAS**. La siguiente migración libre es la
**116**. La 105
corrige la deriva entre el reloj del proceso y los timestamps
escritos por PostgreSQL; la 106 hace que el fixture use la misma referencia
tipada que emitió el modelo real. La batería PostgreSQL es:

```bash
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
```

El resultado vigente después de la 115 es **82/82**, exit 0,
sin `ABORT`, `COBERTURA INCOMPLETA`,
`LIMPIEZA ILEGIBLE`, `RESIDUO` ni `FALL`.
M100.8ab y M100.20 atrasan deliberadamente 24 h el reloj del proceso; no quitar
ese control, porque es lo que distingue el reloj DB del bug anterior.
M100.8b añade además un write durable de memoria sin transacción junto a dos
writes de ledger: el undo debe revertir las dos transacciones sin confundir la
memoria con dinero, y aún debe rehusar cualquier write económico sin recibo.
M109.1 es la sonda de dos conexiones del snapshot único: doce vueltas reales de
ciclo (awaiting_input → claim continuación → save) mientras un lector
concurrente exige coherencia interna en cada lectura; M109.2 prueba el CAP+1
con 201 operaciones abiertas. M110.1/M110.2 prueban que el intake persiste
fingerprint sin el mensaje crudo y que el replay no lo resucita. M111.1 prueba
en runtime que un query sin coincidencias declara el miss del filtro y degrada
a las recientes sin filtrar. M111.2 es la sonda concurrente del archivo (el
scan de la 111 jamás pierde una operación completada presente mientras el
archivo crece); M111.3/M111.4 prueban el ternario sobre un scan topado: sin
coincidencias observadas o con la coincidencia real fuera de la ventana,
`queryMatched` es null y `complete` es false — jamás una negación.
M112.1–M112.5 prueban transición durable e idempotente, un manifiesto de cuatro
acciones sin cuatro challenges, igualdad post-write exacta, confirmación natural
de cuatro acciones sensibles por un único CAS y fallo durable de integridad si
falta cualquiera de los pasos autorizados. M112.2 consulta la identidad real
`originating_operation_id`; M112.5 exige además el diagnóstico durable
`execution_incomplete` y los seis conteos separados de la 113.
M114.1 prueba que un ciclo de tarjeta cubierto, con saldo actual y remanente
vivo en cero, puede cerrarse aunque conserve `minimum_payment` y
`statement_total_due` como snapshot histórico. M114.2 conserva la dirección
fail-closed: un ciclo no cubierto o cualquier saldo actual siguen bloqueando.
M115.1 prueba que PostgreSQL revalida bajo lock la procedencia
`register_card_payment.amount <- debt_accounts:<id>:full_payment_due` aun cuando
`paidInFull` omite el argumento numérico, y rehúsa un testigo divergente. M115.2
simula write+verify seguido de fallo de publicación: el retry exacto recupera
el manifiesto completo como `already_verified`, nunca lo ejecuta otra vez, y
una verificación parcial no obtiene esa salida.
IR300/IR301 fijan la interfaz de planificación que la primera muestra de A
demostró oculta: cada capability publica sus templates monetarios desde la
misma ontología que valida el payload; los rechazos de provenance devuelven el
set exacto faltante/sobrante; y lifecycle + segunda entrega comparten una sola
fuente entre prompt y validador. Los mutantes M0M441–448 cortan cada consumo.

Con servidor local, `KIPU_AGENT_MODE=on` y un secreto QA independiente, ejecutar
el modelo de producción:

```bash
M0_EVAL_SECRET='<secreto-local>' KIPU_AGENT_MODE=on npm run dev
M0_EVAL_SECRET='<secreto-local>' node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
```

Si el shell de auditoría mata comandos que exceden diez minutos, lanzar la
misma muestra una sola vez como worker desacoplado (hereda las variables ya
cargadas y conserva el exit real):

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs m0-11a-wire
```

El launcher devuelve inmediatamente las rutas `/tmp/...log`,
`/tmp/...status.json` y el pid. El auditor espera el status `finished`; no
vuelve a lanzar la muestra por timeout del cliente. El proceso sigue usando el
mismo runner, handshake, cleanup y criterio 24/24.

Resultado esperado para el re-audit M0.11A: **24/24**, exit 0 y residuo cero
en **una sola** corrida completa sobre el árbol/servidor congelado. Ante el
primer rojo se detiene, se diagnostica por razón tipada y sólo se vuelve a
muestrear después de cambiar el código. Las corridas previas sirven como
evidencia histórica; repetir un sello hasta obtener verde no es criterio de
release y quema presupuesto sin aumentar la garantía.

### M0 Etapa 2 — batería de tres carriles

El runner nuevo es black-box: cruza `/dev/m0-agent-eval` por HTTP y verifica
estado en PostgreSQL; no importa el loop ni el planner. El servidor debe estar
levantado en el mismo modo pedido por el runner (el handshake rehúsa medir otro):

```bash
KIPU_AGENT_MODE=loop npm run dev
node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run
node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --smoke
```

`--dry-run` inyecta completions MOCK únicamente a través del bridge local
autorizado y recorre 20 patas de contrato contra PostgreSQL real, incluidas
`DRY_SUCCESSOR_PAY_CLOSE` (cuatro pagos + cuatro cierres en un manifiesto
sucesor) y su variante `DRY_SUCCESSOR_PAY_CLOSE_READ` (lectura emitida por el
modelo después de confirmar, redirigida sin staging antes de narrar).
La misma batería fija que el lote confirmado refresca el contexto del modelo una sola
vez y que las aserciones de lifecycle eligen el manifiesto de la
`plan_version` vigente, aunque queden predecesores rechazados en la evidencia.
También fija la frontera 1AD: el `tool_result` de `confirm_operation` se agrega
antes del refresh post-lote y toda completion valida localmente que ningún rol
se intercale entre `assistant.tool_calls` y sus respuestas `tool` exactas.
`--smoke`
ejecuta solo tres escenarios reales
para validar la plomería del juez mini. Sin ambos flags, `--mode=loop|on`
ejecuta el catálogo completo: 24 escenarios heredados, los transcripts de
arriendo/cuatro créditos y ocho familias aspiracionales con tres paráfrasis
generadas en runtime. `--mode=on` se reporta como baseline **HÍBRIDO
v44+M0.11A**. Cada escenario imprime DINERO, CONDUCTA y el veredicto 1–5 de
CALIDAD; el cierre agrega `loopUsage` y la estimación de tokens/USD.

El árbol vigente añade IR303–IR311 y M0M453–478: el planner ve el registro
exacto de hechos almacenados que runtime puede revalidar (gasto fijo estable y
corte vivo de tarjeta), y una pasada read/replan válida usa un wire generado
por la misma función que lo normaliza.
El wire vivo anuncia únicamente `user_stated|stored_fact`; `derived` queda
reservado y fail-closed hasta M0.11B. IR306 fija el receipt del envelope
persistido y su rechazo ante drift; IR307 fija la independencia entre dirección
de caja y relación crediticia; IR308 fija la frontera histórica/viva de la 114.
IR309 cruza cada monetary path publicado por los schemas y las formas legales
server-materialized: `paidInFull=true` exige provenance de `amount` aunque el
payload lo omita, un parcial sigue user-stated y una autoridad ausente no crea
un claim. Esas cifras (788/788 y 468/468) son el baseline histórico anterior a
la frontera semántica vigente. PostgreSQL: **82/82×2**. IR310 separa preguntas puras
de éxito parcial y exige continuidad conversacional truth-checked; IR311 fija
reentrada de publicación sin doble ejecución y paridad del verificador de
tarjeta en PostgreSQL. La familia semántica de
préstamos permite un pase real de `list_open_receivables` y exige después el
plan económico final; la lectura interna nunca cuenta como respuesta exitosa.
El contrato vigente es
`m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a`. El runner exige que la
ruta compilada reporte el mismo `M0_AGENT_EVAL_CONTRACT`; si el servidor está viejo aborta antes de crear la
persona y ordena reiniciarlo, en vez de atribuir al árbol actual un fallo de una
compilación anterior.

La muestra completa agrega una invariante transversal fuera de los 24 checks:
cualquier turno con respuesta vacía, error final, jerga interna o
`agentPublicationRecovery` hace rojo el proceso. El recovery existe para que
producción jamás calle; no cuenta como prueba de que la inteligencia normal
funcionó.

IR312–IR317 fijan el puente histórico hacia la frontera semántica. IR318–IR327
y M0M487–496 fijan la resta efectiva:

- IR312: el objetivo y la relación semántica elegidos por el modelo sobreviven
  a cada read interno; la interpretación puede enriquecerse con evidencia nueva
  y runtime deriva sólo ids y deltas de lifecycle.
- IR313: los targets de missing-fields se derivan de schemas y ambiguities; el
  servidor nunca inventa el hecho faltante.
- IR314: el modelo declara una cita exacta dentro del step que interpretó;
  runtime deriva el path y liga la cita a la entrega durable exacta. Un 552,77
  meramente presente no obtiene autoridad.
- IR315: la última pasada consume `READ_EVIDENCE`, no repite reads y cualquier
  agotamiento conserva los tres rechazos reales.
- IR316: ninguna frase/token español decide en el camino activo si una pregunta
  natural cubrió un pending tipado.
- IR317: intake, publicación, proveedor y excepción de turno conservan causas
  distintas también en replay/handler; un recovery sin diagnóstico nuevo se
  rehúsa y el alias legacy se normaliza una sola vez.
- IR318: el modelo no puede volver a recibir wire mecánico; raíz/unidad/step
  quedan limitados a 6/3/3 y un gasto ordinario a 12 (máximo 14); la evidencia
  pertenece al step que prueba.
- IR319: capability+arguments+estado esperado compilan el evento contable
  completo; un gasto siempre incluye caja↓ y reconocimiento↑.
- IR320: una cifra contextual como 552,77 sin cita semántica exacta no adquiere
  procedencia ni autoridad.
- IR321: el estado esperado contradice y rechaza una dirección económica
  compilada incorrecta.
- IR322: N steps dentro de una promesa semántica producen una sola unidad
  atómica; el modelo nunca emite grupo/dependencias.
- IR323: ningún `ok:false` sale de la frontera pública sin causa tipada y una
  continuación accionable; recovery sigue rojo.
- IR324: catálogo completo en prefijo estático y telemetría input/cache/output
  consumida también por el E2E.
- IR325: el runner conversacional no importa planner ni aserta envelope;
  conversa por HTTP y verifica efectos PostgreSQL.
- IR326: ninguna mutación compila sin `expected_change` observable.
- IR327: la evidencia es step-local; dos importes iguales en acciones distintas
  conservan citas separadas.

Estos checks no convierten el circuito breaker en éxito. **Cualquier** recovery
sigue siendo rojo en la muestra 24/24; A sólo cierra cuando el camino normal del
modelo conversa y actúa sin usarlo.

Para diagnosticar únicamente el seed ME3 sin gastar la batería completa se
puede usar `M0_MODEL_FOCUS_THROUGH=ME3`. Este modo conserva cleanup, handshake y
exit 1 ante rojo, pero espera 3 checks. No es criterio de cierre: el modo normal
sin esa variable sigue exigiendo 24/24.

Para diagnosticar la cadena exacta que termina en «¿qué falta?» puede usarse
`M0_MODEL_FOCUS_THROUGH=ME5`; conserva las mismas garantías y espera 5 checks.

## Cierre Pre-M — mutaciones y E2E

El runner adversarial apaga uno por uno el catch-up conservador, el cursor de
cierre, el TTL/cadencia FX, los writers de Mis Datos y los seams H.44/H.46. Cada
mutación debe morir por su aserción nombrada y restaurarse byte-for-byte:

```bash
node ./scripts/qa/pre-m-mutation-audit.mjs
```

Resultado esperado: **28/28, residuo cero**.

Después de aplicar las migraciones 096–099 —nunca antes—, la persona desechable recorre
los writers y triggers reales contra PostgreSQL:

```bash
node --env-file=.env.local ./scripts/qa/pre-m-backend-e2e.mjs
```

Resultado esperado: **40/40**, exit 0, sin `ABORT`, `COBERTURA INCOMPLETA`,
`LIMPIEZA ILEGIBLE` ni residuo. Cubre: alta de cuenta idempotente; UPDATE
autenticado bloqueado **y ledger service-role todavía operativo**; reconciliación
nativa y replay; close/reopen normal y con residuo base-only de 0,18; discrepancia
material no ocultada; puerta legacy revocada; deuda con saldo rehusada; H.44/H.46 por executor
real; hueco de cron tardío como ask sin débito; cursores monotónicos; tasa manual
vencida no publicable, validaciones de identidad/mes y ACL service-role-only.

Los gates estáticos de onboarding también pueden correrse sin abrir el servidor:

```bash
node scripts/qa/run-static-gate.mjs src/app/dev/onboarding-loop-test/page.tsx loop-checks
node scripts/qa/run-static-gate.mjs src/app/dev/onboarding-wizard-test/page.tsx wizard-checks
```

Smoke acotado del backfill de zona horaria contra un entorno REAL: usuarios
disposables, sesión real (magiclink → verifyOtp, sin contraseñas), Server Action
real invocado como lo hace el navegador, RLS real, base real. Se limpia solo en
`finally` y verifica cero residuos.

```bash
# 1. crea 2 usuarios disposables y monta sus sesiones
node --env-file=.env.local ./scripts/qa/tz-backfill-smoke-setup.mjs /tmp/tzsmoke.json

# 2. localiza el id del Server Action en el bundle DESPLEGADO (cambia en cada build)
#    busca createServerReference(...) / "ensureUserTimezoneAction" en /_next/static/chunks/*.js

# 3. corre el smoke
node --env-file=.env.local ./scripts/qa/tz-backfill-smoke.mjs /tmp/tzsmoke.json <actionId>
```

Cubre: sin fila → crea · recarga idempotente · zona declarada nunca se pisa · fila
con zona NULL o cadena vacía se completa · dos sesiones se resuelven independientes ·
sin sesión no escribe · limpieza con cero residuos.

Lo que NO cubre, para que nadie lo lea de más:
- **No reproduce la carrera del `23505`.** El caso de zona NULL parte de una fila que
  YA existe, así que la completa el primer update condicional. La carrera real
  (update no toca nada → insert concurrente → 23505 → segundo update) exige inyectar
  una escritura dentro del action y no es reproducible desde fuera.
- **No prueba "dos usuarios en la misma pestaña".** Invoca dos sesiones directamente;
  nunca monta `TimezoneCapture` ni toca `sessionStorage`. Que la marca no se herede
  entre cuentas lo prueba H.52 (claves por user id) más el cableado del layout.

**Nunca contra datos reales del founder.** Los usuarios llevan el prefijo
`kipu-tzsmoke-` y `user_metadata.kipu_smoke = true`.

## J-2 — auditoría local de correcciones (sin DB)

Ejercita los seams reales del guard y del executor sin escribir datos:

```bash
node --experimental-strip-types ./scripts/qa/j2-correction-audit.mjs
```

Cubre 450 movimientos con empate de timestamp y target en tercera página;
error posterior, tope y conteo concurrente; evidencia pendiente y
`confirmedNew`; corrección sin target; captura normal ante lectura caída;
falsos positivos lingüísticos; ingreso con monto corregido y fecha contable
antigua; reemplazo exacto Pichincha→Supervielle; fallo de lectura con cero
writes; propagación de fecha al writer atómico; matriz de 12 correcciones y
16 capturas normales; y el interlock PRE-tool que impide que una corrección
caiga al pipeline legacy sin bloquear el fallback de una captura normal.
Resultado esperado: 17/17.

## J-3 — auditoría local de respuestas al calendario (sin DB)

Ejercita el matcher, el contrato de lectura, la barrera tipada de los writers y
el cableado de las dos RPC de corte sin escribir datos:

```bash
node ./scripts/qa/j3-calendar-reply-audit.mjs
```

Cubre error vs ausencia, listas parciales, dos tarjetas que comparten «Visa»,
fallo de la lectura de nombres, ids anónimos no publicables, procedencia durable
web/Telegram, bloqueo del dispatcher real, propagación de `occurrenceId`,
wrappers atómicos, ausencia del segundo write tras cierre atómico y la regla que
impide que un estado viejo cierre por fallback el aviso nuevo. Resultado
esperado: 21/21. También fija la carrera en la que otra sesión ya había resuelto
la ocurrencia: el caller no ejecuta un segundo `mark` que la reetiquete.

La migración 075 no queda certificada por este harness: antes del deploy hay que
aplicarla y sondear dentro de una transacción revertida los caminos
fecha-exacta, único pendiente, múltiples pendientes (rollback), replay terminal,
statement viejo y privilegios de los helpers privados.

## J-4 — auditoría local del digest proactivo (sin DB)

Ejercita el claim tipado, el fail-closed del cupo, la liberación previa a
delivery, el replay idempotente de publicación, las lecturas completas de días
de pago, las fechas futuras de vencimiento y el copy de re-ask:

```bash
node --experimental-strip-types ./scripts/qa/j4-digest-audit.mjs
```

Resultado esperado: 18/18. La migración 077 no queda certificada por este
harness: antes del deploy hay que aplicarla y sondear dentro de una transacción
revertida la carrera de dos claims, el tope total/lane, publicación+CAS, replay,
payload inválido y privilegios de las tres RPC.


## E2E de persona desechable (Bloque J-7)

Lo único que ningún gate estático puede responder: **¿el dinero se movió —o NO se
movió— como decimos?** Escribe de verdad contra el Postgres real, con los triggers
reales, usando el writer REAL del producto (`applyChatTransactionIntent`), y
después mira los balances.

```bash
node --env-file=.env.local ./scripts/qa/j7-persona-e2e.mjs
```

Prueba las DOS capas por separado, que es el punto:

- **capa TS** — el applier rehúsa antes de escribir.
- **capa DB** — un INSERT CRUDO con `service_role`, saltándose TypeScript entero,
  tiene que ser rechazado igual por el trigger. Un guard que solo vive en
  TypeScript es un guard que el próximo caller se salta.

Los brazos E4/E5 verifican la **migración 078**. E9 verifica que la 079 haya
cerrado también `adjustment` (sin bloquear uno coherente en E9b). E12 prueba
contra la RPC real que inversión = caja+activo+ocurrencia exactamente una vez;
E13 hace lo mismo con mensaje+filas+claim del cierre mensual. Resultado esperado
después de aplicar 079–081. La ampliación de cierre exige además **082–083**
(orden: 082 → deploy → 083):
E12e/f/g comprueban plan+scalar, residual agregado, idempotencia y pausa/reanudación;
E13-pre liga el mes al claim; E14
exige cooldown durable; E15 consume un recordatorio en la misma publicación; y
E16 exige `22023` para el conflicto determinista heredado de la 077. E17 exige
que `service_role` no pueda saltarse ninguno de los quince wrappers v2; E17b
rechaza UPDATE directo de monto/cadencia/status, E17c un alta activa en cero y
E17d la reanudación de un plan legacy pausado en cero. Debe terminar
con residuo cero en todas las tablas que toca.

Persona desechable, limpieza en `finally` y verificación explícita de residuo
cero: un harness que ensucia la base al fallar a medias es peor que no tenerlo,
porque el residuo reaparece después sin dueño.

## E2E de fijos variables (Bloque K)

Las migraciones 093–095 deben estar aplicadas antes. El script detecta
explícitamente si falta la 093 y la batería K7/K54/K59/K12 demuestra por
comportamiento si falta la 094; no acepta que la defensa viva solo en
TypeScript o en una marca de fuente.

```bash
node --env-file=.env.local ./scripts/qa/k-variable-fixed-e2e.mjs
```

Resultado esperado: **79/79** y residuo cero. Prueba con persona desechable los
writers y triggers reales: baseline sin historia inventada; observar sin mover
dinero; pago/ocurrencia/forecast atómicos; replay tras recargar el snapshot;
dedupe mismatch; corrección append-only incluso con el mismo monto pero otra
fuente/fecha; `from_now` abre régimen; ledger genérico converge; duplicado se
rehúsa; pago tardío no fabrica otro ciclo; cambios variable↔fijo migran sus
avisos abiertos; reversa y retractación retiran la evidencia actual; ARS sin FX se puede
observar pero no pagar a 1:1; create+pay variable; categoría preservada; y ACL
(`authenticated` solo SELECT, RPC solo service_role). También prueba lecturas
paginadas y fail-closed, unicidad mensual/anual, coherencia occurrence↔plan por
usuario, moneda canónica, reset estrecho de onboarding y limpieza verificable.
K13 prueba la identidad completa: un redelivery conserva la clave del ledger y
una orden nueva después de undo produce otra transacción aunque monto, cuenta y
fecha coincidan. Las tablas de observaciones se consultan por
`occurrence_id + is_current` con cardinalidad exacta. Las filas divergentes
pre-K nacen como planes estables, se pagan por el ledger genérico y prueban
**cero observaciones K** antes de perder su vínculo; solo después se activa la
variabilidad. Construirlas con el writer canónico de K no sería legacy: la
observación creada mantiene el guard activo aunque se apague `is_variable`.
K56/K58 convierten cualquier fallo de preparación en checks rojos nombrados y
dejan continuar la batería hasta K79.

La auditoría local de mutaciones se corre antes de aplicar la migración:

```bash
node ./scripts/qa/k-mutation-audit.mjs
```

Resultado esperado: **280/280**, sin residuo de archivos mutados.

## Mutaciones del fail-safe de refunds (micro-Bloque L)

Sin servidor ni puerto: el runner invoca `run-capture-gate.mjs` directamente.

```bash
node ./scripts/qa/l-refund-mutation-audit.mjs
```

Resultado esperado: **24/24**. Sujeta que `record_person_payment` consume una
sola decisión tipada, que una lectura incompleta no autoriza writes, que
`budget_treatment = NULL` se hereda literalmente, que el refund persiste
`related_transaction_id`, que una ambigüedad devuelve los candidatos de la
misma lectura completa de 60 días (sin caer a una segunda ventana más corta),
que el refund hereda también la marca fixed/installment (para no restaurar
Saldo que el original nunca drenó), que parciales previos acotan el remanente
y que los once schemas
`category`/`newCategory` son exactamente su enum canónico (las seis
superficies que solo describen compras/gastos excluyen `income`
deliberadamente).

## J-8 — fronteras atómicas e identidad del draft

Después de aplicar en orden `084 (manual) → 085 → 086 → 087`, ejecuta:

```bash
node --env-file=.env.local ./scripts/qa/j8-migration-084-probes.mjs
```

Resultado esperado: **45/45** y `limpieza: residuo cero verificado`. Además de
los caminos felices de la 084, cubre replay/corrección/reversa de grupos,
movimiento+pending, cuotas y —desde la 087— el draft multifuente o retractado
ligado a una sola identidad durable. Incluye dos consumos concurrentes con
dedupes distintos: exactamente uno debe ganar. Un residuo o una lectura de
limpieza fallida hacen que el proceso salga distinto de cero.

## Cierre first-principles del agente — migración 088

La 088 está **APLICADA** (2026-07-28) junto con sus correcciones **089**, **090**,
**091** y **092**. Correr esta batería después de cualquier cambio en esa superficie y
siempre antes de desplegar el código que la consume:

```bash
node --env-file=.env.local ./scripts/qa/j-agent-088-probes.mjs
```

Resultado esperado: **61/61** y residuo cero. La persona desechable comprueba
challenge server-owned (mismo turno, turno posterior, stale, replay y
reemplazo), transferencia FX atómica y reversa, identidad de creates, ciclos de
tarjeta, fronteras household idempotentes/auditadas, correcciones de comercio,
ACL/RLS y redelivery de chat. Toda lectura de limpieza fallida, count nulo o fila
residual hace que el proceso salga distinto de cero.

La serie **F** prueba el ciclo REAL de eliminación de usuario y el contrato de
autoría: un participante que creó un gasto compartido y una liquidación borra su
cuenta **sin borrar el hogar** (F1), las DOS tablas rechazan un INSERT sin autor
(F2), `created_by` es inmutable mientras su autor exista (F3), el CATÁLOGO
—`pg_constraint` + `pg_attribute`— prueba cero columnas NOT NULL dentro de un FK
ON DELETE SET NULL y los cuatro guards activos (F4), y ese reporte no es
ejecutable por `authenticated` (F5). F1 no esquiva el defecto borrando el hogar
antes; eso probaría la 090, no el ciclo.

## M0 — loop nativo y migración 116 (pendiente de aplicación)

Estos dos runners quedan escritos pero **NO deben ejecutarse** hasta que la
migración `116_m0_native_agent_loop.sql` haya sido auditada, aprobada y aplicada
explícitamente. No sustituyen la auditoría pre-aplicación con mocks SQL.

```bash
node --env-file=.env.local ./scripts/qa/m0-loop-116-e2e.mjs
node --env-file=.env.local ./scripts/qa/m0-loop-mock-dry-run.mjs
```

El primero exige **M116.1–M116.6 = 6/6** y residuo cero: staging/replay e
identidad, manifiesto derivado con igualdad completa, reject no terminal con
re-staging, verificación de receipts reales, paridad scoped en turno mixto,
contención post-autorización y undo fail-closed. El segundo usa completions
100% guionadas (cero llamadas pagadas) contra PostgreSQL real y recorre lectura
pura → write ordinario → propuesta sensible → confirmación posterior → receipts
verificados, con telemetría input/cache/output en todas las llamadas.
