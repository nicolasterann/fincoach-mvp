# M0 Loop — Reporte de Etapa 1

Fecha: 2026-08-14  
Estado: **BLOQUEADA — NO LISTA PARA AUDITORÍA DE CIERRE**  
Base contractual: `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md`, §7 Etapa 1.

## 1. Alcance implementado vs. contrato de la etapa

Se completó la verificación previa obligatoria contra el código y las migraciones aplicadas. Sus afirmaciones base quedaron así:

- Confirmado: el loop nativo está en `kipu-agent.ts:6397–6512` y es inalcanzable porque `selectedToolSchemas = []` en `:6032`.
- Confirmado: `executeTool` empieza en `kipu-agent-tools.ts:15716`; sus dos primeros gates son pertenencia al plan y byte-match de argumentos, seguidos por las barreras de compatibilidad económica, freshness, Saldo, schema, timezone, household, corrective, multi-source y confirmación/dispatch.
- Confirmado: existen wrappers/RPCs para registrar, autorizar, comenzar y verificar el manifiesto de 112–115.
- Confirmado con corrección factual: la política mecánica tiene **31** capabilities siempre sensibles, no 30, y 8 reglas condicionales. `manifestRequiresSecondDelivery` no lee el mensaje.
- Refutado: 112–115 no contienen una RPC para rechazar/cerrar un manifiesto `proposed`.
- Refutado: las RPC vigentes no admiten el plan mínimo de loop de §4.5 ni permiten persistir una tool call incremental antes del write. Exigen el envelope persistido y sus steps completos.

Al llegar a esa frontera se aplicó literalmente la instrucción de imposibilidad del founder: no se forzó el shape, no se fabricaron effects/provenance/postconditions, no se puenteó RLS con un update directo y no se conectó un modo `loop` que pudiera escribir sin recibo durable pre-write.

Por ello, los 8 puntos de alcance, los tests (a)–(h) y el dry-run MOCK contra PostgreSQL real **no están implementados**. La máxima entrega segura fue la verificación adversarial, el bloqueo reproducible y el DDL acotado de rechazo de §7. La Etapa 1 no se presenta como cerrada.

## 2. Archivos creados/modificados

- `docs/M0_LOOP_ETAPA_1_REPORT_2026-08-14.md`: este reporte de bloqueo, evidencia y DDL no aplicado.

No se modificó código runtime para Etapa 1. Las modificaciones de quick-win pertenecen exclusivamente a Etapa 0 y están inventariadas en su reporte.

## 3. Decisiones de diseño

1. **No crear un modo parcialmente seguro.** Un loop solo de lectura/no-sensibles no cumple el contrato y un write ordinario ejecutado antes de persistir su step deja una ventana de crash/replay. Añadir el enum y el routing sin la frontera durable habría expuesto un modo aparentemente válido pero incompleto.
2. **No serializar el envelope desde el dispatcher.** Rellenar `state_witness`, `effects`, `provenance` y `postconditions` con vacíos o compilarlos otra vez en TypeScript contradice §4.5 y recrea la arquitectura retirada.
3. **No usar service-role como sustituto de una RPC.** La tabla de manifiestos concede solo `SELECT`; actualizarla directamente rompería la autoridad SECURITY DEFINER/CAS y no cerraría atómicamente la operación ni su evento.
4. **No reescribir executors.** Algunas tools económicas consumen `activePlannedAction.effects/provenance`; resolverlo dentro de ellas violaría la prohibición expresa y dispersaría de nuevo el contrato económico.
5. **No escribir tests que mockeen una garantía ausente.** (a)–(d) y el E2E PostgreSQL deben probar la autoridad real, no un store falso que acepte estados que la base aplicada rehúsa.

## 4. Salida íntegra de los gates

Estos son los gates de regresión del árbol congelado. No hubo llamadas de modelo ni muestras pagadas.

### TypeScript

Comando: `npx tsc --noEmit`

Exit code: `0`

Salida íntegra:

~~~~text

~~~~

### Lint

Comando: `npm run lint`

Exit code: `0`

Salida íntegra:

~~~~text

> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~~

### Build

Comando: `npm run build`

Exit code: `0`

Salida íntegra:

~~~~text

> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally. Somewhere in the import trace below, there are:
- filesystem operations (like path.join, path.resolve or fs.readFile), or
- very dynamic requires (like require('./' + foo)).
To resolve this, you can
- remove them if possible, or
- only use them in development, or
- make sure they are statically scoped to some subfolder: path.join(process.cwd(), 'data', bar), or
- add ignore comments: path.join(/*turbopackIgnore: true*/ process.cwd(), bar)

Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx


✓ Compiled successfully in 2.9s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36) 
  Generating static pages using 11 workers (18/36) 
  Generating static pages using 11 workers (27/36) 
✓ Generating static pages using 11 workers (36/36) in 227ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/ambient-loop
├ ƒ /api/cron/card-interest
├ ƒ /api/cron/fx-refresh
├ ƒ /api/cron/recurring-materialize
├ ƒ /api/cron/scheduled-changes
├ ƒ /api/cron/scheduled-payments
├ ƒ /api/inbound-email
├ ƒ /api/telegram/webhook
├ ƒ /app
├ ƒ /app/activity
├ ƒ /app/cashflow
├ ƒ /app/chat
├ ƒ /app/cuentas
├ ƒ /app/debt
├ ƒ /app/fx
├ ƒ /app/goals
├ ƒ /app/household
├ ƒ /app/join/[token]
├ ƒ /app/kipu-fit
├ ƒ /app/margen
├ ƒ /app/mes
├ ƒ /app/mis-datos
├ ƒ /app/precision
├ ƒ /app/readiness
├ ƒ /app/reality
├ ƒ /app/saldo
├ ƒ /app/settings
├ ƒ /app/settings/export
├ ƒ /app/spending
├ ƒ /app/wealth
├ ƒ /auth/confirm
├ ƒ /dev/ai-parser-test
├ ƒ /dev/capture-sim
├ ƒ /dev/capture-test
├ ƒ /dev/chat-handler-test
├ ƒ /dev/chat-review
├ ƒ /dev/coach-response-test
├ ƒ /dev/m0-agent-eval
├ ƒ /dev/manual-entry
├ ƒ /dev/onboarding-loop-test
├ ƒ /dev/onboarding-sim
├ ƒ /dev/onboarding-wizard-test
├ ƒ /dev/parser-test
├ ƒ /dev/preferences-test
├ ƒ /dev/supabase-test
├ ƒ /dev/telegram-link-test
├ ƒ /dev/transaction-test
├ ƒ /dev/ui-preview
├ ƒ /dev/user-financial-context-test
├ ○ /icon.svg
├ ƒ /login
├ ƒ /login/reset
├ ○ /manifest.webmanifest
├ ƒ /onboarding
├ ƒ /onboarding/template
├ ○ /opengraph-image
├ ƒ /reset-password
└ ƒ /signup


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~~

### Capture

Comando: `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs`

Exit code: `0`

Salida íntegra:

~~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-14T18:52:39.822Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-14T18:52:39.822Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-14T18:52:39.822Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
806/806 capture checks
(node:70440) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~~

### Mutaciones

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

Exit code: `0`

Salida íntegra:

