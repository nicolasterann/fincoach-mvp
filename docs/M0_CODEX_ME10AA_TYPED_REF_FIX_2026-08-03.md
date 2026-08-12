# Informe para Claude — M0 ME10aa: la corrección no era una redelivery

Fecha: 2026-08-03  
Estado: **código preparado; migración 106 NO aplicada; M0 todavía abierto**

## Resumen ejecutivo

La corrida única 21/22 fue útil, pero la hipótesis del informe anterior no se
sostiene contra el estado que dejó el propio E2E. No hubo un intento anterior
que ejecutó la corrección y después perdió su evidencia al reintentarse. La
corrección **nunca pasó el preflight**.

El modelo produjo el plan económico correcto y usó la ontología documentada:

- reversa: `entity_ref = operation:<uuid>`;
- reemplazos de caja: `entity_ref = account:<uuid>`.

La función aplicada desde la migración 100,
`kipu_preflight_agent_operation_step(jsonb)`, compara las referencias de las
patas del ledger únicamente contra el UUID desnudo. Por eso el undo llegaba al
preflight, pero el primer reemplazo moría al comparar:

```text
account:<uuid> != <uuid>
```

El error posterior `money_not_grounded` era secundario: la barrera de
publicación estaba narrando un grupo que no había escrito. La frontera rota era
planner → preflight SQL, no receipts → redelivery.

## Evidencia que refuta la hipótesis de redelivery

En `/tmp/single.log`, el resultado de ME10aa muestra:

- la operación de corrección en `failed_retriable`, no `completed`;
- `afterReplacedPair.account = 1545.89`, exactamente 30 menos que el baseline
  previo: siguen activos los gastos originales de 10 + 20;
- las dos transacciones originales siguen presentes;
- `originalPairRows = null` y `replacementMarker = null`;
- las dos operaciones `completed` que aparecen al lado son las lecturas
  artificiales `archivo 19` y `archivo 20`, no intentos previos de corregir.

La planilla del modelo sí era correcta: undo de la operación durable seguido de
dos `log_movement` por 12 y 19 dentro del mismo grupo atómico. La base rechazó
la representación tipada de la cuenta antes de mover dinero.

## Correcciones implementadas

### 1. Migración append-only 106

Archivo:
`supabase/sql/106_m0_typed_effect_entity_refs.sql`

No se reescribió la 100 aplicada. La 106 crea el helper interno:

```sql
kipu__agent_effect_ref_matches(ref, kind, id)
```

Contrato:

- acepta el UUID desnudo por compatibilidad con planes históricos;
- acepta la forma canónica exacta `kind:<uuid>`;
- sólo admite los kinds económicos que el preflight genérico resuelve:
  `account`, `debt_account`, `goal`;
- rechaza tipos cruzados aunque compartan UUID;
- no usa comparación por suffix, por lo que una etiqueta arbitraria terminada
  en el UUID no obtiene autoridad;
- es `IMMUTABLE`, `SECURITY INVOKER`, con `search_path` fijado;
- no tiene `EXECUTE` para `public`, `anon`, `authenticated` ni `service_role`;
  la consume internamente la función definer propiedad de `postgres`.

La migración deriva el cuerpo vivo de
`kipu_preflight_agent_operation_step(jsonb)` y sustituye exactamente:

- 4 comparaciones de cuenta origen;
- 3 de cuenta destino;
- 3 de deuda;
- 1 de meta.

Total: 11 llamadas tipadas. Aborta si el preestado no es exactamente 4/3/3/1,
si detecta un estado parcial o si la sustitución no aterriza completa. Una
reaplicación con las 11 llamadas presentes es no-op. La función pública de
preflight conserva owner y ACL: sólo `service_role` puede ejecutarla.

### 2. Gramática explícita en el planner

Archivo: `src/lib/ai/agent/agent-planner.ts`

El contrato ahora documenta las referencias canónicas:

```text
account:<uuid>
debt_account:<uuid>
goal:<uuid>
receivable:<uuid>
operation:<uuid>
```

El prefijo debe coincidir con el recurso y con los argumentos resueltos; no es
una etiqueta libre inventada por el modelo.

### 3. El E2E PostgreSQL usa la forma que emitió el modelo real

Archivo: `scripts/qa/telegram-agent-100-e2e.mjs`

Los dos escenarios de corrección de operación ya no pasan un UUID desnudo como
fixture de caja. Pasan literalmente `account:${account.id}`. Así el 62/62 no
puede volver a certificar la frontera equivocada. La suite debe ejecutarse sólo
después de aplicar la 106.

