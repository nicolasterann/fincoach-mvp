# Kipu — AI-Native Architecture (North Star)

This is the target architecture. It supersedes the older "Universal Router +
per-intent handlers" design wherever they conflict. Read after `CLAUDE.md`.

## 0. The one-sentence thesis

**Kipu = a flexible LLM agent that thinks over the user's live structured
financial memory, and executes only through safe, typed, deterministic tools.**

Intelligence is flexible. Money is safe. Reliability is NOT rigidity.

## 1. Why this, and why it beats a Claude/ChatGPT budgeting artifact

A generic ChatGPT/Claude project with a budgeting artifact is **stateless and
inert**: the user must paste their context every time, it cannot remember
across sessions, it cannot act, it cannot reconcile real balances, it cannot
learn the user's patterns, and it cannot proactively reach out. It is a smart
calculator that forgets you.

Kipu wins on four things a chat artifact structurally cannot have:

1. **Live structured financial memory.** Real accounts, cards, debts, income,
   fixed expenses, goals, and balances — always current, never re-pasted. The
   agent opens already knowing you.
2. **Safe action.** It doesn't just advise; it records, undoes, corrects,
   transfers, schedules, reconciles, and updates real state through validated
   tools. "It can actually do things, not just talk."
3. **Learning loop.** Corrections, aliases ("Pichincha = my account"), people
   ("Juan", "mi mamá", "el gym"), and behavioral patterns (overspends on food
   after weekends) are persisted and fed back, so Kipu gets more personal every
   week. An artifact resets to zero each chat.
4. **Continuity & proactivity.** Reconciliation, smart
   reminders, guilt-free recovery, pause/return modes — Kipu accompanies you
   between messages. An artifact only exists while you're typing.

If a feature could be matched by a stateless artifact, it is not where Kipu's
value is. Every architectural decision should deepen memory, safe action,
learning, or continuity.

## 2. How Kipu beats the #1 killer of finance apps: abandonment

Trackers die because logging is a chore, guilt accumulates, and a single gap
makes users feel they "failed" and quit. Kipu's design directly attacks each:

- **Friction → near-zero.** Natural language, any phrasing, any channel
  (Telegram first). No forms, no categories to pick. The agent figures it out
  and asks only when truly necessary.
- **Guilt → clarity.** Tone is zero-judgment by construction (enforced in the
  agent prompt + response rules). Overspending is framed as information Kipu is
  tracking for next time, never a scolding. "Logging must always feel safe."