~~~~text
ok · M0M1 notifier republishes an occurrence already satisfied by a fact → TG-1
ok · M0M2 statement facts stop satisfying the matching calendar cycle → TG-1
ok · M0M3 fact matching ignores the cycle identity → TG-1
ok · M0M4 exact delivery replay re-enters planning → TG-2
ok · M0M5 claim replay stops returning the durable result → TG-8
ok · M0M6 debt proceeds lose the liability leg → TG-3
ok · M0M7 new debt-proceeds history disappears from the base-currency witness → TG-3
ok · M0M8 the debt-proceeds generic half-undo is reopened → TG-7
ok · M0M9 single undo bypasses the versioned domain dispatcher → IR95
ok · M0M10 batch undo bypasses the versioned domain dispatcher → IR105
ok · M0M11 the planner accepts debt cash without a liability → TG-7
ok · M0M12 grouped writes no longer require complete preflight → TG-7
ok · M0M13 atomic execution stops respecting planned order → TG-7
ok · M0M14 archive search can present a capped page as complete → TG-8
ok · M0M15 planner read evidence is derived but not consumed → TG-8
ok · M0M16 agent output stops consuming semantic voice review → TG-6
ok · M0M17 proactive output stops consuming semantic voice review → TG-6
ok · M0M18 voice policy regresses into an incident blacklist → TG-6
ok · M0M19 capability catalog becomes a manually filtered subset → IR154
ok · M0M20 financial facts disappear from base-currency history → TG-3
ok · M0M21 an individually executed write loses its typed transaction receipt → TG-9
ok · M0M22 whole-operation undo bypasses the versioned reversal dispatcher → TG-9
ok · M0M23 whole-operation undo silently accepts more receipts than any bounded plan can create → TG-9
ok · M0M24 the planner accepts an unbounded action list → TG-10
ok · M0M25 PostgreSQL accepts more plan steps than the planner can prove → TG-10
ok · M0M26 statement imports invoke the durable agent without their persisted root turn → TG-11
ok · M0M27 debt-proceeds replay stops binding the low-level dedupe identity → TG-3
ok · M0M28 debt-proceeds replay skips the persisted intent check → TG-3
ok · M0M29 crossed operation closures abandon deterministic lock order → TG-2
ok · M0M30 a reused delivery key is no longer bound to its persisted root turn → TG-2
ok · M0M31 truncated financial context is presented as complete → TG-8
ok · M0M32 an atomic group ignores an unverified external dependency → TG-9
ok · M0M33 voice-review outage silently authorizes unreviewed prose → TG-6
ok · M0M35 model E2E bypasses the public chat handler → TG-12
ok · M0M36 semantic evaluation stops generating unseen paraphrases → TG-12
ok · M0M37 camelCase transaction receipts stop becoming reversible refs → TG-9
ok · M0M38 Pre-M account reconciliation history disappears from the base-currency witness → TG-3
ok · M0M39 the generic financial algebra is derived but no longer consumed → TG-7
ok · M0M40 the validated plan is no longer executed deterministically → TG-10
ok · M0M41 the response model regains execution authority after the plan ran → TG-10
ok · M0M42 an atomic group may wrap an interleaved independent action → TG-10
ok · M0M43 occurrence-first and fact-first transactions lose their shared identity lock → TG-1
ok · M0M44 an infrastructure failure returns to an empty assistant bubble → IR310
ok · M0M45 the legacy response prompt regresses to an incident-specific warning label → TG-6
ok · M0M46 the founder E2E no longer proves the already-booked salary context → TG-12
ok · M0M47 one missing datum freezes every independent action again → TG-9
ok · M0M48 the runtime stops requesting partial verification → TG-9
ok · M0M49 planned missing fields no longer block their named action → TG-9
ok · M0M50 a read-only action is admitted into an atomic write group → TG-10
ok · M0M51 SQL accepts a missing field aimed at a nonexistent step → TG-10
ok · M0M52 open-operation context hides receipts from prior plan versions → IR272
ok · M0M53 operation undo forgets writes from prior plan versions → TG-9
ok · M0M54 partial verification is silently disabled inside PostgreSQL → TG-9
ok · M0M55 a needs-info receipt is rejected merely because its dependency did not run → TG-9
ok · M0M56 a continuation is invited to repeat already verified work → TG-2
ok · M0M57 the planner no longer receives prior-version step receipts → TG-9
ok · M0M58 fact-first satisfaction stops persisting its durable audit link → TG-1
ok · M0M59 get_financial_context drops the recurring-income catalog → TG-8
ok · M0M60 a financial balance can masquerade as configuration → TG-7
ok · M0M61 exact redelivery again depends on context and planner availability → TG-2
ok · M0M62 identity updates stop refreshing the durable fact link → TG-1
ok · M0M63 occurrence updates wait in a row/advisory deadlock instead of retrying → TG-1
ok · M0M64 sharing one account again makes independent facts one all-or-nothing group → TG-7
ok · M0M65 an economic tool may omit its accounting event → TG-7
ok · M0M66 the live catalog computes effect semantics but does not consume them → IR154
ok · M0M67 a domain-state tool may claim it moved money → TG-7
ok · M0M68 a newly unclassified mutating tool silently receives a default → TG-7
ok · M0M69 K learned observations disappear from the base-currency witness → TG-3
ok · M0M70 a stale planner can save after another worker reclaimed the delivery → TG-2
ok · M0M71 a recovered delivery can detach from the operation whose receipts make replay safe → TG-2
ok · M0M72 an inflight duplicate publishes a fallback reply over the winning worker → IR148
ok · M0M73 metadata-only correction is mislabeled as an unavoidable money event → TG-7
ok · M0M74 a continuation may repeat a side effect that already landed → TG-2
ok · M0M75 PostgreSQL accepts the same settled write under a renamed continuation step → TG-2
ok · M0M76 the planner labels a mutating action as a read-and-replan pass → TG-10
ok · M0M77 the read phase invokes a mutating tool before checking its authority → TG-10
ok · M0M78 unrecorded returned capital can fabricate a receivable side effect → TG-7
ok · M0M79 a typed writer can claim a second economic event it never executes → TG-7
ok · M0M80 learned memory omitted from the prompt is reported as complete → TG-8
ok · M0M81 learned-memory recovery is mislabeled as a write → TG-8
ok · M0M82 learned-memory search ignores the complete catalog → TG-8
ok · M0M83 prompt omissions are computed but not delivered to the planner → TG-8
ok · M0M84 PostgreSQL stops checking the resolved capital amount against the persisted plan → TG-7
ok · M0M85 PostgreSQL stops checking a resolved card amount against the persisted plan → TG-7
ok · M0M86 an omitted counterparty silently allocates across several receivables → TG-7
ok · M0M87 a repayment amount may exceed the proven outstanding balance → TG-7
ok · M0M88 the planner may write a repayment without reading exact receivable ids → TG-7
ok · M0M89 the receivable catalog is mislabeled as a mutating tool → TG-7
ok · M0M90 the grouped adapter ignores a mismatch between planned and resolved receivables → TG-7
ok · M0M91 PostgreSQL accepts an allocation for a receivable absent from the persisted plan → TG-7
ok · M0M92 the legacy path degrades an unmatched repayment to ordinary income → TG-7
ok · M0M93 a receivable repayment can masquerade as payday coaching → TG-7
ok · M0M94 the live executor ignores receivable ids from its validated plan → TG-7
ok · M0M95 the complete receivable reader is declared but not dispatchable → TG-7
ok · M0M96 PostgreSQL stops requiring repayment allocations to sum to the cash entry → TG-7
ok · M0M97 a concurrent repayment replay collides while inserting its durable marker → TG-7
ok · M0M98 generic reversal restores repayment cash without restoring the receivable → TG-9
ok · M0M99 universal undo skips the receivable repayment domain writer → TG-9
ok · M0M100 repayment undo reverses cash but no longer restores outstanding receivable → TG-9
ok · M0M101 concurrent repayment replay stops comparing the committed marker fingerprint → TG-7
ok · M0M102 repayment receipts omit the receivable surfaces changed by the atomic group → TG-7
ok · M0M103 one missing card datum reopens every action that uses the same capability → TG-2
ok · M0M104 contextual writers may claim any valid economic algebra even when no typed mode executes it → TG-7
ok · M0M105 reopening a terminal occurrence leaves its stale fact current and the reminder permanently silent → TG-1
ok · M0M106 agent writers drop the trusted FX snapshot and ask for a rate the user already has → TG-8
ok · M0M107 a forward ledger write can complete without a durable transaction receipt → TG-9
ok · M0M108 unrecorded capital return drops the transaction id produced by the ledger → TG-9
ok · M0M109 the canonical chat applier hides every financial transaction receipt from its callers → TG-9
ok · M0M110 a multi-source card payment records its group but not its ledger legs → TG-9
ok · M0M111 reopening a resolved card ask forgets the still-live bank statement fact → TG-1
ok · M0M112 the primary agent invokes a second response model inside its writer → TG-6
ok · M0M113 expense writes rebuild a second stale context before the primary response pass → TG-6
ok · M0M114 a failed calendar read is presented to the planner as a complete empty calendar → TG-8
ok · M0M115 the durable reversal marker rejects a valid fifteen-row batch after reversing it → TG-9
ok · M0M116 the versioned batch dispatcher keeps the obsolete ten-row ceiling → TG-9
ok · M0M117 re-resolving an occurrence with identical evidence leaves its retired fact inactive → TG-1
ok · M0M118 a second delivery may continue an operation that is still applying → TG-2
ok · M0M119 the planner persists a dependent group with no transactional adapter → TG-10
ok · M0M120 conversation memory loses date-window browsing and can only recover remembered words → TG-8
ok · M0M121 open durable work is truncated to twenty rows and the agent locks out on the twenty-first → IR272
ok · M0M122 the live claim discards the operation versions observed by the planner → TG-2
ok · M0M123 PostgreSQL accepts a continuation planned on a stale operation version → TG-2
ok · M0M124 worker recovery re-samples the planner instead of resuming the persisted plan → TG-13
ok · M0M125 the recovery RPC stops proving plan-step parity → TG-13
ok · M0M126 the planner admits a naked replacement movement without reversing its operation → TG-13
ok · M0M127 the atomic replacement adapter loses the durable correction target → TG-13
ok · M0M128 PostgreSQL accepts a replacement without an earlier operation reversal → TG-13
ok · M0M129 financial-context failure disappears before any durable intake record → TG-14
ok · M0M130 an intake delivery key may be reused for different request text → TG-14
ok · M0M131 execution no longer waits for the intake marker to close → TG-14
ok · M0M132 an intake failure can be resolved by an unrelated operation → TG-14
ok · M0M133 the model is no longer taught the only valid atomic correction shape → TG-13
ok · M0M134 deleting an operation nulls a resolved intake and recreates an account-deletion lock-out → TG-14
ok · M0M135 an unusable pending question disappears without a durable intake failure → TG-14
ok · M0M136 a stale operation snapshot disappears before claiming a durable operation → TG-14
ok · M0M137 an operation-claim failure leaves no durable retry evidence → TG-14
ok · M0M138 a corrupt recovered plan keeps a planning lease instead of becoming retriable → TG-14
ok · M0M139 a bare undo of a prior correction is allowed without replacement truth → TG-13
ok · M0M140 correction lineage sends old reversal receipts into reversal-of-reversal → TG-13
ok · M0M141 a settled step accepts a different result when status and effect match → TG-15
ok · M0M142 a settled step accepts different affected refs under the same result → TG-15
ok · M0M143 web retry invents a new delivery identity after an unknown outcome → TG-6
ok · M0M144 completed-operation archive ignores the user's semantic query → TG-16
ok · M0M145 completed-operation search presents a capped archive as complete → TG-16
ok · M0M146 executor computes operation search criteria but never consumes them → TG-16
ok · M0M147 evidence failure returns to an empty webhook reply → TG-17
ok · M0M148 web evidence renders a retryable transport failure as an agent reply → TG-17
ok · M0M149 file-delivery failure stops being UI state outside the conversation → TG-17
ok · M0M150 model correction test leaves its target inside the latest-operation shortcut → TG-12
ok · M0M151 a grouped log_movement is admissible again outside a whole-operation correction → TG-13b
ok · M0M152 plan validation asks the group predicate without the group's real membership → TG-13b
ok · M0M153 the evaluation bridge trusts NODE_ENV alone and stays reachable through a tunnel → TG-12b
ok · M0M154 a voice-judge outage again spends a repair as if it were a verdict → TG-6b
ok · M0M155 a verified style rejection again silences every safe candidate → TG-6b
ok · M0M156 an unverified review can launder voseo because the deterministic backstop went blind → TG-6b
ok · M0M176 the voice judge can reject an answer for naming the user's own card → TG-6c
ok · M0M157 a migration function ships without pinning its search_path → TG-1b
ok · M0M158 reopening ignores the exact bank fact superseded by the retired resolution → TG-1c
ok · M0M159 occurrence reopen no longer serializes with concurrent fact publication → TG-1c
ok · M0M160 corrected statement evidence reuses the cycle birth timestamp → TG-1c
ok · M0M161 the local evaluation route stops consuming its bearer authority → TG-12b
ok · M0M162 the model E2E health check omits the shared evaluation secret → TG-12b
ok · M0M163 whole-operation undo returns to a global fixture balance instead of its local delta → TG-1c
ok · M0M164 single-operation undo returns to a global fixture balance instead of its local baseline → TG-1c
ok · M0M165 reopened statement test stops checking the restored monetary payload → TG-1c
ok · M0M166 legacy restoration trusts a live source id without matching its monetary payload → TG-1c
ok · M0M167 whole-operation undo drops card identity before comparing restored debts → TG-1c
ok · M0M168 model E2E writes timezone into the nonexistent profiles column and never reaches the agent → TG-12
ok · M0M169 model E2E asks the non-variable salary resolver to accept an unsupported explicit payment date → TG-12
ok · M0M170 model E2E aborts instead of retrying the exact durable delivery after an unpublishable sample → TG-12
ok · M0M171 verified read-only context is derived but never consumed by the final money barrier → TG-8
ok · M0M172 a plan with a financial action can launder broad pre-write context into its final reply → IR113b
ok · M0M173 a no-action answer sends tool_choice without tools and the OpenAI API rejects the turn → TG-12c
ok · M0M174 the final voice repair sends tool_choice without tools and is dead on first use → TG-12c
ok · M0M175 pending-question voice repair sends tool_choice without tools and is dead on first use → TG-12c
ok · M0M177 calendar predicates become entity anchors and reject a grounded amount-plus-date answer → IR113c
ok · M0M178 a financial role must appear beside the amount instead of anywhere proven for the same entity → IR113c
ok · M0M179 one entity borrows its financial role from a different entity → IR113c
ok · M0M180 legacy fact restoration again relies on WHERE predicate order before a numeric cast → TG-1d
ok · M0M181 production planner gives up before repairing a deterministic contract failure → TG-3b
ok · M0M182 planner repair hides the deterministic reason and asks the model to guess again → TG-3b
ok · M0M183 planner repair accepts an invalid economic candidate instead of revalidating it → TG-3b
ok · M0M184 economic validation tells the planner that a leg is missing but not which one → TG-3b
ok · M0M185 unrecorded returned capital again requires a fictitious counterparty name → TG-3
ok · M0M186 executor again blocks unrecorded returned capital on an economically irrelevant name → TG-3
ok · M0M187 a continuation forgets entities explicitly named in its immutable root request → IR143
ok · M0M188 production reads durable continuation/recovery authority but never gives it to the entity guard → IR143
ok · M0M189 each amount in a natural multi-card summary is again bound to every card in the sentence → IR113c
ok · M0M190 a failed historical step is promoted to verified write evidence → IR113d
ok · M0M191 verified completed-operation receipts are derived but never given to the action grounding barrier → IR113d
ok · M0M192 historical write prose again requires a write in the current delivery → IR113d
ok · M0M193 typed receipt amounts without a currency suffix disappear from grounding → IR113d
ok · M0M194 the planner trusts conversation prose instead of reading completed-operation receipts → TG-8
ok · M0M195 a READY plan again discards the exact pending question needed after worker recovery → TG-1e
ok · M0M196 the finalizer computes calendar grounding but stops consuming its verdict → IR113c
ok · M0M197 a true due date for one card authorizes the same date on another card → IR113c
ok · M0M198 an invented calendar day is accepted as long as the entity and role are real → IR113c
ok · M0M199 an unrelated operation timestamp again proves a card due date → IR113c
ok · M0M200 open-operation context drops user entities introduced on intermediate clarification turns → IR143
ok · M0M201 punctuation after a user-named account makes the durable mention disappear → IR143
ok · M0M202 the PostgreSQL E2E stops proving that READY recovery retains its exact question → TG-1e
ok · M0M203 the PostgreSQL E2E stops proving that every user clarification remains bound to its operation → IR143
ok · M0M204 PostgreSQL again allows a READY plan to persist missing fields without any recoverable question → TG-1e
ok · M0M205 the PostgreSQL E2E stops challenging a READY plan whose missing fields have no question → TG-1e
ok · M0M206 a relative due date publishes without proving the user's local calendar day → IR113c
ok · M0M207 production derives the local date but never gives it to the publication barrier → IR113c
ok · M0M208 relative dates are resolved in UTC instead of the user's timezone → IR113c
ok · M0M209 a stale compiled eval server can masquerade as the current source tree → TG-12
ok · M0M210 the model E2E health check accepts a server with a different runtime contract → TG-12
ok · M0M211 publication failures again lose the exact failed contract → IR113c
ok · M0M212 a successful model-eval turn omits the compiled runtime contract → TG-12
ok · M0M213 the official financial snapshot remains a doubly-escaped string and its typed money cannot bind → IR113b
ok · M0M214 an arbitrary user-forged tagged object is promoted to verified structured money evidence → IR113b
ok · M0M215 the official financial snapshot is parsed but the verified evidence still consumes the escaped original → IR113b
ok · M0M216 a typed dueDay borrows the cutoff role from a neighbouring field in the same card object → IR113b
ok · M0M217 open-operation continuity is cut off by the app process clock again → IR217
ok · M0M218 completed-operation search is cut off by the app process clock again → IR217
ok · M0M219 the database clock is rounded backwards to milliseconds before bounding committed rows → IR217
ok · M0M220 authenticated gains authority to execute the internal operation snapshot clock → IR217
ok · M0M221 the PostgreSQL E2E stops proving continuity against a process clock one day behind the database → IR217
ok · M0M222 a typed statement date is relabelled as a payment due date by a neighbouring field in the same card object → IR113b
ok · M0M223 a two-digit calendar day is reparsed as its first digit and makes valid grounded replies impossible → IR113b
ok · M0M224 the DD-MM tail inside an ISO date is accepted as a second inverted calendar fact → IR113b
ok · M0M225 user-owned prose inside the verified snapshot becomes deterministic money evidence → IR113b
ok · M0M226 user-owned prose inside the verified snapshot becomes deterministic calendar evidence → IR113b
ok · M0M227 the trusted typed calendar facts are derived but omitted from verified read evidence → IR113b
ok · M0M228 an injected closing tag escapes the structured evidence mask → IR113b
ok · M0M229 verified writes from a still-open operation disappear from conversational audit replies → IR218
ok · M0M230 the bounded repair pass is not told which deterministic publication contract rejected the first reply → IR218
ok · M0M231 the planner again treats optional movement metadata as a blocking missing fact → IR218
ok · M0M232 the live-model E2E again expects a destructive operation to bypass its server-owned confirmation → IR218
ok · M0M233 a stale v13 model-eval runtime can impersonate the operation-inspection contract → TG-12
ok · M0M234 the planner again describes unrecorded capital prose without requiring its unchanged legs → IR219
ok · M0M235 a whole-operation correction may again hide its replacements in an unsupported batch → IR219
ok · M0M236 the repair prompt lies about the single bounded style attempt → IR219
ok · M0M237 an ordinary registered repayment again becomes a proposal that waits for redundant confirmation → IR219
ok · M0M238 a destructive repayment undo fixture again skips its server-owned proposal → IR219
ok · M0M239 a money-grounding repair may repeat the same unbound figures forever → IR219
ok · M0M240 typed planner entity refs are again rejected unless they are bare UUIDs → IR256
ok · M0M241 the PostgreSQL correction fixture stops exercising the model's typed account reference → IR256
ok · M0M242 a typed cash reference is compared as a debt resource at the SQL boundary → IR256
ok · M0M243 grouped paid-in-full is rejected before the card can derive its stored statement amount → IR257
ok · M0M244 the PostgreSQL E2E hardcodes the full payment amount and bypasses the real derivation → IR257
ok · M0M245 grouped paid-in-full stops consuming the card's stored obligation → IR257
ok · M0M246 paid-in-full SQL preflight trusts the optional planned amount instead of the live statement → IR258
ok · M0M247 the live card-payment predicate is left in the function body but neutralized → IR258
ok · M0M248 the grouped adapter routes a statement-total fallback as a plain payment → IR258
ok · M0M249 the atomic statement may claim a different paid amount than its ledger leg → IR258
ok · M0M250 PostgreSQL coverage forgets the two statement-payload forgeries → IR258
ok · M0M251 ME10aa again queries a reversal marker column that does not exist → IR259
ok · M0M252 ME10aa returns to a distant global balance instead of the local correction delta → IR259
ok · M0M253 ME10aa counts reversals without binding them to the original transaction ids → IR259
ok · M0M254 ME10aa accepts any two replacement expense amounts → IR259
ok · M0M255 ME10aa stops binding the durable reversal marker to the exact original pair → IR259
ok · M0M256 an ordinary proved batch is challenged as if its amount associations were unknown → IR260
ok · M0M257 a batch accepts amounts that are present but attached to the opposite descriptions → IR260
ok · M0M258 nested account selections in a batch bypass the entity-authority guard → IR260
ok · M0M259 production stops passing the user's local day into the planner → IR260
ok · M0M260 a future movement date is diagnosed but the planner consumes it anyway → IR260
ok · M0M261 the planner prompt loses the authoritative local date even though the validator still has it → IR260
ok · M0M262 verified historical amounts are derived but discarded before reply publication → IR260
ok · M0M263 requested historical amounts remain in the barrier but no longer reject an incomplete explanation → IR260
ok · M0M264 the model E2E again requires a second confirmation for an explicit ordinary expense batch → IR260
ok · M0M265 a ready unrecorded capital return can again be blocked by optional provenance → IR261
ok · M0M266 the capital-return readiness contract again makes the optional person mandatory → IR261
ok · M0M267 the server challenge again dictates a rigid command instead of requesting natural explicit confirmation → IR261
ok · M0M268 an actually empty reply is again collapsed into a generic structural failure → IR261
ok · M0M269 deterministic non-neutral voice again shares the structural failure label → IR261
ok · M0M270 a published style exception loses its typed advisory identity → IR261
ok · M0M271 the bounded repair again tells users to copy a rigid confirmation phrase → IR261
ok · M0M272 record_person_payment loses the canonical occurrence date from its closed schema → IR262
ok · M0M273 the atomic person-payment adapter reads the card-payment date alias again → IR262
ok · M0M274 the individual person-payment executor ignores a proved historical date and always writes today → IR262
ok · M0M275 a future person-payment date bypasses the planner calendar boundary → IR262
ok · M0M276 planner argument validation is derived but its incompatible payload verdict is ignored → IR262
ok · M0M277 an invented model property is again presented as user-answerable missing information → IR262
ok · M0M278 the refund path drops the proved person-payment date at the writer boundary → IR262
ok · M0M279 an invalid grouped person-payment date silently degrades to today → IR262
ok · M0M280 an invalid individual person-payment date silently degrades to today → IR262
ok · M0M281 a required argument omitted by the planner becomes an unrelated user question instead of an internal repair → IR262
ok · M0M282 Spanish token overlap again becomes execution authority over a typed pending → IR316
ok · M0M283 record_person_payment may claim a counterparty balance its writer never changes → IR263
ok · M0M284 the model E2E again rejects ordinary Spanish containing de una sola operación → IR263
ok · M0M285 ME4 stops checking the durable pending clarification after partial writes → IR263
ok · M0M286 the planner prompt again invites counterparty balances that no person-payment writer executes → IR263
ok · M0M287 ME5 again leaves the status-answer operation awaiting instead of completing it → IR265
ok · M0M288 whole-operation undo proposal again depends on the infinitive deshacer → IR264
ok · M0M289 an ordinary registered repayment again waits for a redundant confirmation → IR264
ok · M0M290 repayment undo proposal again depends on one verb conjugation → IR264
ok · M0M291 a pending-tool assertion no longer proves that the proposal wrote nothing → IR264
ok · M0M292 a pending-tool assertion no longer proves the durable operation is awaiting input → IR264
ok · M0M293 planner-authored pending accepts an action id for the wrong capability → IR264
ok · M0M294 direct ordinary expenses again pass by absence of a word instead of proved completed state → IR264
ok · M0M295 a stale v14 eval runtime can impersonate the operation-inspection harness → TG-12
ok · M0M296 planner-authored pending is ignored unless it names the capability as its author → IR264
ok · M0M297 response-scoped missing field again requires an invented financial action → IR264
ok · M0M298 a stale v17 eval runtime can impersonate the operation-inspection harness → TG-12
ok · M0M299 a status answer again copies an observed operation's missing field into a new awaiting row → IR265
ok · M0M300 an unknown operation id is accepted as read-only observed authority → IR265
ok · M0M301 observed pending state is persisted as if it belonged to the status-answer operation → IR265
ok · M0M302 observed pending state stops constraining the status answer publication → IR265
ok · M0M303 planner instructions again tell a status query to copy the old missing field → IR265
ok · M0M304 ME5 stops proving that the original operation remains awaiting its real answer → IR265
ok · M0M305 live planner samples can omit the operation-inspection field and fall back to legacy ambiguity → IR265
ok · M0M306 a descriptive participle is again treated as a write claimed by Kipu → IR266
ok · M0M307 perfect and impersonal mutation claims no longer require a receipt → IR266
ok · M0M308 a clause-terminal state can again announce an unproved write → IR266
ok · M0M309 listo used as ordinary discourse is again mistaken for a completed mutation → IR266
ok · M0M310 the publication barrier stops consuming the mutation-claim verdict → IR266
ok · M0M311 direct listo and hecho receipts no longer require proof → IR266
ok · M0M312 accented impersonal preterites fall through the ASCII word-boundary trap → IR266
ok · M0M313 Kipu can again claim dejé registrado without a proved write → IR266
ok · M0M314 a proposal subjunctive is again treated as Kipu claiming a completed write → IR266
ok · M0M315 a success receipt after comma or colon escapes the write barrier → IR266
ok · M0M316 an unbound passive state can again claim a completed event → IR266
ok · M0M317 operation undo again classifies every domain write as ledger money → TG-9
ok · M0M318 the PostgreSQL regression fixture stops adding a receipt-less domain write → TG-9
ok · M0M319 an expense write is mislabeled as non-economic and can evade its receipt requirement → TG-9
ok · M0M320 deterministic publication failure is sent to the style judge and can be laundered → TG-6b
ok · M0M321 a rejected pending-question repair deletes the original truth-safe question → TG-6b
ok · M0M322 durable operation replay loses the style advisory that explains what was published → TG-6b
ok · M0M323 chat metadata drops the non-blocking style rejection from review tooling → TG-6b
ok · M0M324 a sentence boundary lets a bare success receipt escape the write barrier → IR266
ok · M0M325 live planning validates the model choreography without compiling its unambiguous correction wiring → IR267
ok · M0M326 the correction compiler accepts two competing whole-operation undos → IR267
ok · M0M327 the correction compiler invents a relationship for wholly ungrouped actions → IR267
ok · M0M328 a safe AI-authored intake failure is discarded and the user receives an empty transport failure → IR268
ok · M0M329 a pre-plan failure invents a user-answerable missing requirement → IR268
ok · M0M330 a pre-plan failure can claim a completed write instead of stating that nothing changed → IR268
ok · M0M331 a pre-plan fallback can repeat an ungrounded amount or date → IR268
ok · M0M332 the intake fallback bypasses the normal deterministic publication boundary → IR268
ok · M0M333 the mutation audit starts from a red capture baseline and mislabels inherited failures as killed mutants → IR269
ok · M0M334 planner repair discards the per-attempt contract reasons before the expensive sample can be diagnosed → TG-3b
ok · M0M335 durable intake stores a reduced error instead of the typed diagnostic returned to QA → IR270
ok · M0M336 a successful safe fallback hides its intake failure from the orchestrator metadata → IR270
ok · M0M337 the model E2E reads intake diagnostics only on HTTP failure and loses successful safe-fallback evidence → IR270
ok · M0M338 one failed seed is again reported as seven independent downstream product regressions → IR270
ok · M0M339 planner validation bypasses canonical economic protocol labels and repeats the same repair error → IR271
ok · M0M340 canonical relabeling is allowed even when the resulting financial shape violates the typed writer → IR271
ok · M0M341 card-payment tool documentation again calls the event a transfer and teaches the planner the wrong ontology → IR271
ok · M0M342 canonical card-payment classification is again mapped to transfer → IR271
ok · M0M343 the open read stops failing closed when the snapshot omits its completeness verdict → IR272
ok · M0M344 the snapshot RPC declares a capped operation set as the complete whole → IR272
ok · M0M345 a child row outside the returned parent set is silently accepted instead of refusing the read → IR276
ok · M0M346 a stale server contract certifies the snapshot-read fix that it does not contain → TG-12
ok · M0M347 intake failures duplicate the raw user message into the durable row again → IR273
ok · M0M348 the completed-archive scan declares a capped candidate set as the complete whole → IR276
ok · M0M349 the PostgreSQL battery loses the CAP+1 completeness probe of the snapshot read → IR272
ok · M0M350 the PostgreSQL battery loses the two-connection torn-snapshot probe → IR272
ok · M0M351 the PostgreSQL battery stops proving that intake rows carry no raw message → IR273
ok · M0M352 the batch receipt loses its per-row amounts and a truthful reply starves at money_not_grounded again → IR274
ok · M0M353 the batch receipt drops its typed per-movement identity → IR274
ok · M0M354 a semantic-filter miss is again presented as absence of the whole history → IR275
ok · M0M355 the filter miss stops degrading to the unfiltered recent operations → IR275
ok · M0M356 the PostgreSQL battery loses the filter-miss evidence probe → IR275
ok · M0M357 the completed archive silently returns to a multi-statement page assembly → IR276
ok · M0M358 the archive bundle stops verifying terminal identity against the scan phase → IR276
ok · M0M359 queryMatched collapses back to a binary that asserts absence over a capped scan → IR277
ok · M0M360 the PostgreSQL battery loses the concurrent archive-presence probe → IR276
ok · M0M361 the PostgreSQL battery loses the capped-no-match ternary probe → IR277
ok · M0M363 an archive bundle step outside the chosen parent set is silently accepted → IR276
ok · M0M362 the PostgreSQL battery loses the match-beyond-window probe → IR277
ok · M0M364 an undo refusal collapses back into one branchless word → IR278
ok · M0M365 the undo executor stops persisting the refusal branch into its durable receipt → IR278
ok · M0M367 the completeness contract is declared but never consumed at the publication boundary → IR280
ok · M0M368 the planner drops response_requirements while persisting the validated plan → IR280
ok · M0M369 the orchestrator stops handing the plan contract to the finalizer → IR280
ok · M0M370 coverage is declared without the value appearing in the published text → IR279
ok · M0M371 a money fact bound to a different entity satisfies the requirement again → IR279
ok · M0M372 an unprovable requirement is demanded as an affirmative fact → IR279
ok · M0M373 the completeness contract stops being minimal and may swallow every assertion → IR280
ok · M0M374 casual conversation may again be handed money requirements → IR280
ok · M0M375 the canonical fallback is disabled and a repeated omission becomes a lost answer → IR280
ok · M0M379 the planner-authored fallback template is dropped before publication → IR280
ok · M0M376 the canonical fallback is published without re-running every truth barrier → IR280
ok · M0M377 a turn that legitimately asks is again forced to satisfy the answer contract → IR282
ok · M0M378 unsupported qualitative kinds pretend that naming an entity proves its state again → IR282
ok · M0M382 a factual answer silently opts out with an empty completeness contract → IR280
ok · M0M383 the planner validates the fallback template but drops it from the durable plan → IR280
ok · M0M384 the canonical fallback disables the same completeness contract it is meant to satisfy → IR280
ok · M0M385 a money requirement with an unknown entity becomes demandable again → IR279
ok · M0M386 an entity requirement may claim one entity while pointing at another → IR281
ok · M0M387 one ungrounded slot again suppresses every grounded fallback fact → IR280
ok · M0M388 the planner prompt hides the exact date value wire shape again → IR280
ok · M0M389 date requirements may use an undocumented value alias again → IR280
ok · M0M390 planner repair loses the exact rejected date field path → IR280
ok · M0M391 bounded planner repair receives a generic error instead of the actionable path → IR280
ok · M0M392 an ungrounded fallback slot republishes the planner's unverified number → IR280
ok · M0M393 requirement grounding again treats entity and amount coexistence as a binding → IR279
ok · M0M394 the prompt stops teaching the exact response-requirement id grammar → IR280
ok · M0M395 an invalid requirement id bypasses the documented slot grammar → IR280
ok · M0M396 a requirement can omit the verified evidence source → IR280
ok · M0M397 a lowercase currency is silently normalized instead of repaired → IR280
ok · M0M398 an impossible calendar date enters the durable response contract → IR280
ok · M0M399 a qualitative observed-operation answer is forced back into an impossible canonical contract → IR265
ok · M0M400 the planner is not taught that observed qualitative pending state is an alternative completeness authority → IR265
ok · M0M401 any factual answer opts out merely because an inspectable operation exists elsewhere → IR265
ok · M0M402 any observed operation waives completeness even when it owns no durable pending question → IR265
ok · M0M403 an observed operation launders unrelated financial assertions past completeness → IR265
ok · M0M404 the publication result drops the exact bounded money-grounding diagnosis → IR283
ok · M0M405 the bounded repair no longer receives the exact rejected monetary figures → IR283
ok · M0M406 post-write prose may again cite unrelated amounts from the earlier financial context → IR283
ok · M0M407 an expensive model failure again deletes the bounded money-grounding diagnosis before cleanup → IR283
ok · M0M408 the planner prompt again hides the exact observed-operation assertion source contract → IR284
ok · M0M409 an invalid observed assertion source again returns only the downstream generic contract error → IR284
ok · M0M410 prompt, validator and fixture again disagree about the observed-operation source root → IR284
ok · M0M411 a recovered HTTP-200 intake failure again disappears from turnDetail before disposable cleanup → IR285
ok · M0M412 an exact stable fixed-expense amount again requires a third user confirmation after the source account was supplied → IR286
ok · M0M413 a planner may ask again for an argument already present in its validated action → IR287
ok · M0M414 a lexical false negative in a pending question degrades to no-action instead of rendering every typed answer shape → IR287
ok · M0M415 the live-model gate stops treating empty or failed deliveries as anti-bot violations → IR310
ok · M0M416 the planner again validates before adopting an exact stored fixed-expense amount → IR288
ok · M0M417 the stored fixed-expense compiler derives currency but drops the monetary value → IR288
ok · M0M418 a resolved entity forgets the user-authored root of its exact durable operation → IR289
ok · M0M419 a fixed-expense link again matches only the latest clarification turn → IR289
ok · M0M420 a newly named entity no longer refutes the stale entity inherited from the operation root → IR289
ok · M0M421 a corrected fixed-expense name is ignored while the stale root entity remains linked → IR289
ok · M0M422 bounded planner repair again treats a rejected action as something that must be kept and mechanically patched → IR290
ok · M0M424 an invalid grouped movement is again told only to add an undo instead of preserving independent work → IR291
ok · M0M425 an internal payload rejection can again be converted into a new user-facing missing field → IR291
ok · M0M426 a response-scoped missing field no longer needs a matching user-evidence ambiguity → IR291
ok · M0M427 the planner can again self-declare an ambiguity without explaining the missing real-world fact → IR291
ok · M0M428 the planner is again told that an internal validation failure is a datum the user can supply → IR291
ok · M0M430 bounded repair computes the transition guard but does not consume it before accepting the next candidate → IR291
ok · M0M431 an authorized manifest again has to repeat an account name in the latest sentence → IR297
ok · M0M432 an authorized operation is again rerouted by a lexical correction matcher → IR297
ok · M0M433 a manifest-authorized movement again enters the text-driven duplicate/correction guard → IR297
ok · M0M434 an exact card-payment manifest again depends on parsing the confirmation sentence → IR297
ok · M0M435 an awaiting-input plan tries to register a ready-only operation manifest → IR297
ok · M0M436 post-execution equality no longer requires every authorized action to have one step → IR295
ok · M0M437 M0.11A drops the legacy challenge index before every rollback path has left it → IR296
ok · M0M438 a paraphrased stalled question can loop forever after the one clarified retry → IR293
ok · M0M439 a semantic transition changes durable state without participating in operation CAS → IR296
ok · M0M440 manifest verification collapses execution failures back into one misleading diagnosis → IR299
ok · M0M441 the planner-facing provenance catalogue stops using the money ontology shared with runtime → IR300
ok · M0M443 provenance repair again reports one symptom instead of the exact required path set → IR300
ok · M0M444 the lifecycle prompt no longer consumes the shared transition wire contract → IR301
ok · M0M445 modified work may target an operation other than its declared continuation → IR301
ok · M0M446 the planner no longer sees the second-delivery policy used by validation → IR301
ok · M0M447 a sensitive manifest can omit its operation-level authorization prompt → IR301
ok · M0M448 a read-only observed turn can consume the operation it only meant to inspect → IR301
ok · M0M449 the orchestrator persists a second receipt after a writer already settled its own step → IR302
ok · M0M450 whole-operation undo stops declaring that its database transaction owns the durable step receipt → IR302
ok · M0M451 the model harness queries the legacy per-action challenge through a column that does not exist → IR302
ok · M0M452 whole-operation correction stops proving the operation-level manifest before confirmation → IR302
ok · M0M454 current card statement amounts lose their server-owned stored-fact verifier → IR303
ok · M0M455 the planner stops canonicalizing exact server-owned stored facts before validation → IR303
ok · M0M456 the executor accepts a stored amount without binding the plan source_ref → IR303
ok · M0M457 a read/replan pass can again ask the user before consuming its typed read → IR304
ok · M0M459 duplicate planner actions collapse back into an undiagnostic generic error → IR304
ok · M0M460 the live planner stops consuming the provenance wire generated by runtime ownership → IR305
ok · M0M461 the planner advertises a derived provenance rule before any locked verifier exists → IR305
ok · M0M462 persisted plans stop carrying the exact server validation receipt → IR306
ok · M0M463 a mutated persisted plan is accepted under its old validation receipt → IR306
ok · M0M464 cash direction again masquerades as creditor/debtor direction → IR307
ok · M0M465 a historical statement snapshot blocks a covered zero-balance card forever → IR308
ok · M0M466 a server-owned full-payment amount stops owing provenance when the numeric argument is intentionally omitted → IR309
ok · M0M467 provenance validation again sees only monetary arguments and ignores exact server-materialized claims → IR309
ok · M0M468 stored-fact compilation again refuses an omitted amount even when the same verifier materializes it → IR309
ok · M0M469 the planner stops declaring the semantic quote that binds a user-stated value → IR314
ok · M0M470 an intake contract failure is again mislabeled as model-provider downtime → IR315
ok · M0M471 the final conversational continuity candidate is never published even after crossing every truth guard → IR310
ok · M0M472 an unpublishable agent turn falls back to transport silence again → IR310
ok · M0M473 the durable operation loses the typed publication recovery diagnosis → IR310
ok · M0M474 the store rejects an exact manifest whose complete execution was already verified before publication failed → IR311
ok · M0M475 runtime forgets that an already verified manifest must never execute again → IR311
ok · M0M476 settlement attempts to verify an immutable recovered manifest a second time → IR311
ok · M0M477 a partially verified manifest is allowed to masquerade as fully recovered → IR311
ok · M0M478 PostgreSQL drops the locked card-statement stored-fact verifier → IR311
ok · M0M479 a later read pass may replace the semantic objective and prior-work relationship → IR312
ok · M0M480 a schema missing field loses its mechanically derived action target → IR313
ok · M0M481 a bare number is auto-promoted to user-stated provenance without the model declaring its semantic quote → IR320
ok · M0M482 the last read pass may postpone synthesis again → IR315
ok · M0M483 the orchestrator forgets the semantic goal between read passes → IR315
ok · M0M484 a model-authored pending question is again sent through lexical Spanish interpretation → IR316
ok · M0M485 durable replay stops parsing the typed recovery cause → IR317
ok · M0M486 an outer turn exception is again mislabeled as provider downtime → IR317
ok · M0M487 the semantic root grows another mechanical obligation → IR318
ok · M0M488 a semantic step again asks the model for financial effects → IR318
ok · M0M489 the server stops compiling expense recognition → IR319
ok · M0M490 expected state stops contradicting a reversed cash direction → IR321
ok · M0M491 a multi-step semantic promise is split into independent writes → IR322
ok · M0M492 the public agent boundary lets an untyped failure escape → IR323
ok · M0M493 cached planner input tokens disappear from telemetry → IR324
ok · M0M494 the conversational gate again imports the private planner → IR325
ok · M0M495 a mutating semantic unit again compiles without an observable final-state projection → IR326
ok · M0M496 equal amounts in separate steps again borrow every quote in the semantic unit → IR327
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 490/490
~~~~