### 4. Gate y mutaciones

`IR256` fija la clase completa, no una línea aislada:

- helper estricto;
- kinds permitidos;
- preestado 4/3/3/1;
- 11 sustituciones completas;
- ACL interna;
- fixture tipado consumido por el E2E;
- gramática entregada al planner;
- prohibición de suffix matching.

Se usó `IR256` porque `IR220` e `IR221` ya pertenecían a reglas anteriores;
dejar el nombre duplicado habría hecho ambiguo qué red mató una mutación.

Mutaciones nuevas:

- **M0M240** elimina la aceptación tipada;
- **M0M241** vuelve el fixture del E2E al UUID desnudo;
- **M0M242** compara una cuenta origen como si fuera una deuda.

Las tres mueren por `IR256`. El runner completo queda en **242/242**, sin
residuo.

### 5. Handshake del runtime

`M0_EVAL_CONTRACT_VERSION` pasó a:

```text
m0-agent-eval-2026-08-03-typed-effect-refs-v8
```

Esto evita volver a medir una compilación anterior como si contuviera la 106 y
el contrato nuevo. M0M233 fue actualizado para matar un runtime v7.

### 6. Corrección documental menor

La cabecera de la migración 105 todavía decía `PREPARED, NOT APPLIED` aunque la
auditoría externa ya confirmó que está aplicada y que PostgreSQL volvió a
62/62. Se corrigió únicamente esa cabecera histórica.

## Autoauditoría local

Ejecutado sin llamadas al modelo y, por tanto, sin gasto de API:

| Comprobación | Resultado |
|---|---:|
| Capture gate | **735/735** |
| Mutaciones M0 | **242/242**, exit 0, residuo cero |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |
| sintaxis de ambos runners | limpia |

`npm run build` alcanzó Next/Turbopack pero el sandbox no pudo descargar Geist
desde Google Fonts. No se presenta como build verde: Claude debe repetirlo con
red, como en las rondas anteriores.

No ejecuté el E2E PostgreSQL porque la 106 aún no está aplicada y el fixture
ahora exige deliberadamente esa frontera. No ejecuté el E2E del modelo: hacerlo
antes de probar la base sólo quemaría créditos repitiendo un fallo conocido.

## Auditoría solicitada a Claude

Seguir este orden; no empezar con cinco corridas del modelo.

1. **Auditar el preestado vivo antes de aplicar 106.** Confirmar cero llamadas
   al helper nuevo y anchors exactos 4/3/3/1. Confirmar que no hay estado parcial.
2. **Aplicar 106** sin editar la 100.
3. **Verificar por catálogo y cuerpo vivo:** helper owner `postgres`,
   `IMMUTABLE`, `SECURITY INVOKER`, `search_path` fijado, sin EXECUTE externo;
   preflight con 11 llamadas al helper, cero comparaciones antiguas, owner y ACL
   intactos.
4. **Probar idempotencia** en transacción revertida y tres comportamientos:
   UUID desnudo acepta; `account:<mismo uuid>` acepta; tipo incompatible
   rechaza.
5. **Ejecutar PostgreSQL 62/62 dos veces**, exit 0, sin residuo. Revisar en
   especial la corrección y la corrección-de-corrección con refs tipados.
6. Limpiar `.next`, compilar con red, levantar runtime y exigir handshake v8.
7. Ejecutar **una sola** corrida del E2E de modelo. Debe dar 22/22 y ME10aa debe
   demostrar económicamente: operación previa revertida, movimientos nuevos 12
   y 19, delta neto final -31 desde el estado anterior al original y marcador
   durable único.
8. Sólo si esa primera corrida da 22/22, ejecutar las otras cuatro corridas de
   estabilidad. Si falla, detenerse y reportar el primer defecto con su estado
   económico; no gastar cuatro muestras adicionales.
9. Repetir capture, mutaciones, build y revisión de residuo sobre el árbol
   congelado.

## Veredicto actual

La única falla observada de la corrida 21/22 tiene una causa determinista,
reproducible y corregida por una migración append-only con cobertura de ambos
lados de la frontera. **M0 todavía no se declara cerrado**: falta que Claude
audite/aplique la 106, certifique PostgreSQL 62/62 ×2, luego modelo 22/22 ×5 y
haga la ronda congelada final.

La secuencia anterior limita el gasto: una sola muestra del modelo antes de
autorizar las cuatro de estabilidad.
