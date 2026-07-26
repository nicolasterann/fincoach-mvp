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
