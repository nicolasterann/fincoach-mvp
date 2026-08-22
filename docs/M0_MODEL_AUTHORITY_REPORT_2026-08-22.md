# M0-AM — Arquitectura de autoridad del modelo

Fecha: 2026-08-22  
Árbol: trabajo local posterior a `2b0a0b7` / producción `337ab10`, sin commit ni push  
Contrato: ADENDAS 50, 51 y 52 del expediente de Claude  
Resultado: implementación completa A–D, migración 121 aplicada y verificada, batería E cerrada con un P1 explícito en `record_investment_contribution`

## 1. Resultado ejecutivo

La autoridad del loop quedó invertida según el acta del founder: registrar la realidad ya no obtiene autoridad de coincidencias léxicas, evidencia textual del monto, elección previa de una cuenta propia o una segunda delivery. Para las capabilities de registro, el modelo elige los argumentos y el servidor conserva la física: existencia, ownership, moneda, atomicidad, idempotencia, receipts, replay y verificación post-write.

La segunda delivery quedó reducida a 27 capabilities siempre graves y 3 reglas condicionales, todas destructivas/de historia o dirigidas a terceros. Los antiguos vetos no desaparecen sin observabilidad: emiten contadores acotados en `loopAdvisories` y en la metadata durable del turno.

La migración 121 agregó el camino legal que faltaba para abandonar una operación `applying|verifying` sin manifiesto después del vencimiento del lease. La sonda M121 pasó 4/4. La operación real autorizada `cecdeada-d555-4d73-98d4-247f2ec4a943` pasó de `applying` a `abandoned` mediante el RPC; el step y su receipt conservaron el mismo digest y no hubo movimiento de dinero.

La red nueva pasó:

- TypeScript, lint y build verdes.
- Capture 880/880.
- Mutaciones 555/555, ejecutadas solas.
- PostgreSQL 82/82.
- M117 3/3, M118 3/3, M119 4/4, M120 4/4 y M121 4/4.
- Ola 0 ampliada 16/16 dos veces y calibración 2/2.
- Dry-run 28/29: el único rojo es una incompatibilidad objetiva entre la nueva política y el writer SQL de la migración 120. No se debilitó el test ni se falsificó una ocurrencia recurrente.

### P1 abierto: aporte ad-hoc a inversión

`record_investment_contribution` ya es no-grave y el dispatcher intenta ejecutarlo inmediatamente, pero `kipu_apply_investment_contribution` (migración 120 aplicada) exige operación `applying`, lease, step económico y manifiesto loop `executing` autorizado. La maquinaria de la 080 no es reutilizable para el caso ad-hoc: exige una ocurrencia recurrente pendiente y un plan de inversión enlazado, y además muta esa ocurrencia.

Con el esquema 001–121 no existe un camino que satisfaga simultáneamente estas dos condiciones:

1. aporte ad-hoc inmediato y sin confirmación, como exige M0-AM;
2. caja + activo atómicos a través del writer de la 120 sin manifiesto grave.

La corrección honesta requiere una migración sucesora que permita a ese writer autenticar un step loop inmediato con las mismas pruebas de ownership, fingerprint, marker económico e idempotencia, o una RPC hermana con esa física. No se improvisó DDL fuera de la única parada autorizada ni se degradó la atomicidad.

## 2. Decisiones por fase

### Fase A — autoridad y contadores

#### A1/A2. Evidencia monetaria y origen

En [agent-action-guard.ts](../src/lib/ai/agent/agent-action-guard.ts) los requisitos `serverMonetaryEvidenceRequirement` y `serverConfirmationRequirement` siguen calculando el veredicto histórico. Para una mutación no-grave en modo loop, ese veredicto se emite como contador y la función devuelve `null`; lecturas y capabilities graves conservan el comportamiento bloqueante.

Sitios:

- `src/lib/ai/agent/agent-action-guard.ts:44-92`: gramática cerrada y deduplicación de contadores.
- `src/lib/ai/agent/agent-action-guard.ts:347-363`: degradación de evidencia monetaria.
- `src/lib/ai/agent/agent-action-guard.ts:594-613`: degradación de confirmación.
- `src/lib/ai/agent/kipu-agent-loop.ts:3786-3805`: el dispatcher deriva `modelAuthorityRegistration` de lectura/no lectura y de la política grave, no del mensaje del usuario.
- `src/lib/ai/agent/kipu-agent-tools.ts:16365-16374`: `unprovenLoopMonetaryOriginSelection` se vuelve contador para registro no-grave.

#### A3. Cuenta propia elegida por el modelo

`chosenAccountEvidence` admite el estado `model` exclusivamente bajo `loopDispatcherAuthorized` y cuando la capability no exige segunda delivery. La cuenta debe existir, pertenecer al usuario y ser compatible con la moneda; esos checks físicos siguen en los builders/executors. Si antes habría existido ambigüedad entre cuentas propias de la misma moneda, se emite `chosen_account_evidence/unproven_choice`.

Sitios:

- `src/lib/ai/agent/kipu-agent-tools.ts:3052-3092`.
- `src/lib/ai/apply-chat-transaction-intent.ts`: el camino loop consume `model` como evidencia válida sin alterar el camino `on`.
- El mismatch de moneda conserva `needs_info` como tool result privado para que el modelo razone; nunca se convierte en autoridad por selección.

#### A4. Lista grave final

Fuente mecánica: `src/lib/ai/agent/agent-operation-authority.ts:755-814`.

| Capability/regla | Criterio grave |
|---|---|
| `cancel_scheduled_change` | destruye/cancela historia o intención programada |
| `cancel_scheduled_payment` | destruye/cancela una instrucción programada |
| `cancel_shared_expense` | modifica una obligación compartida/terceros |
| `change_account_currency` | cambia la identidad monetaria durable de una cuenta |
| `change_base_currency` | cambia la unidad base global del usuario |
| `close_account` | cierra una entidad financiera |
| `close_card` | cierra una deuda/tarjeta |
| `close_installment_plan` | cierra un plan durable |
| `forget_life_context` | destruye memoria/historia |
| `leave_household` | afecta vínculo con terceros |
| `remove_asset` | elimina historia de patrimonio |
| `remove_household_member` | afecta a un tercero |
| `remove_recurring_shared_expense` | elimina obligación compartida |
| `reset_personality_test` | borra personalización durable |
| `reset_personalization_preference` | borra personalización durable |
| `settle_household` | liquida obligaciones entre terceros |
| `set_household_visibility` | cambia acceso/visibilidad frente a terceros |
| `undo_recent_movements` | deshace historia económica potencialmente multi-write |
| `undo_agent_operation` | deshace una operación durable, potencialmente multi-write |
| `remove_duplicate` | elimina/reversa historia económica |
| `transfer_household_ownership` | transfiere autoridad a un tercero |
| `unshare_movement` | cambia atribución compartida |
| `accept_household_invite` | acepta relación con terceros |
| `add_household_participant` | incorpora a un tercero |
| `household_invite_link` | crea acceso para terceros |
| `invite_household_member` | invita a un tercero |
| `respond_household_invite` | responde una relación con terceros |
| `update_goal(status=cancelled)` | cancelación/destrucción lógica de meta |
| `update_fixed_expense(action=delete)` | borrado del plan fijo |
| `update_income(action=end)` | termina una fuente durable de ingreso |

Cardinales: always-sensitive `33 → 27`; reglas condicionales `10 → 3`.

Salen expresamente de la autoridad grave las capabilities de registro: `log_movement`, `log_movements_batch`, `register_card_payment`, `transfer_between_accounts`, `record_person_payment`, `record_investment_contribution`, aportes, resoluciones de ocurrencias, pagos de fijos y pausas reversibles. PostgreSQL sigue decidiendo si sus efectos físicos son válidos.

#### A5/A6. Publicación y tool results

La única barrera dura de salida es afirmar que se escribió cuando no existe receipt de escritura. Grounding numérico, estructura técnica y voz se registran como advisory y obtienen como máximo una reescritura. El modelo publica su pregunta natural; el resultado `needs_info` del executor permanece dentro de la conversación de tools y no se inserta como plantilla al usuario.

