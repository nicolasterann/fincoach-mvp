# Informe para auditoría externa — M0, tarjeta/calendario y reloj durable

Fecha: 2026-08-03  
Estado: **código corregido y falsificado localmente; M0 sigue abierto**.  
Migraciones: 100–104 aplicadas; **105 preparada, NO aplicada**.  
Commit/deploy: ninguno en esta pasada.

## Resumen ejecutivo

La corrida limpia de Claude fue decisiva: la doble serialización monetaria ya
estaba corregida, pero ME2 seguía bloqueado por calendario y tres garantías de
continuidad PostgreSQL habían pasado de 62/62 a 59/62.

No eran un solo problema:

1. La respuesta de Diners intentaba fundamentar el corte vigente desde una
   ocurrencia ya satisfecha. Esa ocurrencia deja de aparecer entre los avisos
   abiertos por diseño, y el snapshot financiero estructurado de la tarjeta no
   llevaba el corte actual, el monto del estado ni sus fechas.
2. El parser calendario infería el rol de una fecha desde todo el objeto JSON.
   `dueDay` y `cutoffDay` conviven en la misma línea compacta; una fecha podía
   heredar el rol de su vecina.
3. Dos defectos de tokenización adicionales aparecieron al refutar el fix: un
   día de dos dígitos se volvía a leer por su primer dígito, y la cola `07-06`
   de un ISO `2026-07-06` se aceptaba como una segunda fecha invertida.
4. Las lecturas de operaciones usaban el reloj del proceso web como límite
   superior para timestamps escritos por PostgreSQL. Si el host iba apenas
   atrasado, una fila ya confirmada desaparecía. Eso explica exactamente los
   tres rojos: autoridad de aclaraciones, continuidad multiversión/undo y
   búsqueda semántica de una operación antigua.

## Fix 1 — el ciclo vigente de tarjeta es contexto financiero, no memoria

`buildAgentContextDataMessage` ahora incluye, por cada tarjeta/deuda:

- `fullPaymentDueNative`;
- `statementTotalDueNative`;
- `statementCovered`;
- `dueDay` y `cutoffDay`;
- `statementDate`, `statementPeriodEnd` y `lastPaymentDate`.

Se conserva la semántica nativa: `fullPaymentDueOriginal` tiene precedencia y
no se presenta un monto convertido como si fuera el estado nativo. Una
ocurrencia cerrada puede desaparecer del calendario abierto sin borrar el hecho
financiero actual de la tarjeta.

`evidenceMoneyClaimDetails` reconoce las nuevas claves sólo dentro de evidencia
determinista. El test usa intencionalmente deuda `88` y corte `50,60`: si el
grounding volviera a leer el balance en lugar del corte, falla.

## Fix 2 — calendario tipado por entidad y rol

`calendarClaimDetails` dejó de inferir `due`/`cutoff` desde el objeto completo:

- `dueDay` y `cutoffDay` asignan su rol por la clave tipada;
- claves ISO `dueDate`, `cutoffDate`, `statementDate`,
  `statementPeriodEnd`, `lastPaymentDate`, etc. asignan el rol desde la clave
  inmediata;
- el objeto que contiene la fecha todavía debe contener la misma entidad que
  nombra la respuesta.

Las pruebas demuestran simultáneamente:

- Diners `50,60`, vence el 3: publicable;
- Visa no puede tomar monto ni vencimiento de Diners;
- `statementDate=2026-07-16` fundamenta “corta el 16”, pero **no** “vence el
  16”;
- una fecha ISO de Visa no se invierte para fabricar “corta el 7 de junio”.

## Fix 3 — dos defectos de parsing encontrados en la autoauditoría

### Día de dos dígitos

El regex de frases como “vence el 16” podía capturar sólo `1`, porque no exigía
el fin del token numérico. Una respuesta correcta generaba dos claims (`16` y
`1`) y el segundo hacía fallar toda la publicación. Se añadió `(?!\d)`.

### Cola de una fecha ISO

El parser `DD-MM` encontraba `07-06` dentro de `2026-07-06` y lo añadía como
7 de junio. Se excluye explícitamente una coincidencia precedida por
`YYYY-`. El ISO completo continúa parseándose normalmente.

## Fix 4 — las operaciones se leen con el reloj que escribe sus timestamps

La causa de 59/62 estaba en `agent-operation-store.ts`:

```ts
const asOf = new Date().toISOString();
```

Ese valor delimitaba `updated_at`, `completed_at` y `expires_at`, columnas que
PostgreSQL escribe. Un reloj de aplicación 24 h atrasado —ahora reproducido por
el E2E— ocultaba filas que ya habían aterrizado.

La migración 105 crea:

```sql
public.kipu_agent_read_clock() returns timestamptz
```

Contrato:

- `SECURITY DEFINER`, owner `postgres`, `search_path` fijo;
- `EXECUTE` sólo para `service_role`;
- devuelve `statement_timestamp()`;
- re-aplicación idempotente por `create or replace` + ACL declarativa.

Ambas lecturas (`readOpenAgentOperations` y
`searchCompletedAgentOperations`) toman primero ese reloj y conservan el
snapshot. Si la RPC no se puede leer, devuelven `ok:false, complete:false`; una
lectura caída nunca se vuelve ausencia.