### PostgreSQL ×1

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

Exit code: `0`

Salida íntegra:

~~~~text
(node:73954) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M100.0aa · un fallo pre-plan queda durable y un retry exacto incrementa el mismo intake
  ok   · M100.0ab · la identidad del intake no puede reutilizarse para otro mensaje
  ok   · M110.1 · un fallo de intake persiste fingerprint e identidad sin el mensaje crudo
  ok   · M110.2 · el replay del mismo delivery conserva la identidad por fingerprint y nunca resucita el texto
  ok   · M100.0ab2 · una operación con otro texto no puede apropiarse ni cerrar el intake fallido
  ok   · M100.0ac · sólo la operación que posee la delivery puede cerrar el intake antes de ejecutar
  ok   · M100.0a · el primer planner recibe un lease durable antes de pensar
  ok   · M100.0b · una redelivery concurrente queda inflight y no adquiere autoridad paralela
  ok   · M100.0c · un planner sin el lease exacto no puede publicar su plan
  ok   · M100.1 · el adapter real resuelve las cuatro patas del caso founder
  ok   · M100.1a · PostgreSQL compara el payload del capital devuelto con el plan persistido antes de confiar en el adapter
  ok   · M100.1b · PostgreSQL compara cada pago de tarjeta resuelto con su plan antes de confiar en el adapter
  ok   · M100.1ba · PostgreSQL deriva expected_due desde el corte vivo y no confía en el statement del adapter
  ok   · M100.1bb · PostgreSQL liga paid_in_card_currency a la pata de ledger probada
  ok   · M100.2 · el grupo aterriza completo: capital no-ingreso + tres pagos
  ok   · M100.3 · replay del grupo no vuelve a mover ninguna pata
  ok   · M100.4 · la entrega exacta recupera el resultado completado sin replanificar
  ok   · M100.5 · una delivery key no puede cambiar de significado económico
  ok   · M100.6 · la continuidad expone pasos, resultados y refs del plan completado
  ok   · M100.6aa · un receipt asentado acepta únicamente su replay byte-equivalente
  ok   · M100.6ab · mismo status no oculta un resultado o refs divergentes bajo replay
  ok   · M100.6a · una redelivery tras caída recupera el plan persistido, no vuelve a muestrear argumentos
  ok   · M100.6b · reanudar no crea otra versión ni pierde el receipt ya asentado
  ok   · M100.6c · corregir una operación revierte el hecho anterior y aterriza el reemplazo en la misma transacción
  ok   · M100.6d · una corrección de otra corrección revierte sólo el reemplazo vigente y aterriza la nueva verdad
  ok   · M100.6e · deshacer una corrección sin declarar la verdad nueva rehúsa antes de mover dinero
  ok   · M100.1c · el adapter real resuelve devolución de receivable y capital independiente sin degradarlos a ingreso
  ok   · M100.1d · PostgreSQL compara la devolución y sus allocations con el plan persistido
  ok   · M100.1e · devolución agrupada acredita caja y reduce el receivable en la misma transacción
  ok   · M100.1f · replay de la devolución agrupada no acredita ni descuenta dos veces
  ok   · M100.1g · la reversa genérica no puede devolver sólo caja y dejar reducido el receivable
  ok   · M100.1h · undo de operación restaura caja y receivable completos o ninguno
  ok   · M100.1i · dos devoluciones concurrentes con la misma identidad convergen en una sola reducción
  ok   · M100.7 · ¿qué falta? vive durable y una redelivery devuelve la pregunta exacta
  ok   · M100.7a · una respuesta planificada sobre una versión vieja no puede consumir trabajo más nuevo
  ok   · M100.8 · dos canales concurrentes reanudan exactamente una vez
  ok   · M100.8 · un plan READY conserva la pregunta exacta para recuperar el worker después de ejecutar sus pasos independientes
  ok   · M100.8b · PostgreSQL rehúsa cualquier missing_fields sin su pregunta exacta, incluso si el plan queda READY
  ok   · M100.8a · un dato faltante bloquea sólo su paso y el write independiente queda verificado antes de preguntar
  ok   · M100.8ab · cada aclaración de usuario queda ligada a la operación y vuelve como autoridad de entidad completa
  ok   · M100.8aa · PostgreSQL rehúsa repetir un efecto ya aterrizado aunque cambien el id del paso y el orden JSON
  ok   · M100.8b · continuación multivuelta conserva versiones y el undo revierte todo el dinero sin exigir transacción a memoria
  ok   · M100.8c · un write económico sin transacción sigue siendo irreversible y rehúsa todo el undo
  ok   · M100.8b · continuaciones cruzadas toman el mismo orden de locks: una gana y no hay deadlock
  ok   · M100.8g · una operación sin respuesta caduca y deja de alimentar loops futuros
  ok   · M100.8d · abandono explícito mata el trabajo viejo y su pregunta, sin reanudarlo
  ok   · M100.8e · PostgreSQL también rehúsa un plan que excede el límite del planner
  ok   · M100.8f · una delivery key no puede reaparecer ligada a otro turno persistido aunque el texto coincida
  ok   · M100.9 · fondos prestados aterrizan las dos patas y su identidad durable
  ok   · M100.10 · el undo genérico no puede revertir sólo la caja de fondos prestados
  ok   · M100.11 · el dispatcher v3 revierte caja y obligación juntas
  ok   · M100.12 · una corrección de operación deshace las cuatro patas, no una fila aislada
  ok   · M100.13 · replay de undo con otro target se rehúsa
  ok   · M100.13a · un lote válido de quince filas sigue siendo reversible como una sola operación
  ok   · M100.13b · un write individual guarda recibo tipado y también admite undo completo
  ok   · M100.14 · el corte durable satisface Diners por entidad+ciclo y no vuelve al open set
  ok   · M100.15 · corregir un hecho supersede historia y religa la misma ocurrencia
  ok   · M100.15a · reabrir una resolución restaura el corte bancario todavía vigente y no repregunta
  ok   · M100.15b · undo→rehacer con evidencia idéntica reactiva el hecho dedupado y religa la ocurrencia
  ok   · M100.16 · el orden fact→occurrence también queda satisfecho con vínculo durable
  ok   · M100.16a · cambiar la identidad retira el vínculo viejo y restaurarla vuelve a enlazar el hecho correcto
  ok   · M100.16b · hecho y ocurrencia concurrentes convergen sin healer
  ok   · M100.17 · las seis familias terminales publican y satisfacen con una sola primitiva
  ok   · M100.18 · una fuente no puede probar otra entidad o ciclo
  ok   · M100.18b · deshacer una resolución retira su hecho y vuelve a abrir el aviso
  ok   · M100.19 · ACLs y witness cierran side doors de operación/hechos
  ok   · M100.20 · una operación enterrada fuera de las veinte recientes sigue recuperable por su identidad semántica
  ok   · M111.1 · un query sin coincidencias declara el miss del filtro y degrada a las recientes sin filtrar, jamás a «no existe»
  ok   · M109.1 · lecturas concurrentes con la operación mutando jamás devuelven un snapshot roto: ni steps futuros ni una versión vigente incompleta
  ok   · M109.2 · doscientas una operaciones abiertas producen complete=false y el tope jamás se presenta como el conjunto entero
  ok   · M111.2 · diez búsquedas concurrentes con el archivo creciendo jamás pierden una operación completada presente
  ok   · M111.3 · un scan topado sin coincidencias observadas jamás afirma queryMatched=false ni complete=true
  ok   · M111.4 · una coincidencia real fuera de la ventana topada produce complete=false y queryMatched=null, jamás una negación
  ok   · M112.1 · la transición semántica es durable, idempotente y no puede cambiar de significado en replay
  ok   · M112.2 · cuatro acciones ordinarias quedan bajo un solo manifiesto autorizado, no cuatro desafíos
  ok   · M112.3 · autorizado = preparado = ejecutado: las cuatro acciones y argumentos coinciden después de escribir
  ok   · M112.4 · una confirmación natural autoriza las cuatro acciones exactas por CAS sin reescribir payloads
  ok   · M112.5 · una ejecución parcial o distinta falla duro y deja failed_integrity durable
  ok   · M115.1 · el manifiesto prueba paidInFull contra el corte vivo bajo lock y rehúsa un testigo monetario divergente
  ok   · M115.2 · un retry exacto tras write+verify recupera el manifiesto completo sin reejecutarlo; una verificación parcial no obtiene esa salida
  ok   · M114.1 · una tarjeta sin saldo vivo y con ciclo cubierto puede cerrar aunque conserve el mínimo y total históricos
  ok   · M114.2 · un ciclo no cubierto o cualquier saldo actual siguen bloqueando el cierre