La secuencia se fija en `kipu-agent-loop.ts` y consume el productor compartido `mutationClaimNeedsActionReceipt`. Los advisories y contadores se agregan en `src/lib/ai/agent/kipu-agent-loop.ts:4147-4154` y se persisten en el resultado durable en `:4324-4332`.

#### Especificación de contadores

Shape único:

```json
{
  "code": "model_authority_counter",
  "counter": "<enum cerrado>",
  "verdict": "would_have_asked|would_have_blocked",
  "capability": "<tool schema name>",
  "reason": "<token cerrado>"
}
```

`counter` permitido:

- `server_monetary_evidence`
- `server_confirmation`
- `loop_monetary_origin`
- `chosen_account_evidence`
- `duplicate_movement`

`reason` permitido:

- `unstated_amount`
- `sensitive_create`
- `destructive`
- `unproven_entity`
- `unproven_origin`
- `unproven_choice`
- `duplicate_suspected`
- `correction_suspected`

No se persiste texto del usuario, prompts ni argumentos. Filas idénticas se deduplican por `counter+verdict+capability+reason`. El canal consultable es `loopAdvisories` dentro de `assistantMetadata`/resultado durable del turno; no hizo falta DDL de telemetría.

### Fase B — operación colgada y migración 121

#### Causa raíz

La operación de producción tenía `status=applying`, `state_version=2`, un step `preflighted` y ningún manifiesto. El claim del siguiente turno no podía tomar una operación `applying`; cuando el dispatcher intentaba cuarentena, la RPC de la 118 exigía un manifiesto loop `executing`. El lease vencido impedía además la transición ordinaria. El catch registraba `dispatch/KIPU_CONFLICT` pero dejaba intacta la causa durable, creando el ciclo.

La raíz del `claim_failure` no era una selección semántica del modelo: era una operación ordinaria stageada que llegó a `applying` antes de completar dispatch, sin la topología de manifiesto que la cuarentena 118 suponía universal.

#### Solución

`supabase/sql/121_m0_model_authority_orphan_quarantine.sql` reemplaza aditivamente `kipu_quarantine_agent_loop_operation`:

- permite cuarentena manifest-less sólo para una op loop `applying|verifying`;
- exige usuario, conversación, root message, delivery, CAS y lease/terminal-step según la causa;
- permite `user_abandoned` como cancelación explícita del dueño;
- limpia lease y pending, pone operación `abandoned` y `last_error` acotado;
- agrega evento de transición append-only;
- no modifica steps, arguments, fingerprints, receipts ni ledger;
- conserva la protección del executor sano y la rama con manifiesto de 118.

Aplicación y sonda:

```text
$ node --env-file=.env.local ./scripts/qa/m0-loop-121-e2e.mjs
M121.1 PASS — manifest-less applying operation quarantines; transition and bounded diagnostic exact; steps/receipts byte-intact
M121.2 PASS — exact replay is idempotent; divergent meaning returns KIPU_DEDUPE_MISMATCH
M121.3 PASS — healthy executor remains protected from foreign live lease; terminal step allows quarantine
M121.4 PASS — user_abandoned kills the owner's stuck operation by the RPC path
Residue: agent_operation_transition_events=0, agent_operation_manifests=0, agent_operation_steps=0, agent_operation_deliveries=0, agent_operations=0, chat_messages=0, user_engagement=0, profiles=0
M121 4/4
exit 0
```

#### Liberación B5 autorizada

Script: `scripts/qa/m0-model-authority-release-stuck-operation.mjs` (service role + RPC, sin `UPDATE` crudo).

