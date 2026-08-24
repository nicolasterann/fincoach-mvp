# M0 · Cierre — Reporte Codex de limpieza del stack envelope

Fecha: 2026-08-24 · rama: `m0-closure-cleanup` · commit funcional: `77fd1f9`

## 1. Alcance implementado vs. contrato

Se cumplió el contrato de limpieza por alcanzabilidad sobre la rama
`m0-closure-cleanup`, sin merge ni push a `main`:

- `AgentMode` quedó reducido a `"off" | "loop"`. `on` y `shadow` se
  resuelven a `loop` con un único `console.warn` por proceso; el rollback
  documentado es `off`.
- Se eliminó el planner envelope completo, su orquestación `on/shadow`, sus
  challenges por tool, sus validadores/compiladores/publicación v29–v44 y el
  harness que solo fijaba ese camino.
- Se conservaron el loop nativo, el pipeline legacy `off`, las tools y sus
  writers, el manifiesto durable 112–115, los builders, MoneyRead, el motor,
  Telegram/web/auth/crons/onboarding y todas las superficies `/app/*`.
- No hay cambios bajo `supabase/`; no se creó ni aplicó migración 125.
- El harness quedó en capture **826/826** y mutaciones **324/324**, sin anchors
  huérfanos. Se podaron 93 aserciones históricas que representan 64 IDs ya
  ausentes y 277 mutantes cuyo objeto era código borrado.
- Los 101 documentos históricos `docs/M0_*.md` que existían antes de este
  reporte conservan su contenido y recibieron el banner de cierre. El dossier
  declara además que sus ADENDAs son el expediente del cierre.
- `AGENTS.md`, `CLAUDE.md`, roadmap, arquitectura y progreso declaran M0
  cerrado, Bloque M activo/desbloqueado, migraciones 001–124 aplicadas y 125
  como próxima.

Balance de la limpieza antes de añadir este reporte: **+2.135 / -28.108**
líneas, neto **-25.973**; código+harness **-23.115**, documentación **-2.858**.
La diferencia de una línea frente al cómputo previo al commit corresponde al
salto de línea añadido al texto del balance en `BUILD_PROGRESS.md`.

Desviación explícita: el contrato estimaba unas 15.000–20.000 líneas. El neto
real es mayor porque la poda alcanzable incluyó el harness envelope completo y
la compresión exigida de los standing briefs, además del runtime muerto. No se
amplió el alcance funcional ni se eliminó una garantía viva.

## 2. Archivos creados, modificados o eliminados

- `.env.example` — documenta solo `loop`/`off` y aliases de compatibilidad.
- `AGENTS.md` — standing brief legible: M0 cerrado y Bloque M activo.
- `CLAUDE.md` — standing brief legible: M0 cerrado y Bloque M activo.
- `docs/AI_NATIVE_ARCHITECTURE.md` — §5 completada y arquitectura final basada en loop.
- `docs/BUILD_PROGRESS.md` — entrada de cierre, commit funcional y balance de líneas.
- `docs/DEPLOYMENT_READINESS.md` — terminología operativa actualizada a `loop`/`off`.
- `docs/M0_11A_CODEX_ANTIBOT_CONTINUITY_FIX_2026-08-13.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_EXPLICIT_WIRE_FIX_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_IMPLEMENTATION_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_MANIFEST_SETTLEMENT_FIX_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_PERSISTED_ENVELOPE_FIX_2026-08-13.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_POST_AUDIT_FIX_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_SEMANTIC_OBJECTIVE_COMPILER_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_SERVER_MATERIALIZED_PROVENANCE_FIX_2026-08-13.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_STORED_FACT_REPLAN_FIX_2026-08-13.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_11A_CODEX_SUBTRACTIVE_SEMANTIC_PLAN_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CIERRE_CODEX_CLEANUP_PROMPT_2026-08-24.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V12_2026-08-04.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V13_2026-08-04.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V14_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V15_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V16_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V17_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V18_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V19_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V20_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V21_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V22_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_EXEC_AUDIT_V23_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_FOUNDER_SMOKE_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CLAUDE_SNAPSHOT_READ_V24_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_CANONICAL_COMPLETENESS_V33_2026-08-10.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_CARD_CALENDAR_CLOCK_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_DIRECT_EXPENSE_CLOSURE_V11_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_DURABLE_ENTITY_AUTHORITY_V42_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_DURABLE_PROPOSAL_ASSERTIONS_V15_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_ECONOMIC_CLUSTER_REPAIR_V7_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_ECONOMIC_RECEIPTS_V20_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_EXPLICIT_REQUIREMENTS_V34_2026-08-10.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_FINAL_REPAIR_AFTER_CLAUDE_ME2_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_FIXES_AFTER_CLAUDE_EXEC_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_GROUNDING_REPAIR_V36_2026-08-10.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_INTAKE_DIAGNOSTICS_V23_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_INTAKE_REPORTING_V38_2026-08-11.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_ME10AA_STATE_ASSERTION_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_ME10AA_TYPED_REF_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_ME9_ME10_REPAIR_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_MUTATION_SUBJECT_V19_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_OBSERVED_PENDING_V35_2026-08-10.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_OBSERVED_SOURCE_V37_2026-08-11.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_OPERATION_INSPECTION_V18_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PAID_IN_FULL_ATOMIC_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PARTIAL_TRUTH_CLOSURE_V14_2026-08-04.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PENDING_CAPABILITY_V16_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PENDING_QUESTION_COHERENCE_V40_2026-08-11.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PENDING_SCOPE_V17_2026-08-08.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PERSON_PAYMENT_DATE_CLOSURE_V13_2026-08-04.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PLANNER_COMPILER_V22_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_PLANNER_VOICE_CLOSURE_V12_2026-08-04.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_REAUDIT_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_REPAIR_AUTHORITY_V44_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_SEMANTIC_REPAIR_V43_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_SQL_AMOUNT_AUTHORITY_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_STORED_MONEY_AUTHORITY_V39_2026-08-11.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_STORED_PLAN_ADOPTION_V41_2026-08-12.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_STRUCTURED_EVIDENCE_FIX_2026-08-03.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_CODEX_TRUTH_BEFORE_STYLE_V21_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_EXTERNAL_AUDIT_2026-08-02.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_IMPLEMENTATION_CHECKPOINT_2026-07-31.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_1AA_DIAGNOSTIC_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_1AB_NAMING_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_1AC_CONFIRMATION_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_1Z_FOCUSED_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_0_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_1B_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_1C_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_1D_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_1E_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_1_REPORT_2026-08-14.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_2_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3B_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3C_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3D_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3E_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3F_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3G_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3H_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3I_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3J_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3K_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3L_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3M_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3_FINAL_2_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3_FINAL_3_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3_FULL_1_1AD_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3_FULL_2_1AE_REPORT_2026-08-16.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_3_REPORT_2026-08-15.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_4A_REPORT_2026-08-17.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_4B_REPORT_2026-08-17.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_LOOP_ETAPA_4C_REPORT_2026-08-20.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_MODEL_AUTHORITY_REPORT_2026-08-22.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_OLA0_BASELINE_REPORT_2026-08-21.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_OLA1_REPORT_2026-08-21.md` — banner histórico de cierre; contenido preservado.
- `docs/M0_OLA2_REPORT_2026-08-21.md` — banner histórico de cierre; contenido preservado.
- `docs/PRODUCT_SPEC.md` — terminología operativa actualizada a `loop`/`off`.
- `docs/ROADMAP.md` — fuente viva: cierre M0, vara final y Bloque M desbloqueado.
- `docs/TECHNICAL_SPEC.md` — terminología operativa actualizada a `loop`/`off`.
- `docs/TELEGRAM_SETUP.md` — terminología operativa actualizada a `loop`/`off`.
- `docs/TEST_SCRIPTS.md` — comandos y modos vigentes del harness.
- `scripts/qa/README.md` — runner vigente, muestra 35 carriles y comandos loop.
- `scripts/qa/m0-loop-conversation-e2e.mjs` — runner exclusivamente loop, sin baseline envelope.
- `scripts/qa/m0-model-conversation-e2e.mjs` — ELIMINADO; eliminado: muestra que fijaba el envelope retirado.
- `scripts/qa/run-m0-loop-conversation-background.mjs` — runner exclusivamente loop, sin baseline envelope.
- `scripts/qa/run-m0-model-e2e-background.mjs` — ELIMINADO; eliminado: wrapper del harness envelope retirado.
- `scripts/qa/telegram-agent-regression-audit.mjs` — poda 277 mutantes cuyo objeto fue borrado.
- `src/app/dev/capture-test/page.tsx` — poda IR muertos y conserva/resepara todos los pins vivos.
- `src/app/dev/m0-agent-eval/route.ts` — bridge de evaluación exclusivamente loop.
- `src/lib/ai/agent/agent-action-challenges.ts` — ELIMINADO; eliminado: challenges 088 no alcanzados por loop ni off.
- `src/lib/ai/agent/agent-action-guard.ts` — retira challenge 088 y preserva barreras monetarias vivas.
- `src/lib/ai/agent/agent-operation-authority.ts` — conserva autoridad loop/manifiesto y elimina contratos envelope.
- `src/lib/ai/agent/agent-planner.ts` — ELIMINADO; eliminado: planner/validator/compiler envelope inalcanzable.
- `src/lib/ai/agent/kipu-agent-tools.ts` — retira imports/ramas envelope sin cambiar cuerpos de tools vivos.
- `src/lib/ai/agent/kipu-agent.ts` — podado a helpers compartidos vivos, modo y barreras consumidas por loop.
- `src/lib/ai/agent/m0-eval-contract.ts` — handshake del harness nativo de cierre.
- `src/lib/ai/chat-transaction-handler.ts` — elimina dispatch on/shadow y conserva loop/off.
- `src/lib/capture/evidence-capture.ts` — captura de evidencia invoca loop/off sin ramas on/shadow.
- `docs/M0_CIERRE_CODEX_CLEANUP_REPORT_2026-08-24.md` — este reporte de entrega con diff, poda y gates íntegros.

## 3. Decisiones de diseño

- **La alcanzabilidad prevaleció sobre la tabla histórica.**
  `agent-action-guard.ts` quedó vivo; solo salió su dependencia de challenges.
  Se conservaron `serverMonetaryEvidenceRequirement`,
  `serverConfirmationRequirement`, `SIMULATION_HYPOTHESIS_PATHS` y
  `emphasizedStatedAmounts`.
- **`kipu-agent.ts` se operó con cirugía.** Salió el orquestador envelope;
  permanecieron contexto/totales, receipts, grounding/mutation claims,
  sanitización, tipos compartidos, modo y continuidad post-write usados por
  `kipu-agent-loop.ts`.
- **Los challenges 088 salieron completos** después de demostrar que el loop
  autoriza con el manifiesto durable y que ninguna tool viva los necesitaba en
  modo loop/off.
- **Compatibilidad de despliegue:** `on`/`shadow` no forman parte del tipo ni
  crean caminos; solo se normalizan a `loop` con warning único.
- **Los pins mixtos se separaron, no se debilitaron.** Quince familias que antes
  mezclaban envelope con SQL/tools vivos recibieron anchors exactos. Una primera
  corrida de mutaciones reveló 17 detectores demasiado amplios; se corrigieron
  a la cadena completa y la corrida final dio 324/324.
- **Dos helpers del manifiesto resultaron vivos por import dinámico.** La primera
  sonda PostgreSQL alcanzó `buildAgentOperationManifest` y
  `agentOperationManifestHash`; se restauraron desde `main` exactamente como
  parte del manifiesto 112–115. No se restauró ningún validator/repair envelope.
- **Historia vs. configuración actual:** documentos/evidencias históricos
  conservan hechos de cuando `on` era un modo; las superficies vigentes
  documentan `off | loop` y los registros históricos de BUILD aclaran que
  `on` hoy es alias de `loop`.

## 4. Salida íntegra de los gates

### 1. TypeScript

Comando: `npx tsc --noEmit`

Exit: `0`

~~~text
(salida vacía)
~~~

### 2. Lint

Comando: `npm run lint`

Exit: `0`

~~~text

> fincoach-mvp@0.1.0 lint
> eslint


/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-122-e2e.mjs
  39:3  warning  'authorizeAgentOperationManifest' is assigned a value but never used  @typescript-eslint/no-unused-vars
  40:3  warning  'beginAgentOperationApplication' is assigned a value but never used   @typescript-eslint/no-unused-vars
  41:3  warning  'beginAgentOperationManifest' is assigned a value but never used      @typescript-eslint/no-unused-vars
  45:3  warning  'transitionAgentOperation' is assigned a value but never used         @typescript-eslint/no-unused-vars
  46:3  warning  'verifyAgentLoopManifest' is assigned a value but never used          @typescript-eslint/no-unused-vars
  47:3  warning  'verifyAgentLoopStep' is assigned a value but never used              @typescript-eslint/no-unused-vars

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-123-e2e.mjs
   37:3   warning  'quarantineAgentLoopOperation' is assigned a value but never used  @typescript-eslint/no-unused-vars
  107:10  warning  'digest' is defined but never used                                 @typescript-eslint/no-unused-vars

✖ 8 problems (0 errors, 8 warnings)

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

### 3. Build

Comando: `npm run build`

Exit: `0`

~~~text

> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
✓ Compiled successfully in 2.8s
  Running TypeScript ...
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 230ms
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


~~~

### 4. Capture

Comando: `node scripts/qa/run-capture-gate.mjs`

Exit: `0`