El string de PostgreSQL se valida, pero **no** se normaliza con
`toISOString()`: eso truncaría microsegundos y podría mover el límite hacia
atrás otra vez.

## Cobertura nueva

El capture gate queda en **732/732**. IR113b ahora recorre el builder real y
las barreras reales; IR217 fija el reloj DB, su consumo, fail-closed, ACL y los
dos escenarios con reloj del proceso atrasado.

La autoauditoría añadió una frontera más: notas, nombres y memoria del usuario
viven dentro del snapshot para que el modelo razone, pero no son hechos
deterministas. El grounding lexical ahora enmascara el tag estructurado completo
(usando el último cierre, para resistir un cierre inyectado) y sólo acepta allí
claves tipadas. Los avisos abiertos dejan de entrar como un blob de prosa:
`readOpenOccurrenceFactsForAgent` proyecta hechos por ocurrencia con nombre,
kind, estado, monto y `dueDate`/`cutoffDate`/`occurrenceDate` tipados. Así dos
entidades no comparten una misma ventana de evidencia.

Mutaciones M0: **228/228**, residuo cero. Las nuevas M216–M228 prueban:

- rol de `dueDay`;
- los dos consumidores del reloj DB;
- preservación de microsegundos;
- ACL sin `authenticated`;
- que el E2E realmente atrasa el reloj del proceso;
- rol de `statementDate`;
- día de dos dígitos completo;
- no reinterpretar la cola de un ISO;
- que prosa del usuario no se vuelva evidencia de dinero/calendario;
- consumo de hechos calendario tipados;
- que un cierre de tag inyectado no escape el enmascarado.

El PostgreSQL E2E ahora ejecuta M100.8ab y M100.20 con `Date` del proceso
atrasado 24 horas. Sin la 105 debe reproducir la regresión; con la 105 debe
volver a 62/62 sin depender del reloj del host.

El contrato del runtime sube a:

```text
m0-agent-eval-2026-08-03-trusted-structured-evidence-v5
```

Un servidor compilado anterior no puede certificar este árbol.

## Batería local ejecutada

| Suite | Resultado |
|---|---:|
| Capture | **732/732** |
| Mutaciones M0 | **228/228** |
| Mutaciones K | **280/280** |
| Mutaciones L refund | **24/24** |
| Mutaciones Pre-M | **28/28** |
| Loop / wizard | **22/22 · 161/161** |
| J-2 / J-3 / J-4 | **17/17 · 21/21 · 18/18** |
| `tsc --noEmit` | limpio |
| lint | limpio |
| `git diff --check` | limpio |
| sintaxis de los dos E2E M0 | limpia |

No pude abrir un puerto local en este sandbox, por lo que no afirmo haber
ejecutado el E2E de modelo. Tampoco apliqué la 105 ni ejecuté el E2E PostgreSQL
contra una función que todavía no existe. El build con red debe volver a ser
certificado por el auditor; la última certificación externa correspondía al
árbol v3 anterior.

## Instrucciones exactas para Claude

1. Auditar los diffs de:
   - `src/lib/ai/agent/kipu-agent.ts`;
   - `src/lib/ai/agent/agent-operation-store.ts`;
   - `src/lib/financial/recurring-resolve.ts`;
   - `src/app/dev/capture-test/page.tsx`;
   - `scripts/qa/telegram-agent-100-e2e.mjs`;
   - `scripts/qa/telegram-agent-regression-audit.mjs`;
   - `src/lib/ai/agent/m0-eval-contract.ts`;
   - `supabase/sql/105_m0_database_clock_for_operation_reads.sql`.
2. Confirmar preestado: la 105 no está aplicada y la función no existe todavía.
3. Aplicar **105**, sin reescribir 100–104.
4. Verificar por catálogo: firma, `SECURITY DEFINER`, owner, `search_path`,
   volatilidad `STABLE`, grants sólo a `service_role` y cero ejecución para
   `anon/authenticated`.
5. Reaplicar la 105 dentro de una transacción revertida y comprobar que cuerpo
   y ACL no divergen.
6. Ejecutar `telegram-agent-100-e2e.mjs` **dos veces**: debe dar **62/62**, exit
   0, cobertura completa y residuo cero. No quitar el desfase artificial de
   24 h: es el control positivo que prueba el fix.
7. Borrar `.next`, correr capture **732/732**, arrancar un servidor limpio y
   exigir en `/dev/m0-agent-eval` el contrato v5 exacto.
8. Ejecutar el modelo real **22/22 cinco veces**. ME2 debe publicar la respuesta
   de Diners sin `money_not_grounded` ni `calendar_fact_not_grounded`; los otros
   21 checks deben ejecutarse, no quedar ocultos detrás de ME2.
9. Repetir mutaciones **228/228**, build con red, `tsc`, lint y diff-check.
10. Hacer la ronda congelada final sobre el árbol sin modificar. Sólo entonces
    evaluar cierre, commit y deploy.

## Veredicto de esta pasada

Los defectos conocidos de esta ronda están corregidos en código y falsificados
localmente. **M0 no está cerrado todavía**: faltan aplicar/probar la 105, recuperar
62/62 en PostgreSQL y obtener 22/22 ×5 con el modelo real sobre el runtime v5.