Bloque M0 PostgreSQL E2E: 82/82
~~~~


### Tests deterministas nuevos (a)–(h)

Comando: no existe todavía un runner de Etapa 1 ejecutable.

Salida íntegra:

~~~~text
NO EJECUTADO — BLOQUEADO. Las RPC aplicadas no pueden registrar el manifiesto mínimo ni el step incremental pre-write y no existe transición durable de rechazo. No se creó un mock que ocultara esa ausencia.
~~~~

### Dry-run E2E con modelo MOCK contra PostgreSQL real

Comando: no existe todavía un runner de Etapa 1 ejecutable.

Salida íntegra:

~~~~text
NO EJECUTADO — BLOQUEADO. Los escenarios propuesta sensible → confirmación → rechazo/paridad no son representables sobre el esquema aplicado 001–115 sin forzar el envelope legacy o aplicar DDL no autorizado.
~~~~

## 5. Qué no se hizo y qué quedó pendiente

Quedan pendientes todos los puntos de aceptación de Etapa 1:

- Añadir `loop` al modo y enrutarlo sin alterar `on`.
- Crear `kipu-agent-loop.ts`.
- Exponer las 122 tools con schemas completos y el loop de 12 turnos.
- Añadir el modo loop de `executeTool` con solo gates 1–2 omitidos.
- Implementar dispatcher, staging, `confirm_operation` y `reject_operation`.
- Implementar las tres guardas duras y el advisory de cifras.
- Agregar telemetría `assistantMetadata.loopUsage`.
- Añadir el system prompt condensado sin wire protocol.
- Implementar y correr (a)–(h).
- Implementar y correr el dry-run MOCK con PostgreSQL real.

