# M0.11A — propiedad única del receipt y harness de manifiesto

Fecha: 2026-08-12  
Estado: **CORREGIDO LOCALMENTE; M0.11A ABIERTO HASTA RE-AUDIT + 24/24**  
Producción: sigue en `ce22319` / v44  
Migraciones: 112–113 APLICADAS; esta pasada no añade ni aplica SQL  
Runtime esperado: `m0-agent-eval-2026-08-12-manifest-settlement-m0-11a`

Sello canónico para Claude:

```text
ba8795de20d8df45ba16ef7b36aac3b91e6bd8c6af1960e068b6e2ea2f10612e
490 archivos
```

## 1. Qué reportó Claude y qué faltaba en ese diagnóstico

La auditoría del sello `e7c18d47…` verificó que el contrato wire explícito sí
funcionó: desaparecieron los 27 rechazos de provenance y ME16 quedó verde. La
corrida parcial terminó con 17/22, ABORT y tres deudas evidentes del harness:

1. ME17 consultaba `agent_action_challenges.operation_id`, columna inexistente.
2. ME9 todavía medía autorización por capability/tool, no por el manifiesto de
   la operación.
3. ME10aa/ME10b/ME10c heredaban el orden de turnos anterior a M0.11A.

Esas deudas eran reales, pero no explicaban por qué el undo de ME9 aparecía
ejecutado durante ME10b. El log completo `/tmp/kipu-m0-model-m011a-wire.log`
conservó la evidencia que el resumen no alcanzó a cerrar:

- La propuesta de ME9 creó exactamente un manifiesto `proposed` y un pendiente
  `agent_operation_manifest` para toda la operación.
- La confirmación natural reclamó ese manifiesto y las cuatro reversas
  aterrizaron.
- La misma entrega devolvió HTTP 500. Tras sus retries exactos, la operación
  quedó con `operation_manifest_not_authorized`.
- ME10b pudo leer después que el undo ya estaba asentado. No se ejecutó un
  turno tarde: se escribió en ME9 y la entrega de ME9 murió después del write.

Por lo tanto había un defecto de producto, no sólo de instrumento.

## 2. Causa raíz ejecutable

`kipu_reverse_agent_operation` es un writer especial: dentro de la misma
transacción PostgreSQL:

1. deriva todos los recibos reversibles de la operación objetivo;
2. escribe todas las reversas;
3. persiste el marcador de reversal;
4. cambia su propio `agent_operation_steps` de `preflighted` a `applied`, con
   el result y los `affected_refs` reales.

El executor TypeScript sólo enviaba grupos con más de una action al coordinador
genérico. Un undo singleton entraba por `executeTool`; eso era correcto para su
transacción de dominio. Lo incorrecto venía inmediatamente después:
`persistPlannedStepOutcome` intentaba grabar un segundo result, envuelto con
otra forma. PostgreSQL detectaba el receipt distinto y respondía
`KIPU_DEDUPE_MISMATCH` **después de que el dinero ya se había revertido**.

Cambiar el umbral del coordinador de `>1` a `>0` no es correcto:
`kipu_apply_operation` exige por contrato al menos dos steps, y además convertiría
writers single-step que ya son atómicos en otra coreografía. El primer capture
rojo permitió descartar esa ampliación antes de sellar el árbol.

## 3. Fix de producto

### 3.1 Propiedad tipada del receipt

`ToolResult` admite ahora el metadato interno:

```ts
operationStepReceipt?: "writer";
```

`executeUndoAgentOperation` lo devuelve **sólo cuando la RPC terminó o replaysó
con éxito**, porque en esos caminos PostgreSQL ya posee el step receipt. Un
rechazo `unsafe`, `conflict` o `write_failed` no lo devuelve; el orquestador
conserva entonces su responsabilidad de persistir el needs-info/error.

El executor ordinario aplica la invariante:

```ts
if (result.operationStepReceipt !== "writer") {
  await persistPlannedStepOutcome(...);
}
```

Esto no clasifica lenguaje, no mira el mensaje del usuario y no contiene una
ruta por tarjetas, préstamos o frases. Es propiedad mecánica declarada por el
writer que ejecutó la transacción.

### 3.2 Atomicidad sin expansión de alcance

- Grupos de **dos o más** acciones continúan en `executePlannedAtomicGroup` /
  `kipu_apply_operation`.
- Un writer de **una** acción continúa en su transacción de dominio.
- Si ese writer asentó además el step, el executor no lo duplica.
- La validación de planner permanece con el contrato anterior para grupos
  multi-step; las reglas existentes siguen rechazando un `log_movement`
  agrupado sin el undo exacto.

