# QA con usuario disposable

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
writes; y propagación de fecha al writer atómico. Resultado esperado: 15/15.
