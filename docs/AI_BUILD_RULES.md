# AI Build Rules — Kipu

These rules govern any AI-assisted development on Kipu (Claude Code,
Cursor, or any other coding agent). They are stricter than general
"good agent" practice because Kipu touches money, debt, and habits —
mistakes here erode user trust quickly.

If a rule conflicts with general agent training, this document wins.

## 1. Allowed autonomy levels

We operate at three levels. Pick the lowest level that fits the task.

- **L1 — Read only.** Inspect, summarize, propose a plan. No file
  writes. Used for "what is the current state?" and architectural
  questions.
- **L2 — Bounded edit.** Modify a small, named scope (≤3 files OR ≤
  ~150 changed lines OR a single function family). Must run lint and
  build. Must report files changed and intentional non-changes. No
  commit.
- **L3 — Module.** Larger bounded work (a new component, a new
  router, a new server action set). Must be preceded by a plan in
  a dedicated file or chat. Must keep all safety boundaries intact.
  Must run lint + build + relevant manual QA. No commit unless the
  user explicitly says "commit".

Default level: **L2**. Escalate explicitly when needed.

## 2. Model choice

- **Opus (latest)** — default for any L3 module, any task touching the
  AI prompts/engines, any architectural reasoning across files,
  anything financial-engine-adjacent.
- **Sonnet (latest) / Composer (latest)** — focused L2 edits, refactors
  with a clear plan handed off from Opus, single-file changes with
  bounded scope.
- **Haiku (latest)** — quick one-shot read-only summaries, glue scripts.
  Avoid for code that touches money math or AI prompts.

Model selection is set at session start; do not switch mid-task. If a
session was started on the wrong model for the work, ask the user to
open a new session before continuing.

## 3. Module size rules

- Hard cap per L2 task: 3 files, ~150 changed lines. If a task
  exceeds, stop and propose to split.
- Hard cap per L3 task: ~6 files OR a single isolated module. If a
  task exceeds, stop and propose a phased plan.
- Never combine an L3 module with parallel unrelated cleanup. Land
  the module clean, then propose cleanup as a separate task.

## 4. No commits by default

- The default action after lint + build success is **report**, not
  `git commit`. Do not commit unless the user explicitly says so.
- If asked to commit, run `git status` and `git diff --stat` first,
  confirm with the user, then commit using a conventional message
  body ending with the `Co-Authored-By` trailer for the active
  model.
- Never push without explicit instruction.

## 5. No SQL without permission

- No new files in `supabase/`. No edits to applied migrations. No
  ad-hoc SQL run through any client.
- No schema-shape assumptions in `lib/financial/onboarding-context-
  mappers.ts` or `supabase-mappers.ts` that diverge from the
  current DB. If the type model needs to evolve, propose a migration
  and wait for approval.
- RLS policies and grants must remain enabled and unchanged.

## 6. No production webhook changes without permission

- Do not edit `src/app/api/telegram/webhook/route.ts` behavior in a
  way that changes dedupe, secret validation, or downstream call
  shape without approval.