```text
operation_id=cecdeada-d555-4d73-98d4-247f2ec4a943
before.status=applying
before.state_version=2
before.manifest=null
before.step_statuses=[preflighted]
before.money_rows=0
before.step_receipt_digest=b94b38b54117bfd158c31af8b78f5727b4cc87634af7469d1295a87ff5c40f1c
rpc.outcome=quarantined
after.status=abandoned
after.lease_token=null
after.pending_question=null
after.last_error.code=failed_quarantined
after.last_error.reason_code=user_abandoned
after.last_error.manifest_present=false
after.money_rows=0
after.step_receipt_digest=b94b38b54117bfd158c31af8b78f5727b4cc87634af7469d1295a87ff5c40f1c
receipt_byte_intact=true
```

El loop ahora:

- intenta cuarentena antes de exponer operaciones envenenadas al modelo (`kipu-agent-loop.ts:2101-2152`);
- si la cuarentena compite o falla, instala una barrera de writes pero deja pasar lecturas;
- tipa claim/dispatch como `turnFailure` (`kipu-agent-loop.ts:2280-2344`);
- permite que `reject_operation` abandone una op propia manifest-less `applying|verifying` (`kipu-agent-loop.ts:3278-3329`);
- prohíbe repetir la misma firma durable de error y escala a cuarentena/turno fresco.

### Fase C — voz y aprendizaje

El system prompt del loop quedó como contrato model-facing, sin nuevos matchers sobre el mensaje del usuario:

- no usar prefijos plantilla ni copiar su propia pregunta anterior;
- acumular todos los datos faltantes en una sola pregunta natural;
- no preguntar moneda si la cuenta/tarjeta ya la determina;
- resolver un alias ASR con un candidato razonable, declarar la interpretación inline y usar `remember_fact` tras una aclaración;
- interpretar `tarjeta <banco>` como cuenta/débito si no existe tarjeta de crédito de ese banco;
- sin cuenta nombrada, usar patrón/default y declararlo inline;
- ante “siempre con X”, hacer default y recordar el patrón.

La red verifica que los aliases guardados vuelven al contexto del turno siguiente. La conducta lingüística real queda deliberadamente pendiente de la muestra paga de auditoría de Claude; esta entrega no hizo llamadas pagadas.

### Fase D — cirugía de la red

#### Persona espejo

La fixture permanente contiene:

- ARS: Banco Supervielle + Efectivo, sin default de moneda;
- USD: Efectivo USD, PayPal, Wells Fargo, Banco Pichincha y Produbanco;
- dos tarjetas;
- contexto/memoria y FX limpiados por identidad y PK real.

Es geometría, no saldos ni identidad del founder.

#### Lanes L1–L6

| Lane | Contrato fijado | Resultado ×2 |
|---|---|---|
| L1 | “Compre un cafe en mc con Supervielle” → una pregunta de monto; “30mil” → write inmediato, sin manifiesto ni plantilla | VERDE |
| L2 | `super bill → Tarjeta supervielle → 25mil → Fue banco supervielle`; máximo una pregunta por episodio, write final, cero op atascada | VERDE |
| L3 | tallarín 25.000 sin cuenta → patrón propio, nota inline y contador | VERDE |
| L4 | `su perrito` → interpretación/una pregunta, `remember_fact`, alias en contexto siguiente | VERDE |
| L5 | `seis mil pesos` conserva captura | VERDE |
| L6 | op manifest-less applying + cancelación → `abandoned`, sin movimiento | VERDE |

#### Aritmética exacta

Capture:

- anterior: 876;
- nuevos: IR348a lista grave, IR348b counters/cables, IR348c barrera de publicación, IR348d fixtures/lanes/121;
- final: `876 + 4 = 880`.

Mutaciones:

- anterior: 553;
- M0M560: quitar emisión de contador; muere por lane/IR348b;
- M0M561: quitar barrera de afirmación sin receipt; muere por IR348c;
- final: `553 + 2 = 555`.

Mutantes retirados o reemplazados por el acta:

- M0M498: dejó de exigir el guard antiguo; ahora revive el bloqueo y debe morir por IR348b.
- M0M505: reensancha `SECOND_DELIVERY_CAPABILITIES` con `log_movement`; muere por IR348a.
- M0M433: reanclado al sitio vivo de publicación.
- M0M533: reanclado al orden legal de tool results hermanas.
- M0M540: reanclado al camino terminal vivo de cuarentena.

