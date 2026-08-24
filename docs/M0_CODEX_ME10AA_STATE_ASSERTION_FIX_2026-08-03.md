> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 — relevo a Claude: ME10aa era una aserción contra una columna fantasma

Fecha: 2026-08-03  
Estado: **M0 ABIERTO** · migraciones **100–107 aplicadas** · PostgreSQL **64/64 ×2**  
Runtime: `m0-agent-eval-2026-08-03-card-preflight-v10`

## 1. Veredicto sobre el 21/22 de Claude

El producto ejecutó ME10aa correctamente. El rojo era del harness.

La evidencia de `/tmp/v10.log` es completa:

- `deliveryAttempts=1`;
- `wrote=true`;
- tools: `undo_agent_operation`, `log_movement`, `log_movement`, las tres con
  efecto write;
- operación durable `completed`;
- sin `publicationFailure` ni `last_error`;
- balance antes de la corrección: 1.575,89;
- balance después: 1.544,89, es decir, los dos gastos corregidos suman 31;
- aparecen dos reversas nuevas por 10 y 20;
- aparecen dos gastos nuevos por 12 y 19;
- `agent_operation_reversals` guarda el target correcto y exactamente los dos
  ids originales;
- respuesta natural, correcta y sin muletillas.

El check, sin embargo, ejecutaba:

```ts
.select("id,reversed_by_transaction_id")
```

`transactions.reversed_by_transaction_id` **no existe en ningún esquema**. La
reversa en Kipu es una fila append-only `type='reversal'` cuyo
`related_transaction_id` apunta al original. La consulta falló, por eso el log
mostró `originalPairRows:null` y ME10aa rojo aunque todo el trabajo aterrizó.

Esto ya se había diagnosticado y corregido en
`telegram-agent-100-e2e.mjs`; el mismo antipatrón quedó duplicado en
`m0-model-conversation-e2e.mjs`.

## 2. Corrección del harness

Archivo: `scripts/qa/m0-model-conversation-e2e.mjs`.

La consulta ahora lee reversas reales:

```text
transactions
  type = reversal
  related_transaction_id IN (ids originales)
```

ME10aa ya no se apoya en un conteo global ni en una columna inventada. Prueba
simultáneamente:

1. delta local: `afterReplacedPair.account === afterOriginalPair.account - 1`;
2. exactamente dos filas de reversa;
3. conjunto de `related_transaction_id` exactamente igual al par original;
4. marker durable con el `target_operation_id` correcto;
5. conjunto de `marker.transaction_ids` exactamente igual al par original;
6. exactamente cuatro filas nuevas en la corrección;
7. exactamente dos reversas y dos gastos;
8. montos de reemplazo exactamente `[12, 19]`;
9. total de transacciones local `afterOriginalPair + 4`;
10. respuesta publicable y con voz normal.

Esta forma diferencia los fallos relevantes:

- revertir sólo una compra;
- revertir dos compras equivocadas;
- escribir dos reemplazos sin deshacer;
- deshacer correctamente pero guardar marker de otra operación;
- registrar dos gastos con montos distintos;
- pasar por coincidencia de un baseline capturado lejos.

## 3. Nueva red determinista IR259

Capture añade **IR259**, que exige que el E2E:

- no mencione `reversed_by_transaction_id`;
- consulte `related_transaction_id` sobre filas `reversal`;
- use delta local;
- compare ambos conjuntos de identidades exactamente;
- pruebe cardinalidad 4 = 2 reversas + 2 gastos;
- pruebe los montos 12 y 19;
- mida el crecimiento desde `afterOriginalPair`, no desde un baseline lejano.

Cinco mutaciones nuevas, todas muerden IR259:

- **M0M251:** reintroduce la columna inexistente;
- **M0M252:** vuelve al baseline distante;
- **M0M253:** sustituye identidad exacta de reversas por mero conteo;
- **M0M254:** acepta cualesquiera dos montos de reemplazo;
- **M0M255:** sustituye identidad exacta del marker por mero conteo.

## 4. Evidencia local

| Comprobación | Resultado |
|---|---:|
| Capture | **738/738** |
| Mutaciones M0 | **255/255**, exit 0, residuo cero |
| `node --check` de ambos runners | limpio |
| `npx tsc --noEmit` | limpio |
| `git diff --check` | limpio |
| modelo real | **no ejecutado**; cero gasto adicional |

La fuente de producto no cambió después del build v10 que Claude certificó. Los
cambios de esta pasada son harness, capture, mutaciones y documentación.

## 5. Documentación

Se alinearon `AGENTS.md`, `CLAUDE.md`, `docs/ROADMAP.md` y
`scripts/qa/README.md`:

- migraciones 001–107 aplicadas;
- próxima migración 108;
- PostgreSQL 64/64×2;
- capture 738/738;
- mutaciones 255/255;
- runtime v10;
- M0 sigue abierto únicamente por la repetición del modelo y la ronda externa
  congelada.

La cabecera de la 107 ahora dice `APPLIED 2026-08-03`.

## 6. Qué debe hacer Claude

No repetir PostgreSQL ni gastar cinco muestras de entrada: esa frontera ya está
certificada. Seguir esta secuencia:

1. Leer el diff de ME10aa y confirmar en catálogo que
   `transactions.related_transaction_id` es la identidad append-only real y que
   `reversed_by_transaction_id` no existe.
2. Revisar el log `/tmp/v10.log` y confirmar la aritmética local:
   original 10+20, corrección 12+19, efecto neto adicional −1.
3. Ejecutar capture **738/738** y mutaciones **255/255**. No modificar la
   aserción para acomodar el resultado del modelo.
4. Con `.next` limpio y handshake v10, ejecutar **una sola** corrida del E2E de
   modelo. ME10aa debe probar reversas por `related_transaction_id` y el total
   debe ser **22/22**.
5. Sólo si da 22/22, ejecutar las otras cuatro corridas de estabilidad.
6. Después hacer la ronda final sobre árbol congelado por un auditor que no haya
   escrito los fixes. Verificar cero residuo, datos del founder intactos y build
   con red.

## Veredicto de Codex

No hay un defecto de producto nuevo detrás del 21/22 de Claude. El último rojo
consultaba una columna inexistente y por eso no podía certificar una corrección
que el propio log demuestra que fue atómica, completa y bien narrada. La
aserción queda ahora alineada con el ledger append-only y protegida por cinco
mutaciones. **M0 todavía no se declara cerrado**: falta obtener 22/22 y luego
las cuatro corridas de estabilidad sobre este harness corregido.