~~~text
[kipu.route] {"ts":"2026-08-24T15:06:09.914Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-24T15:06:09.914Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-24T15:06:09.914Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
826/826 capture checks
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
(node:32919) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 5. DRY

Comando: `node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run`

Exit: `0`

~~~text
Handshake: contract=m0-agent-eval-2026-08-24-native-loop-closure mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 32 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_READ] plomería read-only
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Tu corte de Diners NT es de 50,60$ y vence el 3 de agosto.","user":"¿Cuánto tengo que pagar de la Diners NT y cuándo vence?"}]
[DRY_READ] cleanup por identidad: cero

[DRY_WRITE] plomería write ordinario
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré el café por 5$ desde Produbanco.","user":"Registré un café de 5 dólares hoy desde Produbanco."}]
[DRY_WRITE] cleanup por identidad: cero

[DRY_UNSTATED_ASK] monto que nadie dijo: pregunta, jamás escribe ni propone
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿De cuánto fue el súper esta vez?","user":"Anota el gasto del súper de siempre."}]
[DRY_UNSTATED_ASK] cleanup por identidad: cero

[DRY_QUOTED_SLANG] jerga desconocida: la cita literal del episodio autoriza; una cita falsa no
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré 900 de taxi desde Produbanco.","user":"Anota 9 gambas de taxi desde Produbanco."},{"assistant":"¿Cuánto fue el cine?","user":"Anota el gasto del cine."}]
[DRY_QUOTED_SLANG] cleanup por identidad: cero

[DRY_STACKED_CANCEL] las preguntas no apilan operaciones y «cancela» fluye con voz humana
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Cuántos ARS salieron para esos 20 USD?","user":"Aporté 20 dólares a eToro desde mi cuenta en pesos."},{"assistant":"¿Cuántos ARS salieron para esos 20 USD?","user":"Usa el tipo de cambio que tengas para ese cálculo."},{"assistant":"No registré ningún cambio en este turno. Cuéntame exactamente qué querías y lo hago.","user":"Mmm mejor cancela la operación."}]
[DRY_STACKED_CANCEL] cleanup por identidad: cero

[DRY_SENSITIVE] plomería propuesta y confirmación sensible
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé cancelar Viaje a Cartagena. ¿Confirmas?","user":"Cancela mi objetivo Viaje a Cartagena."},{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Sí, es Viaje a Cartagena; conserva esos mismos datos."},{"assistant":"Listo, cancelé el objetivo Viaje a Cartagena.","user":"Sí, cancela exactamente ese objetivo."}]
[DRY_SENSITIVE] cleanup por identidad: cero

[DRY_ORIGIN] ME3 acepta origen propio elegido por el modelo
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré los tres pagos desde Produbanco por 50,60, 22,14 y 201,25 USD.","user":"Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV."}]
[DRY_ORIGIN] cleanup por identidad: cero

[DRY_CAPITAL] devolución de capital registra sin confirmación
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré 83.86 USD en Produbanco como devolución de capital; no lo conté como ingreso.","user":"María me devolvió 83.86 en Produbanco. Era capital de un préstamo que yo le había hecho y nunca registré."}]
[DRY_CAPITAL] cleanup por identidad: cero

[DRY_LOAN_OUT] préstamo saliente conserva continuidad post-write
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, prestaste 25 USD a María desde Produbanco y quedó como dinero por cobrar.","user":"Le presté 25 a María desde Produbanco; quedó debiéndomelos."}]
[DRY_LOAN_OUT] cleanup por identidad: cero

[DRY_CORRECTION] corrección completa ejecuta undo y reemplazos
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré 10 USD en Compra A y 20 USD en Compra B desde Produbanco.","user":"Registra como una sola operación dos gastos de hoy desde Produbanco: 10 dólares en compra A y 20 dólares en compra B."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 12, 19. Entidades: Produbanco. ¿Confirmas exactamente este conjunto?","user":"Me equivoqué en esa operación: la compra A fueron 12 dólares y la compra B 19. Corrige la operación completa; reemplaza los datos anteriores, no agregues gastos encima."},{"assistant":"Listo, revertí los dos gastos anteriores y registré Compra A por 12 USD y Compra B por 19 USD.","user":"Sí, confirma exactamente esa corrección completa."}]
[DRY_CORRECTION] cleanup por identidad: cero

[DRY_CONSOLIDATION] propuesta sucesora conserva pagos antes de cierres
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Deja cubiertos los cuatro créditos piloto y prepara cancelar Viaje a Cartagena."},{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Sí salen de Produbanco; agrega también cerrar esas mismas cuatro tarjetas."},{"assistant":"Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, cancelé Viaje a Cartagena y después cerré las cuatro tarjetas.","user":"Confirmo el conjunto completo en ese orden."}]
[DRY_CONSOLIDATION] cleanup por identidad: cero

[DRY_SUCCESSOR_PAY_CLOSE] sucesor de cuatro pagos y cuatro cierres ejecuta y asienta
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Siguen pendientes Crédito piloto 1 por 11,11 USD, Crédito piloto 2 por 12,22 USD, Crédito piloto 3 por 13,33 USD y Crédito piloto 4 por 14,44 USD.","user":"Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 11.11, 12.22, 13.33, 14.44. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Perfecto, deja esos cuatro cubiertos desde mi Produbanco y prepara cancelar Viaje a Cartagena."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 11.11, 12.22, 13.33, 14.44. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas."},{"assistant":"Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, cancelé Viaje a Cartagena y cerré las cuatro tarjetas.","user":"Adelante con el conjunto tal como lo acabas de plantear."}]
[DRY_SUCCESSOR_PAY_CLOSE] cleanup por identidad: cero

[DRY_SUCCESSOR_PAY_CLOSE_READ] lectura post-ejecución no bloquea el settle del sucesor
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Siguen pendientes Crédito piloto 1 por 11,11 USD, Crédito piloto 2 por 12,22 USD, Crédito piloto 3 por 13,33 USD y Crédito piloto 4 por 14,44 USD.","user":"Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 11.11, 12.22, 13.33, 14.44. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Perfecto, deja esos cuatro cubiertos desde mi Produbanco y prepara cancelar Viaje a Cartagena."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 11.11, 12.22, 13.33, 14.44. Entidades: Crédito piloto 1, Crédito piloto 2, Crédito piloto 3, Crédito piloto 4, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas."},{"assistant":"Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, cancelé Viaje a Cartagena y cerré las cuatro tarjetas.","user":"Adelante con el conjunto tal como lo acabas de plantear."}]
[DRY_SUCCESSOR_PAY_CLOSE_READ] cleanup por identidad: cero

[DRY_POST_WRITE_ABORT] receipt conserva continuidad si falla la narración
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Registré préstamo 25$ a María: la salida y lo que te deben quedaron juntos.","user":"Le presté 25 a María desde Produbanco y quedó debiéndomelos."}]
[DRY_POST_WRITE_ABORT] cleanup por identidad: cero

[DRY_REPAYMENT] repago registrado sigue inmediato
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, entraron 40 USD a Produbanco y el préstamo registrado de Juan quedó con 20 USD pendientes.","user":"Juan me devolvió hoy 40 dólares del préstamo de 60 que ya tengo registrado. Entraron a Produbanco."}]
[DRY_REPAYMENT] cleanup por identidad: cero

[DRY_RENT_AUTHORITY] arriendo usa vínculo durable de fuente
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré el arriendo por 1.010.786,70 USD desde Produbanco.","user":"Hola, acabo de pagar el arriendo."}]
[DRY_RENT_AUTHORITY] cleanup por identidad: cero

[DRY_LIVE_REPLACEMENT] argumentos nuevos reemplazan la acción viva de la misma entidad
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé el pago total de Diners NT y cancelar Viaje a Cartagena. ¿Desde qué cuenta salió el pago?","user":"Pagué Diners NT en full; prepara el registro y cancelar Viaje a Cartagena; después te preciso la cuenta."},{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Diners NT, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Salió de Produbanco; reemplaza esa misma acción con este origen."},{"assistant":"Listo, registré el pago de Diners NT por 50,60 USD desde Produbanco y cancelé Viaje a Cartagena.","user":"Sí, confirma esa versión actualizada."}]
[DRY_LIVE_REPLACEMENT] cleanup por identidad: cero

[DRY_OPERATION_SOURCE] la confirmación hereda la fuente user-authored de la operación
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé el pago total de Diners NT con el origen que nombraste y cancelar Viaje a Cartagena. ¿Confirmas ejecutarlo?","user":"Pagué Diners NT en full desde Produbanco; prepara ese registro y cancelar Viaje a Cartagena."},{"assistant":"Listo, pagué Diners NT por 50,60 USD desde Produbanco y cancelé Viaje a Cartagena.","user":"Sí, confirma ese pago."}]
[DRY_OPERATION_SOURCE] cleanup por identidad: cero

[DRY_BORROWED_LINK] préstamo recibido resuelve vínculos y ejecuta caja + deuda tras confirmar
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé acreditar 83,86 USD en Produbanco, aumentar la deuda Alpaca y cancelar Viaje a Cartagena. ¿Confirmas esa interpretación?","user":"Alpaca me prestó 83,86 USD y entraron a Produbanco; prepara el préstamo recibido y cancelar Viaje a Cartagena."},{"assistant":"Listo: acredité 83,86 USD en Produbanco, aumenté por el mismo monto la deuda Alpaca y cancelé Viaje a Cartagena.","user":"Sí, confirma que esos fondos fueron prestados a mí y aumenta la deuda Alpaca."}]
[DRY_BORROWED_LINK] cleanup por identidad: cero

[DRY_SET_COHESION] cohesión de conjunto difiere el write temprano y propone todo una sola vez
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Desde qué cuenta salieron los tres pagos de tarjeta?","user":"Registra estos cuatro hechos de hoy y prepara cancelar Viaje a Cartagena: pagué completo Produbanco MV, María me devolvió 83,86 USD de capital de un préstamo mío nunca registrado, y pagué completos Diners NT y Titanium MV. Los tres pagos salieron de la misma cuenta, pero todavía no te dije cuál."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 83.86. Entidades: Diners NT, María, Produbanco, Produbanco MV, Titanium MV, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Todos salieron de Produbanco."},{"assistant":"Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.","user":"Sí, confirma y ejecuta exactamente ese único conjunto."}]
[DRY_SET_COHESION] cleanup por identidad: cero

[DRY_CONFIRM_REEMIT_IDENTICAL] re-emisión idéntica redirige y confirma sin sucesor
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Crédito piloto 1, Crédito piloto 2, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena."},{"assistant":"Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco y cancelé Viaje a Cartagena.","user":"Sí, confirma exactamente esos dos pagos."}]
[DRY_CONFIRM_REEMIT_IDENTICAL] cleanup por identidad: cero

[DRY_CONFIRM_REEMIT_MODIFIED] re-emisión modificada conserva la consolidación sucesora
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Crédito piloto 1, Crédito piloto 2, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena."},{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 10.11. Entidades: Crédito piloto 1, Crédito piloto 2, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Cambia el primero a 10,11 USD y conserva el segundo."},{"assistant":"Listo, pagué 10,11 USD del primero, 12,22 USD del segundo y cancelé Viaje a Cartagena.","user":"Sí, confirma esa propuesta modificada."}]
[DRY_CONFIRM_REEMIT_MODIFIED] cleanup por identidad: cero

[DRY_EXECUTING_REEMIT] re-emisión durante executing no duplica ni colapsa
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Entidades: Crédito piloto 1, Crédito piloto 2, Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena."},{"assistant":"Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco y cancelé Viaje a Cartagena.","user":"Sí, confirma exactamente esos dos pagos."}]
[DRY_EXECUTING_REEMIT] cleanup por identidad: cero

[DRY_CONTROL_CONFIRM_FIRST] confirm primero redirige el subconjunto hermano sin duplicar
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 83.86. Entidades: Diners NT, María, Produbanco, Produbanco MV, Titanium MV, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara un solo conjunto: la devolución de 83,86 USD de capital no registrado, los pagos completos de Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena."},{"assistant":"Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.","user":"Sí, confirma y ejecuta exactamente las cinco acciones pendientes."}]
[DRY_CONTROL_CONFIRM_FIRST] cleanup por identidad: cero

[DRY_CONTROL_CONFIRM_LAST] confirm último redirige el subconjunto hermano sin consolidar
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 83.86. Entidades: Diners NT, María, Produbanco, Produbanco MV, Titanium MV, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara un solo conjunto: la devolución de 83,86 USD de capital no registrado, los pagos completos de Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena."},{"assistant":"Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.","user":"Sí, confirma y ejecuta exactamente las cinco acciones pendientes."}]
[DRY_CONTROL_CONFIRM_LAST] cleanup por identidad: cero

[DRY_CONTROL_DIRECTION_RESOLVED] dirección resuelta y confirmada redirige toda re-emisión hermana
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 83.86. Entidades: Diners NT, María, Produbanco, Produbanco MV, Titanium MV, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Prepara un solo conjunto: la devolución de 83,86 USD de capital no registrado, los pagos completos de Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena."},{"assistant":"Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.","user":"Era una devolución: yo había prestado ese dinero. Confirma exactamente el conjunto pendiente."}]
[DRY_CONTROL_DIRECTION_RESOLVED] cleanup por identidad: cero

