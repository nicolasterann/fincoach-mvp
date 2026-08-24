> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0.11A — reparación posterior al primer audit de PostgreSQL

Fecha: 2026-08-12  
Estado: **CORREGIDO LOCALMENTE; 112 APLICADA; 113 PREPARADA, NO APLICADA**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo: **no ejecutada**

Sello canónico de la superficie ejecutable:

```text
ecc86625e5fb7ccd83d96d354a89c60d420113d8d8428294ee916960af013190
489 archivos
```

El sello usa el comando de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md` y no incluye
documentación.

## 1. Resultado del primer audit

Claude auditó y aplicó la migración 112. La revisión de fuente aprobó la
arquitectura de manifiesto y la batería determinista quedó verde, pero el E2E
real de PostgreSQL terminó **76/78**. No se gastó la muestra del modelo.

Los dos rojos fueron:

1. **M112.2, instrumento:** el harness filtraba
   `agent_action_challenges.operation_id`, columna inexistente. La identidad
   real es `originating_operation_id`.
2. **M112.5, semántica de diagnóstico:** la barrera sí dejó el manifiesto en
   `failed_integrity`, pero `actual_count` contaba todas las filas de step ya
   preparadas, no las que alcanzaron ejecución. Además, el único mensaje
   `authorized, prepared and executed sets differ` culpaba conjuntos que en la
   sonda sí eran iguales; lo que faltaba era ejecutar/verificar una acción.

La segunda observación es un defecto real de observabilidad, no de seguridad:
la 112 falló cerrado, pero nombró mal la causa.

## 2. Correcciones implementadas

### 2.1 M112.2 usa el esquema real

En `scripts/qa/telegram-agent-100-e2e.mjs`:

```text
operation_id  →  originating_operation_id
```

La aserción vuelve a medir lo que declara: cuatro acciones dentro de un solo
manifiesto y cero challenges legacy originados por esa operación.

### 2.2 Migración 113 append-only

Archivo nuevo:

`supabase/sql/113_m0_manifest_verification_diagnostics.sql`

La 112 ya fue aplicada y no se reescribió. La 113 redefine únicamente
`kipu_verify_agent_operation_manifest(jsonb)` y conserva:

- `SECURITY DEFINER`;
- owner `postgres`;
- `search_path = public, pg_temp`;
- EXECUTE sólo para `service_role`;
- lock y ownership de operación/manifiesto;
- plan version y lease vigentes;
- igualdad exacta de action id, capability, arguments, witness, effects,
  postconditions, grupo y ordinal;
- `failed_integrity` durable ante cualquier divergencia.

El payload ahora distingue:

- `authorized_count`: acciones del manifiesto autorizado;
- `prepared_count`: filas persistidas para el plan;
- `matching_count`: filas idénticas al manifiesto;
- `executed_count`: filas que alcanzaron un resultado de ejecución;
- `actual_count`: alias compatible de `executed_count`;
- `settled_count`: coincidencias con resultado terminal admisible;
- `verified_count`: coincidencias verificadas.

Los rechazos tienen `reason_code` durable y un mensaje con los dos conteos que
divergieron:

- `prepared_set_mismatch`;
- `prepared_payload_mismatch`;
- `execution_incomplete`;
- `verification_incomplete`;
- `settlement_incomplete`.

No se añadió una salida permisiva. Cada rama sigue terminando en
`failed_integrity`.

### 2.3 El caller conserva el diagnóstico estructurado

`verifyAgentOperationManifest` ahora devuelve en el lado de error:

```ts
{
  ok: false,
  reason,
  reasonCode,
  verification,
}
```

El mensaje sigue disponible para el lifecycle existente y el payload exacto
queda disponible para QA/auditoría. La propia fila del manifiesto guarda la
misma evidencia antes de responder.

### 2.4 M112.5 mide la semántica correcta

La sonda de una acción ejecutada entre dos autorizadas ahora exige:

```text
reason_code       = execution_incomplete
authorized_count  = 2
prepared_count    = 2
matching_count    = 2
executed_count    = 1
actual_count      = 1
verified_count    = 0
status            = failed_integrity
```

También exige el mensaje `prepared_count=2 but executed_count=1`. Ajustar el
assert no vuelve verde un fallo: fija la semántica nueva de la 113 y seguiría
rojo contra la función aplicada de la 112.

### 2.5 Cobertura permanente

- Capture nuevo **IR299**: obliga a conservar los seis conteos, los cinco
  códigos y `failed_integrity`.
- Mutante nuevo **M0M440**: colapsa `execution_incomplete` en una causa
  incorrecta y debe morir por IR299.
- Totales locales: capture **778/778**, mutaciones **439/439**.

## 3. Validación local de este sello

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| capture | **778/778** |
| mutaciones M0 | **439/439**, exit 0 |
| build con red, `.next` reconstruido | **36/36 páginas**, exit 0 |
| sintaxis de ambos E2E | limpia |
| `git diff --check` | limpio |

Incidente operativo declarado: la primera invocación local del mutation runner
fue interrumpida por la sesión de herramienta y dejó temporalmente activo
M0M93 (`receivable_repayment` contado como payday). El baseline rojo impidió
ejecutar otra batería. Se detuvo el proceso huérfano, se restauró únicamente la
línea exacta del mutante y se comprobó capture 778/778 antes de iniciar una
nueva corrida serial completa. Esa corrida terminó **439/439**, exit 0 y sin
residuo.

No se ejecutó PostgreSQL porque la 113 aún no está aplicada. No se gastó una
muestra del modelo. No se tocó la cuenta del founder ni se hizo commit, push o
deploy.

## 4. Auditoría solicitada a Claude

Orden obligatorio:

1. Verificar sello `ecc86625…3190`, 489 archivos y `git diff --check`.
2. Auditar la 113 por fuente: ownership, lease, plan version, igualdad exacta,
   las seis métricas, prioridad de las cinco causas, `failed_integrity`, owner,
   search_path y grants. Confirmar que la 112 no fue reescrita.
3. Preestado sólo lectura: 112 aplicada, 113 ausente, función todavía con el
   marcador genérico de 112.
4. Aplicar 113 sólo si 1–3 están verdes.
5. Verificar por catálogo `SECURITY DEFINER`, owner postgres,
   `public,pg_temp`, EXECUTE sólo `service_role`, y cuerpo con los cinco
   `reason_code`.
6. Ejecutar PostgreSQL **78/78 dos veces**, serial, exit 0 y residuo cero.
   Revisar expresamente:
   - M112.2: consulta legible, un manifiesto, cero challenges;
   - M112.5: `execution_incomplete`, conteos 2/2/2/1/0 y
     `failed_integrity` durable.
7. Ejecutar capture **778/778**.
8. Ejecutar mutaciones **439/439** desde baseline verde, sin otro runner vivo,
   y comprobar restauración byte a byte.
9. Ejecutar tsc, lint, build con red y `git diff --check`.
10. Verificar servidor nuevo y handshake
    `m0-agent-eval-2026-08-12-operation-manifest-m0-11a`.
11. Sólo entonces gastar **una muestra completa** del modelo: esperado 24/24.
    Primer rojo: detener, conservar operación/manifiesto/transiciones/steps y
    reportar causa tipada. No repetir sobre el mismo sello.
12. Verificar residuo por identidad y sello final idéntico. No hacer commit,
    push ni deploy durante la auditoría.

## 5. Riesgos y límites que no cambian

- M0.11B sigue pendiente: selectores de conjuntos, país/institución y
  derivaciones masivas.
- `derived` continúa fail-closed.
- La clase 552,77 sigue siendo adversarial obligatorio del modelo; no se agregó
  parsing léxico para reinterpretar el lenguaje del usuario.
- La 113 mejora diagnóstico; no amplía autoridad, no relaja un writer y no
  altera RLS, preflight, receipts, undo ni CAS financiero.
- Producción continúa en v44 hasta cerrar la auditoría y el rollout completo.

## 6. Veredicto de Codex

**Las dos causas reportadas por Claude están corregidas localmente. M0.11A
sigue abierto hasta aplicar/auditar 113, obtener PostgreSQL 78/78×2 y una única
muestra 24/24.**