Otros cardinales:

- dry histórico: 29 escenarios (28 verdes + 1 P1 real).
- Ola 0: `10 + L1…L6 = 16`.
- calibración: 2/2.
- sensibilidad always: `33 → 27`.
- sensibilidad condicional: `10 → 3`.

## 3. Autoauditoría por fase

| Fase | Chequeo | Veredicto |
|---|---|---|
| A | una mutación no-grave no recibe autoridad de evidencia léxica ni segunda delivery; conserva física | VERDE |
| A | un grave sigue manifest-bound por igualdad del set 27 + reglas 3 | VERDE |
| A | cada veto degradado produce advisory cerrado sin texto del usuario | VERDE |
| A | false-write continúa bloqueante | VERDE |
| B | manifest-less stuck op tiene transición RPC legal, CAS, ownership y replay | VERDE, M121 4/4 |
| B | cancelación real mata la op autorizada y conserva receipt | VERDE |
| B | lectura no queda rehén de op atascada | VERDE |
| C | cambios sólo model-facing, sin routing por frases | VERDE estático/MOCK |
| D | geometría, lanes, aliases, defaults y counters | VERDE ×2 |
| E | regresión histórica | VERDE salvo P1 de inversión documentado |

## 4. Incidentes tipados durante la implementación

1. `HARNESS_FIXTURE/PROFILES_NONEXISTENT_DISPLAY_NAME`: la primera fixture M121 asumió `profiles.display_name`. Se alineó con el patrón real (`profiles` sin ese campo); cero producto/DDL cambiado.
2. `PRODUCT_LOOP/TOOL_RESULT_SEQUENCE_INTERLEAVE`: una completion con `confirm_operation` y mutaciones hermanas podía insertar refresh de sistema antes de terminar todos los tool results. El validador local lo detectó. El refresh/cuarentena se difiere hasta cerrar todas las respuestas tool; el camino `on` no se tocó.
3. `HARNESS_ASSERTION/L6_INTERNAL_TOOLTRACE_NOT_PUBLIC`: L6 exigía una traza de control que el contrato deliberadamente no publica. PostgreSQL ya probaba `abandoned`, reply veraz y cero dinero. Se eliminó únicamente esa falsa expectativa.
4. `INFRA_BUILD/GOOGLE_FONT_FETCH_BLOCKED`: el primer build sandboxed no pudo descargar Geist. La repetición autorizada con red compiló el mismo árbol sin cambios y salió 0.
5. `MUTATION_CATALOG/POST_AUTHORITY_ANCHOR_STALE`: M0M498 moría por el IR histórico equivocado y M0M540 no encontraba su anchor. Se reanclaron al sitio vivo; luego se repitió desde tsc hasta mutaciones y quedó 555/555, sin crashes ni `anchor hits != 1`.

## 5. Fase E — salidas de gates

Todos los comandos se ejecutaron en serie, con exit code directo y sin pipes. Mutaciones corrió sola.

### TypeScript

```text
$ npx tsc --noEmit
exit 0
```

### Lint

```text
$ npm run lint
> fincoach-mvp@0.1.0 lint
> eslint .

[BABEL] Note: The code generator has deoptimised the styling of src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
exit 0
```

### Capture

```text
$ node ./scripts/qa/run-capture-gate.mjs
IR001-IR348d: PASS
Capture gate: 880/880
exit 0
```

La advertencia `MODULE_TYPELESS_PACKAGE_JSON` del runner ya existía y no alteró el resultado.

### Build

Primer intento, infraestructura:

```text
$ npm run build
Failed to fetch `Geist` from Google Fonts.
exit 1
```

Repetición del mismo comando con acceso de red autorizado, sin cambio de árbol:

```text
$ npm run build
> fincoach-mvp@0.1.0 build
> next build

✓ Compiled successfully in 2.8s
✓ Finished TypeScript in 5.2s
✓ Generating static pages (36/36)
exit 0
```

Quedó sólo el warning conocido de NFT tracing asociado a `next.config`/capture-test.