[DRY_QUARANTINE_RECOVERY] recovery terminal entra en cuarentena y el turno fresco conserva read/reset
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé esta propuesta sin ejecutarla. Montos: 5. Entidades: Produbanco, Viaje a Cartagena. ¿Confirmas exactamente este conjunto?","user":"Registra el café de 5 USD desde Produbanco, confirma el aviso de Diners y cancela Viaje a Cartagena; todavía no indiqué la fuente del pago de la tarjeta."},{"assistant":"Registré el café y cancelé Viaje a Cartagena; el aviso de Diners quedó sin ejecutar porque todavía falta probar la fuente del pago.","user":"Sí, confirma ese conjunto exacto."},{"assistant":"Tu saldo actual en Produbanco es 995 USD.","user":"¿Cuál es ahora mi saldo en Produbanco?"},{"assistant":"Entendido. La operación anterior quedó cerrada; empezamos de cero desde el estado actual.","user":"Cancela lo anterior y empecemos de cero."}]
[DRY_QUARANTINE_RECOVERY] cleanup por identidad: cero

[DRY_CALENDAR_OVERCLAIM] calendario confirma sin atribuir el pago a la cuenta esperada equivocada
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"El pago de Internet ya estaba registrado hoy desde Cuenta Calendario Real, no desde Produbanco. Al cerrar el aviso no moví dinero.","user":"El Internet ya está pagado desde Produbanco; márcalo pagado."}]
[DRY_CALENDAR_OVERCLAIM] cleanup por identidad: cero

[DRY_NO_PROGRESS_REFUSAL] misma rehúsa estructural corta preguntas sin progreso
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Confirmas que quieres pausar el ingreso llamado Alpaca?","user":"Pausa por ahora los pagos mensuales de Alpaca."},{"assistant":"No hice ese cambio: la misma capacidad volvió a rechazar la misma acción sin que cambiara el estado. No te voy a pedir lo mismo otra vez. Puedo usar una capacidad compatible con ese tipo de entidad o dejarlo sin cambios.","user":"Sí."}]
[DRY_NO_PROGRESS_REFUSAL] cleanup por identidad: cero

[DRY_CLOSE_PREFLIGHT] deuda con saldo se rehúsa antes de ofrecer manifiesto
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Diners NT todavía tiene saldo. No la cerré porque ocultaría deuda; primero registra el pago real o corrige el saldo y luego vuelve a cerrarla.","user":"Cierra Diners NT."}]
[DRY_CLOSE_PREFLIGHT] cleanup por identidad: cero

[DRY_INVESTMENT_PROPOSAL] aporte ad-hoc mueve caja y activo sin confirmación
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, aporté 75 USD desde Produbanco a eToro MOCK; bajó la cuenta y subió el activo.","user":"Aporté 75 USD desde Produbanco a eToro MOCK."}]
[DRY_INVESTMENT_PROPOSAL] cleanup por identidad: cero

[DRY_UPDATE_ASSET_TRUTH] revaluar patrimonio declara que no movió dinero de una cuenta
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Actualicé eToro MOCK a 550 USD. Esto no movió dinero de ninguna cuenta; sólo cambió el patrimonio.","user":"eToro MOCK ahora vale 550 USD."}]
[DRY_UPDATE_ASSET_TRUTH] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":5640,"calls":141,"inputTokens":14100,"outputTokens":2820}
Judge usage agregado: {"cachedInputTokens":0,"calls":32,"inputTokens":5760,"outputTokens":1440}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo simulado por telemetría MOCK: 0.069468 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.12,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9518,"calls":238,"inputTokens":23794,"outputTokens":4759},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 tres carriles (loop, MOCK): 32/32 duros verdes
(node:32929) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/amount-evidence.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 6. OLA0

Comando: `node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --ola0`

Exit: `0`

~~~text
Handshake: contract=m0-agent-eval-2026-08-24-native-loop-closure mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Ola 0 + autoridad MOCK: 8 dorados de fricción + conversación encadenada + L1–L6.

[O0_COTO_EXPLICIT] Coto 15.070,22 ARS desde Supervielle
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré Coto por 15070.22 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Coto 15.070,22 ARS desde Supervielle."}]
[O0_COTO_EXPLICIT] cleanup por identidad: cero

[O0_LA_IDEAL_UNIQUE] La Ideal 50.000 ARS con fuente única
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré La Ideal por 50000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"La Ideal 50.000 ARS."}]
[O0_LA_IDEAL_UNIQUE] cleanup por identidad: cero

[O0_ENTRADAS_UNIQUE] entradas 74.550 ARS con destino único
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré Entradas por 74550 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Entraron 74.550 ARS de las entradas."}]
[O0_ENTRADAS_UNIQUE] cleanup por identidad: cero

[O0_SERVIENTREGA_EXPLICIT] Servientrega 8,51$ desde Pichincha
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré Servientrega por 8.51 USD. Tu objetivo Objetivo Ola 0 sigue en 200 USD.","user":"Servientrega 8,51$ desde Pichincha."}]
[O0_SERVIENTREGA_EXPLICIT] cleanup por identidad: cero

[O0_MCDONALDS_AUDIO] McDonald's 6$ con tarjeta Produbanco, texto transcrito
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré McDonald's por 6 USD. Tu objetivo Objetivo Ola 0 sigue en 200 USD.","user":"McDonald's 6$ con tarjeta Produbanco."}]
[O0_MCDONALDS_AUDIO] cleanup por identidad: cero

[O0_50MIL] 50mil sin forma decimal canónica
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré Coto por 50000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Coto 50mil desde Supervielle."}]
[O0_50MIL] cleanup por identidad: cero

[O0_ASSUMED_CURRENCY] moneda asumida por Supervielle aprendida
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré Coto por 20000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Coto 20.000 desde Supervielle."}]
[O0_ASSUMED_CURRENCY] cleanup por identidad: cero

[O0_VOICE_WORDS] voz transcrita en palabras: seis mil pesos
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré McDonald's por 6000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Gasté seis mil pesos en McDonald's desde Supervielle."}]
[O0_VOICE_WORDS] cleanup por identidad: cero

[O0_CLARIFIED_CAPTURE] aclaración → respuesta → ejecución sin confirmación
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Cuánto fue la hamburguesa y en qué moneda?","user":"Compré una hamburguesa en McDonald's desde Supervielle."},{"assistant":"Listo, registré Hamburguesa en McDonald's por 25000 ARS desde Supervielle.","user":"Cierto fueron 25 mil."}]
[O0_CLARIFIED_CAPTURE] cleanup por identidad: cero

[O0_LONG_CONVERSATION] 15 turnos con propuesta sensible pendiente y captura posterior
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"¿Cómo están mis cuentas?"},{"assistant":"Claro, seguimos desde aquí cuando quieras.","user":"Gracias, solo quería ver el panorama."},{"assistant":"Listo, registré el café por 3$ desde Pichincha.","user":"Anota un café de 3$ desde Pichincha."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"¿Cuánto tengo ahora en Pichincha?"},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"¿Y mi objetivo sigue activo?"},{"assistant":"Entendido, no cambio nada.","user":"Perfecto, no cambies nada más todavía."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"Recuérdame el panorama una vez más."},{"assistant":"Preparé cancelar el objetivo Objetivo Ola 0. ¿Confirmas?","user":"Cancela mi objetivo Objetivo Ola 0."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"Déjala pendiente; muéstrame solamente mis saldos."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"No confirmo esa cancelación todavía. ¿Cómo va mi objetivo?"},{"assistant":"Listo, registré el taxi por 4$ desde Pichincha.","user":"Anota un taxi de 4$ desde Pichincha."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"¿Cuáles fueron mis dos gastos de hoy?"},{"assistant":"De acuerdo: la propuesta sigue pendiente y no hice cambios nuevos.","user":"Gracias, conserva pendiente la cancelación del objetivo."},{"assistant":"Tu panorama sigue disponible con los saldos actuales.","user":"Dame una última lectura de mis cuentas."},{"assistant":"Listo, dejamos la conversación aquí.","user":"Eso es todo por ahora."}]
[O0_LONG_CONVERSATION] cleanup por identidad: cero

[MA_L1_AMOUNT_FOLLOWUP] L1 monto aclarado escribe sin confirmación ni plantilla
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Cuánto fue el café?","user":"Compre un cafe en mc con Supervielle"},{"assistant":"Listo, registré 30.000 ARS desde Banco Supervielle.","user":"30mil"}]
[MA_L1_AMOUNT_FOLLOWUP] cleanup por identidad: cero

[MA_L2_ASR_CHAIN] L2 cadena ASR aterriza sin operación atascada
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Te referís a Banco Supervielle, y cuánto fue la compra?","user":"super bill"},{"assistant":"Entendí Banco Supervielle como la cuenta o débito, no como una tarjeta de crédito.","user":"Tarjeta supervielle"},{"assistant":"Tomo 25.000 ARS para esta compra.","user":"25mil"},{"assistant":"Listo, registré 25.000 ARS desde Banco Supervielle.","user":"Fue banco supervielle"}]
[MA_L2_ASR_CHAIN] cleanup por identidad: cero

[MA_L3_MODEL_ACCOUNT] L3 cuenta propia elegida por el modelo escribe y cuenta el guard degradado
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Registré 25.000 ARS desde Banco Supervielle, que tomé como tu patrón — avísame si era otra.","user":"Compré un tallarín chino por $25.000"}]
[MA_L3_MODEL_ACCOUNT] cleanup por identidad: cero

[MA_L4_ALIAS_MEMORY] L4 alias ASR se recuerda y llega al episodio siguiente
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Entendido: voy a recordar ese alias.","user":"Para mí, 'su perrito' quiere decir Banco Supervielle."},{"assistant":"Registré 6.000 ARS desde Banco Supervielle — interpreté 'su perrito' como ese banco; avísame si era otra.","user":"Compré un café de seis mil pesos con su perrito."}]
[MA_L4_ALIAS_MEMORY] cleanup por identidad: cero

[MA_L5_VOICE_AMOUNT] L5 seis mil pesos conserva captura inmediata
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Listo, registré McDonald's por 6000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.","user":"Gasté seis mil pesos en McDonald's desde Supervielle."}]
[MA_L5_VOICE_AMOUNT] cleanup por identidad: cero

[MA_L6_CANCEL_STUCK] L6 cancelar termina una operación applying sin manifiesto
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"La operación pendiente quedó cancelada de verdad.","user":"Cancela la operación"}]
[MA_L6_CANCEL_STUCK] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":3240,"calls":81,"inputTokens":8100,"outputTokens":1620}
Judge usage agregado: {"cachedInputTokens":0,"calls":16,"inputTokens":2880,"outputTokens":720}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo simulado por telemetría MOCK: 0.039564 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.12,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9720,"calls":243,"inputTokens":24300,"outputTokens":4860},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 Ola 0 (loop, MOCK): 16/16 duros verdes
(node:33475) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/amount-evidence.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 7. CAL

Comando: `KIPU_AGENT_MODE=loop node --env-file=.env.local scripts/qa/m0-ola0-calibration.mjs`

Exit: `0`

~~~text
[O0_REMINDER] GREEN
  ok · reminder fixture and RPC path complete without typed error
  ok · night calendar selects the exact due occurrence
  ok · typed reminder facts retain entity, date and amount
  ok · mock copy crosses real claim and publish RPCs exactly once
  ok · reminder disposable identity leaves zero residue
  EVIDENCE {"mode":"loop","persisted":{"message":{"channel":"web","content":"Hoy vence Coto por 15.070,22 ARS. ¿Cuánto salió y desde dónde lo pagaste?","id":"4d28bc81-a5ce-4b71-b8e9-45fb5348eaee","role":"assistant"},"nudge":{"budget_lane":"calendar","delivered":true,"id":"4e546e65-743e-4724-8af9-bbd24759ffb4","status":"sent"},"occurrence":{"ask_count":1,"id":"5d2ac9de-ff2a-4ca5-b43d-222e04bdd02c","last_asked_on":"2026-08-21","status":"pending"}},"published":{"claimId":"4e546e65-743e-4724-8af9-bbd24759ffb4","claimToken":"822dae83-9736-46bc-83cf-7fc1f4208fca","content":"Hoy vence Coto por 15.070,22 ARS. ¿Cuánto salió y desde dónde lo pagaste?"},"reminderError":null,"reminderFacts":"Hoy vence el gasto \"Coto\", y no tienes el monto exacto. La última vez fueron 15.070,22 ARS, pero puede cambiar. Pregúntale cuánto le salió este mes y si ya lo pagó. Informar la factura NO mueve caja: solo registra el pago si lo confirma y dice desde qué cuenta/tarjeta. Es válido que responda el monto, \"todavía no lo pagué\", o \"te digo mañana\".","reminderPlan":{"asks":[{"amount":15070.22,"currency":"ARS","kind":"expense","label":"Coto","occurrenceDate":"2026-08-21","occurrenceId":"5d2ac9de-ff2a-4ca5-b43d-222e04bdd02c","priority":0,"slot":"ask"}],"confirms":[],"held":[],"items":[{"amount":15070.22,"currency":"ARS","kind":"expense","label":"Coto","occurrenceDate":"2026-08-21","occurrenceId":"5d2ac9de-ff2a-4ca5-b43d-222e04bdd02c","priority":0,"slot":"ask"}],"send":true,"standing":[]},"reminderResidue":{"accounts":0,"ambient_nudges":0,"chat_messages":0,"fixed_expenses":0,"profiles":0,"recurring_occurrences":0,"user_engagement":0}}
