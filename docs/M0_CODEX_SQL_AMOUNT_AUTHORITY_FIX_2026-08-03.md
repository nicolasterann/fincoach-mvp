> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 — relevo a Claude: autoridad SQL del monto de tarjeta (107)

Fecha: 2026-08-03  
Estado: **M0 ABIERTO** · migraciones 100–106 aplicadas · **107 preparada, no aplicada**  
Regla de costo: no ejecutar el E2E de modelo hasta que PostgreSQL dé 64/64 dos veces.

## 1. Hallazgo externo aceptado

Claude ejecutó el árbol anterior contra PostgreSQL real y obtuvo 61/62 tres
veces. `M100.1b` alteraba en +1 el pago en full resuelto por el adapter y el
preflight lo aceptaba.

La causa era exactamente ésta en la función aplicada desde la 100:

```sql
or (
  nullif(v_step.arguments->>'amount','') is not null
  and abs(plan_amount - payload_amount) > 0.005
)
```

El arreglo TypeScript anterior fue correcto al omitir `amount` cuando
`paidInFull=true`: ese número no debe venir del modelo, sino del estado vigente
de la tarjeta. Pero esa omisión apagaba la comparación de PostgreSQL. Un dato
derivado había dejado al verificador sin autoridad en vez de hacer que el
verificador lo derivara también.

Regla permanente: **un guard de dinero no se desactiva porque su insumo sea
opcional; si el dato es derivado, la frontera de autoridad lo deriva de nuevo**.

## 2. Escaneo de la clase, no sólo de M100.1b

La rama tenía dos superficies adicionales que el preflight no demostraba de
forma directa:

- `statement.expected_due`, que es la foto CAS que recibe el writer atómico;
- `statement.paid_in_card_currency`, que debe ser exactamente la pata de ledger.

Los writers históricos vuelven a validar parte de esto al aplicar, pero M0
declara que el payload resuelto queda probado **antes** de entrar al coordinador
atómico. Dejar esos dos campos fuera habría cerrado el fixture y no la clase.

También encontré una divergencia entre callers TypeScript: cuatro rutas pasaban
`fullPaymentDueOriginal ?? fullPaymentDue`, mientras la derivación de
`paidInFull` acepta correctamente `statementTotalDue` como fallback nativo. Un
estado con total probado pero remanente nulo podía derivar el monto y luego caer
por error al ledger plano, dejando el estado sin CAS.

## 3. Migración 107 preparada (append-only)

Archivo:
`supabase/sql/107_m0_card_payment_preflight_derives_live_amount.sql`

No reescribe la 100 ni la 106. Crea el helper privado:

```text
kipu__agent_card_payment_payload_matches(uuid,jsonb,jsonb,text)
```

Contrato:

1. valida formas JSON antes de castear;
2. liga `debt_account_id` a una tarjeta del mismo usuario;
3. toma `FOR UPDATE` sobre la tarjeta;
4. deriva el corte vivo como:
   - `0` si `statement_covered=true`;
   - de otro modo `coalesce(full_payment_due, statement_total_due)`;
5. con `paidInFull=true`, el esperado es el corte vivo y el `amount` opcional
   del plan nunca tiene autoridad;
6. con pago parcial, el esperado sigue siendo el `amount` persistido y positivo;
7. exige igualdad entre ese esperado y `entry.original_amount`;
8. si hay corte positivo, exige la ruta `card_payment`; si no lo hay, exige la
   ruta `ledger_entry`;
9. en ruta atómica, prueba `statement.expected_due == corte vivo` y
   `statement.paid_in_card_currency == entry.original_amount`;
10. devuelve sólo boolean; cualquier forma inválida rehúsa.

El helper es `VOLATILE`, `SECURITY INVOKER`, owner `postgres`, con EXECUTE
revocado a `public`, `anon`, `authenticated` y `service_role`. Sólo lo consume
la función `SECURITY DEFINER` de preflight, cuyo owner es postgres. No abre una
RPC nueva.

La 107 modifica el cuerpo vivo de
`kipu_preflight_agent_operation_step(jsonb)` con un único ancla. Es idempotente:

- estado sano previo: 0 llamadas al helper y exactamente 1 guard opcional viejo;
- estado sano posterior: exactamente 1 llamada y 0 anclas viejas;
- cualquier estado parcial aborta;
- después repone owner/ACL del preflight.

En la fuente de la 100 el ancla vieja cuenta exactamente una vez. La 106 sólo
modificó las once comparaciones de `entity_ref`, no este bloque; Claude debe
confirmar el conteo contra `pg_get_functiondef` vivo antes de aplicar.

## 4. Callers TypeScript alineados

En `src/lib/ai/agent/kipu-agent-tools.ts`, las cuatro invocaciones relevantes a
`planCardPaymentStatement` usan ahora:

```ts
fullPaymentDue: cardNativeStatementExpected(card, ctx.baseCurrency)
```

Cubre:

- `log_movement` individual;
- barrido del batch;
- reemplazo dentro de una corrección atómica;
- `register_card_payment` agrupado.

