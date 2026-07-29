# QA con usuario disposable

## Capture gate sin servidor local

Ejecuta el mismo `runChecks()` de `/dev/capture-test` sin abrir un puerto ni
descargar fuentes de `next/font`:

```bash
node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs
```

El runner transpila únicamente la página TSX del gate; todas las funciones
financieras importadas siguen siendo las del código real.

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