[O0_PREFLIGHT_PARITY] GREEN
  ok · runner sensitivity mirror equals the product set
  ok · every exported pure state veto belongs to a sensitive capability
  ok · every exported pure state veto runs in executor and loop preflight
  EVIDENCE {"pureStateGuards":[{"capability":"close_card","dispatcherSelectsCapability":true,"executorUsesSameGuard":true,"guardName":"closeCardStateGuard","loopUsesSameGuard":true,"sensitive":true}],"sensitiveCapabilities":["accept_household_invite","add_household_participant","cancel_scheduled_change","cancel_scheduled_payment","cancel_shared_expense","change_account_currency","change_base_currency","close_account","close_card","close_installment_plan","forget_life_context","household_invite_link","invite_household_member","leave_household","remove_asset","remove_duplicate","remove_household_member","remove_recurring_shared_expense","reset_personality_test","reset_personalization_preference","respond_household_invite","set_household_visibility","settle_household","transfer_household_ownership","undo_agent_operation","undo_recent_movements","unshare_movement"],"sensitiveCount":27}
Ola0 calibración determinista: 2/2 verdes
(node:33706) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/scheduled/recurring-notifier.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8. PostgreSQL M0

Comando: `node --env-file=.env.local scripts/qa/telegram-agent-100-e2e.mjs`

Exit: `0`

~~~text
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
(node:33720) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.1 PostgreSQL M116

Comando: `node --env-file=.env.local scripts/qa/m0-loop-116-e2e.mjs`

Exit: `0`

~~~text
  ok   · M116.1 · staging replay exacto + delivery/lease/CAS
  ok   · M116.2 · register deriva shape espejo, exige igualdad y persiste la pregunta
  ok   · M116.3 · reject atómico, replay, anti-self reject+confirm y re-staging con bump en la misma delivery
  ok   · M116.4 · verify-loop-step prueba ledger, rehúsa económico sin receipt y deriva marcador contextual por receipt
  ok   · M116.5 · paridad scoped MIXTA + barrera proposed/executing + smoke de contención en profundidad
  ok   · M116.7 · MIXTO v1→reject→restage v2 verifica el ordinary v1 y no deja applied
  ok   · M116.6 · undo valora receipts de catálogo/contextuales + barrera receipt-less + smoke del target parcial inalcanzable
M116 PostgreSQL probes: 7/7
(node:33787) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.2 PostgreSQL M117

Comando: `node --env-file=.env.local scripts/qa/m0-loop-117-e2e.mjs`

Exit: `0`

~~~text
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
(node:33816) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.3 PostgreSQL M118

Comando: `node --env-file=.env.local scripts/qa/m0-loop-118-e2e.mjs`

Exit: `0`

~~~text
  ok   · M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos
  ok   · M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH
  ok   · M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva
M118 PostgreSQL probes: 3/3
(node:33824) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.4 PostgreSQL M119

Comando: `node --env-file=.env.local scripts/qa/m0-loop-119-e2e.mjs`

Exit: `0`

~~~text
  ok   · M119.1 · pausa conserva deuda/ledger y descarta sólo ocurrencia futura no bookeada
  ok   · M119.2 · replay exacto es noop y resume no reabre ocurrencias históricas ni mueve dinero
  ok   · M119.3 · tarjeta y ownership ajeno rehúsan fail-closed
  ok   · M119.4 · deuda inactiva rehúsa sin SQLSTATE reintentable y el wrapper conserva conflict tipado
M119 PostgreSQL probes: 4/4
(node:33835) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/financial/debt-payment-plan-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.5 PostgreSQL M120

Comando: `node --env-file=.env.local scripts/qa/m0-loop-120-e2e.mjs`

Exit: `0`

~~~text
  ok   · M120.1 · propuesta→confirmación mueve caja y activo juntos, persiste ambas identidades y verifica el manifiesto
  ok   · M120.2 · replay exacto conserva receipt y payload divergente muerde KIPU_DEDUPE_MISMATCH sin duplicar patas
  ok   · M120.3 · el reversor genérico no puede devolver caja dejando el activo inflado
  ok   · M120.4 · el dispatcher v3 revierte caja+activo una sola vez y su replay conserva el marcador
M120 PostgreSQL probes: 4/4
(node:33843) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.6 PostgreSQL M121

Comando: `node --env-file=.env.local scripts/qa/m0-loop-121-e2e.mjs`

Exit: `0`

~~~text
M121.1 · manifest-less worker quarantine
  ok   · M121.1
M121.2 · exact replay and divergent meaning
  ok   · M121.2
M121.3 · healthy lease protected; terminal step authorizes
  ok   · M121.3
M121.4 · conversation ownership
  ok   · M121.4
M121_RESIDUE=[{"table":"agent_operation_transition_events","count":0,"error":null},{"table":"agent_operation_manifests","count":0,"error":null},{"table":"agent_operation_steps","count":0,"error":null},{"table":"agent_operation_deliveries","count":0,"error":null},{"table":"agent_operations","count":0,"error":null},{"table":"chat_messages","count":0,"error":null},{"table":"user_engagement","count":0,"error":null},{"table":"profiles","count":0,"error":null}]
M121_RESULT=4/4
M121_OK=4/4
(node:33855) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.7 PostgreSQL M122

Comando: `node --env-file=.env.local scripts/qa/m0-loop-122-e2e.mjs`

Exit: `0`

~~~text
  ok   · M122.1 · sin manifiesto: claim→stage→writer mueve caja y activo juntos bajo el lease vivo
  ok   · M122.2 · replay exacto conserva receipt y payload divergente muerde KIPU_DEDUPE_MISMATCH sin duplicar patas
  ok   · M122.3 · manifiesto proposed presente ⇒ el camino inmediato es INCONSTRUIBLE: lease, stage, forge y resume rehúsan y el dinero no se mueve
  ok   · M122.4 · reversal v3 devuelve caja y activo una sola vez; replay conserva
M122 PostgreSQL probes: 4/4
(node:33863) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.8 PostgreSQL M123

Comando: `node --env-file=.env.local scripts/qa/m0-loop-123-e2e.mjs`

Exit: `0`

~~~text
  ok   · M123.1 · un paso económico con noop declarado y cero recibos VERIFICA (nada esperado, nada encontrado)
  ok   · M123.2 · un paso económico sin noop y sin recibos sigue muriendo en KIPU_EFFECT_MISSING
  ok   · M123.3 · un noop que reclama efecto write sigue muriendo (el agujero no se abre)
  ok   · M123.4 · re-verificar el noop verificado es replay idempotente
M123 PostgreSQL probes: 4/4
(node:33878) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

### 8.9 PostgreSQL M124

Comando: `node --env-file=.env.local scripts/qa/m0-loop-124-e2e.mjs`

Exit: `0`

~~~text
  ok   · M124.1 · una meta USD con fondeo desde una cuenta USD aterriza con la columna escrita
  ok   · M124.2 · fondear una meta EUR desde una cuenta USD se rehúsa en el INSERT (KIPU_VALIDATION funded)
  ok   · M124.3 · mover el fondeo de una meta USD a una cuenta EUR se rehúsa en el UPDATE
  ok   · M124.4 · vincular goal_account_id en otra moneda sigue rehusándose (rama original intacta)
  ok   · M124.5 · cambiar la moneda de la cuenta que fondea una meta se rehúsa (wired to a goal)
  ok   · M124.6 · la cuenta gemela sin vínculo cambia de moneda: el guard es la dependencia, no un cerrojo
  ok   · M124.7 · borrar la cuenta de fondeo deja la meta viva con funding_account_id NULL (cero clase 091)
M124 PostgreSQL probes: 7/7
~~~

### 9. Mutaciones

Comando: `node scripts/qa/telegram-agent-regression-audit.mjs`

Exit: `0`