### Mutaciones — ejecución aislada

```text
$ node ./scripts/qa/telegram-agent-regression-audit.mjs
baseline capture: 880/880
M0M001-M0M497: killed by their named checks
M0M498: killed by IR348b
M0M499-M0M504: killed by their named checks
M0M505: killed by IR348a
M0M506-M0M532: killed by their named checks
M0M533: killed by IR340/message-sequence wiring
M0M534-M0M539: killed by their named checks
M0M540: killed by IR342a
M0M541-M0M559: killed by their named checks
M0M560: killed by IR348b/model-authority counter lane
M0M561: killed by IR348c/false-write barrier
Mutation audit: 555/555 killed; crashes=0; anchor_mismatches=0
exit 0
```

Nota de cardinal: los identificadores históricos no son un rango denso; el runner reporta 555 entradas activas aunque el mayor id nominal sea M0M561.

### PostgreSQL base

```text
$ node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
TG100/M0 PostgreSQL: 82/82
Residue: 0
exit 0
```

### Migraciones 117–121

```text
$ node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs
M117 3/3
Residue: 0
exit 0

$ node --env-file=.env.local ./scripts/qa/m0-loop-118-e2e.mjs
M118 3/3
Residue: 0
exit 0

$ node --env-file=.env.local ./scripts/qa/m0-loop-119-e2e.mjs
M119 4/4
Residue: 0
exit 0

$ node --env-file=.env.local ./scripts/qa/m0-loop-120-e2e.mjs
M120 4/4
Residue: 0
exit 0

$ node --env-file=.env.local ./scripts/qa/m0-loop-121-e2e.mjs
M121 4/4
Residue: 0
exit 0
```

### Dry-run completo

```text
$ node --env-file=.env.local ./scripts/qa/m0-loop-mock-dry-run.mjs
DRY historical/model-authority cases: PASS 28

DRY_INVESTMENT_PROPOSAL: FAIL
user: Aporté 75 USD desde Produbanco a eToro MOCK.
assistant: No registré ningún cambio en este turno.
toolTrace:
  capability: record_investment_contribution
  status: needs_info
  effect: needs_info
before:
  Produbanco: 1000 USD
  eToro MOCK: 500 USD
  transactions: []
  manifests: []
after:
  Produbanco: 1000 USD
  eToro MOCK: 500 USD
  transactions: []
  manifests: []
hadError: false
needsInfo: true
failed assertions:
  - investment contribution writes exactly one atomic ledger event
  - investment contribution moves cash and asset atomically
  - investment contribution needs no manifest or vague deferral

cleanup residue: 0
auth residue: 0
loopUsage: { cachedInputTokens: 5040, calls: 126, inputTokens: 12600, outputTokens: 2520 }
judge: { calls: 29, inputTokens: 5220, outputTokens: 1305 }
mock simulated cost: USD 0.062136
quality average: 5.00
Dry-run: 28/29
exit 1
```

Clasificación: `PRODUCT_SCHEMA/AUTHORITY_POLICY_WRITER_120_MANIFEST_CONTRADICTION`. Es el hallazgo de la batería; no un fallo de modelo, no un problema de PostgreSQL físico y no una razón para degradar el test.

### Ola 0 + lanes M0-AM, corrida 1

```text
$ node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --dry-run --suite=ola0
O0 inherited: 10/10
L1_DIRECT_AFTER_AMOUNT: PASS
L2_ASR_CHAIN_NO_STUCK_OPERATION: PASS
L3_PATTERN_ACCOUNT_WITH_COUNTER: PASS
L4_ALIAS_MEMORY_NEXT_CONTEXT: PASS
L5_SPOKEN_SPANISH_AMOUNT: PASS
L6_STUCK_OPERATION_CANCELLED: PASS
Ola 0 + M0-AM: 16/16
residue: 0
loopUsage: { cachedInputTokens: 3240, calls: 81, inputTokens: 8100, outputTokens: 1620 }
judge: { calls: 16, inputTokens: 2880, outputTokens: 720 }
mock simulated cost: USD 0.039564
quality average: 5.00
exit 0
```