También se mantuvieron las prohibiciones: no se tocó el comportamiento de `on`, no se reescribieron executors, no se aplicaron migraciones, no hubo regex de ruteo, muestras pagadas, commit, push ni deploy.

## 6. Riesgos y objeciones

### 6.1 No existe rechazo durable del manifiesto

Evidencia:

- `112_m0_operation_manifest_authority.sql:206,389,502,541` define solo register/authorize/begin/verify.
- `agent_operation_manifests.status` admite `rejected`, pero ninguna RPC lo produce.
- `agent_operation_manifests_live_uq` mantiene un único `proposed` vivo por conversación.
- `kipu_transition_agent_operation(... abandoned)` cambia `agent_operations`, pero no toca el manifiesto. Usarlo solo deja el `proposed` ocupando el índice parcial y bloquea una propuesta posterior.
- La tabla concede solo `SELECT` a `authenticated` y `service_role`; el write autorizado debe ser una RPC SECURITY DEFINER.

Objeción: §4.3 requiere `reject_operation`, pero 112–115 no suministran la transición que el dispatcher debe envolver. El DDL acotado de §7 cubre solo este hueco.

### 6.2 El registro exige el envelope exacto, no el plan mínimo

Evidencia en `112:253–284`:

- La operación debe estar `ready` y tener el mismo `plan_version`.
- `manifest.actions` debe tener la misma cardinalidad que `v_op.plan.actions`.
- Cada acción se compara por `action_id/id`, capability, arguments, provenance, atomic_group, depends_on, state_witness, effects y postconditions.
- El plan mínimo aprobado `{mode:"loop", stagedActions?, toolTrace}` no contiene `actions` con ese wire.

