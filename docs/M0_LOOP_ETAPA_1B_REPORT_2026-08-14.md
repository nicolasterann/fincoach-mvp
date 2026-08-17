# M0 Tool Loop — Etapa 1B — reporte de bloqueo post-adenda

Fecha: 2026-08-14  
Estado: **NO CERRADA — BLOQUEO ARQUITECTÓNICO REPRODUCIBLE EN A2/A3**  
Muestras pagadas: **0**  
Migraciones aplicadas: **0**  
Commit / push / deploy: **no realizados**

## 1. Alcance implementado vs. contrato de la etapa

Se leyó completo `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md`, incluida la adenda A1–A5, y se verificó adversarialmente la composición prometida contra la cadena SQL 100/108/112/113/115 y el runtime actual antes de escribir el loop.

La implementación se detuvo conforme a §4.5 porque A2/A3 sigue siendo imposible tal como está escrito. No es una objeción a la arquitectura elegida; son cuatro incompatibilidades concretas dentro del contrato de persistencia propuesto:

1. El manifiesto `loop_staged` de A2.2 no tiene el wire que `kipu_verify_agent_operation_manifest` compara.
2. Los writes quedan `applied`; el único promotor a `verified` exige `plan.actions`, pero A1/A3 fija `plan={"mode":"loop"}`.
3. `effects=[]` hace que el undo de 108 no reconozca ningún write económico del loop.
4. El verificador cuenta todos los steps de `plan_version`, mientras el register A3 autoriza solo los `preflighted` no ejecutados; un write ordinario previo y una propuesta sensible posterior en el mismo loop producen conjuntos distintos.

Además, el flujo “rechazar y stagear una propuesta modificada en la misma delivery” no puede crear otra operación: el reject aceptado abandona la operación actual y `agent_operation_deliveries` impone `unique(user_id, delivery_key)`.

Por ello no se redactó una migración 116 ejecutable parcial, no se añadió `KIPU_AGENT_MODE=loop`, no se creó `kipu-agent-loop.ts`, no se tocaron dispatcher/executors, y no se escribieron tests que certificarían un protocolo que no puede llegar a paridad verificada ni conservar undo universal. El camino `KIPU_AGENT_MODE=on` no cambió.

Desviación explícita: la Etapa 1B no se presenta como lista para auditoría pre-aplicación. El máximo seguro fue verificar y aislar el bloqueo antes de introducir un camino muerto o una garantía falsa.

## 2. Archivos creados/modificados

- `docs/M0_LOOP_ETAPA_1B_REPORT_2026-08-14.md`: reporte de verificación, gates y bloqueo. Es el único archivo creado por esta entrega.

No se modificó código de aplicación, executors, schemas, SQL ni runners.

## 3. Decisiones de diseño

1. **No rellenar `plan.actions` con placeholders.** Haría pasar el conteo de `kipu_verify_agent_operation`, pero contradice A1 (“nada se verifica contra el plan”) y §4.5 (no forzar el shape).
2. **No reportar writes como reads.** Forzaría `record_outcome` a producir `verified`, pero falsificaría el efecto, anularía post-write freshness y rompería undo.
3. **No usar `allow_incomplete=true` como cierre.** 113 podría aceptar steps `applied` como settled, pero produciría una verificación parcial; 115 rechaza explícitamente su reentrada y los steps seguirían sin ser reversibles.
4. **No materializar effects en el wrapper.** A3 y A4 exigen `effects=[]`; reconstruir el álgebra fuera de los writers reinstalaría el protocolo que la arquitectura retiró.
5. **No escribir pruebas mock del SQL.** M116.1–M116.5 deben probar las RPC reales una vez que exista un contrato componible; mockear la promoción a `verified` ocultaría exactamente el defecto encontrado.

## 4. Salida íntegra de los gates

Estos gates prueban que el árbol congelado previo sigue verde. No constituyen aceptación de Etapa 1B, porque no hubo implementación de loop.

### 4.1 TypeScript

Comando: `npx tsc --noEmit`

~~~text

~~~

Exit: 0

### 4.2 Lint

Comando: `npm run lint`

~~~text

> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.

~~~

Exit: 0

### 4.3 Build — primer intento bajo sandbox

Comando: `npm run build`

~~~text

> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 2 warnings:
[next]/internal/font/google/geist_a71539c9.module.css
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap


[next]/internal/font/google/geist_mono_8d43a2aa.module.css
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap



> Build error occurred
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.


[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.


    at ignore-listed frames

~~~

Exit: 1

El único fallo fue DNS/red bloqueada para Google Fonts. Se reintentó el mismo comando con acceso de red autorizado.

### 4.4 Build — reintento con red

Comando: `npm run build`

~~~text

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


✓ Compiled successfully in 3.6s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36) 
  Generating static pages using 11 workers (18/36) 
  Generating static pages using 11 workers (27/36) 