~~~text
ok · M0M1 notifier republishes an occurrence already satisfied by a fact → TG-1
ok · M0M2 statement facts stop satisfying the matching calendar cycle → TG-1
ok · M0M3 fact matching ignores the cycle identity → TG-1
ok · M0M5 claim replay stops returning the durable result → TG-8
ok · M0M6 debt proceeds lose the liability leg → TG-3
ok · M0M7 new debt-proceeds history disappears from the base-currency witness → TG-3
ok · M0M8 the debt-proceeds generic half-undo is reopened → TG-7
ok · M0M9 single undo bypasses the versioned domain dispatcher → IR95
ok · M0M10 batch undo bypasses the versioned domain dispatcher → IR105
ok · M0M12 grouped writes no longer require complete preflight → TG-7
ok · M0M13 atomic execution stops respecting planned order → TG-7
ok · M0M14 archive search can present a capped page as complete → TG-8
ok · M0M17 proactive output stops consuming semantic voice review → TG-6
ok · M0M18 voice policy regresses into an incident blacklist → TG-6
ok · M0M20 financial facts disappear from base-currency history → TG-3
ok · M0M22 whole-operation undo bypasses the versioned reversal dispatcher → TG-9
ok · M0M23 whole-operation undo silently accepts more receipts than any bounded plan can create → TG-9
ok · M0M25 PostgreSQL accepts more plan steps than the planner can prove → TG-10
ok · M0M26 statement imports invoke the durable agent without their persisted root turn → TG-11
ok · M0M27 debt-proceeds replay stops binding the low-level dedupe identity → TG-3
ok · M0M28 debt-proceeds replay skips the persisted intent check → TG-3
ok · M0M29 crossed operation closures abandon deterministic lock order → TG-2
ok · M0M30 a reused delivery key is no longer bound to its persisted root turn → TG-2
ok · M0M33 voice-review outage silently authorizes unreviewed prose → TG-6
ok · M0M35 model E2E bypasses the public chat handler → TG-12
ok · M0M37 camelCase transaction receipts stop becoming reversible refs → TG-9
ok · M0M38 Pre-M account reconciliation history disappears from the base-currency witness → TG-3
ok · M0M43 occurrence-first and fact-first transactions lose their shared identity lock → TG-1
ok · M0M45 the legacy response prompt regresses to an incident-specific warning label → TG-6
ok · M0M47 one missing datum freezes every independent action again → TG-9
ok · M0M51 SQL accepts a missing field aimed at a nonexistent step → TG-10
ok · M0M52 open-operation context hides receipts from prior plan versions → IR272
ok · M0M53 operation undo forgets writes from prior plan versions → TG-9
ok · M0M54 partial verification is silently disabled inside PostgreSQL → TG-9
ok · M0M55 a needs-info receipt is rejected merely because its dependency did not run → TG-9
ok · M0M58 fact-first satisfaction stops persisting its durable audit link → TG-1
ok · M0M59 get_financial_context drops the recurring-income catalog → TG-8
ok · M0M62 identity updates stop refreshing the durable fact link → TG-1
ok · M0M63 occurrence updates wait in a row/advisory deadlock instead of retrying → TG-1
ok · M0M68 a newly unclassified mutating tool silently receives a default → TG-7
ok · M0M69 K learned observations disappear from the base-currency witness → TG-3
ok · M0M70 a stale planner can save after another worker reclaimed the delivery → TG-2
ok · M0M73 metadata-only correction is mislabeled as an unavoidable money event → TG-7
ok · M0M75 PostgreSQL accepts the same settled write under a renamed continuation step → TG-2
ok · M0M80 learned memory omitted from the prompt is reported as complete → TG-8
ok · M0M81 learned-memory recovery is mislabeled as a write → TG-8
ok · M0M82 learned-memory search ignores the complete catalog → TG-8
ok · M0M84 PostgreSQL stops checking the resolved capital amount against the persisted plan → TG-7
ok · M0M85 PostgreSQL stops checking a resolved card amount against the persisted plan → TG-7
ok · M0M86 an omitted counterparty silently allocates across several receivables → TG-7
ok · M0M87 a repayment amount may exceed the proven outstanding balance → TG-7
ok · M0M89 the receivable catalog is mislabeled as a mutating tool → IR163
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
ok · M0M105 reopening a terminal occurrence leaves its stale fact current and the reminder permanently silent → TG-1
ok · M0M106 agent writers drop the trusted FX snapshot and ask for a rate the user already has → TG-8
ok · M0M108 unrecorded capital return drops the transaction id produced by the ledger → TG-9
ok · M0M109 the canonical chat applier hides every financial transaction receipt from its callers → TG-9
ok · M0M110 a multi-source card payment records its group but not its ledger legs → TG-9
ok · M0M111 reopening a resolved card ask forgets the still-live bank statement fact → TG-1
ok · M0M112 the primary agent invokes a second response model inside its writer → TG-6
ok · M0M113 expense writes rebuild a second stale context before the primary response pass → TG-6
ok · M0M115 the durable reversal marker rejects a valid fifteen-row batch after reversing it → TG-9
ok · M0M116 the versioned batch dispatcher keeps the obsolete ten-row ceiling → TG-9
ok · M0M117 re-resolving an occurrence with identical evidence leaves its retired fact inactive → TG-1
ok · M0M120 conversation memory loses date-window browsing and can only recover remembered words → TG-8
ok · M0M121 open durable work is truncated to twenty rows and the agent locks out on the twenty-first → IR272
ok · M0M123 PostgreSQL accepts a continuation planned on a stale operation version → TG-2
ok · M0M125 the recovery RPC stops proving plan-step parity → TG-13
ok · M0M128 PostgreSQL accepts a replacement without an earlier operation reversal → TG-13
ok · M0M130 an intake delivery key may be reused for different request text → TG-14
ok · M0M132 an intake failure can be resolved by an unrelated operation → TG-14
ok · M0M134 deleting an operation nulls a resolved intake and recreates an account-deletion lock-out → TG-14
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
ok · M0M151 a grouped log_movement is admissible again outside a whole-operation correction → TG-13b
ok · M0M153 the evaluation bridge trusts NODE_ENV alone and stays reachable through a tunnel → TG-12b
ok · M0M156 an unverified review can launder voseo because the deterministic backstop went blind → TG-6b
ok · M0M176 the voice judge can reject an answer for naming the user's own card → TG-6c
ok · M0M157 a migration function ships without pinning its search_path → TG-1b
ok · M0M158 reopening ignores the exact bank fact superseded by the retired resolution → TG-1c
ok · M0M159 occurrence reopen no longer serializes with concurrent fact publication → TG-1c
ok · M0M160 corrected statement evidence reuses the cycle birth timestamp → TG-1c
ok · M0M161 the local evaluation route stops consuming its bearer authority → TG-12b
ok · M0M163 whole-operation undo returns to a global fixture balance instead of its local delta → TG-1c
ok · M0M164 single-operation undo returns to a global fixture balance instead of its local baseline → TG-1c
ok · M0M165 reopened statement test stops checking the restored monetary payload → TG-1c
ok · M0M166 legacy restoration trusts a live source id without matching its monetary payload → TG-1c
ok · M0M167 whole-operation undo drops card identity before comparing restored debts → TG-1c
ok · M0M177 calendar predicates become entity anchors and reject a grounded amount-plus-date answer → IR113c
ok · M0M178 a financial role must appear beside the amount instead of anywhere proven for the same entity → IR113c
ok · M0M179 one entity borrows its financial role from a different entity → IR113c
ok · M0M180 legacy fact restoration again relies on WHERE predicate order before a numeric cast → TG-1d
ok · M0M185 unrecorded returned capital again requires a fictitious counterparty name → TG-3
ok · M0M186 executor again blocks unrecorded returned capital on an economically irrelevant name → TG-3
ok · M0M187 a continuation forgets entities explicitly named in its immutable root request → IR143
ok · M0M189 each amount in a natural multi-card summary is again bound to every card in the sentence → IR113c
ok · M0M193 typed receipt amounts without a currency suffix disappear from grounding → IR113d
ok · M0M195 a READY plan again discards the exact pending question needed after worker recovery → TG-1e
ok · M0M200 open-operation context drops user entities introduced on intermediate clarification turns → IR143
ok · M0M201 punctuation after a user-named account makes the durable mention disappear → IR143
ok · M0M202 the PostgreSQL E2E stops proving that READY recovery retains its exact question → TG-1e
ok · M0M203 the PostgreSQL E2E stops proving that every user clarification remains bound to its operation → IR143
ok · M0M204 PostgreSQL again allows a READY plan to persist missing fields without any recoverable question → TG-1e
ok · M0M205 the PostgreSQL E2E stops challenging a READY plan whose missing fields have no question → TG-1e
ok · M0M208 relative dates are resolved in UTC instead of the user's timezone → IR113c
ok · M0M212 a successful model-eval turn omits the compiled runtime contract → TG-12
ok · M0M217 open-operation continuity is cut off by the app process clock again → IR217
ok · M0M218 completed-operation search is cut off by the app process clock again → IR217
ok · M0M219 the database clock is rounded backwards to milliseconds before bounding committed rows → IR217
ok · M0M220 authenticated gains authority to execute the internal operation snapshot clock → IR217
ok · M0M221 the PostgreSQL E2E stops proving continuity against a process clock one day behind the database → IR217
ok · M0M225 user-owned prose inside the verified snapshot becomes deterministic money evidence → IR113b
ok · M0M228 an injected closing tag escapes the structured evidence mask → IR113b
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
ok · M0M256 an ordinary proved batch is challenged as if its amount associations were unknown → IR260
ok · M0M257 a batch accepts amounts that are present but attached to the opposite descriptions → IR260
ok · M0M258 nested account selections in a batch bypass the entity-authority guard → IR260
ok · M0M267 the server challenge again dictates a rigid command instead of requesting natural explicit confirmation → IR261
ok · M0M272 record_person_payment loses the canonical occurrence date from its closed schema → IR262
ok · M0M273 the atomic person-payment adapter reads the card-payment date alias again → IR262
ok · M0M274 the individual person-payment executor ignores a proved historical date and always writes today → IR262
ok · M0M277 an invented model property is again presented as user-answerable missing information → IR122
ok · M0M278 the refund path drops the proved person-payment date at the writer boundary → IR262
ok · M0M279 an invalid grouped person-payment date silently degrades to today → IR262
ok · M0M280 an invalid individual person-payment date silently degrades to today → IR262
ok · M0M306 a descriptive participle is again treated as a write claimed by Kipu → IR266
ok · M0M307 perfect and impersonal mutation claims no longer require a receipt → IR266
ok · M0M308 a clause-terminal state can again announce an unproved write → IR266
ok · M0M309 listo used as ordinary discourse is again mistaken for a completed mutation → IR266
ok · M0M311 direct listo and hecho receipts no longer require proof → IR266
ok · M0M312 accented impersonal preterites fall through the ASCII word-boundary trap → IR266
ok · M0M313 Kipu can again claim dejé registrado without a proved write → IR266
ok · M0M314 a proposal subjunctive is again treated as Kipu claiming a completed write → IR266
ok · M0M316 an unbound passive state can again claim a completed event → IR266
ok · M0M317 operation undo again classifies every domain write as ledger money → TG-9
ok · M0M318 the PostgreSQL regression fixture stops adding a receipt-less domain write → TG-9
ok · M0M319 an expense write is mislabeled as non-economic and can evade its receipt requirement → TG-9
ok · M0M324 a sentence boundary lets a bare success receipt escape the write barrier → IR266
ok · M0M333 the mutation audit starts from a red capture baseline and mislabels inherited failures as killed mutants → IR269
ok · M0M341 card-payment tool documentation again calls the event a transfer and teaches the planner the wrong ontology → IR271
ok · M0M343 the open read stops failing closed when the snapshot omits its completeness verdict → IR272
ok · M0M344 the snapshot RPC declares a capped operation set as the complete whole → IR272
ok · M0M345 a child row outside the returned parent set is silently accepted instead of refusing the read → IR276
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
ok · M0M412 an exact stable fixed-expense amount again requires a third user confirmation after the source account was supplied → IR286
ok · M0M418 a resolved entity forgets the user-authored root of its exact durable operation → IR289
ok · M0M419 a fixed-expense link again matches only the latest clarification turn → IR289
ok · M0M420 a newly named entity no longer refutes the stale entity inherited from the operation root → IR289
ok · M0M421 a corrected fixed-expense name is ignored while the stale root entity remains linked → IR289
ok · M0M431 an authorized manifest again has to repeat an account name in the latest sentence → IR297
ok · M0M432 an authorized operation is again rerouted by a lexical correction matcher → IR297
ok · M0M433 a manifest-authorized movement again enters the text-driven duplicate/correction guard → IR297
ok · M0M434 an exact card-payment manifest again depends on parsing the confirmation sentence → IR297
ok · M0M437 M0.11A drops the legacy challenge index before every rollback path has left it → IR296
ok · M0M439 a semantic transition changes durable state without participating in operation CAS → IR296
ok · M0M440 manifest verification collapses execution failures back into one misleading diagnosis → IR299
ok · M0M441 the planner-facing provenance catalogue stops using the money ontology shared with runtime → IR300
ok · M0M450 whole-operation undo stops declaring that its database transaction owns the durable step receipt → IR334
ok · M0M454 current card statement amounts lose their server-owned stored-fact verifier → IR303
ok · M0M456 the executor accepts a stored amount without binding the plan source_ref → IR303
ok · M0M465 a historical statement snapshot blocks a covered zero-balance card forever → IR308
ok · M0M474 the store rejects an exact manifest whose complete execution was already verified before publication failed → IR311
ok · M0M477 a partially verified manifest is allowed to masquerade as fully recovered → IR311
ok · M0M478 PostgreSQL drops the locked card-statement stored-fact verifier → IR311
ok · M0M497 native dispatcher stops staging mechanical sensitivity and monetary evidence requirements → IR328a
ok · M0M498 ordinary registration loses model authority and revives the blocking guard → IR348b
ok · M0M499 undo stops consuming the server-derived economic marker from a contextual receipt → IR328i
ok · M0M500 loop settlement goes back to the request-local step array → IR328j
ok · M0M501 verify-loop-step again rejects an applied v1 step after manifest restaging bumps the operation to v2 → IR328k
ok · M0M502 native loop shadows the proven executor receipt-to-ref producer again → IR328o
ok · M0M503 native loop pays the heavy envelope role-binding tax again → IR328q
ok · M0M504 native loop again treats the model's sole origin candidate as user authority → IR330a
ok · M0M505 log_movement is re-added to the grave second-delivery list → IR348a
ok · M0M506 a named stored principal again counts as an unbound second amount → IR331a
ok · M0M507 proposal extension stops carrying the prior staged actions into one successor → IR331b
ok · M0M508 a post-write model failure loses its safe receipt continuity → IR331c
ok · M0M509 an authorized correction batch re-enters the legacy correction redirect → IR331d
ok · M0M510 native rent execution again uses the planner-provenance verifier instead of the loop catalog verifier → IR331e
ok · M0M511 live consolidation keeps the stale action instead of replacing the same capability and entity → IR332a
ok · M0M512 confirmed execution stops consuming the operation-authored source before S31 → IR332b
ok · M0M513 manifest authorization no longer satisfies the legacy close-card confirmation bit → IR332c
ok · M0M514 borrowed funds bypass pre-staging account and liability completion → IR332d
ok · M0M515 correction guidance again permits an undo-only proposal despite known replacements → IR332f
ok · M0M516 identical user redelivery and identical response become a false no-progress failure again → IR332e
ok · M0M517 live consolidation stops canonicalizing a typed entity name to its durable id → IR333a
ok · M0M518 debt proceeds accept a merely proposed loop manifest instead of an executing authorized one → IR333b
ok · M0M519 borrowed-funds dry-run stops confirming the exact durable proposal → IR333c
ok · M0M520 a null loop authority verdict again falls through the PL/pgSQL IF → IR333b
ok · M0M521 borrowed debt proceeds lose writer-owned operation-step receipt → IR334
ok · M0M522 completion-level economic classification is bypassed before dispatch → IR335
ok · M0M523 an immediate-eligible economic call executes before the turn set is known → IR335
ok · M0M524 a modified model-emitted set is misclassified as the identical pending manifest → IR336
ok · M0M525 a retained proposal is again mistaken for a proposal authored by the current delivery → IR336
ok · M0M526 model re-emission after confirm bypasses the executing-manifest redirect → IR336
ok · M0M527 outer turn diagnostics drop bounded HTTP status from the error class → IR338
ok · M0M528 post-write continuity bypasses server-side settlement → IR338
ok · M0M529 post-execution reads again bypass the executing-manifest redirect → IR338
ok · M0M530 manifest execution again pushes a full refresh after every write → IR339
ok · M0M531 provider error code disappears from the bounded turnFailure token → IR339
ok · M0M532 a rejected predecessor again shadows the current manifest → IR339
ok · M0M533 manifest confirmation again interleaves refresh before sibling tool responses → IR340
ok · M0M534 loop completions bypass the local tool-message sequence validator → IR340
ok · M0M535 pending-manifest control no longer owns sibling mutations in its completion → IR341
ok · M0M536 manifest registration again admits duplicate server-owned intent keys → IR341
ok · M0M537 an HTTP 200 hadError can again lose its bounded diagnostic → IR341
ok · M0M538 a terminal manifest step no longer triggers loop quarantine → IR342a
ok · M0M539 the durable repeated-error circuit breaker is disabled → IR342a
ok · M0M540 origin no longer quarantines a manifest with a terminal step → IR342a
ok · M0M541 Telegram replies lose the guarded HTML parse mode → IR342b
ok · M0M542 a generic resume failure again escapes quarantine → IR342a
ok · M0M543 a quarantined recovery can no longer execute a read without durable restaging → IR342a
ok · M0M544 the worker drops its exact live lease before quarantining its own resume failure → IR342a
ok · M0M545 a calendar receipt overclaims that confirming pre-existing money moved it again → IR343a
ok · M0M546 calendar source mismatch stops comparing the expected and actual owned ids → IR343b
ok · M0M547 the recurring executor drops consumption of pre-existing transaction evidence → IR343c
ok · M0M548 repeated capability intent and refusal can ask forever without durable progress → IR344a
ok · M0M549 close-card live balance guard runs only after the proposal again → IR344b
ok · M0M550 a paused debt keeps consuming monthly capacity → IR344c
ok · M0M551 Telegram leaves Markdown headers unrendered → IR344d
ok · M0M552 an unrelated ordinary capture is absorbed by any pending sensitive proposal → IR345a
ok · M0M553 compact amount suffixes stop contributing their closed numeric scale → IR345b
ok · M0M554 ad-hoc investment contributions lose their economic-event classification → IR346a
ok · M0M555 asset revaluation receipts claim that money moved → IR346b
ok · M0M556 pending proposals accept a vague deferral without checking staged facts → IR346c
ok · M0M557 the money guard stops consulting the value the user stated one turn earlier → IR347a
ok · M0M558 spoken amounts stop counting as the user's own evidence → IR347b
ok · M0M559 the money evidence stops reaching the user's previous delivery in this conversation → IR347c
ok · M0M562 a self-corrected model slip stains the turn as an error again → IR349
ok · M0M563 an invented amount silently writes again instead of asking → IR350
ok · M0M564 a fabricated quote authorizes an invented amount again → IR351
ok · M0M565 arithmetic over proven figures is flagged unsupported again → IR352
ok · M0M567 a poisoned assembly kills the turn again instead of self-repairing → IR353
ok · M0M568 the figure rewrite may order refusing totals again → IR353
ok · M0M566 conversational questions stack awaiting operations again → IR352
ok · M0M569 the engine per-currency totals silently drop money again → IR354
ok · M0M570 sum_balances accepts a foreign/unknown id and publishes a partial silent total → IR354
ok · M0M571 a sum_balances read failure authorizes mental math again → IR354
ok · M0M572 the loop prompt stops routing arithmetic to the engine → IR354
ok · M0M573 a debt declared settled outside keeps a phantom base-side balance again → IR354
ok · M0M574 the card noop summary points the model at an unregistered tool again → IR353
ok · M0M575 the context hides each debt's kind and a card-scoped request can sweep a loan again → IR354
ok · M0M576 an unrequested identical duplicate writes a second row again → IR354
ok · M0M577 a stated numeral no longer keeps the duplicate write flowing → IR354
ok · M0M578 the prompt drops answering≠writing and the payment-method semantics → IR354
ok · M0M579 an identical re-narrated capital return lands real money twice again → IR354
ok · M0M580 the no-numeral warrant option is ignored and re-narrated numbers re-write → IR354
ok · M0M581 the identical partial card payment re-lands because the net lost its card identity → IR354
ok · M0M582 the funding advisor loses its by-date engine math and dates go unanswered → IR355
ok · M0M583 the proposal verdict always says the user's plan fits → IR355
ok · M0M584 a product-name numeral interrogates against a currency-marked price again → IR355
ok · M0M585 a re-narrated goal creates a second identical goal again → IR355
ok · M0M586 the update_goal receipt hides the committed contribution figure again → IR355
ok · M0M587 new-goal capacity stops subtracting existing goal commitments → IR355
ok · M0M588 the prompt stops routing goal math to the engine → IR355
ok · M0M589 an unreadable briefing silently claims zero free capacity → IR355
ok · M0M590 the engine no longer commits the required contribution at goal creation → IR355
ok · M0M591 a simulation hypothesis is interrogated as an unstated amount again → IR355
ok · M0M592 a loan name in the card-payment tool asks an absurd card question again → IR355
ok · M0M593 the executor-side barrier interrogates a simulation hypothesis pair again → IR355
ok · M0M594 a landed write can be denied to the user again → IR356
ok · M0M595 the save-failure grammar goes blind → IR356
ok · M0M596 a distinct goal that happens to cost the same is swallowed as a duplicate again → IR357
ok · M0M597 a sequential stage runs from today again and can land before its predecessor → IR357
ok · M0M598 the planning/closing phase doctrine disappears from the prompt → IR357
ok · M0M599 the frontier stops declaring itself isolated → IR357
ok · M0M600 a freshly committed figure can be deferred to the next step again → IR358
ok · M0M601 the loan payment through the card tool depends on model obedience again → IR358
ok · M0M602 a contribution without a named account ignores the goal's declared funding again → IR359
ok · M0M603 the funding-defaulted source loses its learned authority and dies in unproven_choice again → IR359
ok · M0M604 the calendar stops attributing the goal contribution to its funding account → IR359
ok · M0M605 the funding resolver inverts its currency guard and blesses a cross-currency source → IR359
ok · M0M606 update_goal silently drops the explicit funding clear → IR359
ok · M0M607 the prompt stops teaching that declared funding is an engine fact never asked at creation → IR359
ok · M0M560 degraded authority guards stop emitting their bounded telemetry counter → IR348b
ok · M0M561 the loop publishes a claimed write even though no tool wrote → IR348c
M0 mutations: 324/324
~~~