No se relajó ningún writer ni se modificó PostgreSQL.

## 4. Migración completa del E2E del modelo al lifecycle del manifiesto

### ME9 / ME10aa / ME10c

El helper nuevo `turnHasManifestAuthorizationScope` no busca palabras ni un
tool challenge. Prueba simultáneamente:

- `wrote === false` en la propuesta;
- operación `awaiting_input`;
- pendiente de `agent_operation_manifest`;
- `intentKey = operation:<operationId>:authorization`;
- conjunto exacto de `appliesToActionIds` igual al conjunto de actions del
  plan;
- presencia de la capability sensible pedida dentro de ese conjunto.

Cada undo/corrección sensible se mide en dos entregas: propuesta sin write y
confirmación natural que ejecuta ese manifiesto exacto.

### ME10b

Una devolución ordinaria y completamente probada no es sensible ni destructiva.
Ahora el fixture mide una sola entrega, `wrote=true`, operación `completed` y
cero pendientes. Eliminé la confirmación redundante que contaminaba los checks
siguientes.

### ME17

La consulta de challenges legacy usa la columna real
`originating_operation_id`. Las consultas a `agent_operation_manifests`
conservan correctamente `operation_id`; no se hizo un reemplazo global ciego.

## 5. Redes nuevas

### IR302

Fija en una sola invariante:

- el coordinador genérico conserva el umbral multi-step;
- el executor consume `operationStepReceipt="writer"`;
- el undo declara esa propiedad;
- ME9/ME10aa/ME10c usan scope de manifiesto;
- ME10b es inmediata;
- ME17 usa la columna real del challenge legacy.

También actualicé IR219/IR264 y sus mutantes históricos, que todavía describían
la propuesta redundante previa a M0.11A.

### Mutaciones

- **M0M449:** el orquestador vuelve a persistir siempre el segundo receipt.
- **M0M450:** el undo deja de declarar que el writer asentó su step.
- **M0M451:** ME17 vuelve a consultar la columna inexistente.
- **M0M452:** la corrección completa deja de probar el manifiesto de undo.

Las cuatro mueren por IR302. La batería completa queda en 451/451.

## 6. Validación local (cero créditos de modelo)

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio, exit 0 |
| `npm run lint` | limpio, exit 0 |
| capture | **781/781**, exit 0 |
| mutaciones M0, seriales | **451/451**, exit 0 |
| build con red | **36/36**, exit 0 |
| `git diff --check` | limpio |
| PostgreSQL | sin cambio SQL desde **78/78 ×2** auditado por Claude |
| modelo | **no ejecutado** |

El primer intento de build falló exclusivamente porque el sandbox no podía
descargar Geist. Repetido con red: compiló 36/36.

## 7. Instrucciones exactas para Claude

1. Verificar el sello indicado en el relevo; no editar el árbol.
2. Auditar por fuente:
   - `operationStepReceipt` aparece en el éxito/replay del undo, no en sus
     rechazos;
   - el executor omite sólo el segundo receipt declarado por el writer;
   - grupos multi-step siguen usando el coordinador y ningún writer perdió sus
     barreras;
   - ME9/ME10aa/ME10c proponen y luego confirman manifiesto;
   - ME10b escribe inmediatamente;
   - ME17 distingue `agent_operation_manifests.operation_id` de
     `agent_action_challenges.originating_operation_id`.
3. Ejecutar en serie: diff, tsc, lint, capture 781/781, mutaciones 451/451,
   PostgreSQL 78/78 dos veces y build.
4. Sólo si todo lo anterior está verde, levantar servidor limpio y verificar
   handshake `m0-agent-eval-2026-08-12-manifest-settlement-m0-11a`.
5. Ejecutar **una sola** muestra pagada mediante el runner detached:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs m0-11a-manifest-settlement
```

6. Esperar su status `finished`; un timeout del cliente no autoriza relanzar.
7. La aceptación exige 24/24, cero FALL/BLOCKED/ABORT y residuo cero.
8. Si hay un rojo, detenerse con su diagnóstico tipado. No repetir el mismo
   sello buscando verde y no ajustar una aserción sin probar antes la
   invariante de producto.

## 8. Estado

M0.11A sigue **ABIERTO** hasta ese re-audit y la muestra 24/24. No hay commit,
push ni deploy. M0.11B no se inició. Esta pasada no añade frases conocidas,
selectores, rutas semánticas ni casos financieros especiales.
