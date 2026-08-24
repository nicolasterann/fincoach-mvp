> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 v20 — evidencia de publicación y undo económico

Fecha: 2026-08-08  
Estado: **implementado localmente; migración 108 PREPARADA, NO APLICADA; M0 sigue ABIERTO**  
Contrato de runtime: `m0-agent-eval-2026-08-08-economic-receipts-v20`

## Contexto de esta vuelta

La auditoría externa v19 llegó a 20/22. ME10b quedó cerrado. ME9 rechazó de
forma segura el undo completo y ME10 cayó por cascada. PostgreSQL devolvió:

`KIPU_NEEDS_INFO: target operation contains a write without a reversible transaction receipt`

En paralelo, Claude construyó quince respuestas adversariales sobre la barrera
de publicación y cinco escaparon con `wrote=false`:

- `Perfecto, guardado.`
- `Listo: registrado.`
- `Listo, ya está guardado.`
- `La devolución ya está registrada.`
- `Listo, ya quedó.`

No ejecuté el modelo real en esta vuelta. El presupuesto sólo debe gastarse
después de instalar y verificar la frontera PostgreSQL.

## Hallazgo 1 — ME9 no era una pérdida demostrada del receipt de tarjeta

Audité ambas rutas de persistencia:

- ejecución individual: `agentForwardLedgerReceiptIsComplete` impide que los
  siete writers forward terminen con un write sin `transaction`;
- ejecución atómica: `kipu_apply_operation` persiste directamente refs de
  transacción para `ledger_entry`, `card_payment`, `repayment`,
  `debt_proceeds` y `operation_reversal`;
- el E2E PostgreSQL existente ya prueba que una continuación multivuelta
  conserva y revierte recibos de versiones anteriores.

La contradicción estaba en la propia función SQL de undo. Su comentario exige
receipt a cada *money-writing step*, pero el predicado real contaba cualquier
`execution_effect='write'`. `remember_fact` y otros writes de
memoria/configuración son writes durables legítimos sin fila de ledger. Si el
planner añadía uno junto a los cuatro movimientos, el undo declaraba toda la
operación irreversible. Si no lo añadía, pasaba. Esto explica la oscilación de
ME9 entre muestras sin atribuírsela a un UUID o a una frase.

### Fix — migración 108 append-only

Archivo: `supabase/sql/108_m0_operation_undo_uses_economic_effects.sql`.

La 108 crea dos helpers privados:

1. `kipu__agent_step_is_reversible_money_write(result,effects)`
   - exige `execution_effect='write'`;
   - deriva la naturaleza monetaria de la ontología financiera persistida en
     `agent_operation_steps.effects`;
   - reconoce las clasificaciones algebraicas que el planner ya valida y sólo
     las superficies financieras;
   - no enumera frases ni decide por el nombre del tool.
2. `kipu__agent_operation_receipt_gaps(operation,exclude_reversal)`
   - devuelve internamente los `step_key[capability]` económicos que carecen de
     transaction ref;
   - mejora el diagnóstico sin cambiar el mensaje humano ni aflojar el rechazo.

La migración deriva el cuerpo vivo de `kipu_reverse_agent_operation` y reemplaza
exactamente tres predicados. Tiene guard de preestado, detección de estado
parcial, verificación de tres marcadores y reaplicación no-op. Los helpers son
owner `postgres` y no otorgan EXECUTE a roles externos.

### Cobertura ejecutable nueva

`scripts/qa/telegram-agent-100-e2e.mjs` conserva el caso multivuelta y añade dos
mitades dentro de PostgreSQL real:

- plan v2 con dos transacciones financieras más un `remember_fact` verificado,
  `execution_effect='write'` y cero transaction refs: el undo debe restaurar
  exactamente las dos transacciones y no bloquearse por memoria;
- operación corrupta con efectos `expense` y write sin transaction ref: el
  undo completo debe seguir rehusándose como `unsafe`.

El EXPECTED pasa de 64 a **65**. Esta batería no puede certificar verde hasta
que Claude aplique 108.

## Hallazgo 2 — la barrera de publicación confundía puntuación y sujeto

Había dos defectos diferentes:

1. el recibo autónomo sólo se reconocía al inicio o después de `.!?`; coma y
   dos puntos después de `Listo/Perfecto` abrían una salida;
2. `estar + participio` no puede decidirse sólo por gramática: `el préstamo está
   registrado` y `la devolución está registrada` comparten forma, pero el
   primero puede describir una entidad previa y el segundo puede fingir que
   Kipu acaba de registrar un evento.

### Fix de publicación

En `src/lib/ai/agent/kipu-agent.ts`:

- `PREFIXED_MUTATION_RECEIPT` reconoce únicamente prefijos de éxito estrechos
  seguidos por coma/dos puntos y un resultado real; no convierte
  `Listo: para confirmar...` en éxito;