✓ Generating static pages using 11 workers (36/36) in 237ms
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


~~~

Exit: 0

### 4.5 Capture

Comando: `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs`

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-14T19:45:47.575Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-14T19:45:47.575Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-14T19:45:47.575Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
806/806 capture checks
(node:79563) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)

~~~

Exit: 0

### 4.6 Mutaciones M0

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

~~~text
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

~~~

Exit: 0

La auditoría de mutaciones corrió sola; ningún otro gate se ejecutó en paralelo.

### 4.7 PostgreSQL — primer intento bajo sandbox

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
(node:83072) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
[TypeError: fetch failed] {
  [cause]: Error: getaddrinfo ENOTFOUND xgapsonlkymfhxmqzqdn.supabase.co
      at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:121:26) {
    errno: -3008,
    code: 'ENOTFOUND',
    syscall: 'getaddrinfo',
    hostname: 'xgapsonlkymfhxmqzqdn.supabase.co'
  }
}
Error: create disposable user: fetch failed
    at must (file:///Users/nicot/Projects/fincoach-mvp/scripts/qa/telegram-agent-100-e2e.mjs:108:27)
    at file:///Users/nicot/Projects/fincoach-mvp/scripts/qa/telegram-agent-100-e2e.mjs:253:19
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
Bloque M0 PostgreSQL E2E: 0/0
FAILURES: ABORT | COBERTURA INCOMPLETA 0/82

~~~

Exit: 1

El fallo fue únicamente DNS del sandbox antes de crear la persona desechable. Se repitió con red autorizada.

### 4.8 PostgreSQL actual — reintento con red

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
(node:83077) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
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

~~~

Exit: 0

### 4.9 Tests deterministas (a)–(h)

**NO EJECUTADO — PENDIENTE DE APLICACIÓN DE 116.** Antes de esa aplicación, A2/A3 debe corregir los bloqueos de §6. Los tests tampoco se escribieron: no se mockeó la frontera SQL.

### 4.10 Sondas M116.1–M116.5

**NO EJECUTADO — PENDIENTE DE APLICACIÓN DE 116.** Antes de esa aplicación debe existir una 116 componible. No se escribieron sondas contra firmas que aún no pueden satisfacer el contrato end-to-end.

### 4.11 Dry-run E2E MOCK

**NO EJECUTADO — BLOQUEADO.** El recorrido propuesta → confirmación → write → paridad verificada no puede cerrar con A2/A3 actual. No hubo llamadas pagadas.

## 5. Qué NO se hizo y qué queda pendiente

No se hizo, deliberadamente:

- migración 116;
- aplicación de migraciones;
- `KIPU_AGENT_MODE=loop`;
- `kipu-agent-loop.ts`;
- dispatcher loop, `confirm_operation` o `reject_operation`;
- cambio del guard clase 552/77;
- guardas de salida/advisory/telemetría;
- tests (a)–(h), M116.1–M116.5 o dry-run MOCK;
- cambios al camino `on`;
- regex o heurística léxica de routing;
- reescritura de executors;
- muestras pagadas;
- commit, push o deploy.

Para continuar, el contrato debe decidir explícitamente:

1. quién promueve los writes loop de `applied` a `verified` sin depender de `plan.actions`;
2. qué wire exacto guarda `loop_staged` o cómo 113 se ramifica por `kind`;
3. cómo conserva el loop la clasificación económica necesaria para undo sin reintroducir effects del planner;
4. cómo se separan los steps ya asentados de la propuesta sensible actual;
5. cómo una delivery de cambio rechaza la operación vieja y obtiene una identidad durable nueva sin violar el unique de deliveries.

## 6. Riesgos y objeciones

### 6.1 El wire `loop_staged` no puede coincidir con 113

A2.2 define:

`{"kind":"loop_staged","actions":[{"seq","capability","arguments"}…]}`

Pero 113:82–95 exige por acción:

- `ordinal`;
- `action_id`;
- `capability`;
- `arguments`;
- `state_witness`;
- `effects`;
- `postconditions`;
- `atomic_group`;
- y orden `ordinal = step_order - 1`.

Con el wire A2.2, `a.value->>'ordinal'`, `action_id`, `state_witness`, `effects` y `postconditions` son null; `v_matching=0` y 113 devuelve `prepared_payload_mismatch`. La afirmación A2.2 de que effects compara `[]=[]` presupone un campo que el mismo shape no contiene.

No se añadió el wire legacy vacío porque A2 lo llama contenido exacto y A1 prohíbe volver autoridad al envelope. Claude debe autorizar expresamente uno de dos contratos: ampliar el manifest server-derived con los campos exactos que 113 consume, o ramificar/reemplazar el verificador para `kind=loop_staged`.

### 6.2 Ninguna de las tres funciones A3 puede verificar un write

Evidencia:

- 100:1231–1247: `done + read → verified`; `done + write|noop → applied`.
- 113:128–133: con `allow_incomplete=false`, `verified_count` debe igualar `matching_count`.
- 100:1312–1315: solo `kipu_verify_agent_operation` promueve `applied → verified`.
- 100:1302–1305: esa función exige `step_count = jsonb_array_length(plan.actions)`.
- A1/A3: el plan se fija en `{"mode":"loop"}`, sin actions, y nada debe verificarse contra él.
- Runtime actual, `kipu-agent.ts:5695–5726`, llama primero al verificador genérico y después al de manifiesto por este motivo.

Con un step loop, el lado SQL es `1 <> 0`, por lo que devuelve `KIPU_EFFECT_MISSING` antes de promoverlo. Saltar el verificador genérico deja el step `applied`, y entonces 113 falla `verification_incomplete`.

Se necesita una cuarta función o un cambio explícito a una función existente. Ninguna de las tres funciones nuevas descritas en A3 tiene autoridad post-write para resolverlo.

### 6.3 `effects=[]` elimina el undo universal

108:18–43 define un write monetario reversible como:

- `result.execution_effect='write'`;
- al menos un elemento de `effects` con clasificación y surface económicos.

108 reemplaza tres predicados dentro de `kipu_reverse_agent_operation` por ese helper. A3/A4 fija `effects=[]` tanto en la fila como en el shim. Por lo tanto, aun si el step llegara artificialmente a `verified`, el undo contaría cero writes económicos y respondería que la operación no tiene writes monetarios reversibles.

Esto contradice A2.3 (“el undo universal queda disponible”). La clasificación debe vivir en una autoridad durable server-owned: effects derivados por la tool/writer, o una rama de undo basada en capability+receipt. Ambos requieren contrato/DDL adicional.

### 6.4 Un loop mixto rompe la cardinalidad del manifiesto

A3 fija `plan_version=1` en el primer staging. El register recibe solo el conjunto completo de steps `preflighted` no ejecutados. Sin embargo, 113:66–73 cuenta **todos** los steps de esa versión como `prepared_count`.

Secuencia reproducible:

1. tool ordinaria A se stagea y ejecuta: step A queda `applied|verified`;
2. en el siguiente tool turn del mismo loop, tool sensible B se stagea;
3. register deriva el manifiesto solo desde B porque A ya no está preflighted/no ejecutado;
4. verify observa `prepared_count=2`, `authorized_count=1`;
5. resultado: `prepared_set_mismatch`.

Hace falta una frontera durable por lote/manifiesto (otra plan_version, manifest scope en steps o conteos filtrados por el conjunto autorizado). A3 no la define.

### 6.5 “Rechazar y modificar” no tiene identidad durable disponible

El reject aceptado cambia la operación a `abandoned`. La delivery del mensaje de cambio ya fue insertada para esa operación, y 100:77–89 impone `unique(user_id, delivery_key)`. Después del rechazo:

- no se puede stagear en la operación terminal;
- no se puede reclamar otra operación con la misma delivery;
- el reject aceptado no crea una operación sucesora.

Esto contradice §4.3: “si el usuario pide variar, el modelo rechaza y stagea una propuesta nueva” en el mismo turno. Debe definirse una transición atómica a una operación sucesora o una semántica de modificación que no terminalice la identidad antes del nuevo staging.

### 6.6 Riesgo de certificar un falso end-to-end

Los tests pedidos M116.5 y (b) deben probar `authorize/verify` end-to-end y paridad verificada. Si se escribieran ahora con mocks o `allow_incomplete`, certificarían una propiedad que PostgreSQL no ofrece. Por eso quedaron sin escribir y se reportan como bloqueados, no como verdes.

## 7. DDL propuesto

**No se emite DDL ejecutable parcial.**

La 116 solicitada “solo tres funciones” no puede satisfacer simultáneamente:

- el wire de paridad de 113;
- la promoción `applied → verified`;
- el conteo de `plan.actions` de 100;
- la ontología económica de undo de 108;
- la separación entre steps asentados y la propuesta actual;
- el cambio de propuesta en una delivery ya ligada.

La función `kipu_reject_agent_operation_manifest` aceptada permanece íntegra en el reporte anterior, pero copiarla junto a dos funciones incompletas y denominar el conjunto “migración 116” produciría una garantía falsa. Conforme a §4.5, se solicita que Claude/founder fijen estas cinco fronteras; recién entonces puede imprimirse una 116 exacta y auditable.

