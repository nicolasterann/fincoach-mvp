> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0.11A — envelope persistido, dirección crediticia y cierre de ciclo cubierto

Fecha: 2026-08-13  
Estado: **CORREGIDO LOCALMENTE; M0.11A ABIERTO HASTA APLICAR 114, RE-AUDIT Y 24/24**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo en esta pasada: **no ejecutada (cero créditos)**

## 1. Sello entregado a Claude

Superficie ejecutable canónica:

```text
9c7cb8f8da8125c2b2b1da29150d34003a2f7d5662cb470f403b68cddcbd813d
492 archivos
```

Runtime esperado:

```text
m0-agent-eval-2026-08-13-persisted-envelope-m0-11a
```

El sello usa el comando de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`; incluye `src/`,
`supabase/sql/`, `scripts/qa/` y la configuración canónica, y excluye docs y
secretos.

## 2. Qué probó la auditoría anterior

Claude auditó el sello `632904f3…` sin editarlo. Deterministas y PostgreSQL
quedaron verdes (capture 784/784, mutaciones 460/460, PG 78/78×2, build). La
muestra real llegó a **22/24**:

- **ME16 verde:** el modelo entendió una referencia natural al conjunto y
  ejecutó cuatro pagos bajo una sola identidad durable. La tesis central del
  manifiesto ya quedó ejercitada.
- **ME17 rojo:** el plan se había persistido como válido, pero una entrega de
  confirmación lo recuperó como `persisted_plan_invalid`. Además, las cuatro
  tarjetas quedaron activas pese a estar cubiertas y con saldo vivo cero.
- **ME13 rojo:** ante «recibí 83.86 relacionados con un préstamo no registrado»,
  el modelo confundió entrada de caja con prueba de que el usuario era
  acreedor y emitió `capital_return_unrecorded` sin preguntar quién debía a
  quién.

No eran una sola causa. Esta pasada las separa y corrige en su frontera propia.

## 3. Fix 1 — persistir y recuperar el mismo envelope validado

### 3.1 Causa raíz

`agent_operations` contiene dos estados legítimos que no son la misma cosa:

1. el envelope inmutable que el planner emitió y
   `validatePlannedAgentRequest` aceptó;
2. el pending mutable que un executor/preflight puede registrar después de un
   intento.

El recovery anterior reutilizaba el plan persistido, pero lo combinaba con
`recoveredOperationClaim.missingFields`. En ME17 ese campo ya era un rechazo del
executor y se volvió a validar como si fuera una ambiguity original del modelo.
Por eso guardar era válido y recuperar no: el runtime reetiquetaba su propio
estado mecánico como salida semántica.

### 3.2 Contrato nuevo

`DurableAgentPlan.persistence_validation` es un receipt **server-owned** que se
adjunta únicamente después de que la petición completa cruzó la validación. El
modelo no puede escribirlo: el parser reconstruye el plan desde una allow-list
y el orquestador lo agrega después.

El receipt versión 1 liga mediante SHA-256 canónico:

- delivery durable exacta;
- plan validado completo;
- continuation/supersede/abandon originales;
- missing-fields y pregunta del planner;
- transición semántica original.

`recoverPersistedAgentPlanValidation` vuelve a parsear todos esos campos,
recalcula el digest y rechaza cualquier drift. Exact worker recovery reanuda el
plan y el missing contract originales; no consume el pending runtime. Tampoco
vuelve a registrar la transición semántica original bajo una delivery de retry:
esa transición ya es durable en su evento.

Compatibilidad y fail-closed:

- una fila creada antes de M0.11A, sin receipt, conserva el camino histórico;
- un receipt presente pero inválido **nunca** cae al camino legacy;
- un cambio en el plan o en el envelope rompe el digest;
- no se relaja el preflight, el manifiesto, los state witnesses ni la igualdad
  autorizado=ejecutado.

Esto no es un router ni otra autoridad semántica. Es una prueba de identidad
entre lo que el servidor validó y lo que el worker reanuda.

## 4. Fix 2 — snapshot histórico no es obligación viva

El log de ME17 mostró cuatro `close_card` correctos con:

- `debtNative=0`;
- `full_payment_due=0`;
- `statement_covered=true`.

Sin embargo, `kipu_close_debt_account_v2` todavía consideraba
`minimum_payment` y `statement_total_due` distintos de cero como deuda viva.
Esos valores se conservan intencionalmente como hechos históricos del último
corte; el pago cubre el ciclo sin borrar la foto.

La migración append-only **114 está escrita pero NO aplicada**. Reemplaza sólo
esa RPC bajo el mismo lock y ACL:

- `current_balance_original` o `current_balance_base` distintos de cero siempre
  bloquean;
- un ciclo no cubierto o `full_payment_due` vivo siempre bloquean;
- sólo una `credit_card` con `statement_covered=true` y remanente vivo cero
  puede conservar mínimo/total históricos y cerrar;
- ownership, `FOR UPDATE`, SECURITY DEFINER, owner postgres, `search_path` y
  EXECUTE sólo para service_role permanecen.

La regla no está ligada a ME17 ni a un nombre de tarjeta. Distingue estado
actual de snapshot histórico para cualquier tarjeta.

## 5. Fix 3 — caja entrante no decide quién era acreedor

ME13 era semántico, no un fallo de payload. El texto «recibí dinero relacionado
con un préstamo no registrado» sigue siendo verdadero en dos mundos:

1. el usuario había prestado y recuperó capital;
2. el usuario recibió principal y ahora debe dinero.

`loanRelationshipDirectionContractForPlanner()` publica una prueba
contrafactual general desde la misma fuente consumida por el prompt:

- dirección de caja y dirección de la relación crediticia son hechos
  independientes;
- `capital_return_unrecorded`/repayment exigen prueba de que el usuario era
  lender/acreedor;
- `borrowed` exige prueba de que el usuario recibió principal y es deudor;
- recibir dinero, mencionar un préstamo o decir «no registrado» no decide ese
  rol;
- si ambos mundos siguen siendo posibles, el modelo omite sólo esa escritura,
  declara una ambiguity y pregunta naturalmente quién debía a quién.

No se añadió regex, frase mágica, nombre, monto, contraparte ni capability
elegida por código. El modelo sigue interpretando; el servidor verifica después
el writer, la procedencia y las patas económicas de la interpretación elegida.

## 6. Cobertura nueva

### Capture

- **IR306:** attach→recover conserva el envelope exacto; mutar plan o receipt
  rompe el digest; el source wiring impide volver a consumir el pending runtime.
- **IR307:** la doctrina de préstamos es contrafactual y no contiene el monto,
  cuenta ni frase de ME13; el prompt consume esa fuente compartida.
- **IR308:** la 114 conserva lock/ACL, bloquea saldo actual/ciclo abierto y
  permite únicamente el snapshot histórico de un ciclo cubierto.

### Mutaciones

- **M0M462:** elimina el receipt server-owned → muere por IR306.
- **M0M463:** acepta drift bajo el digest viejo → muere por IR306.
- **M0M464:** vuelve a inferir relación crediticia desde dirección de caja →
  muere por IR307.
- **M0M465:** vuelve a tratar snapshot histórico cubierto como deuda viva →
  muere por IR308.

La numeración llega a M0M465 pero el inventario histórico contiene un id
ausente; el total efectivo y correcto del runner es **464/464**.

### PostgreSQL

- **M114.1:** tarjeta con ciclo cubierto, saldo vivo cero y total/mínimo
  históricos cierra sin borrar la foto.
- **M114.2:** ciclo no cubierto o saldo actual siguen rehusando el cierre.

El total esperado sube de 78 a **80**. No se declara verde hasta aplicar 114 y
ejecutarlo contra PostgreSQL real.

## 7. Validación local

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio, exit 0 |
| `npm run lint` | limpio, exit 0, cero warnings propios |
| capture | **787/787**, exit 0 |
| mutaciones M0 | **464/464**, exit 0, cero anchor miss, restauración byte a byte |
| `npm run build` | **36/36 páginas**, compilado con red |
| `git diff --check` | limpio |
| PostgreSQL | **pendiente de aplicar 114; esperado 80/80×2** |
| modelo | **no ejecutado; cero créditos** |

## 8. Auditoría solicitada a Claude

Claude debe auditar este sello sin editar código, fixtures ni aserciones:

1. Recalcular sello, conteo y `git diff --check`.
2. Verificar por fuente que el receipt sólo se adjunta después de validación,
   que el modelo no puede autorizarlo y que recovery usa el envelope attested,
   no `agent_operations.missing_fields` mutable.
3. Probar attach/recover exacto, plan mutado, envelope mutado, receipt ausente
   legacy y receipt presente inválido. Confirmar que el retry no duplica la
   transición semántica.
4. Auditar la 114 antes de aplicarla: preestado exacto, un solo reemplazo de la
   RPC, lock/ownership, estado vivo vs snapshot, owner/search_path/ACL.
5. Aplicar **114** y verificar catálogo/fidelidad. No reescribir 112/113.
6. Ejecutar tsc, lint, capture **787/787**, mutaciones **464/464**, PostgreSQL
   **80/80 dos veces**, build y diff check.
7. Probar adversariales SQL: covered+zero cierra; uncovered due, current native,
   current base y una deuda no-card con snapshot siguen bloqueando.
8. Revisar el contrato contrafactual de préstamos: no debe contener rutas por
   verbos, montos, nombres, cuentas ni transcript. La decisión semántica sigue
   en el planner.
9. Levantar servidor limpio y verificar el handshake exacto.
10. Sólo entonces gastar una única muestra completa en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs persisted-envelope-audit
```

Esperado: **24/24**, exit 0, cero FALL/BLOCKED/ABORT/residuo. Deben quedar
verdes juntos ME13, ME16 y ME17. En ME17 verificar además: una confirmación
natural autoriza el manifiesto exacto una vez, las cuatro tarjetas cierran y no
queda `persisted_plan_invalid`.

Si aparece un rojo, detener la ronda. No repetir este sello buscando verde.
Conservar diagnóstico tipado, plan persistido, receipt, pending runtime,
manifiesto y cards antes del cleanup; luego limpiar por identidad, detener el
servidor y confirmar el mismo sello final.

## 9. Veredicto de Codex

**Las causas de ME17 fueron separadas y corregidas en sus dos fronteras; ME13
recibe una regla semántica general sin hardcodear lenguaje. M0.11A sigue ABIERTO
únicamente hasta que Claude aplique/audite la 114, obtenga 80/80×2 y ejecute una
sola muestra real 24/24 sobre este sello.**

No hay commit, push ni deploy. M0.11B continúa fuera de alcance: selectores de
conjuntos y derivaciones generales se abren sólo después de cerrar A.