- `PASSIVE_MUTATION_STATE` detecta el estado pasivo;
- `passiveMutationStateIsGrounded` permite historia sólo si la misma cláusula
  contiene el nombre de una entidad retornada por evidencia estructurada
  verificada;
- `mutationClaimNeedsActionReceipt` es el veredicto único consumido tanto por
  la publicación como por la selección de evidencia del grounding monetario.

Consecuencia deliberada: un genérico `La devolución ya está registrada` no se
publica sin receipt. Un estado concreto como `Diners NT ya está registrada`
puede publicarse si `Diners NT` existe como nombre estructurado en la lectura
verificada. No se intentó separar la clase con una lista de sustantivos.

IR266 prueba las cinco fugas exactas, los negativos `listo para confirmar` y
subjuntivos, y el positivo histórico ligado a entidad. La reauditoría local
estrechó además `Listo, ya quedó`: `quedó` sólo cuenta como recibo terminal,
no dentro de conversación normal como `ya quedó claro` o `ya quedó pendiente`.
M0M315 y M0M316 matan el prefijo y el binding pasivo por nombre.

El mismo barrido encontró dos checks PostgreSQL llamados `M100.8c`. El check
económico conserva ese nombre —es el que debe auditarse junto a 108— y el check
independiente de caducidad ahora se llama `M100.8g`; así un rojo vuelve a
identificar una sola garantía.

## Mutaciones y gates

Resultado local, sin modelo y sin tocar PostgreSQL:

- capture: **745/745**;
- mutaciones M0: **319/319**, serial, restauración byte-for-byte;
- `npx tsc --noEmit`: limpio;
- `npm run lint`: limpio;
- `npm run build` con red: compilación exitosa, 36/36 páginas;
- `node --check` de ambos runners: limpio;
- `git diff --check`: limpio;
- conteo de preestado local de la función 100: tres predicados viejos y un
  error viejo, exactamente lo que 108 exige antes de sustituir.

No corrí PostgreSQL, porque 108 no está aplicada. No corrí ninguna muestra del
modelo.

## Secuencia exacta para Claude

### 1. Auditar la 108 antes de aplicar

Contra la función viva:

- helper nuevo ausente;
- exactamente 3 apariciones de
  `s.result->>'execution_effect' = 'write'` dentro de
  `kipu_reverse_agent_operation`;
- exactamente 1 error genérico viejo;
- ningún marcador parcial de 108.

Revisar que la lista de clasificaciones/superficies coincide con la ontología
de `agent-planner.ts`, y que `memory/configuration/calendar/household` quedan
fuera por diseño.

### 2. Aplicar 108 y verificar catálogo

- helper booleano `IMMUTABLE`, helper diagnóstico `STABLE`;
- ambos owner postgres, search_path fijado, EXECUTE externo 0;
- `kipu_reverse_agent_operation` conserva DEFINER/owner/search_path y sólo
  service_role;
- tres llamadas al helper económico, cero predicados sueltos viejos;
- una llamada al helper diagnóstico;
- reaplicación completa dentro de transacción revertida = no-op.

### 3. Ejecutar PostgreSQL antes de gastar modelo

```bash
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
```

Debe dar **65/65**, exit 0, sin `ABORT`, `FALL`, `RESIDUO`,
`LIMPIEZA ILEGIBLE` ni `COBERTURA INCOMPLETA`. Repetir dos veces. Confirmar
específicamente M100.8b (memoria no bloquea) y M100.8c (dinero sin receipt sí
bloquea).

### 4. Repetir deterministic battery

- capture 745/745;
- mutaciones 319/319;
- tsc/lint/diff;
- build con red;
- handshake archivo↔servidor exactamente `economic-receipts-v20`.

### 5. Sólo entonces, una muestra del modelo

Ejecutar **una** corrida. No repetir si queda roja. La expectativa falsable es:

- ME9 revierte los tres pagos y la devolución completos;
- ME10 deja de caer por cascada;
- ME10b sigue pasando;
- total 22/22, cobertura completa, residuo cero.

Si queda 22/22, recién entonces ejecutar las cuatro muestras restantes de
estabilidad. Si falla, conservar las filas/steps de la persona antes del cleanup
o imprimir para cada step: `plan_version`, `step_key`, `capability`, `effects`,
`execution_effect`, `affected_refs`. No volver a diagnosticar desde el mensaje
genérico.

## Veredicto de Codex

Los dos defectos reportados por Claude están corregidos por clase y protegidos
por mutación. **M0 todavía no se puede cerrar**: la 108 debe aplicarse y pasar
65/65×2; luego falta una sola muestra 22/22 y, si es verde, las cuatro de
estabilidad y la ronda externa congelada.