## 5. Qué no se hizo y qué queda pendiente

- No se ejecutó la muestra real de 35 carriles: el contrato la reserva a
  Claude porque usa modelo real y cuesta dinero.
- No se hizo merge ni push a `main`; no se desplegó ni se cambió ningún env de
  producción.
- No se tocó SQL, migraciones, RLS, grants, writers, motor financiero, prompt
  del loop, schemas de tools, webhook de Telegram ni auth.
- No se borraron documentos M0 históricos ni logs de evidencia.
- No se intentó “mejorar” warnings preexistentes ni comportamiento de una
  superficie viva. Queda pendiente únicamente la auditoría de Claude, su muestra
  real y la declaración/merge posterior del founder.

## 6. Riesgos, hallazgos y objeciones

- La primera sonda PostgreSQL detectó una omisión real de alcance estático:
  dos helpers puros del manifiesto se cargan dinámicamente desde el E2E. Fueron
  restaurados antes de la batería final; PostgreSQL cerró 82/82 y M116–M124.
- La primera corrida de mutaciones detectó 17 pins vivos mal separados durante
  la poda. No se eliminaron esos mutantes: se fortalecieron sus detectores y la
  corrida diagnóstica y la final cerraron 324/324.
- Lint conserva 8 warnings preexistentes en M122/M123 y 0 errores. Build conserva
  el warning de Turbopack por el lector dinámico del capture-test. Node emite el
  warning `MODULE_TYPELESS_PACKAGE_JSON` en varias sondas. Ninguno cambió el
  exit ni fue introducido como comportamiento de producto.
- No hay objeción estructural al contrato ni necesidad de DDL. La única
  desviación cuantitativa es el mayor número de líneas eliminadas, explicado en
  §1 y enteramente sustractivo.

## 7. DDL

Ninguno propuesto ni aplicado. `supabase/` quedó byte-intacto en el diff.

## Anexo A. IDs de capture podados

Se eliminaron **93 aserciones** históricas, equivalentes a **64 IDs que ya no existen**. Los IDs mixtos que todavía fijan código vivo se conservaron o reexpresaron y no aparecen aquí.

- `H.45` — 1 aserción; fijaba aclaración tras un fallo REAL del refresh (P1): el refresher lanza → saldoAvailable queda false → la pregunta pendiente llega intacta al usuario; sin esto la captura quedaba muerta todo el fallo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `H.34` — 1 aserción; fijaba barrera final determinista (P1): si el refresh dejó saldoAvailable=false, una respuesta que filtra 120 se rehúsa para re-redacción del modelo; con estado sano no altera la respuesta. Su objeto era el planner/publicación/recovery envelope eliminado.
- `H.37` — 1 aserción; fijaba la barrera no mata la pregunta (P1): con saldoAvailable=false una aclaración limpia sobrevive; si filtra Saldo o no es una aclaración se rehúsa para re-redacción del modelo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR55-d` — 1 aserción; fijaba una corrección bloqueada no cae al pipeline legacy (que la reescribiría como movimiento nuevo). Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR110` — 1 aserción; fijaba confirm:true del modelo no autoriza: el servidor emite un challenge y solo otra entrega explícitamente afirmativa puede consumirlo una vez. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR113` — 4 aserciónes; fijaba la salida solo cita montos probados JUNTO a su entidad y nunca narra una escritura que no ocurrió. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR121` — 1 aserción; fijaba confirmedNew y confirmDefaultSource dejaron de ser autoridad del modelo: ambos requieren challenge durable y la cuenta habitual queda resuelta por el servidor en la propuesta. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR126` — 1 aserción; fijaba omitir el símbolo de moneda no evade el grounding cuando la frase afirma Saldo/deuda; fechas, cuotas y porcentajes siguen fuera. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR130` — 1 aserción; fijaba una confirmación natural la interpreta el planner y autoriza UN manifiesto exacto; el atajo léxico legacy queda fuera del runtime. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR145` — 1 aserción; fijaba el estado de un tool separa destinos: el éxito de Diners no borra el fallo de Visa, pero completar una tarjeta faltante sí limpia la aclaración genérica del mismo pago. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR147` — 1 aserción; fijaba corregir una de dos propuestas bloqueadas no borra la otra ni reabre el fallback legacy. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR148` — 1 aserción; fijaba una redelivery sin respuesta no ocupa la identidad con copy artificial: el lease durable decide inflight/recovery y un worker vivo fuerza retry del transporte. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR154` — 1 aserción; fijaba el planner deriva su catálogo de toda tool expuesta y el executor recibe sólo el subconjunto del plan; no hay lista manual que pueda omitir capacidades. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR165` — 1 aserción; fijaba bancos/aliases cortos también atan monto↔entidad: BCP, MP y N26 no pueden tomar prestado el número verdadero de otra fila. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR201` — 1 aserción; fijaba el agente no conserva la ruta antigua que mandaba una factura variable a log_movement: toda observación/pago/corrección usa el ciclo canónico. Su objeto era el planner/publicación/recovery envelope eliminado.
- `TG-3b` — 1 aserción; fijaba un plan económico incompleto recibe el veredicto determinista y se repara con límite; tres candidatos inválidos siguen fallando cerrados. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR259` — 1 aserción; fijaba ME10aa verifica la corrección con reversas append-only, identidades exactas y deltas locales; nunca consulta una columna fantasma. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR263` — 1 aserción; fijaba un éxito parcial nombra cada pendiente verificado, «de una sola operación» no es regionalismo y person-payment no inventa balances de contraparte. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR264` — 1 aserción; fijaba los pendientes legacy conservan su scope tipado y las autorizaciones sensibles se miden por manifiesto de operación, nunca por autor o conjugación. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR265` — 1 aserción; fijaba una consulta de estado observa la operación sin consumirla ni copiar su missing-field a otra fila awaiting_input. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR284` — 1 aserción; fijaba prompt, validador y fixture comparten el source exacto de una assertion observada y el repair recibe su path. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR283` — 1 aserción; fijaba money_not_grounded nombra la cifra acotada, guía la reparación y no amplía la evidencia post-write. Su objeto era el planner/publicación/recovery envelope eliminado.
- `TG-12c` — 1 aserción; fijaba una respuesta sin tools omite tool_choice en los tres pases del modelo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR267` — 1 aserción; fijaba el servidor compila sólo la coreografía inequívoca de una corrección completa y conserva el validador estricto. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR268` — 1 aserción; fijaba agotar el planner produce lenguaje AI de no-acción y nunca un 500, recibo falso o dato faltante inventado. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR270` — 1 aserción; fijaba un fallo de intake conserva etapa y los tres rechazos tipados antes del cleanup; los checks dependientes no se presentan como defectos nuevos. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR285` — 1 aserción; fijaba un intake failure recuperado con HTTP 200 conserva stage, attempts y validationFailures en turnDetail antes del cleanup. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR287` — 1 aserción; fijaba un dato ya presente no puede reaparecer como missing_field y una pregunta natural que tropieza con el matcher conserva todos los answer_shape sin degradar a no-acción. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR288` — 1 aserción; fijaba el planner adopta el monto nativo server-owned de un fijo estable ya identificado, retira sólo amount y conserva la pregunta real; variable o contradicción permanecen intactas. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR290` — 1 aserción; fijaba un plan mixto inválido recibe una salida semántica segura: operación durable no significa grupo atómico, la procedencia no se reescribe y una pata ambigua no elimina las acciones independientes. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR291` — 1 aserción; fijaba un veto interno repara su propia dimensión y jamás se convierte en un falso dato faltante del usuario. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR279` — 1 aserción; fijaba la respuesta cubre cada hecho declarado o se rehúsa: omitir monto o fecha falla, la paráfrasis pasa, un valor ligado a otra entidad no cuenta y un requisito sin evidencia jamás se exige. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR280` — 1 aserción; fijaba el contrato es mínimo y tipado: >6 requisitos, un kind inventado o un no_op con requisitos se rehúsan; una omisión read-only bloquea su primera candidata y fuerza reparación, y la reparación no puede perder un hecho ya cubierto. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR281` — 1 aserción; fijaba combinaciones no anticipadas (multi-entidad + comparación derivada) se representan y verifican sin ruta nueva; prosa sin entidad y operandos no probados jamás se exigen como hecho. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR282` — 1 aserción; fijaba el contrato de la respuesta acepta sólo valores canónicos: un turno needsInfo no arrastra requisitos, los kinds cualitativos se rehúsan y una entidad real se verifica en ambos sentidos. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR292` — 1 aserción; fijaba una autorización cubre 1, 4 o 20 acciones exactas sin fragmentarse en desafíos por tool. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR293` — 1 aserción; fijaba la transición consume estructuralmente la respuesta: progreso pasa y un loop literal o parafraseado queda prohibido. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR294` — 1 aserción; fijaba user_stated se prueba contra una entrega durable exacta; un saldo verdadero no puede ocupar el monto de la acción. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR295` — 1 aserción; fijaba autorizado = preparado = ejecutado: una acción faltante o distinta es fallo duro durable. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR298` — 1 aserción; fijaba el lifecycle acepta por estructura las ocho salidas terminales/no-estancadas sin clasificar frases. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR301` — 1 aserción; fijaba transición y autorización publican el mismo contrato wire que valida, con rutas y acciones exactas en cada rechazo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR302` — 1 aserción; fijaba un writer que asienta su step no recibe un segundo recibo y el E2E mide el lifecycle del manifiesto. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR304` — 1 aserción; fijaba una pasada read/replan elegida por el modelo difiere la pregunta hasta ver READ_EVIDENCE; mutaciones no se compilan y los rechazos nombran la ruta exacta. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR305` — 1 aserción; fijaba el prompt vivo publica sólo procedencias que A puede verificar; derived queda reservado hasta que B registre un derivador bajo lock. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR306` — 1 aserción; fijaba guardar→recuperar usa el envelope exacto validado; un pendiente posterior del executor no se reinterpreta como salida del planner y cualquier drift rompe el receipt. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR307` — 1 aserción; fijaba la dirección de caja nunca decide quién era acreedor: el planner aplica una prueba contrafactual general y pregunta cuando ambos mundos económicos siguen siendo posibles. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR309` — 1 aserción; fijaba cada forma monetaria usa un único cálculo de provenance: los números presentes y los paths omitidos materializados por un verificador server-owned convergen antes del modelo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR310` — 1 aserción; fijaba lógica anti-bot: la prosa pertenece al modelo, el runtime verifica estado y todo último recurso cruza verdad sin convertir tokens españoles en autoridad. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR312` — 1 aserción; fijaba el objetivo y la relación durable no cambian entre reads, mientras la interpretación sí puede enriquecerse con evidencia nueva. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR313` — 1 aserción; fijaba missing_fields conserva la ambigüedad elegida por el modelo y el servidor deriva únicamente su target mecánico. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR314` — 1 aserción; fijaba el modelo declara la asociación semántica y el servidor liga su cita a una entrega durable exacta; un número meramente presente nunca se autoautoriza. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR315` — 1 aserción; fijaba read/replan bloquea el significado inicial, converge en un pase final y toda degradación conserva la causa tipada real. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR316` — 1 aserción; fijaba ninguna frase o token español decide si una pregunta natural consume un pendiente en el camino activo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR317` — 1 aserción; fijaba replay y transporte conservan la causa tipada; un fallo de contrato nunca vuelve a fingir caída del proveedor. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR318` — 1 aserción; fijaba la interfaz viva es sustractiva y el gate falla si reaparece wire mecánico: 6 raíces, 3 campos por unidad, 3 por step y 12 obligaciones ordinarias. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR319` — 1 aserción; fijaba el modelo elige gasto+argumentos y el servidor compila patas, ids, lifecycle y procedencia sin pedirle contabilidad al modelo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR320` — 1 aserción; fijaba resta no relaja 552,77: un número presente sin la cita semántica exacta nunca adquiere procedencia por búsqueda mecánica. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR321` — 1 aserción; fijaba expected_change conserva el cruce semántico: un gasto no puede proyectar que la misma caja aumenta. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR322` — 1 aserción; fijaba N pasos de una promesa de estado se compilan a una sola unidad atómica sin N challenges ni wiring del modelo. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR323` — 1 aserción; fijaba ningún ok:false puede escapar del agente sin causa tipada y continuación; el handler consume esa respuesta en vez de inventar otra. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR324` — 1 aserción; fijaba el catálogo estático precede al turno dinámico para cachearse y la telemetría conserva input/cached/output por turno. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR325` — 1 aserción; fijaba el E2E conversacional ya no importa ni aserta el planner/envelope: conversa por HTTP y juzga efectos PostgreSQL. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR326` — 1 aserción; fijaba toda mutación conserva una proyección observable; una action sin expected_change nunca obtiene wire ejecutable. Su objeto era el planner/publicación/recovery envelope eliminado.
- `IR327` — 1 aserción; fijaba la evidencia pertenece al step semántico: dos importes iguales no comparten ni canibalizan su cita. Su objeto era el planner/publicación/recovery envelope eliminado.