Objeción: registrar staged calls con arrays vacíos o generar de nuevo el envelope en el wrapper sería exactamente “forzar el shape”, prohibido por §4.5 y por el pedido del founder.

### 6.3 No hay recibo incremental pre-write

Evidencia:

- `kipu_save_agent_operation_plan` crea todos los rows de `agent_operation_steps` a partir de `plan.actions` en una sola operación (`100:1047–1094`).
- `kipu_record_agent_operation_step_outcome` solo acepta operaciones `ready|applying` y un step preexistente con capability + fingerprint exactos (`100:1188–1204`).
- El loop nativo conoce las tool calls incrementalmente. Si ejecuta primero y persiste después, un crash entre writer y receipt obliga a remuestrear; una tool call distinta puede derivar otro fingerprint/dedupe y repetir economía.
- El comentario del store en `agent-operation-store.ts:697–701` reconoce explícitamente ese riesgo y exige reusar steps persistidos, no remuestrear.

Objeción: antes de conectar cualquier write del loop hace falta una RPC aditiva que stagee cada intento exacto bajo lease/CAS **antes** de `executeTool`, y una recuperación que reejecute/reproduzca ese step sin volver a pedirle el significado al modelo.

### 6.4 Los grupos atómicos dependen de effects del planner

Evidencia:

- `kipu_preflight_agent_operation_step` exige un step `preflighted` con `atomic_group` y valida payloads económicos contra `v_op.plan.actions[].effects` (`100:1453–1843`).
- `kipu_apply_operation` requiere al menos dos steps del grupo y que todos tengan preflight tipado (`100:1846–1924`).
- Una tool call nativa trae capability + arguments; no trae el álgebra `effects` del envelope retirado.

Objeción: la frase “usar el grupo atómico existente cuando las acciones son agrupables” no es implementable sin decidir quién materializa esa álgebra. Compilarla otra vez en el wrapper restaura el mismo segundo protocolo. Dejarla vacía debilita TG-7/TG-9 y rompe las precondiciones SQL.

### 6.5 La política tiene 31, no 30, capabilities siempre sensibles

El `Set` en `agent-operation-authority.ts:755–787` contiene 31 strings. Las 8 reglas de `:789–851` sí coinciden con el documento. No se cambió la lista ni se propone reducirla; el dato debe corregirse para que los tests de cobertura no congelen un cardinal obsoleto.

### 6.6 Afirmaciones verificadas sin objeción

- El loop muerto y la asignación vacía existen en las líneas citadas.
- `executeTool` y sus barreras existen; el modo loop puede omitir los dos gates de plan solo cuando el dispatcher/receipt alternativo esté listo.
- La auto-confirmación ya queda rechazada por SQL cuando proposal y authorization comparten delivery.
- La reentrada `already_verified` de 115 existe para el manifiesto legacy verificado.

