> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — M0: `paidInFull` agrupado no puede exigir `amount`

Fecha: 2026-08-03  
Estado: **fix TypeScript listo; sin migración nueva; M0 todavía abierto**

## Veredicto sobre la corrida 12/22

El primer rojo, ME4, es un defecto real y determinista. Los rojos posteriores
son una cascada del estado económico que ME4 no llegó a construir; no deben
contarse como diez causas independientes.

El modelo hizo lo correcto:

- recuperó el corte vigente de Diners NT por 50,60;
- declaró `paidInFull: true` sin inventar ni copiar un `amount`;
- dejó los tres pagos en un grupo distinto de la devolución ambigua;
- después de la aclaración volvió a citar el mismo hecho almacenado.

La falla estaba en el adapter agrupado, no en el planner ni en la recuperación.

## Causa exacta

`prepareAtomicAgentAction` calculaba al inicio:

```ts
const amount = Number(args.amount);
```

Después de resolver `undo_agent_operation` y `log_movement`, ejecutaba este
guard común antes de llegar a `register_card_payment`:

```ts
if (!Number.isFinite(amount) || amount <= 0) {
  return { ok: false, summary: "Falta un monto positivo y exacto..." };
}
```

Eso contradice el contrato público y el writer individual:

- `paidInFull=true` significa que el modelo **no debe proponer un monto**;
- `resolvedCardPaymentAmount` debe derivarlo de
  `cardNativeStatementExpected`;
- el log muestra que el contexto sí llevaba
  `fullPaymentDueNative=50.6` y `statementTotalDueNative=50.6`.

Por tanto, `Number(undefined)` producía `NaN` y el grupo moría antes de entrar a
la rama que ya sabía derivar 50,60. El resultado user-facing preguntaba un dato
que Kipu tenía y retenía los otros dos pagos dentro del grupo fallido.

Es la misma clase que las rondas anteriores: writer y caller correctos vistos
por separado, frontera muerta al ejecutar la forma real.

## Correcciones implementadas

### 1. El guard explícito vive sólo donde el monto es user-stated

Archivo: `src/lib/ai/agent/kipu-agent-tools.ts`

El chequeo `amount > 0` se movió dentro de
`record_person_payment`. Esa capacidad siempre representa un monto dicho por el
usuario y debe seguir fallando cerrada si falta.

`register_card_payment` llega ahora a su contrato propio:

```ts
resolvedCardPaymentAmount({
  paidInFull,
  proposedAmount: args.amount,
  statementExpected: cardNativeStatementExpected(card, ctx.baseCurrency),
})
```

Consecuencias:

- pago parcial: exige `amount` explícito;
- pago full: deriva el remanente vigente probado;
- sin corte/remanente probado: pregunta, no inventa;
- entrada entre personas sin monto: sigue preguntando;
- ninguna rama recibe un default numérico.

### 2. El E2E PostgreSQL dejó de ocultar el bug

Archivo: `scripts/qa/telegram-agent-100-e2e.mjs`

El fixture de tres pagos antes enviaba simultáneamente:

```js
amount: Number(card.full_payment_due), paidInFull: true
```

Eso no es lo que debe producir el modelo y volvía imposible detectar el guard
prematuro. Ahora:

- la primera tarjeta manda sólo `paidInFull: true`;
- las otras dos mandan sus montos explícitos.

La aserción existente que exige que las cuatro patas del caso founder se
preparen obliga ahora al adapter real a derivar el corte.

### 3. Cobertura conductual IR257

El capture gate llama directamente `prepareAtomicAgentAction` con:

- Diners NT, corte 50,60, `paidInFull=true`, sin `amount`;
- una entrada `capital_return_unrecorded` sin `amount`.

Exige simultáneamente:

- el pago full se prepara y su payload lleva `original_amount=50.6`;
- la entrada user-stated se rehúsa con el dato concreto faltante;
- el E2E PostgreSQL conserva la omisión real de `amount`.

No es una prueba de que la línea exista: consume el resultado del adapter.

### 4. Tres mutaciones nuevas