## Anexo B. Mutantes M0M podados

Se podaron exactamente **277 mutantes**. Cada línea identifica el comportamiento muerto que fijaba; los 324 mutantes restantes conservaron anchor con hits=1 y murieron en la batería final.

- `M0M4` — exact delivery replay re-enters planning; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-2`).
- `M0M11` — the planner accepts debt cash without a liability; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M15` — planner read evidence is derived but not consumed; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-8`).
- `M0M16` — agent output stops consuming semantic voice review; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6`).
- `M0M19` — capability catalog becomes a manually filtered subset; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR154`).
- `M0M21` — an individually executed write loses its typed transaction receipt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-9`).
- `M0M24` — the planner accepts an unbounded action list; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-10`).
- `M0M31` — truncated financial context is presented as complete; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-8`).
- `M0M32` — an atomic group ignores an unverified external dependency; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-9`).
- `M0M36` — semantic evaluation stops generating unseen paraphrases; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M39` — the generic financial algebra is derived but no longer consumed; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M40` — the validated plan is no longer executed deterministically; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-10`).
- `M0M41` — the response model regains execution authority after the plan ran; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-10`).
- `M0M42` — an atomic group may wrap an interleaved independent action; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-10`).
- `M0M44` — an infrastructure failure returns to an empty assistant bubble; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `IR310`).
- `M0M46` — the founder E2E no longer proves the already-booked salary context; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M48` — the runtime stops requesting partial verification; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-9`).
- `M0M49` — planned missing fields no longer block their named action; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-9`).
- `M0M50` — a read-only action is admitted into an atomic write group; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-10`).
- `M0M56` — a continuation is invited to repeat already verified work; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-2`).
- `M0M57` — the planner no longer receives prior-version step receipts; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-9`).
- `M0M60` — a financial balance can masquerade as configuration; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M61` — exact redelivery again depends on context and planner availability; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-2`).
- `M0M64` — sharing one account again makes independent facts one all-or-nothing group; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M65` — an economic tool may omit its accounting event; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M66` — the live catalog computes effect semantics but does not consume them; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR154`).
- `M0M67` — a domain-state tool may claim it moved money; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M71` — a recovered delivery can detach from the operation whose receipts make replay safe; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-2`).
- `M0M72` — an inflight duplicate publishes a fallback reply over the winning worker; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `IR148`).
- `M0M74` — a continuation may repeat a side effect that already landed; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-2`).
- `M0M76` — the planner labels a mutating action as a read-and-replan pass; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-10`).
- `M0M77` — the read phase invokes a mutating tool before checking its authority; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-10`).
- `M0M78` — unrecorded returned capital can fabricate a receivable side effect; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M79` — a typed writer can claim a second economic event it never executes; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M83` — prompt omissions are computed but not delivered to the planner; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-8`).
- `M0M88` — the planner may write a repayment without reading exact receivable ids; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M103` — one missing card datum reopens every action that uses the same capability; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-2`).
- `M0M104` — contextual writers may claim any valid economic algebra even when no typed mode executes it; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-7`).
- `M0M107` — a forward ledger write can complete without a durable transaction receipt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-9`).
- `M0M114` — a failed calendar read is presented to the planner as a complete empty calendar; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-8`).
- `M0M118` — a second delivery may continue an operation that is still applying; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-2`).
- `M0M119` — the planner persists a dependent group with no transactional adapter; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-10`).
- `M0M122` — the live claim discards the operation versions observed by the planner; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-2`).
- `M0M124` — worker recovery re-samples the planner instead of resuming the persisted plan; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-13`).
- `M0M126` — the planner admits a naked replacement movement without reversing its operation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-13`).
- `M0M127` — the atomic replacement adapter loses the durable correction target; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-13`).
- `M0M129` — financial-context failure disappears before any durable intake record; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M131` — execution no longer waits for the intake marker to close; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M133` — the model is no longer taught the only valid atomic correction shape; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-13`).
- `M0M135` — an unusable pending question disappears without a durable intake failure; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M136` — a stale operation snapshot disappears before claiming a durable operation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M137` — an operation-claim failure leaves no durable retry evidence; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M138` — a corrupt recovered plan keeps a planning lease instead of becoming retriable; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-14`).
- `M0M150` — model correction test leaves its target inside the latest-operation shortcut; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M152` — plan validation asks the group predicate without the group's real membership; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-13b`).
- `M0M154` — a voice-judge outage again spends a repair as if it were a verdict; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6b`).
- `M0M155` — a verified style rejection again silences every safe candidate; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6b`).
- `M0M162` — the model E2E health check omits the shared evaluation secret; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12b`).
- `M0M168` — model E2E writes timezone into the nonexistent profiles column and never reaches the agent; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M169` — model E2E asks the non-variable salary resolver to accept an unsupported explicit payment date; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M170` — model E2E aborts instead of retrying the exact durable delivery after an unpublishable sample; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M171` — verified read-only context is derived but never consumed by the final money barrier; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-8`).
- `M0M172` — a plan with a financial action can launder broad pre-write context into its final reply; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M173` — a no-action answer sends tool_choice without tools and the OpenAI API rejects the turn; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-12c`).
- `M0M174` — the final voice repair sends tool_choice without tools and is dead on first use; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-12c`).
- `M0M175` — pending-question voice repair sends tool_choice without tools and is dead on first use; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-12c`).
- `M0M181` — production planner gives up before repairing a deterministic contract failure; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-3b`).
- `M0M182` — planner repair hides the deterministic reason and asks the model to guess again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-3b`).
- `M0M183` — planner repair accepts an invalid economic candidate instead of revalidating it; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-3b`).
- `M0M184` — economic validation tells the planner that a leg is missing but not which one; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-3b`).
- `M0M188` — production reads durable continuation/recovery authority but never gives it to the entity guard; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR143`).
- `M0M190` — a failed historical step is promoted to verified write evidence; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113d`).
- `M0M191` — verified completed-operation receipts are derived but never given to the action grounding barrier; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113d`).
- `M0M192` — historical write prose again requires a write in the current delivery; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113d`).
- `M0M194` — the planner trusts conversation prose instead of reading completed-operation receipts; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-8`).
- `M0M196` — the finalizer computes calendar grounding but stops consuming its verdict; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M197` — a true due date for one card authorizes the same date on another card; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M198` — an invented calendar day is accepted as long as the entity and role are real; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M199` — an unrelated operation timestamp again proves a card due date; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M206` — a relative due date publishes without proving the user's local calendar day; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M207` — production derives the local date but never gives it to the publication barrier; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M209` — a stale compiled eval server can masquerade as the current source tree; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M210` — the model E2E health check accepts a server with a different runtime contract; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `TG-12`).
- `M0M211` — publication failures again lose the exact failed contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113c`).
- `M0M213` — the official financial snapshot remains a doubly-escaped string and its typed money cannot bind; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M214` — an arbitrary user-forged tagged object is promoted to verified structured money evidence; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M215` — the official financial snapshot is parsed but the verified evidence still consumes the escaped original; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M216` — a typed dueDay borrows the cutoff role from a neighbouring field in the same card object; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M222` — a typed statement date is relabelled as a payment due date by a neighbouring field in the same card object; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M223` — a two-digit calendar day is reparsed as its first digit and makes valid grounded replies impossible; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M224` — the DD-MM tail inside an ISO date is accepted as a second inverted calendar fact; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M226` — user-owned prose inside the verified snapshot becomes deterministic calendar evidence; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M227` — the trusted typed calendar facts are derived but omitted from verified read evidence; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR113b`).
- `M0M229` — verified writes from a still-open operation disappear from conversational audit replies; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR218`).
- `M0M230` — the bounded repair pass is not told which deterministic publication contract rejected the first reply; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR218`).
- `M0M231` — the planner again treats optional movement metadata as a blocking missing fact; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR218`).
- `M0M232` — the live-model E2E again expects a destructive operation to bypass its server-owned confirmation; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR218`).
- `M0M233` — a stale v13 model-eval runtime can impersonate the operation-inspection contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `TG-12`).
- `M0M234` — the planner again describes unrecorded capital prose without requiring its unchanged legs; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR219`).
- `M0M235` — a whole-operation correction may again hide its replacements in an unsupported batch; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR219`).
- `M0M236` — the repair prompt lies about the single bounded style attempt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR219`).
- `M0M237` — an ordinary registered repayment again becomes a proposal that waits for redundant confirmation; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR219`).
- `M0M238` — a destructive repayment undo fixture again skips its server-owned proposal; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR219`).
- `M0M239` — a money-grounding repair may repeat the same unbound figures forever; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR219`).
- `M0M251` — ME10aa again queries a reversal marker column that does not exist; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR259`).
- `M0M252` — ME10aa returns to a distant global balance instead of the local correction delta; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR259`).
- `M0M253` — ME10aa counts reversals without binding them to the original transaction ids; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR259`).
- `M0M254` — ME10aa accepts any two replacement expense amounts; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR259`).
- `M0M255` — ME10aa stops binding the durable reversal marker to the exact original pair; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR259`).
- `M0M259` — production stops passing the user's local day into the planner; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR260`).
- `M0M260` — a future movement date is diagnosed but the planner consumes it anyway; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR260`).
- `M0M261` — the planner prompt loses the authoritative local date even though the validator still has it; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR260`).
- `M0M262` — verified historical amounts are derived but discarded before reply publication; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR260`).
- `M0M263` — requested historical amounts remain in the barrier but no longer reject an incomplete explanation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR260`).
- `M0M264` — the model E2E again requires a second confirmation for an explicit ordinary expense batch; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR260`).
- `M0M265` — a ready unrecorded capital return can again be blocked by optional provenance; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR261`).
- `M0M266` — the capital-return readiness contract again makes the optional person mandatory; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR261`).
- `M0M268` — an actually empty reply is again collapsed into a generic structural failure; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR261`).
- `M0M269` — deterministic non-neutral voice again shares the structural failure label; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR261`).
- `M0M270` — a published style exception loses its typed advisory identity; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR261`).
- `M0M271` — the bounded repair again tells users to copy a rigid confirmation phrase; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR261`).
- `M0M275` — a future person-payment date bypasses the planner calendar boundary; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR262`).
- `M0M276` — planner argument validation is derived but its incompatible payload verdict is ignored; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR262`).
- `M0M281` — a required argument omitted by the planner becomes an unrelated user question instead of an internal repair; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR262`).
- `M0M282` — Spanish token overlap again becomes execution authority over a typed pending; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR316`).
- `M0M283` — record_person_payment may claim a counterparty balance its writer never changes; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR263`).
- `M0M284` — the model E2E again rejects ordinary Spanish containing de una sola operación; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR263`).
- `M0M285` — ME4 stops checking the durable pending clarification after partial writes; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR263`).
- `M0M286` — the planner prompt again invites counterparty balances that no person-payment writer executes; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR263`).
- `M0M287` — ME5 again leaves the status-answer operation awaiting instead of completing it; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR265`).
- `M0M288` — whole-operation undo proposal again depends on the infinitive deshacer; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M289` — an ordinary registered repayment again waits for a redundant confirmation; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M290` — repayment undo proposal again depends on one verb conjugation; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M291` — a pending-tool assertion no longer proves that the proposal wrote nothing; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M292` — a pending-tool assertion no longer proves the durable operation is awaiting input; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M293` — planner-authored pending accepts an action id for the wrong capability; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `IR264`).
- `M0M294` — direct ordinary expenses again pass by absence of a word instead of proved completed state; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR264`).
- `M0M295` — a stale v14 eval runtime can impersonate the operation-inspection harness; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `TG-12`).
- `M0M296` — planner-authored pending is ignored unless it names the capability as its author; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `IR264`).
- `M0M297` — response-scoped missing field again requires an invented financial action; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `IR264`).
- `M0M298` — a stale v17 eval runtime can impersonate the operation-inspection harness; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `TG-12`).
- `M0M299` — a status answer again copies an observed operation's missing field into a new awaiting row; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M300` — an unknown operation id is accepted as read-only observed authority; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M301` — observed pending state is persisted as if it belonged to the status-answer operation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR265`).
- `M0M302` — observed pending state stops constraining the status answer publication; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR265`).
- `M0M303` — planner instructions again tell a status query to copy the old missing field; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M304` — ME5 stops proving that the original operation remains awaiting its real answer; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR265`).
- `M0M305` — live planner samples can omit the operation-inspection field and fall back to legacy ambiguity; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M310` — the publication barrier stops consuming the mutation-claim verdict; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR266`).
- `M0M315` — a success receipt after comma or colon escapes the write barrier; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR266`).
- `M0M320` — deterministic publication failure is sent to the style judge and can be laundered; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6b`).
- `M0M321` — a rejected pending-question repair deletes the original truth-safe question; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6b`).
- `M0M322` — durable operation replay loses the style advisory that explains what was published; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `TG-6b`).
- `M0M323` — chat metadata drops the non-blocking style rejection from review tooling; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `TG-6b`).
- `M0M325` — live planning validates the model choreography without compiling its unambiguous correction wiring; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR267`).
- `M0M326` — the correction compiler accepts two competing whole-operation undos; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR267`).
- `M0M327` — the correction compiler invents a relationship for wholly ungrouped actions; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR267`).
- `M0M328` — a safe AI-authored intake failure is discarded and the user receives an empty transport failure; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR268`).
- `M0M329` — a pre-plan failure invents a user-answerable missing requirement; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR268`).
- `M0M330` — a pre-plan failure can claim a completed write instead of stating that nothing changed; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR268`).
- `M0M331` — a pre-plan fallback can repeat an ungrounded amount or date; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR268`).
- `M0M332` — the intake fallback bypasses the normal deterministic publication boundary; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR268`).
- `M0M334` — planner repair discards the per-attempt contract reasons before the expensive sample can be diagnosed; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `TG-3b`).
- `M0M335` — durable intake stores a reduced error instead of the typed diagnostic returned to QA; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR270`).
- `M0M336` — a successful safe fallback hides its intake failure from the orchestrator metadata; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `IR270`).
- `M0M337` — the model E2E reads intake diagnostics only on HTTP failure and loses successful safe-fallback evidence; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR270`).
- `M0M338` — one failed seed is again reported as seven independent downstream product regressions; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR270`).
- `M0M339` — planner validation bypasses canonical economic protocol labels and repeats the same repair error; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR271`).
- `M0M340` — canonical relabeling is allowed even when the resulting financial shape violates the typed writer; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR271`).
- `M0M342` — canonical card-payment classification is again mapped to transfer; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR271`).
- `M0M346` — a stale server contract certifies the snapshot-read fix that it does not contain; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/m0-eval-contract.ts` (detector histórico `TG-12`).
- `M0M367` — the completeness contract is declared but never consumed at the publication boundary; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M368` — the planner drops response_requirements while persisting the validated plan; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M369` — the orchestrator stops handing the plan contract to the finalizer; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M370` — coverage is declared without the value appearing in the published text; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR279`).
- `M0M371` — a money fact bound to a different entity satisfies the requirement again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR279`).
- `M0M372` — an unprovable requirement is demanded as an affirmative fact; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR279`).
- `M0M373` — the completeness contract stops being minimal and may swallow every assertion; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M374` — casual conversation may again be handed money requirements; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M375` — the canonical fallback is disabled and a repeated omission becomes a lost answer; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M379` — the planner-authored fallback template is dropped before publication; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M376` — the canonical fallback is published without re-running every truth barrier; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M377` — a turn that legitimately asks is again forced to satisfy the answer contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR282`).
- `M0M378` — unsupported qualitative kinds pretend that naming an entity proves its state again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR282`).
- `M0M382` — a factual answer silently opts out with an empty completeness contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M383` — the planner validates the fallback template but drops it from the durable plan; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M384` — the canonical fallback disables the same completeness contract it is meant to satisfy; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M385` — a money requirement with an unknown entity becomes demandable again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR279`).
- `M0M386` — an entity requirement may claim one entity while pointing at another; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR281`).
- `M0M387` — one ungrounded slot again suppresses every grounded fallback fact; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M388` — the planner prompt hides the exact date value wire shape again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M389` — date requirements may use an undocumented value alias again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M390` — planner repair loses the exact rejected date field path; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M391` — bounded planner repair receives a generic error instead of the actionable path; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M392` — an ungrounded fallback slot republishes the planner's unverified number; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR280`).
- `M0M393` — requirement grounding again treats entity and amount coexistence as a binding; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR279`).
- `M0M394` — the prompt stops teaching the exact response-requirement id grammar; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M395` — an invalid requirement id bypasses the documented slot grammar; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M396` — a requirement can omit the verified evidence source; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M397` — a lowercase currency is silently normalized instead of repaired; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M398` — an impossible calendar date enters the durable response contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR280`).
- `M0M399` — a qualitative observed-operation answer is forced back into an impossible canonical contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M400` — the planner is not taught that observed qualitative pending state is an alternative completeness authority; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M401` — any factual answer opts out merely because an inspectable operation exists elsewhere; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M402` — any observed operation waives completeness even when it owns no durable pending question; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M403` — an observed operation launders unrelated financial assertions past completeness; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR265`).
- `M0M404` — the publication result drops the exact bounded money-grounding diagnosis; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR283`).
- `M0M405` — the bounded repair no longer receives the exact rejected monetary figures; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR283`).
- `M0M406` — post-write prose may again cite unrelated amounts from the earlier financial context; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR283`).
- `M0M407` — an expensive model failure again deletes the bounded money-grounding diagnosis before cleanup; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR283`).
- `M0M408` — the planner prompt again hides the exact observed-operation assertion source contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR284`).
- `M0M409` — an invalid observed assertion source again returns only the downstream generic contract error; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR284`).
- `M0M410` — prompt, validator and fixture again disagree about the observed-operation source root; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR284`).
- `M0M411` — a recovered HTTP-200 intake failure again disappears from turnDetail before disposable cleanup; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR285`).
- `M0M413` — a planner may ask again for an argument already present in its validated action; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR287`).
- `M0M414` — a lexical false negative in a pending question degrades to no-action instead of rendering every typed answer shape; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR287`).
- `M0M415` — the live-model gate stops treating empty or failed deliveries as anti-bot violations; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR310`).
- `M0M416` — the planner again validates before adopting an exact stored fixed-expense amount; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR288`).
- `M0M417` — the stored fixed-expense compiler derives currency but drops the monetary value; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR288`).
- `M0M422` — bounded planner repair again treats a rejected action as something that must be kept and mechanically patched; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR290`).
- `M0M424` — an invalid grouped movement is again told only to add an undo instead of preserving independent work; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M425` — an internal payload rejection can again be converted into a new user-facing missing field; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M426` — a response-scoped missing field no longer needs a matching user-evidence ambiguity; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M427` — the planner can again self-declare an ambiguity without explaining the missing real-world fact; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M428` — the planner is again told that an internal validation failure is a datum the user can supply; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M430` — bounded repair computes the transition guard but does not consume it before accepting the next candidate; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR291`).
- `M0M435` — an awaiting-input plan tries to register a ready-only operation manifest; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR297`).
- `M0M436` — post-execution equality no longer requires every authorized action to have one step; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR295`).
- `M0M438` — a paraphrased stalled question can loop forever after the one clarified retry; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR293`).
- `M0M443` — provenance repair again reports one symptom instead of the exact required path set; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR300`).
- `M0M444` — the lifecycle prompt no longer consumes the shared transition wire contract; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR301`).
- `M0M445` — modified work may target an operation other than its declared continuation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR301`).
- `M0M446` — the planner no longer sees the second-delivery policy used by validation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR301`).
- `M0M447` — a sensitive manifest can omit its operation-level authorization prompt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR301`).
- `M0M448` — a read-only observed turn can consume the operation it only meant to inspect; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR301`).
- `M0M449` — the orchestrator persists a second receipt after a writer already settled its own step; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR302`).
- `M0M451` — the model harness queries the legacy per-action challenge through a column that does not exist; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR302`).
- `M0M452` — whole-operation correction stops proving the operation-level manifest before confirmation; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR302`).
- `M0M455` — the planner stops canonicalizing exact server-owned stored facts before validation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR303`).
- `M0M457` — a read/replan pass can again ask the user before consuming its typed read; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR304`).
- `M0M459` — duplicate planner actions collapse back into an undiagnostic generic error; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR304`).
- `M0M460` — the live planner stops consuming the provenance wire generated by runtime ownership; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR305`).
- `M0M461` — the planner advertises a derived provenance rule before any locked verifier exists; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR305`).
- `M0M462` — persisted plans stop carrying the exact server validation receipt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR306`).
- `M0M463` — a mutated persisted plan is accepted under its old validation receipt; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR306`).
- `M0M464` — cash direction again masquerades as creditor/debtor direction; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR307`).
- `M0M466` — a server-owned full-payment amount stops owing provenance when the numeric argument is intentionally omitted; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR309`).
- `M0M467` — provenance validation again sees only monetary arguments and ignores exact server-materialized claims; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-operation-authority.ts` (detector histórico `IR309`).
- `M0M468` — stored-fact compilation again refuses an omitted amount even when the same verifier materializes it; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR309`).
- `M0M469` — the planner stops declaring the semantic quote that binds a user-stated value; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR314`).
- `M0M470` — an intake contract failure is again mislabeled as model-provider downtime; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR315`).
- `M0M471` — the final conversational continuity candidate is never published even after crossing every truth guard; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR310`).
- `M0M472` — an unpublishable agent turn falls back to transport silence again; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `IR310`).
- `M0M473` — the durable operation loses the typed publication recovery diagnosis; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR310`).
- `M0M475` — runtime forgets that an already verified manifest must never execute again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR311`).
- `M0M476` — settlement attempts to verify an immutable recovered manifest a second time; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR311`).
- `M0M479` — a later read pass may replace the semantic objective and prior-work relationship; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR312`).
- `M0M480` — a schema missing field loses its mechanically derived action target; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR313`).
- `M0M481` — a bare number is auto-promoted to user-stated provenance without the model declaring its semantic quote; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR320`).
- `M0M482` — the last read pass may postpone synthesis again; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR315`).
- `M0M483` — the orchestrator forgets the semantic goal between read passes; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR315`).
- `M0M484` — a model-authored pending question is again sent through lexical Spanish interpretation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR316`).
- `M0M485` — durable replay stops parsing the typed recovery cause; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR317`).
- `M0M486` — an outer turn exception is again mislabeled as provider downtime; fijaba una rama envelope-only o su harness en `src/lib/ai/chat-transaction-handler.ts` (detector histórico `IR317`).
- `M0M487` — the semantic root grows another mechanical obligation; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR318`).
- `M0M488` — a semantic step again asks the model for financial effects; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR318`).
- `M0M489` — the server stops compiling expense recognition; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR319`).
- `M0M490` — expected state stops contradicting a reversed cash direction; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR321`).
- `M0M491` — a multi-step semantic promise is split into independent writes; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR322`).
- `M0M492` — the public agent boundary lets an untyped failure escape; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/kipu-agent.ts` (detector histórico `IR323`).
- `M0M493` — cached planner input tokens disappear from telemetry; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR324`).
- `M0M494` — the conversational gate again imports the private planner; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR325`).
- `M0M495` — a mutating semantic unit again compiles without an observable final-state projection; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR326`).
- `M0M496` — equal amounts in separate steps again borrow every quote in the semantic unit; fijaba una rama envelope-only o su harness en `src/lib/ai/agent/agent-planner.ts` (detector histórico `IR327`).
- `M0M380` — a failed delivery loses its typed cause again because the detail prints only the reply; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR278`).
- `M0M381` — one failed delivery again aborts every remaining semantic check; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR278`).
- `M0M366` — the model harness deletes its undo step capture and a red ME9 loses its branch again; fijaba una rama envelope-only o su harness en `scripts/qa/m0-model-conversation-e2e.mjs` (detector histórico `IR278`).