## 7. DDL propuesto

### 7.1 DDL exacto y acotado para `reject_operation`

Este candidato se imprime para auditoría; **no fue creado como migración ni aplicado**. Cierra manifiesto, evento y operación en una transacción, conserva ownership, delivery posterior, lease, CAS, anti-self-rejection y replay exacto.

~~~sql
-- CANDIDATO ACOTADO: cierra de forma atómica un manifiesto proposed.
-- NO resuelve el staging incremental ni habilita por sí solo la Etapa 1.
create or replace function public.kipu_reject_agent_operation_manifest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_reason text := nullif(btrim(p->>'reason'),'');
  v_transition jsonb;
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_event public.agent_operation_transition_events%rowtype;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_delivery is null or v_lease is null then
    raise exception 'KIPU_VALIDATION: exact rejection identity and lease required'
      using errcode = '22023';
  end if;

  v_transition := jsonb_build_object(
    'kind','rejected',
    'target_operation_id',v_operation,
    'consumed_pending_keys','[]'::jsonb,
    'remaining_pending_keys','[]'::jsonb,
    'rationale',coalesce(v_reason,'El usuario rechazó la propuesta pendiente.')
  );

  select * into v_op
    from public.agent_operations
   where id = v_operation and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned'
      using errcode = '42501';
  end if;

  select * into v_event
    from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_delivery;
  if found then
    if v_event.operation_id <> v_operation
       or v_event.transition_kind <> 'rejected'
       or v_event.transition <> v_transition
       or v_op.status <> 'abandoned' then
      raise exception 'KIPU_DEDUPE_MISMATCH: rejection replay changed meaning'
        using errcode = '22023';
    end if;
    select * into v_manifest
      from public.agent_operation_manifests
     where operation_id = v_operation
       and user_id = v_user
       and status = 'rejected'
     order by plan_version desc
     limit 1;
    if not found then
      raise exception 'KIPU_EFFECT_MISSING: rejected transition has no rejected manifest'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed',
      'id',v_op.id,
      'status',v_op.status,
      'state_version',v_op.state_version,
      'manifest_id',v_manifest.id,
      'manifest_hash',v_manifest.manifest_hash
    );
  end if;

  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict',
      'id',v_op.id,
      'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if v_op.status <> 'planning'
     or v_op.plan_version is null
     or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: rejection has no live exact operation lease'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.agent_operation_deliveries d
     where d.operation_id = v_operation
       and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: rejection delivery does not own operation'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':manifest:' || v_op.channel || ':' || coalesce(v_op.chat_id,''),
    0
  ));

  select * into v_manifest
    from public.agent_operation_manifests
   where operation_id = v_operation
     and user_id = v_user
     and plan_version = v_op.plan_version
     and status = 'proposed'
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: exact proposed operation manifest is missing'
      using errcode = '22023';
  end if;
  if v_manifest.proposed_delivery_key = v_delivery then
    raise exception 'KIPU_VALIDATION: a manifest cannot reject itself in its proposal delivery'
      using errcode = '22023';
  end if;

  insert into public.agent_operation_transition_events(
    user_id,
    operation_id,
    delivery_key,
    transition_kind,
    target_operation_id,
    transition,
    before_state,
    after_state
  ) values (
    v_user,
    v_operation,
    v_delivery,
    'rejected',
    v_operation,
    v_transition,
    jsonb_build_object(
      'operation_id',v_operation,
      'status','awaiting_input',
      'state_version',v_expected - 1,
      'manifest_hash',v_manifest.manifest_hash
    ),
    jsonb_build_object(
      'operation_id',v_operation,
      'status','abandoned',
      'state_version',v_expected + 1,
      'manifest_hash',v_manifest.manifest_hash
    )
  )
  returning * into v_event;

  update public.agent_operation_manifests
     set status = 'rejected'
   where id = v_manifest.id
   returning * into v_manifest;

  update public.agent_operations
     set status = 'abandoned',
         state_version = state_version + 1,
         missing_fields = '[]'::jsonb,
         pending_question = null,
         last_operation_transition = v_transition,
         semantic_stall_count = 0,
         lease_token = null,
         lease_expires_at = null,
         completed_at = null
   where id = v_operation
   returning * into v_op;

  return jsonb_build_object(
    'outcome','rejected',
    'id',v_op.id,
    'status',v_op.status,
    'state_version',v_op.state_version,
    'manifest_id',v_manifest.id,
    'manifest_hash',v_manifest.manifest_hash
  );
end;
$$;

alter function public.kipu_reject_agent_operation_manifest(jsonb)
  owner to postgres;
revoke all on function public.kipu_reject_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_reject_agent_operation_manifest(jsonb)
  to service_role;

~~~

### 7.2 DDL de staging/plan mínimo: bloqueo que requiere respuesta arquitectónica

No se imprime un DDL ejecutable parcial para esta segunda mitad porque hacerlo obligaría a decidir unilateralmente tres contratos que §4 no define y que afectan seguridad económica:

1. si los steps incrementales viven en `agent_operation_steps` y cómo se recupera un step pre-write sin remuestrear;
2. qué manifest version representa una acción nativa sin provenance/state_witness/effects/postconditions legacy;
3. quién materializa y verifica el álgebra de un grupo atómico cuando la tool call no la contiene.

El mínimo DDL que desbloquee Etapa 1 debe resolver **conjuntamente**:

- RPC SECURITY DEFINER de begin/stage bajo delivery + lease + CAS;
- identidad estable de intent y replay exacto antes del writer;
- registro de manifiesto derivado por el servidor desde los staged rows, no desde JSON del modelo;
- lectura autorizada de las N acciones exactas en `confirm_operation`;
- verificación de paridad sobre ese manifest version;
- recuperación de crash que nunca remuestree un write pendiente;
- materialización atómica sin reintroducir el envelope.

Proponer solo una tabla o una firma y llamar eso “exacto” dejaría una falsa garantía. Se solicita que Claude responda esta objeción y fije esa frontera; con esa autorización puede emitirse el DDL completo y continuar la Etapa 1 sin desviarse del plan aprobado.