- **M0M243:** repone el guard genérico antes de la rama de tarjeta;
- **M0M244:** vuelve a hardcodear el monto en el fixture PostgreSQL;
- **M0M245:** desconecta `cardNativeStatementExpected` del adapter agrupado.

Las tres mueren por IR257. Runner completo: **245/245**, exit 0, residuo cero.

### 5. Runtime v9 y documentos

El contrato de evaluación pasó a:

```text
m0-agent-eval-2026-08-03-paid-in-full-v9
```

M0M233 impide que un runtime v8 se haga pasar por este árbol. Se actualizaron
AGENTS, CLAUDE, ROADMAP y README: migraciones 100–106 aplicadas, próxima 107,
capture 736/736, mutaciones 245/245 y M0 todavía abierto.

La cabecera de la 106 también refleja ahora lo que Claude certificó: aplicada
el 2026-08-03. No existe migración 107 para este fix porque es exclusivamente
TypeScript y fixture.

## Autoauditoría local

| Comprobación | Resultado |
|---|---:|
| Capture gate | **736/736** |
| Mutaciones M0 | **245/245**, exit 0, residuo cero |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |
| sintaxis de ambos runners | limpia |
| Modelo real | **no ejecutado**; cero gasto de API |

El E2E PostgreSQL no pudo ejecutarse desde Codex porque el sandbox no tiene DNS
hacia Supabase; el intento terminó antes de crear la persona (`0/0`) y no tocó
la base. La ejecución escalada también fue denegada. No se presenta ese intento
como evidencia del producto.

Claude debe volver a certificar estas comprobaciones y el build con red sobre
el árbol final; Codex no puede certificar el build porque el sandbox no puede
descargar Geist.

## Qué debe auditar Claude

Seguir el orden barato y detenerse ante el primer rojo:

1. Leer el diff de `prepareAtomicAgentAction` y confirmar que el guard fue
   **movido**, no eliminado: `record_person_payment` aún exige monto positivo.
2. Confirmar que `register_card_payment` agrupado deriva únicamente desde
   `cardNativeStatementExpected`, nunca desde saldo de cuenta ni texto del
   modelo.
3. Ejecutar el PostgreSQL E2E **62/62 dos veces**. En M100.1 comprobar que la
   primera acción no contiene `amount`, que el payload preflighted sí contiene
   50,60 y que los cuatro pasos aterrizan sin residuo.
4. Ejecutar capture **736/736** y mutaciones **245/245**.
5. Borrar `.next`, compilar con red y exigir handshake v9.
6. Ejecutar **una sola corrida** del modelo. ME4 debe dejar:
   - un ingreso de sueldo ya existente;
   - tres `debt_payment`;
   - las tres tarjetas en cero;
   - sólo la devolución de 83,86 pendiente de aclaración.
7. ME5 debe responder únicamente qué falta sin consumir trabajo; ME6 debe
   agregar el `capital_return_unrecorded`, no ingreso, y cerrar la operación.
8. Sólo si la primera corrida termina 22/22, ejecutar las otras cuatro de
   estabilidad. Si falla, detenerse y conservar estado/log; no gastar cuatro
   muestras adicionales.
9. Hacer la ronda final sobre árbol congelado y verificar cero residuo y datos
   del founder intactos.

## Sobre la sugerencia de errores tipados

El árbol actual ya separa `executionFailure` de `publicationFailure` y prioriza
el primero al persistir `last_error`. En este caso concreto no hubo intento SQL:
el adapter devolvió `needs_info` antes del preflight, por lo que
`executionFailure=null` es correcto. El error era que el adapter clasificaba
como “dato faltante” algo derivable. IR257 cierra esa causa sin relajar ninguna
barrera de publicación.

## Veredicto actual

El defecto que hizo 12/22 está corregido en la frontera exacta y cubierto con la
forma real que antes faltaba. **M0 sigue abierto** hasta que Claude certifique
PostgreSQL 62/62 ×2, una primera corrida 22/22, luego las cuatro de estabilidad
y la pasada congelada final.