El capture ejecuta el caso que faltaba: `fullPaymentDueOriginal=null`, sin
`fullPaymentDue`, `statementTotalDue=50.60`. El resultado debe seguir siendo
`card_payment`, con `expected_due=50.60` y
`paid_in_card_currency=50.60`; nunca `ledger_entry` plano.

## 5. PostgreSQL E2E reforzado: 62 → 64

`scripts/qa/telegram-agent-100-e2e.mjs` conserva el fixture real:

- el plan de Diners lleva `paidInFull:true` y **no** lleva `amount`;
- el adapter deriva 50.60 desde la tarjeta.

Antes de aceptar el payload sano ejecuta ahora tres falsificaciones separadas:

- **M100.1b:** `entry.original_amount + 1` → debe rehusar;
- **M100.1ba:** `statement.expected_due + 1` → debe rehusar;
- **M100.1bb:** `statement.paid_in_card_currency + 1` → debe rehusar.

Después preflightea y aplica el mismo payload legítimo. `EXPECTED` sube a 64;
la cobertura incompleta sigue siendo exit 1.

## 6. Redes deterministas

Capture nuevo: **IR258**. Prueba:

- derivación live bajo lock;
- rama full vs parcial;
- consumo de la comparación, no sólo presencia;
- ruta atómica obligatoria con corte vivo;
- ligadura de los dos campos statement;
- ancla/idempotencia/ACL de la 107;
- cuatro callers compartiendo la expectativa;
- fallback conductual desde `statementTotalDue`;
- presencia de las dos falsificaciones nuevas y `EXPECTED=64`.

Mutaciones nuevas, todas muerden IR258:

- **M0M246:** el full vuelve a confiar en el monto opcional del plan;
- **M0M247:** la llamada al helper queda escrita pero neutralizada;
- **M0M248:** el adapter agrupado pierde el fallback al total del estado;
- **M0M249:** el statement puede declarar un pago distinto de la pata ledger;
- **M0M250:** el E2E olvida las dos nuevas falsificaciones.

Además se actualizó M0M233 al handshake v10; la primera corrida completa detectó
esa ancla vieja y se corrigió antes de certificar el runner final.

## 7. Evidencia local certificada

| Comprobación | Resultado |
|---|---:|
| Capture gate sin servidor | **737/737** |
| Mutaciones M0 | **250/250**, exit 0, residuo cero |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |
| sintaxis E2E/mutaciones | limpia |
| ancla vieja en la fuente 100 | **1** |
| modelo real | **no ejecutado; cero gasto API** |

`npm run build` llegó al compilador y falló sólo porque el sandbox no pudo
descargar Geist/Geist Mono desde Google Fonts. La ejecución con red escalada fue
denegada. Claude debe certificar el build con red; no se presenta como verde.

Codex no aplicó la 107 ni ejecutó el E2E PostgreSQL: esa aplicación y las sondas
contra la función viva corresponden a Claude, como acordó el founder.

## 8. Secuencia exacta pedida a Claude

Detenerse en el primer rojo y **no llamar al modelo** antes del punto 8.

1. Leer este informe y el diff de 107/IR258/M100.1b–bb.
2. Antes de aplicar, consultar la función viva y comprobar:
   - once llamadas de `kipu__agent_effect_ref_matches` de la 106 intactas;
   - cero llamadas al helper 107;
   - exactamente un ancla del guard opcional viejo;
   - helper 107 ausente.
3. Auditar especialmente si el `FOR UPDATE` del helper conserva el orden de
   locks operación → step → tarjeta y si `SECURITY INVOKER` privado es correcto
   al ser llamado desde el preflight DEFINER.
4. Aplicar **107** sin modificar 100–106.
5. Verificar por catálogo:
   - helper `VOLATILE`, invoker, owner postgres, search_path fijo;
   - cero EXECUTE externo, incluido service_role;
   - preflight DEFINER, owner postgres, EXECUTE sólo service_role;
   - once comparaciones tipadas de 106 intactas;
   - una llamada al helper 107 y cero guard opcional viejo.
6. Reaplicar 107 dentro de una transacción revertida y comprobar no-op real.
7. Ejecutar PostgreSQL E2E **64/64 dos veces**, exit 0, sin ABORT, cobertura
   incompleta, residuo, limpieza ilegible ni FALL. Inspeccionar por nombre
   M100.1b, M100.1ba y M100.1bb y confirmar datos del founder intactos.
8. Ejecutar capture **737/737**, mutaciones **250/250**, tsc, lint,
   `git diff --check` y build con red.
9. Borrar `.next`, levantar runtime y exigir handshake exacto:
   `m0-agent-eval-2026-08-03-card-preflight-v10`.
10. Sólo entonces gastar **una** corrida del modelo. Si no da 22/22, detenerse
    con el primer rojo y conservar el log. Si da 22/22, ejecutar las cuatro de
    estabilidad y luego la ronda externa final sobre árbol congelado.

## Veredicto de Codex

El P1 reportado por Claude está corregido en código y cubierto como clase, no
como una excepción para Diners. La corrección no está aún probada contra la
función PostgreSQL viva porque la 107 no está aplicada. **M0 sigue abierto** y
no debe consumir otra muestra del modelo hasta que Claude certifique 64/64×2.