- Do not change `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, or
  webhook registration.
- Local QA via curl or a tunneling tool is fine; production cutover
  is a human decision.

## 7. No frontend API calls to OpenAI/Anthropic

- The OpenAI key (and any other provider key) must never reach the
  browser. All model calls go through a server action or route
  handler.
- Never import `openai` or `@anthropic-ai/sdk` from a `"use client"`
  module.
- Never wire a public env var to a provider client.

## 8. Always preserve fallbacks

- Every AI feature ships with a deterministic non-AI fallback:
  - parser: `parseTransactionWithBasicAdapter`
  - coach: `buildFallbackCoachResponse`
  - onboarding: `resolveLocalMockTurn` and the mock interpreter
- A change is not done if the fallback path is broken.
- Mode env vars (`TRANSACTION_PARSER_MODE`, `COACH_RESPONSE_MODE`,
  `ONBOARDING_ENGINE_MODE`) must keep their existing values.

## 9. Always keep feature flags for AI behavior

- New AI capabilities ship behind a mode flag from day one.
- Default the flag to the safe value (fallback / mock) in
  `.env.example` and production. Flipping to AI is a human decision.

## 10. Always run lint and build

- `npm run lint` must be clean. If it warns on existing code that
  was not touched, leave it (it's not your scope).
- `npm run build` must succeed end-to-end (TypeScript + static page
  generation). A `compile failed` or `type error` blocks the task.
- For UI changes, also run `npm run dev` and walk the change in a
  browser before reporting success.

## 11. Always summarize risks

- Final summary must include:
  1. Files changed (with one-line "what changed").
  2. Files intentionally NOT changed in scope.
  3. Risks introduced or identified (security, data, UX, cost).
  4. Manual QA scripts you ran and which scripts you skipped.
  5. Whether lint and build passed.
- Do not bury risks in a long paragraph. List them.

## 12. Always list intentional non-changes

- If a related issue was visible but out of scope, name it: "I saw X
  in file Y but did not change it because the task said Z. Suggest a
  follow-up task."
- This protects the user from assuming you covered something you
  didn't.

## 13. Dirty working tree handling

- If you find files modified at session start that you didn't touch,
  do not revert them. Mention them in the final summary so the user
  knows they were pre-existing.
- If your task implies committing, run `git diff --stat` and list
  the diffs. Do not stage or amend other people's changes.
- Never run `git reset --hard`, `git restore .`, or `git clean -f`
  without explicit instruction.

## 14. Lint or build failure handling

- If lint fails on files in your scope: fix it. If lint fails on
  pre-existing code outside your scope: report and leave it.
- If build fails because of a type error in your change: fix it.
- If build fails because of an env-var issue (e.g. `OPENAI_API_KEY`
  required during static generation): stop and ask. Do not stub or
  inline a fake key.
- If build hangs or runs >5 minutes: stop, report timing, and ask.
  Production build should complete in well under that.

## 15. Uncertainty handling

- Cost of a wrong guess > cost of a clarifying question. When the
  spec or code is ambiguous, ask before acting.
- Do not invent acceptance criteria. If the task didn't say "advance
  to coach_preferences on phrase X", do not silently add it.
- If you cannot finish safely, stop with a clear report of what's
  done, what's blocked, and what decision is needed.

## 16. Production safety

- Never set `TRANSACTION_PARSER_MODE=ai` or `COACH_RESPONSE_MODE=ai`
  in production without explicit approval and a rollback plan.
- Never change `OPENAI_*_MODEL` defaults without approval.
- Never bypass the dedupe table in the Telegram webhook.
- Never log or print secrets (Supabase service role key, OpenAI key,
  Telegram bot token, webhook secret).
- Never log PII (full name, exact balances tied to a userId) outside
  the user's own session.

## 17. Cost awareness

- AI calls cost money. Prefer:
  - Cheaper models (`-mini`) where quality allows.
  - Trimmed contexts (do not stuff entire history into a prompt).
  - Cached prompts where the surrounding harness supports it.
- For any new AI feature, document the per-turn token estimate and
  the worst-case per-user monthly cost.

## 18. Data integrity

- All user-owned tables must include `user_id` and be scoped via
  RLS or the admin client.
- Money math operates on base amounts. Display layer may format
  cents; storage never rounds.
- Never write 0 as a "we don't know" sentinel. Use null / omit the
  key.
- Never duplicate a draft item — always reuse `draftId` when
  updating.

## 19. Channel separation

- The financial engine, the parser, and the coach are
  channel-agnostic. Channel-specific code (Telegram webhook, web
  chat action, future WhatsApp adapter) must not leak into them.
- A new channel adapter must use the existing
  `chat-transaction-handler` entry point.

## 20. Documentation hygiene

- Update `docs/BUILD_PROGRESS.md` after a meaningful change is
  validated end-to-end.
- Update `docs/ROADMAP_MVP.md` if a phase's definition of done
  shifts.
- Add new manual scripts to `docs/TEST_SCRIPTS.md` for any new
  flow the user is expected to exercise.
- Do not create one-off `*.md` notes for every task. Keep
  documentation consolidated.

## Quick reference — pre-flight checklist

Before you write code:
- [ ] I read the relevant files and their immediate callers.
- [ ] My task fits within L1/L2/L3 scope.
- [ ] I'm not touching anything on the safety-boundary list without
      explicit approval.
- [ ] I know which fallback path I must keep working.

Before you report done:
- [ ] `npm run lint` is clean.
- [ ] `npm run build` succeeded.
- [ ] I ran the manual QA scripts that apply.
- [ ] I listed files changed, intentional non-changes, and risks.
- [ ] I did NOT commit unless instructed.