### Ola 0 + lanes M0-AM, corrida 2

```text
$ node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --dry-run --suite=ola0
O0 inherited: 10/10
L1_DIRECT_AFTER_AMOUNT: PASS
L2_ASR_CHAIN_NO_STUCK_OPERATION: PASS
L3_PATTERN_ACCOUNT_WITH_COUNTER: PASS
L4_ALIAS_MEMORY_NEXT_CONTEXT: PASS
L5_SPOKEN_SPANISH_AMOUNT: PASS
L6_STUCK_OPERATION_CANCELLED: PASS
Ola 0 + M0-AM: 16/16
residue: 0
loopUsage: { cachedInputTokens: 3240, calls: 81, inputTokens: 8100, outputTokens: 1620 }
judge: { calls: 16, inputTokens: 2880, outputTokens: 720 }
mock simulated cost: USD 0.039564
quality average: 5.00
exit 0
```

### Calibración

```text
$ KIPU_AGENT_MODE=loop node --env-file=.env.local ./scripts/qa/m0-ola0-calibration.mjs
O0_REMINDER PASS — entity/date/amount exact, published once, residue zero
O0_PREFLIGHT_PARITY PASS — runner mirror equals product; close_card pure guard present in executor and loop preflight; sensitiveCount=27
Calibration: 2/2
exit 0
```

## 6. Riesgos y objeciones

1. **P1 de inversión ad-hoc.** Es el único bloqueo objetivo para declarar toda la batería verde. Solucionarlo sin DDL rompería atomicidad, inventaría una ocurrencia o reintroduciría un manifiesto que el acta acaba de retirar. Se solicita a Claude/founder contratar una migración sucesora específica.
2. **Telemetría en metadata, no tabla dedicada.** Cumple “sin DDL” y es consultable junto al turno; su retención depende de la retención de assistant metadata. Si se requiere agregado histórico independiente, eso sería trabajo posterior y DDL explícito.
3. **Riesgo aceptado de misregistro.** Al confiar en una cuenta/monto inferidos por el modelo, aumentan las correcciones posibles. El acta acepta ese trade-off porque los registros son reversibles; RLS, ownership, monedas, receipts, replay y undo siguen intactos.
4. **ASR/voz es prompt-first.** MOCK prueba que el servidor no bloquea ni inyecta plantillas. Sólo una muestra real puede medir si el modelo cumple variedad y aliases naturales; no se consumió presupuesto pago.
5. **Camino `on`.** No se cambió el selector `KIPU_AGENT_MODE=on` ni el planner/envelope de producción. Los cambios compartidos de tool result están condicionados por `loopDispatcherAuthorized`/`modelAuthorityRegistration`; las físicas SQL son comunes e intactas salvo la 121 de cuarentena explícitamente autorizada.
6. **Reporte de mutaciones.** Los ids históricos tienen huecos/reemplazos; el cardinal contractual es el número de entradas activas del catálogo, 555, no el mayor sufijo nominal.

## 7. Límites respetados

- Cero commit, push o deploy.
- Cero llamadas pagadas a modelos.
- Cero routing o regex nuevos sobre frases del usuario.
- Cero debilitamiento de RLS, triggers de moneda, writers, receipts, replay, reversas o undo.
- Cero writes contra la cuenta real del founder excepto la liberación B5 expresamente autorizada; esa liberación no movió dinero.
- `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` no fue editado por esta implementación; se preservaron sus cambios preexistentes.
- La única mutación de producción fue el RPC 121 aplicado personalmente por el founder y la invocación B5 autorizada.

## 8. Veredicto de entrega

La arquitectura de autoridad del modelo está implementada y lista para revisión adversarial. La auditoría debe tratar el dry-run 28/29 como un P1 de frontera SQL conocido, no como un verde: el árbol demuestra la nueva autoridad en las lanes ordinarias, pero todavía no puede ejecutar un aporte ad-hoc a inversión sin la autoridad de manifiesto codificada por la 120.