- **Gaps → recovery, not debt.** Light mode, pause mode, return
  mode, and a soft reset ("retómame sin hacerme sentir mal", "empezar desde
  cero desde hoy") let a 5-day gap heal in one message instead of ending the
  relationship.
- **Every log returns value.** Confirmation + classification + goal impact +
  updated Saldo Kipu (money left for gustos) + personality — never a bare
  "registrado".
- **Proactivity keeps the loop warm.** Weekly reconciliation, smart reminders,
  and check-ins bring the user back before they drift.
- **Memory makes it worth coming back.** Because Kipu remembers and improves,
  the cost of switching to a generic chatbot grows every week.

### New ideas we are adopting (beyond the original MVP) to fight abandonment

- **Confidence-aware honesty.** Kipu tells you how sure it is about a number
  ("tu gasto de comida lo tengo estimado, todavía aprendiéndolo") — trust
  through humility, not false precision.
- **One-tap / one-word reconciliation.** Weekly "¿esto cuadra?" answerable with
  "sí" — reconciliation as a 5-second ritual, not a chore.
- **Behavioral nudges from learned patterns.** "Los findes sueles pasarte en
  comida; ¿te aparto algo en tu Reserva?" — value only a memory-rich system can
  give.
- **Emotional check-ins.** Detect guilt/stress/avoidance and respond as a
  coach, not a ledger. Money is emotional; Kipu treats it that way.
- **Recovery momentum, not streak shame.** Returning after a gap is celebrated
  ("qué bueno que volviste"), and a "return mode" reconstructs without
  itemizing every expense.
- **Split & shared-expense intelligence** ("mitad mío, mitad de Ana") as a
  first-class learned pattern feeding the receivable ledger.
- **Alias & people memory** so "la cena de siempre", "el gym", "mi mamá"
  resolve correctly and improve over time.

## 3. The architecture

```
Channel (Telegram / web / WhatsApp later)
   → normalize message + identify user
   → KIPU AGENT  (LLM, tool-calling loop)
        reads:  live financial context + relevant conversation
                + learned facts/aliases/preferences + open operations
        plans:  semantic goal, selected capabilities/arguments, real
                ambiguities and observable expected state (NO writes)
        preflight: deterministic resolution against current state
        calls:  the minimal safe subset of TOOLS (0..n) ──────────────┐
   ┌──────────────────────────────────────┘
   │  each TOOL = a typed, deterministic capability:
   │    validates against real state → executes OR asks OR refuses
   │    (ledger writes go through the single writer;
   │     domain writes through their store; never raw SQL from the LLM)
   └──→ tool results fed back to the agent
   → deterministic post-write re-read verifies the requested outcome
   → AGENT composes a natural, personalized reply from verified results
   → AGENT may persist learned facts (remember_fact)
   → reply sent on the channel; turn stored in chat_messages
```

### The LLM declares semantics; the server compiles mechanics

The planner is not required to behave like a byte-perfect workflow compiler.
It must declare the economic intent, entities, facts, actions and
postconditions. When a safe execution shape contains purely mechanical wiring
(for example, the shared atomic-group id and direct dependency from each
replacement to an already-declared whole-operation undo), the server may
normalize that wiring **only when the relationship is structurally
unambiguous**. The compiled candidate then passes through the same strict
validator and preflight as every other plan.

This compiler may never invent an action, target, amount, entity, effect or
missing fact. More than one possible undo, a batch replacement, an unrelated
interleaved action or a set of actions with no declared relationship remains
unchanged and is refused. The principle is general: spend model intelligence on
understanding the user; derive deterministic bookkeeping from proved intent;
keep financial authority in validators and typed writers.

If bounded planning still cannot produce a safe candidate, that is not a
user-answerable missing field and is not a valid product answer. The runtime
must preserve the exact typed cause for operators, keep money fail-closed and
recover the plan internally. A continuity message is only a circuit breaker;
its presence makes the release gate red. It may never be counted as successful
intelligence or promise an automatic retry unless a durable scheduler with a
real `next_attempt_at` owns that promise.

M0.11A makes that boundary concrete and measurable. The live planner emits six
semantic root fields. A step has only `capability`, public `arguments` and its
own exact user evidence; an execution unit adds the observable expected state
and natural confirmation when needed. The model
never emits effects, provenance paths, action ids, manifests, hashes, CAS,
dependencies, atomic-group ids, missing-field targets, response templates,
receipts or postconditions. A gate fails if root/unit/step obligations grow
beyond 6/3/3 or an ordinary write exceeds 14 semantic obligations. Evidence
belongs to its semantic step, so equal amounts in different actions cannot
borrow authority from one another.

Runtime derives the complete accounting event and all executor wire from the
typed capability and verifies it against the model's expected observable state.
This keeps an independent check without asking the model to duplicate the
writer's ontology. Steps placed by the model in one execution unit compile to
one all-or-nothing promise; runtime does not guess atomicity from a phrase or a
shared account.

For a user-stated value, the model selects an exact supporting excerpt without
naming any path/source/hash. The server binds it to the current durable delivery
or exactly one delivery of the same operation and constructs provenance. A
number merely present elsewhere is never auto-authorized; the 552,77 class
remains refused. Stored values require no model provenance and are re-derived
under the existing locked verifier. The full capability catalog stays visible
and unfiltered in a static cacheable prefix; cost telemetry records total and
cached input tokens per turn.

The release E2E treats the planner as private: HTTP in, PostgreSQL state and
natural reply out. It never imports the planner or asserts its JSON. This keeps
tests strict about money and lifecycle while allowing the model to reason and
speak freely.

### Tools (the safe capability surface)

Implemented in `src/lib/ai/agent/`. Initial set (grows over time):

- `get_financial_context` — read balances, Saldo Kipu (the same number the
  dashboard shows; `margenWeekly`/`margenDaily` stay engine-internal), debt
  pressure, goal, fixed expenses, upcoming payments, receivables, learned facts.
- `log_movement` — expense / income / debt_payment / goal_contribution, with
  source resolution; card = debt, never available money.
- `transfer_between_accounts` — internal transfer (not spending/income).
- `record_person_payment` — outgoing person transfer (expense/loan) or incoming
  (income/refund/repayment), with receivable side-effects.
- `undo_movement` / `remove_duplicate` / `correct_movement` — append-only,
  idempotent reversal + reverse-and-replace.
- `create_fixed_expense` / `update_fixed_expense` / `schedule_payment` — future
  & recurring commitments.
- `remember_fact` — persist a learned alias / preference / pattern / correction
  to memory.

A coach/advisory reply with no state change needs NO tool: the agent simply
answers. Read-only is the default; a tool call is what makes a turn act.

> **2026-08:** the live surface is **122 typed tools** (incl.
> `plan_reserve_withdrawal`, calendar/ambient resolvers, Saldo Kipu readers).
> The canonical list is the registry in `src/lib/ai/agent/kipu-agent-tools.ts`;
> the set above is the founding core, kept for orientation.

Every tool returns a structured result (`done` / `needs_confirmation` /
`needs_info` / `refused`) so the agent can ask a smart follow-up instead of
guessing. A money-mutating tool **never executes on ambiguity** — it asks.

### Memory & learning model

- **State** lives in the existing tables (accounts, debts, goals, income,
  fixed_expenses, transactions, scheduled_payments, receivables).
- **Learned memory** lives in `user_context_notes` (free-form typed notes:
  alias, preference, pattern, person, correction) + `user_financial_preferences`
  (default source, etc.). The agent loads a compact memory digest each turn and
  writes new facts via `remember_fact`.
- **Self-improvement:** corrections and repeated behaviors become notes; future
  turns read them; interpretations adapt. No model fine-tuning needed — the
  memory IS the personalization.

### Durable operational continuity (Bloque M0)

Recent chat and learned notes are not sufficient for a multi-turn action. A
financial request also needs a durable **operation**: original delivery, typed
plan, evidence, missing fields, dependencies, tool steps, affected ids and
verified result. This is what lets Kipu answer "¿qué falta?", resume after a
topic/channel/process change, and distinguish replay from a new order without
guessing from the last assistant message.

The required lifecycle is:

```text
retrieve → plan (read-only) → deterministic preflight → execute safe atomic
groups → re-read/postcondition check → reconcile fact/calendar/memory → reply
```

The LLM owns interpretation and natural language; it does not own identity,
money math, database writes or the assertion that a write landed. A phrase
regex may be an adversarial last net, never the primary router or the semantic
definition of a financial event. The full implementation and closure contract
is the active **Bloque M0** in `docs/ROADMAP.md`; the visual Bloque M is blocked
until that contract passes against the real model and PostgreSQL.

M0.11A makes that boundary executable. The planner declares the semantic kind
and prior-work target (`resolved`, `modified`, `confirmed`, `observed`, etc.);
the server derives the lifecycle arrays and verifies the before/after structure.
It never reinterprets confirmation or correction from a phrase list. Monetary
origin is verified as `user_stated` or `stored_fact`; `derived` remains disabled
until M0.11B supplies locked derivation rules and drift policies. Mechanical
code verifies one exact durable delivery or one locked stored row without
deciding what the user meant.

Any protocol the planner must emit is a public model interface, never hidden
validator trivia. Monetary provenance paths are generated per capability from
the same money ontology that inspects runtime arguments; lifecycle targeting
and second-delivery policy are likewise rendered from their validating source.
Stored facts follow the same rule: the model may select any supported action,
but the capability catalog tells it which exact persisted fact can authorize
each monetary path. Runtime then re-derives that fact for the chosen entity; a
model-authored `stored_fact` label is never authority by itself. Read/replan is
also an internal protocol, not a conversational behavior: the model chooses the
typed read, while a shared wire compiler defers questions and final-response
duties until the read evidence has been consumed.
Repairs receive exact rejected paths and sets. This keeps intelligence focused
on intent while mechanical JSON wiring remains learnable, deterministic and
cheap; a schema mismatch must never be misreported as user ambiguity.

A server-materialized monetary path does not need to be present in the model's
arguments to exist economically. The canonical example is a full card payment:
`paidInFull=true` intentionally omits `amount`, while PostgreSQL derives the
live statement remainder under lock. One shared calculator therefore defines
required provenance as (a) monetary values present in arguments plus (b) paths
materialized by a registered verifier whose structural precondition holds.
Prompt, planner compiler and validator consume that same result. This is a
schema/domain contract, never a phrase rule: it cannot add an action, choose an
entity or infer intent. Without the exact server-owned authority it adds
nothing and execution remains fail-closed.

Authorization belongs to one durable operation manifest, not to individual
tools. The manifest contains the exact actions, entities, arguments, effects,
dependencies, witnesses and projected final state. A sensitive operation may
require a second delivery, but any natural confirmation the planner understands
authorizes the exact previously shown manifest under CAS; it cannot resample N
payloads. Execution is accepted only when the persisted prepared and observed
step sets are exactly equal to that manifest. Partial or changed execution is a
durable integrity failure. The old per-tool challenge remains only as a safe
rollback path while M0.11A is audited; it is not used by a manifest-authorized
operation.

Receipt ownership is singular too. A multi-step atomic group delegates domain
writes and operation-step receipts to the generic PostgreSQL coordinator. A
single domain writer may instead settle its own step in the same transaction as
its write; its typed result declares that ownership and the orchestrator must
not append a second receipt. This is execution metadata, never a user phrase or
model interpretation. A duplicated receipt after money moved is an integrity
failure, not a retryable conversational question.

Persisted plan recovery has the same single-authority rule. The planner
envelope that crossed validation is immutable, while executor/preflight pending
state may evolve after an attempted write. Persistence therefore attaches a
server-owned digest of the exact validated root envelope. A worker retry
verifies and resumes that envelope; it never reinterprets a later executor
clarification as fresh planner output. A missing receipt is accepted only for
operations created before this protocol, while a present but invalid receipt
fails closed. This is structural continuity, not a second semantic judge.

Cash direction and credit relationship direction are independent facts. Money
arriving proves `cash/increase`; it does not prove whether the user borrowed
principal or recovered money previously lent. The planner applies a semantic
counterfactual: if the same statement is true in both worlds, it asks who owed
whom. Mechanical code verifies the eventual chosen writer and effects, but
never infers creditor/debtor role from a verb, transfer direction or phrase
list.

The anti-loop rule is structural. One insufficient answer may produce one more
concrete clarification. A second delivery that leaves the same pending set
unchanged cannot merely paraphrase the question: the model must resolve,
modify, abandon or leave that operation. This preserves intelligent questions
for genuine ambiguity without allowing a mechanical loop.

Conversation availability is a separate invariant from write authorization.
The model owns every normal question, explanation and receipt. Deterministic
boundaries may refuse an unsafe claim or write, but they cannot veto the speech
act merely because its wording does not overlap an internal executor summary.
A pure no-write `needs_info` turn is therefore verified as a question/request,
not by shared tokens; a partial success remains stricter and must name every
durable pending item so it cannot hide unfinished work.

If the initial model answer and its one directed repair both fail publication,
the circuit breaker may repeat an exact verified pending question or state only
what durable receipts prove. That text re-enters every truth, money, calendar
and mutation guard and grants no execution authority. It is persisted as
`publicationRecovery`, and **any occurrence fails the release gate**: it is not
the desired conversation and must be diagnosed at its actual source. Intake,
publication, response-model availability and outer transport exceptions have
different typed diagnoses on the live path and on replay; `model_unavailable`
is never a bucket for planner errors. A recovered delivery whose complete
manifest was already verified resumes only publication and cannot execute money
a second time.

The reply has its own typed contract. The planner — not a lexical router —
declares the minimum canonical facts needed to answer the actual request. The
server can enforce only facts it can truly verify in free text: an amount, a
date or the name of an evidence-backed entity. Qualitative explanations remain
model intelligence; naming an entity never pretends to prove an arbitrary
state. For a non-empty contract the planner also authors a natural fallback
template with typed slots. If the normal response and one bounded repair both
omit a grounded fact, the server fills those slots only from verified evidence
and re-runs every truth barrier with the original contract. It never solves an
omission by deleting the requirement or by switching to canned product copy.
The wire shape is explicit and discriminated (`money={amount,currency}`,
`date={date}`, `entity={name}`), and deterministic repair names the exact
rejected field path. This is a model-facing protocol, not hidden schema trivia:
the model should spend inference on the user's meaning, not guess JSON keys.
Before a slot is renderable, value and entity must coexist in the same trusted
evidence window. An over-declared, unproved slot becomes typed uncertainty in
the planner-authored sentence; it cannot suppress other proved facts and can
never reuse the planner's unverified value.

Verified writes also bound what the final prose may quote. The model can explain
provenance and context naturally, but monetary figures after a write must be
bound by that turn's executed-plan receipts or a verified pending fact; broad
financial context is not silently promoted into action evidence. If grounding
rejects a figure, the durable diagnostic carries only its value, reason and
semantic roles, and one bounded model repair removes that figure while keeping
the meaning. This is a truth boundary, not a phrase router or canned response.

An observed open operation is a separate qualitative completeness authority
only when it actually owns a durable pending question and the answer's factual
assertions come from that observed operation state. Merely naming an unrelated
visible operation never waives the normal money/date/entity contract.
That provenance is itself a public planner wire contract: the prompt, validator
and fixtures share the exact `openOperations[<observed-id>].<field>` formatter,
and a rejected assertion returns its indexed field path to bounded repair. The
model is never required to infer a private token from server implementation.

Observability is part of the safety contract, including recovered failures. A
bounded planner/intake failure may truthfully return HTTP 200 with a no-write
explanation; that does not make its cause disposable. The evaluation path must
report the same whitelisted stage/code/attempts/validation failures it already
captured before deleting a disposable persona. Capturing a diagnosis that no
failure detail consumes is equivalent to losing it and must be mutation-tested.

User authority and server-owned authority are distinct. A continuation need not
make the user repeat an amount that a typed executor can re-derive exactly from
current structured state, but a planner label such as `stored_fact` is never
proof by itself. Derived monetary authority is an explicit path-level registry:
each allowed argument has a domain verifier for entity, current amount and
native currency, and any missing catalog, variable value, mismatch or
user-stated contradiction falls back to the ordinary confirmation barrier.
This keeps conversation fluid without turning context prose into write
authority or adding phrase-specific routes.

## 4. What's wrong with the pre-reset architecture (being replaced)

- **Route-native, not AI-native.** A prefilter + Universal Router + a stack of
  per-intent gates (recovery gate, transfer gate, commitment gate, coach-followup
  gate, fixed-expense matcher…). Each new behavior needed a new gate. Anything
  outside a pre-coded shape collapsed to a fallback. That is the chatbot feel
  the reset rejects.
- **AI as cosmetic.** The LLM mostly rewrote final strings; interpretation was
  regex/classifier-driven. The intelligence wasn't operational.
- **Brittle.** Phrase-shaped detectors (`looksLikeTransferish`,
  `looksLikeCommitmentish`, affirmation regexes) break on unanticipated
  phrasing and fight each other for the same message.
- **Stateless-ish.** Memory was recent-chat + a few notes, not a first-class
  learning loop. No alias/people/pattern learning.
- **No real agency.** Capabilities existed but were reachable only through the
  exact route that triggered them.

The capabilities themselves (the writers, reversal engine, transfer/commitment
logic, financial context builder) are GOOD — they become the **tools**. We are
replacing the **front door** (rigid routing) with an **agent**, not throwing
away safe execution.

## 5. Staged migration — COMPLETED

**Status: COMPLETED on 2026-08-24.** The staged front-door migration ended in
the native tool-calling loop. Production uses `KIPU_AGENT_MODE=loop`; the only
other mode is `off`, which runs the frozen deterministic legacy pipeline as
an explicit emergency rollback. Historical `on` and `shadow` values map to
`loop` with a one-time warning; they are no longer `AgentMode` states.

Final request path:

```
channel delivery
  → runKipuAgentLoop
  → live financial context + memory + calendar + conversation archive
  → native model tool calls
  → typed tool validation and durable operation manifest
  → PostgreSQL writer / CAS / verification / replay
  → natural reply with post-write receipt continuity
```

The envelope planner and its parallel validation, bounded-repair, canonical
publication and intake-recovery stack were removed after reachability proved
that neither live mode could call them. The ~124 tool bodies, financial engine,
MoneyRead doctrine, builders, manifest authority (112–115), PostgreSQL and the
legacy `off` pipeline remain intact.

M0 closed with the real 35-lane model sample at 35/35 and the permanent capture,
mutation, PostgreSQL, DRY, OLA0, CAL, typecheck, lint and build gates. The full
staged history is preserved in `docs/BUILD_PROGRESS.md` and the historical
`docs/M0_*` dossier. Migrations 001–124 are applied; 125 is next. The only
active roadmap block is Bloque M, the complete front.

## 6. Non-negotiables (carry over)

- Financial engine is the source of truth for numbers. The LLM never
  hallucinates a balance and never writes the DB directly.
- Cards are debt. Reversals are append-only. Ambiguous money moves → ask.
- RLS enabled; service-role only server-side; secrets never in the browser.
- Tone: zero judgment; logging always feels safe; responses generated from
  facts + memory, not templates.
