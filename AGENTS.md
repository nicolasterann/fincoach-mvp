<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Kipu Agent Instructions (AI-native)

## Product context

This project is **Kipu**: an AI-native personal financial coach for LatAm
users. "FinCoach" was an old internal name; user-facing is always **Kipu**.
**Kipu X** is business/legal/investor only.

Kipu should feel like a personal ChatGPT that already knows the user's whole
financial life and can act on it safely — it remembers, measures, learns,
acts, corrects, plans, and adapts on live structured financial state. It is
**not** an expense tracker, **not** a dashboard-first app, **not** a generic
GPT wrapper, and **not** a rigid route-based chatbot.

No bank connections — manual capture is by design. No monetization yet.

Current roadmap: **`docs/ROADMAP.md` is the live roadmap and the only source of
work order.** Read it there — don't re-derive it from any other doc. Principle:
back-end and features to 100% first, the ENTIRE front last as its own stage.
Bloque J is CLOSED (2026-07-28, final commit `54311f6`): the agent was audited
against the real beta chat and then first-principles across delivery identity,
authority, replay/no-op, grounded money/entity evidence, fallbacks, post-write
freshness, runtime tool contracts, complete reads and every write boundary.
J's migration chain 066–095 is applied and its final disposable probe is
61/61. Bloque K is CLOSED (2026-07-29; production serves `a7f99bb`, which contains the
functional commit `36ed895`; migrations 093–095, real
E2E 79/79 with exit 0): variable fixed expenses separate declared PLAN, per-cycle
OBSERVATION and prudent ESTIMATION. Of **Bloque L** (shared/refunds, LOW priority, 0 rows in production) only the
cheap refund fail-safe was built — `record_person_payment` now inherits its
original purchase's registration instead of defaulting to `other`; the rest of L
stays unbuilt by decision. **Pre-M backend closure is CLOSED and deployed**
(2026-07-31, commit `2f41a00`; migrations 096–099 APPLIED): atomic Mis Datos
writers, durable catch-up/month-close
cursors, current-FX freshness + daily refresh, and real H.44/H.46 executor
coverage. Its first external audit caught and locally fixed two pre-apply
lock-outs: web ledger actions now authenticate with the session but execute the
SECURITY INVOKER ledger through service_role, and account close/reopen v3
handles a tightly bounded base-only FX rounding residue with a durable reversible
snapshot. Three external audit rounds followed, each finding a real defect the gates were
green over: the guard would have locked out the SECURITY INVOKER ledger itself
(the web forms call it under the user session); the native-residue sweep was
bounded by a COUNT of native units (`abs(native) <= 1000`) instead of by value,
so it erased 1000 ARS, 5 EUR and 500 USD while writing a fabricated rate of 1
into its own audit marker (099 makes it `|native × current rate| < 0.005` and
refuses without a rate); and both real callers derived that rate from
`convert(1, …).baseAmount`, which rounds to cents — so ARS→USD read as "no rate"
and the fix is the shared pure helper `rateToBase`. Pre-M gates: mutations
28/28, DB E2E 40/40, capture 701/701.
**Bloque M0** = general operational intelligence of the agent is the
CURRENT/ACTIVE stage. A post-Pre-M review of the founder's real chat proved that
green financial gates still allowed bot-like failures: a known Diners statement
was asked again, a multi-action turn fell into a vague "missing data" loop, and
"a loan they paid me back" could be confused with money the user borrowed.
M0 replaces case patches with a durable operation lifecycle: relevant-context
retrieval → typed no-write plan → deterministic preflight → safe atomic groups →
post-write verification → natural reply. `docs/ROADMAP.md` carries the full
contract and closure battery. **The redesign is now implemented locally:**
migrations 100–107 are APPLIED (2026-08-02/03; 101 fixes the dead
`jsonb_object_length` claim and 102 restores the exact predecessor fact).
PostgreSQL had passed 62/62 twice on that schema: 103 makes the legacy fact amount
cast safe by CASE, and 104 preserves plus enforces the exact pending question
for a partially executable READY plan. A clean matching-runtime run first
exposed double-serialized money evidence and then missing structured card-cycle
facts. The verified read now unwraps only exact official context, carries the
native statement amount plus due/cutoff facts, and binds calendar roles from
typed keys; entity swaps, injected keys, two-digit date truncation and ISO-tail
reinterpretation are all refused by named tests. The later 59/62 PostgreSQL
regression was app↔DB clock skew: operation rows use DB timestamps but readers
bounded them with `new Date()`. Migration **105 is APPLIED** and provides a
service-role-only PostgreSQL snapshot clock; PostgreSQL returned 62/62 twice
with a forced 24-hour negative process skew. User-owned notes/memory are masked from lexical
grounding; open-calendar authority now travels as typed per-occurrence facts,
not a prose blob. The first multivuelta model pass then exposed test/contract
faults plus one real evidence gap: destructive and multi-money actions require
a second delivery confirmation; optional schema metadata is not missing data;
and verified writes of a still-open operation must authorize a truthful audit
reply. The remaining economic cluster now has a local repair: registered
receivable repayments and their undo obey the server-owned second-delivery
confirmation, capital_return_unrecorded has three mandatory algebraic legs,
whole-operation correction is forced into undo + individual replacements, and
model-authored publication gets three bounded attempts under the same guards.
The first 21/22 run then exposed an app↔SQL ontology mismatch: the planner's
canonical `account:<uuid>` reference was compared only with a bare UUID during
atomic preflight, so ME10aa never reached the writer. Migration **106 is
APPLIED** and admits bare or correctly typed refs while rejecting the wrong
resource kind; the PostgreSQL correction fixture now uses the real typed form.
The next real-model pass exposed the mirror app-side boundary: grouped
`paidInFull=true` was rejected by a generic `args.amount` guard before the card
branch could derive 50.60 from its stored statement. The amount guard now lives
only in the user-stated person-payment branch and the E2E omits `amount` exactly
like the model. The first real PostgreSQL pass then found the corresponding
database P1: omitting that untrusted amount also disabled migration 100's amount
comparison, so a forged resolved payload was accepted. Migration **107 is
APPLIED**: its private locked predicate derives a full payment from
the live card statement, uses the persisted amount only for a partial payment,
and binds `expected_due` plus `paid_in_card_currency` to the same live fact and
ledger leg. All four TypeScript card routes use the same native expectation.
PostgreSQL is **64/64 twice**. The first v10 model run executed ME10aa correctly
(atomic undo + two replacements, completed operation and clean reply), but its
harness queried the nonexistent `transactions.reversed_by_transaction_id` and
reported 21/22. That assertion now uses real append-only reversal rows,
`related_transaction_id`, exact marker identities, local deltas and exact
replacement amounts. The next independent run (19/22) found three app-side
contract gaps now repaired without another model sample: an ordinary batch with
explicit amount↔description associations was challenged merely for containing
two amounts; "hoy" was planned without the authoritative user-local day; and an
audit answer could replace exact verified amounts with "el monto que dijiste".
The direct-expense path now proves associations clause-by-clause, proves nested
account/card/goal selections, validates actual-movement dates against
`CURRENT_LOCAL_DATE`, and requires every requested receipt amount in the final
reply. ME10a writes immediately and the E2E saves one model turn. The v12
follow-up closes the two defects from the independent 16/22 run: a fully
specified `capital_return_unrecorded` can no longer invent a blocking
counterparty-name question, and publication distinguishes empty/structure/
deterministic voice/semantic voice instead of collapsing them. Server-owned
confirmation remains mandatory but is requested naturally, never as a rigid
phrase the user must copy. The v13 repair then closes the executor contract
exposed behind that planner fix: `record_person_payment` publishes and consumes
one `occurredAtISO` field in both individual and atomic paths, planner validation
repairs invented properties/types/enums before saving the operation, and runtime
never presents an internal payload defect as user-answerable missing data.
The v14 repair separates the three findings from the following independent
model run. The ordinary phrase `de una sola operación` is no longer mistaken
for the regional interjection `de una`; ME4 now checks the durable pending
clarification instead of a hand-written transcript regex; and publication
refuses a partial-success reply unless it names every verified pending item.
`record_person_payment` also rejects invented `owner="counterparty"` financial
legs because its writer changes only the user's cash/debt/receivable surfaces;
the counterparty remains identity and context. The v15 harness closure removes
the last transcript-conjugation assertions: ME5, ME9, ME10b and ME10c now prove
the server-owned challenge by durable pending scope, `wrote=false` and
`awaiting_input`; ordinary ME10a proves `wrote=true`, `completed` and zero
pending rows. The v16 audit fixes the author/target distinction exposed by ME5:
planner missing-fields are authored by `agent_plan`, but target a capability by
`appliesToActionIds → durable plan action`. Executor challenges may still name
the capability directly. The v17 audit closed the response-scope ontology:
when ambiguity intentionally prevents creating any financial action, the
planner's `missing_field` targets the first-class `"$response"` scope. ME5 now
proved that exact scope rather than requiring an invented action. The first v17
model run then exposed real lifecycle fragmentation: a status question created
a second empty `awaiting_input` operation while citing the pending fact owned by
the original. v18 adds typed `plan.observed_operation_ids`: status/audit turns
create their own completed read-only operation, retain the original operation
unchanged, and use its pending fact only to constrain truthful publication —
never as missing state owned by the new delivery. Capability challenges still
prove their exact action/tool target. The first external v18 model pass proved
that lifecycle (ME5 passed) and exposed the next production defect: a bare
participle such as `registrado` was treated as Kipu claiming a current write,
so a normal proposal referring to "the loan you already have registered" ended
in `mutation_claim_not_proved` and HTTP 500. v19 classifies grammatical action
claims instead of the word: active/perfect/impersonal/resultative/standalone
receipts remain fail-closed, while possessive or past-state descriptions do not
claim a write. The external v19 pass then exposed two more class boundaries.
Publication now recognizes success receipts after comma/colon and treats
`está registrado` as historical only when the same clause names an entity from
verified structured evidence; a generic event-state still needs a write
receipt. Migration **108 is APPLIED (2026-08-08)**: operation undo derives
money writes from the persisted financial algebra in `step.effects`, rather
than demanding a ledger transaction from memory/configuration writes. Economic
writes remain fail-closed and the rejection now identifies the exact missing
steps internally. Its PostgreSQL fixture adds a verified receipt-less memory
write beside two ledger writes and requires undo to reverse exactly the money;
the inverse fixture requires a receipt-less economic write to remain unsafe.
The DB battery is **65/65** on the applied schema. The v21 publication boundary
then removes the stochastic style judge's veto over a deterministically safe
interactive reply: truth/grounding/receipts remain blocking, semantic style may
request one rewrite, and a still-safe candidate is published with a durable
advisory instead of returning HTTP 500 after money moved. Mutation receipts are
classified by grammatical state plus verified entity evidence, not an expanding
list of discourse prefixes. The independent v21 run then reached 21/22 because
the planner declared the correct whole-operation undo plus two replacements but
failed three times to copy the exact atomic-group/dependency choreography. v22
keeps the validator strict and compiles that mechanical wiring only when one
undo, its contiguous individual replacements and their existing relationship
are unambiguous; it never invents an action, target, amount or economic effect.
Ambiguous shapes remain unchanged and fail closed. If bounded planning still
fails, the primary model authors a short no-write explanation that crosses the
normal deterministic boundary; it cannot invent a missing datum, ask a fake
question, repeat an ungrounded figure or claim a write. The mutation runner now
refuses to start from a red capture baseline, so an inherited failure cannot
masquerade as a killed mutant. v23 makes bounded planner failure observable
before disposable cleanup: assistant metadata and `agent_intake_failures` carry
only bounded stage/code/validator reasons, never raw candidate JSON, prompts or messages, and
dependent checks report BLOCKED instead of masquerading as independent defects.
The focused ME1–ME3 reproduction exposed a contract contradiction: the card
payment tool called the event TRANSFER while the safe algebra requires payment.
The tool contract is aligned and a capability+mode compiler may relabel only an
already complete economic shape; it cannot add/remove effects or change owner,
entity, direction, amount source, arguments or grouping. Unsafe shapes remain
unchanged and fail strict validation. The focused real-model run passed 3/3; capture was **750/750** and M0
mutations **342/342** under handshake `intake-diagnostics-v23`. The 2026-08-09
frozen audit ran that battery green plus one 22/22 sample, and the Codex
re-audit escalated a P2 the verdict had underclassified: the open-operation
read assembled parents, steps and deliveries from three independent paginated
readers — children paged by OFFSET with no snapshot bound, and the parent
keyset paged on mutable `updated_at`, so a concurrent delivery could tear the
result while `complete` stayed true. Migration **109 (APPLIED 2026-08-09)**
moves the whole read into ONE single-snapshot RPC
(`kipu_read_open_agent_operations`: parents + steps + deliveries + counted
CAP+1 + statement clock in one SQL statement) with a fail-closed caller (shape
and membership refusals); the completed archive proved sound (terminal status
+ `completed_at <= asOf` freeze the set) and only gained id-dedupe against the
one possible tear. Migration **110 (APPLIED 2026-08-09)** makes the v23
documentation claim true: `agent_intake_failures` keeps fingerprint and
identity, never the raw message. The v24 sample (tree `cef2cae8…`) then hit
**20/22** and isolated ONE new root defect: the batch wrote perfectly but its
receipt carried no per-row amounts or entities, so every truthful reply was a
mutation claim without a backing receipt — deterministic `money_not_grounded`
across 6 candidates, HTTP 500 with the money already written, and the
whole-operation correction cascading fail-closed because undo demands a
`completed` target. Same boundary-parity class as Bloque K's five defects:
the individual writer does declare `Expense 10 recorded from Produbanco`. v25
restores parity (per-row `built.summary` in the batch receipt plus typed
`data.movements` in proven batch order), IR274 proves both directions in pure
code, M0M352/353 bite, and the handshake became `batch-receipt-v25`. The v25
sample (tree `9e1acc66…`) then hit **20/22** with ME10a/ME10aa now GREEN (the
parity fix certified by the real model) and isolated the next class in ME9: a
semantic query with zero matches (`completedAgentOperationMatchesQuery`
requires EVERY word) was presented as "No hay operaciones completadas en este
historial", and the planner turned that unmatched paraphrase into a false
nonexistence claim that blocked the undo — a FILTER miss is not absence. v26
closes it at the evidence layer (M0.3, no phrase routing): the tool declares
`queryMatched:false` with a summary that distinguishes filter from absence and
DEGRADES to the unfiltered recent completed operations (`recentUnfiltered`), so
one read shows the real work; absolute absence is only assertable with no
filter and a complete scan. IR275 pins the branch, M111.1 proves it at runtime
against PostgreSQL, M0M354–356 bite; handshake `search-miss-v26`. The v26
sample passed **22/22** with ME9/ME10a/ME10aa green, but the second Codex
re-audit found TWO source P2s a 22/22 cannot cancel: (a) the completed archive
still paged by offset across statements — under MVCC an operation committing
between pages lands in the already-read region and is MISSED with
archiveComplete=true (the "append-only can only duplicate" claim was wrong);
(b) `queryMatched:false` asserted an unproved negation over a capped scan.
Migration **111 (APPLIED 2026-08-09)** brings the archive to the 109 contract
(candidate scan in ONE statement with counted CAP+1 at 120 over the filtered
set; ops+steps bundle in one statement with terminal identity verified against
phase 1; the Unicode matcher stays in TypeScript as the single truth) and the
verdict becomes TERNARY (false requires a complete scan; capped-no-observed ⇒
null). M111.2 proves presence under concurrent completions, M111.3/M111.4
prove the capped ternary including a real match beyond the window; IR276/IR277
and M0M357–363 pin them; handshake `archive-snapshot-v27`. The v27 sample hit
**20/22** on ME9: the agent proposed and confirmed the correct undo (target
found through the new archive, four rows enumerated, durable server-owned
challenge) and the executor refused with a KIPU_* branch the wrapper collapsed
to one word — unobservable after cleanup. v28 is an OBSERVABILITY pass (the
v23 doctrine, zero writers touched): the wrapper keeps the bounded KIPU_*
message as `detail`, the executor persists `undoRefusal/undoDetail/
targetOperationId` into the durable receipt, and the ME9 harness captures the
correction and target steps before cleanup. IR278 + M0M364–366; handshake
`undo-observability-v28`. Frozen v28 battery (tree `8a36cc18…`, 486 files):
capture **757/757**, mutations **366/366**, PostgreSQL **73/73×2**, clean
build, zero residue. The v28 sample passed **22/22**, and the Codex re-audit
accepted 111 plus the ternary verdict but found the remaining CLASS defect: M0
verified that what was said was TRUE, never that everything the question NEEDED
was said. ME2 answered the due date and omitted the 50.60 with every barrier
green, because completeness was being treated as style. **v29** separates three
authorities: truth/grounding (deterministic), completeness
(`plan.response_requirements` — the minimal facts the PLANNER derives from the
request, bound to verified evidence and checked AGAINST THE PUBLISHED TEXT with
entity and role binding) and voice (advisory). A requirement the evidence
cannot prove is never demanded; a value bound to another entity does not cover;
coverage is never self-declared. A read-only omission blocks and gets one
bounded repair carrying only the omitted facts; after a verified write the
truthful reply is preserved with a durable advisory — v21 intact. IR279–IR282
and M0M367–M0M378 originally pinned it; handshake `diagnosable-turns-v32`. Sampling forced three iterations of one family: a turn that
legitimately ASKS does not carry the answer contract; internal identifiers are
not demandable prose; and — the root correction — **only a CANONICAL value is
verifiable against free text** (an amount, a date, or the NAME of an
entity already in the evidence). A planner's free descriptor is never demanded:
demanding prose turns the guarantee into a deadlock, which is worse than the
omission. A comparison is covered by naming its winner. The Codex audit then
found three class defects in v32: after that repair it explicitly re-finalized
with an empty contract, qualitative state/pending/comparison values were
treated as covered merely because an entity was named, and a personalized
factual plan could silently omit the contract. **v33** removes the waiver and
reduces deterministic completeness to the three canonical kinds the server can
really verify: money, date and an evidence-backed entity name. For a non-empty
contract the planner also authors a natural `response_template` with one typed
slot per requirement. If both normal replies omit a grounded fact, the server
renders only canonical values from verified evidence into that model-authored
language and runs the result through every original truth barrier with the
original, non-empty contract. Unsupported qualitative predicates stay with the
intelligent model instead of being disguised as deterministic guarantees.
IR279–IR282 and M0M367–M0M387 pin that historical v33 boundary. Claude's full
sample then exposed that v33 told the planner only `value:object` while runtime
required undocumented keys, so valid model reasoning died while guessing a
wire shape. **v34** makes the contract explicit and discriminated
(`money={amount,currency}`, `date={date}`, `entity={name}`), returns the exact
rejected field path to bounded repair, binds value+entity in one evidence
window, and renders an unproved slot as typed uncertainty without suppressing
proved facts or trusting the planner value. M0M388–398 pin those class fixes;
handshake `explicit-requirements-v34`. Local v34 battery: capture **761/761**,
mutations **398/398**, PostgreSQL **73/73×2**, clean tsc/lint/build, focused
model **3/3**, zero residue. Claude's full v34 sample certified ME2 and reached
21/22: ME5 was impossible because the factual-contract guard demanded a
money/date/entity value for a qualitative open-operation pending while the
lifecycle correctly forbade copying that pending into the read-only inspection.
**v35** treats the already server-owned observed pending state as the alternate
completeness authority only for a strict read-only answer (observed operation,
zero actions, zero new missing fields); publication still must acknowledge the
pending. It does not exempt answer_and_act or an answer with no observed
operation, and it does not add a qualitative requirement kind. M0M399–401 pin
both directions; handshake `observed-pending-v35`. Claude's full v35 sample
then exposed an older publication class: after three verified card payments,
one additional amount without a turn receipt could fail `money_not_grounded`
without naming the rejected figure, producing HTTP 500 after money moved.
**v36** keeps grounding fail-closed but carries a bounded
`{value, reason, roles}` diagnosis into the durable operation and the model E2E,
then gives exactly that diagnosis to one repair; post-write prose may mention
provenance but may quote only amounts bound by executed-plan evidence or verified
pending facts. It also closes the source hole found in v35: observed-operation
authority requires every observed row to own a real durable pending and every
assertion to come from `openOperations`, so an unrelated visible id cannot waive
canonical completeness. IR265/IR283 and M0M399–407 pin the class; handshake
`grounding-repair-v36`. Local v36 battery: capture **762/762**, mutations
**407/407**, PostgreSQL **73/73×2**, clean tsc/lint/build, focused model ME1–ME5
**5/5**, zero residue. Claude's full v36 sample certified ME4 and reached 21/22
on ME5 because runtime required an `assertions[].source` wire token the prompt
never documented, then returned only the downstream generic factual-contract
error. **v37** uses one shared `openOperationAssertionSource` contract across
prompt, validator and fixtures, explicitly teaches
`openOperations[<observed_operation_id>].<field>`, and returns the exact
`plan.assertions[i].source` path to bounded repair. Source provenance is now
bound to one actually observed id, not merely to a collection name. IR265/IR284
and M0M399–410 pin the class; handshake `observed-source-v37`. Local v37 battery:
capture **763/763**, mutations **410/410**, unchanged PostgreSQL **73/73×2**,
clean tsc/lint/build, focused ME1–ME5 **5/5**, zero residue. Claude's full v37
sample certified that wire in the real planner but ME4 returned a safe HTTP-200
intake fallback whose typed cause was lost by the reporter: `turn()` had already
captured `turn.intakeDiagnostic`, while `turnDetail()` read only the HTTP-error
branch and cleanup then deleted the durable row. **v38** is observability-only:
the detail consumes the bounded successful-path diagnostic and IR270/IR285 plus
M0M411 prevent that evidence from disappearing again. Handshake
`intake-reporting-v38`; capture **764/764**, mutations **411/411**. M0 remains
OPEN for Claude's next full audit on v38; if ME4 is red, the same sample must now
name stage/code/attempts/validationFailures before any product change.
Claude's frozen v38 audit passed 22/22 and the exact tree shipped as `e91df36`,
but the founder's first real acceptance turn reopened M0: a stable rent payment
asked for its source and, after “from Supervielle”, demanded a redundant third
confirmation. Production rows proved the planner was right; the generic amount
guard searched the stored fixed-expense amount only in the current
clarification. **v39** adds a typed server-owned monetary-path registry. It
exempts only an exact amount/currency re-derived from a complete current domain
catalog; its first verifier covers an active non-variable fixed expense linked
by id. Variable plans, missing catalogs, mismatches and any user-stated
contradictory amount remain fail-closed. It never matches the phrase “rent” and
never trusts planner-authored `amount_source`. IR286/M0M412; handshake
`stored-money-authority-v39`; capture **765/765**, mutations **412/412**, clean
tsc/lint/build, no migration. M0 is OPEN again pending external audit and a
disposable exact-transcript smoke. That smoke independently proved the v39
verifier with 24/24 adversarials, then exposed a pre-existing pending-question
contract failure: the planner could call an already supplied argument missing,
and a reasonable question could be discarded by a lexical false negative.
**v40** rejects any missing_field whose exact argument path is already present
in its targeted validated action. If both model-authored question attempts
still fail lexical acknowledgement, a last-resort question renders every typed
`answer_shape` and re-enters all deterministic publication barriers; it never
invents a financial fact or phrase-specific route. IR287/M0M413–414; handshake
`pending-question-coherence-v40`; capture **766/766**, mutations **414/414**,
clean tsc/lint/build, no migration. M0 remains OPEN for a disposable exact
transcript audit on v40. That audit proved both invariants but found the missing
planner half: across two real samples the planner identified the exact stable
fixed-expense row yet omitted its durable amount and asked the user to repeat
it. It also proved that the server-rendered last-resort amount question could
not satisfy the old lexical pending matcher because user-facing words such as
`monto` are deliberately stopwords. **v41** adds a narrow semantic compiler,
not a phrase route: after the model chooses `log_movement`, an exact
`fixedExpenseId` and expense semantics, the server may fill only amount/native
currency from one active non-variable row in a COMPLETE financial catalogue.
It refuses variable/inactive/non-unique rows, incomplete reads, currency
conflicts and any contradictory user-authored amount. A shared amount-missing
field is removed only from compiled actions, never from unresolved siblings.
The canonical last-resort question is verified by construction from every
typed `answer_shape`, skips only the lexical overlap check, and still crosses
all truth, money, calendar, voice and mutation barriers. IR287/IR288 plus
M0M415–417 pin consumption and both fail-closed sides; capture **767/767**,
mutations **417/417**, no migration. Handshake
`stored-plan-adoption-v41`. M0 remains OPEN for one external disposable smoke
of the exact rent transcript on v41. Claude's v41 audit proved the compiler
21/21 and the first turn finally asked only for the account, then exposed the
entity mirror of v39: the executor rechecked `Arriendo` only against “Desde mi
cuenta Supervielle”, ignoring that the exact durable operation root already
named it. **v42** makes user-authored entity authority operation-scoped across
all resolved-entity guards and the fixed-expense linker. The latest delivery
has precedence: explicitly naming another peer refutes the inherited entity.
An unrelated operation contributes no messages. Fixed matching consumes the
operation's user messages plus the validated amount, never a model-authored
description. IR289 and M0M418–421 pin inheritance, isolation, correction and
consumption; capture **768/768**, mutations **421/421**, no migration. Handshake
`durable-entity-authority-v42`. Claude's v42 audit certified the exact rent
transcript 6/6, then the full gate exposed a separate planner-repair class in
ME4: three invalid candidates successively invented an incomplete income,
an effect-less write and a grouped `log_movement` without an undo. **v43** makes
the semantic exit explicit without routing language or rewriting a plan:
`atomic_group` is database dependency, never conversation/operation identity;
provenance or an already-recorded fact is not a write request; a validator veto
does not prove the rejected action should exist; and bounded repair must retain
independent valid actions while representing only an economically unresolved
fact as response-scoped missing state. Validator errors now teach the same safe
exit and explicitly forbid inventing a leg or undo to appease the schema. IR290
and M0M422–424 pin prompt, repair consumption and the grouped-movement branch;
capture **769/769**, mutations **424/424**, no migration. Handshake
`semantic-repair-v43`. M0 remains OPEN for one frozen full model audit.
Claude's v43 audit directly refuted that repair: ME12c understood an
unambiguous outgoing loan but used the new `$response` escape to abandon the
write after an internal algebra error, while ME4 exhausted its attempts
fabricating the same kind of pending state. **v44** removes the contradiction
at the contract boundary. Server validation reasons describe only the defect;
bounded repair is typed as `action_payload`, `transaction_wiring`,
`clarification_lifecycle` or `general`. An internal payload rejection cannot
create a new response-scoped missing field, but a concrete user-evidence
ambiguity already present in the rejected plan keeps its legitimate question
path. `$response` is structurally bound to one matching ambiguity field+reason
and cannot mix action targets. No user phrase, financial case or capability
selects these branches. IR291 and M0M425–430 pin fail-closed, consumption and semantic
freedom sides; handshake `repair-authority-v44`. M0 remains OPEN for one frozen
full model audit of v44.
The frozen v44 audit passed and shipped, but the founder's next real chat proved
that four sensitive proposals still cannibalized each other: one partial unique
index allowed only one pending challenge per conversation, while deterministic
confirmation accepted only a narrow linguistic surface. **M0.11A is now the
local active frontier.** It replaces per-tool semantic authorization with one
durable operation manifest for one or N exact actions. The model alone declares
meaning, lifecycle transition and provenance; PostgreSQL/app code verifies
ownership, exact durable source, CAS, state witness, typed effects and exact
authorized=executed parity. Anti-loop is structural: a reply must resolve,
reduce, materially change, reject or abandon durable pending state; one
clarified retry is allowed, a second unchanged paraphrase is not. Migration
**112 is APPLIED (2026-08-12)**. Its first PostgreSQL audit found two harness/
observability defects without weakening the manifest boundary: M112.2 queried
the nonexistent `agent_action_challenges.operation_id`, and manifest
verification called every persisted step `actual` while reporting one generic
set-mismatch even when only execution/verification was incomplete. **113 is
APPLIED (2026-08-12)**: it makes `actual_count` the executed count, persists
separate authorized/prepared/matching/executed/settled/verified counts and a
typed failure code. PostgreSQL is **78/78×2**. Claude's first live-model sample
then exposed a model-interface class defect: provenance paths, lifecycle
targeting and second-delivery policy were enforced as hidden wire rules. The
current local repair generates all three model-facing contracts from the same
sources that validate them, returns exact rejected paths/sets and adds a
detached runner for a single long sample. Claude's next partial sample proved
that wire repair (zero provenance rejects and ME16 green), but also exposed one
runtime ownership defect plus harness debt: a singleton whole-operation undo
settled its step inside PostgreSQL and the ordinary executor tried to append a
second, differently-shaped receipt after the reversal had landed. The writer
now declares `operationStepReceipt="writer"`; the orchestrator skips only that
second receipt, while multi-step atomic groups remain on the generic
coordinator. The model E2E now measures operation-manifest scope, two-delivery
undo/correction, immediate ordinary repayment and the real legacy-challenge
column. Claude's next full pass executed all 24 checks and isolated two
model-interface boundaries. ME16 could name four live card statement amounts,
but `stored_fact` knew only the fixed-expense verifier; ME12 could legitimately
choose a read-only pass but had to guess how to defer its question. The local
repair publishes one shared stored-fact registry for stable fixed expenses and
live uncovered card statements, canonicalizes only provenance for an already
model-selected action/entity/amount, and re-derives the same fact in executor
preflight. It also publishes and compiles the generic read/replan wire; the
model still chooses every read and the final economic action. The semantic E2E
follows one typed replan instead of treating an internal read as the final
answer. No phrase, card name or transcript selects either branch. Claude's
next frozen sample reached **22/24**: ME16 certified the four-payment manifest,
then exposed two independent seams. A persisted operation may replace its
planner missing-fields with an executor clarification; exact recovery was
feeding that mutable runtime state back through the planner ambiguity
validator. New plans now carry a server-authored validation receipt for the
exact immutable planner envelope. Recovery verifies its digest and resumes
that envelope; a present-but-invalid receipt fails closed, while pre-M0.11A
rows retain their legacy path. Separately, closing a covered card cycle was
still blocked by historical `minimum_payment`/`statement_total_due` snapshots
even with zero current balance and zero live due. Migration **114 is APPLIED
(2026-08-13)**: current balances always block, while only a credit card with a
covered cycle and zero remaining due may retain those historical figures.
PostgreSQL is **80/80×2** on that schema. The loan-direction doctrine is also a
shared counterfactual contract: cash entering never by itself proves whether
the user was lender or borrower. The model remains semantic authority and asks
when both worlds fit; no phrase is routed.

Claude's first post-114 sample then exposed one contradiction between two
otherwise-correct provenance contracts. A full card payment intentionally omits
`arguments.amount` because PostgreSQL derives it from the live statement, while
the generic provenance calculator required only numeric paths present in the
arguments. The stored-fact registry therefore taught the model to cite
`register_card_payment.amount`, and the validator rejected that exact citation
as unknown. The current repair uses one shared calculator for prompt compiler
and runtime validation: required monetary claims are present numeric arguments
plus server-materialized paths whose typed structural condition holds. For
`paidInFull=true`, `amount` remains absent from arguments but is required and
proved from the exact live card fact; partial payments remain user-stated, and
missing/wrong authority fails closed. IR309 mechanically crosses every monetary
schema path plus every registered server-materialized form; M0M466–469 pin the
shared calculator, compiler and prompt. The next sample proved that shape and
exposed one class boundary: a pure executor question could die for not sharing
words with its internal summary, while an exact retry after verified money
could try to begin the same verified manifest again. The current anti-bot
invariant keeps normal language with the model, verifies a no-write
`needs_info` as a speech act rather than lexical overlap, retains strict pending
disclosure after a write, and gives production a truth-checked continuity reply
instead of silence/500. Recovery is durable telemetry and makes the E2E red; it
is never counted as normal intelligence. Migration **115 is APPLIED
(2026-08-14)**: it adds SQL parity for the live-card stored fact and permits
`already_verified` reentry only for a complete non-partial manifest. PostgreSQL
passed **82/82×2**. Its first model audit reached 15/24 because five turns used
recovery; all five were falsely labeled provider downtime although two were
planner read/replan exhaustion and three had lost their cause. A partial
mechanical compiler still left about forty simultaneous wire obligations on the
model and the next audit fell to 12/24, dominated by a derived accounting leg.
The current pass is a net subtraction: live model output has six semantic root
fields, three unit fields and three step fields; an ordinary write is 12 semantic
obligations (hard ceiling 14). Runtime derives effects, provenance, ids,
lifecycle, missing targets, manifest/CAS, dependency/atomic wiring, witnesses,
postconditions and response wire, then checks compiled effects against the
model-owned observable `expected_change` and runs the original strict
validator/preflight/writers. Exact user evidence still binds one durable
delivery, so 552.77 remains refused. Evidence is step-local, preventing equal
amounts in separate actions from sharing authority. The complete 122-tool catalog is never
filtered; it precedes dynamic user data in a cacheable system prefix and every
turn exposes total/cached/output usage. The conversational E2E is black-box HTTP
+ PostgreSQL and never imports the planner envelope. Any recovery remains
release-red. Baseline: capture **806/806**, mutations **490/490**, PostgreSQL
**82/82×2** and build **36/36**. The frozen sample expects **24/24**, zero recovery,
intake failure, error, empty reply or internal jargon under handshake
`subtractive-semantic-plan-m0-11a`.
M0.11B (set selectors, entity geography and locked server derivations for
requests such as “zero my negative Ecuador accounts”) remains explicitly
pending and must not be smuggled into A.
A green authorizes commit/deploy/production smoke/founder review. A red sample
stops immediately for one typed diagnosis and is never rerun until the tree
changes. See `docs/M0_11A_CODEX_SUBTRACTIVE_SEMANTIC_PLAN_2026-08-14.md`
for the current handoff; `docs/M0_11A_CODEX_ANTIBOT_CONTINUITY_FIX_2026-08-13.md`,
`docs/M0_11A_CODEX_PERSISTED_ENVELOPE_FIX_2026-08-13.md`,
`docs/M0_11A_CODEX_STORED_FACT_REPLAN_FIX_2026-08-13.md`, the earlier M0.11A reports and
`docs/M0_CODEX_REPAIR_AUTHORITY_V44_2026-08-12.md` are history. Use
`docs/M0_IMPLEMENTATION_CHECKPOINT_2026-07-31.md` only for the historical
implementation checkpoint. **Bloque M** (the complete front) is
BLOCKED until M0 closes.
Bloques A–D, F, G, H, I, J, K are CLOSED (G = LatAm
installments/cuotas; H = objetivo mensual comida/transporte; I = no number can
inflate itself — money-read doctrine, migrations 056–065). `docs/ROADMAP_MVP.md`
is a historical archive, not pending work.

Read first: `CLAUDE.md`, then `docs/AI_NATIVE_ARCHITECTURE.md` (north star),
then `docs/ROADMAP.md` (what's next), then `docs/PRODUCT_SPEC.md` /
`docs/TECHNICAL_SPEC.md`.

## How to build (AI-native, not route-native)

- The brain is an **LLM agent** that interprets intent broadly and chooses
  **tools**. Add capabilities as **tools**, never as new regex routes or
  phrase gates.
- Production posture: `KIPU_AGENT_MODE=on` — the agent is the primary brain;
  the legacy pipeline is emergency fallback only (never re-extend its gates).
  The tool surface is 122 typed tools. Agent, chat, ambient, and fallback
  must quote the SAME saldo the dashboard shows.
- **Intelligence is flexible; execution is safe.** The LLM plans; typed
  deterministic tools validate and execute every write. The LLM never writes
  to the DB directly and never issues raw SQL.
- Memory is first-class: read learned facts/aliases/preferences before acting;
  persist corrections and inferred patterns after (the `remember_fact` tool).
- Work in small, testable steps. Don't add packages unless necessary. Behavior
  over phrasing — never build a feature as exact-phrase matching.

## Channels

Internal web app + Telegram (first) + WhatsApp (later). Channel-specific code
stays separate from the agent core and the financial engine. The web internal
chat may show conversations from other channels (shared `chat_messages`).

## Financial rules (source of truth = the engine, not the LLM)

- Credit cards are debt, not available money. A card purchase = an expense
  today + a debt increase. A card payment = source account down + debt down,
  NOT a new expense.
- Reversals are append-only and auditable (never hard-delete financial rows).
- The system supports multi-currency fields, split expenses, reimbursements,
  refunds, reversals, transfers (own + person-to-person), receivables/loans,
  recurring/fixed expense create+update, scheduled future payments, variable
  budgets, goal feasibility, and debt pressure. (The old accuracy/flexibility
  scores are retired from the product face — engine-internal only.) New
  capabilities are exposed as tools.
- **Comida and transporte are NOT learned any more** (Bloque H): they carry a
  monthly OBJETIVO the user DECIDES, and Kipu never adjusts it on its own.
  Spend inside the objetivo does not drain the Saldo (it's already reserved via
  essentialEstimate); only the excess drains it. The objetivo is versioned per
  month — each month is measured against the objetivo in force back then, and
  history is immutable. The rest of the variable budgets keep learning. See
  `CLAUDE.md` (Bloque H) for the full contract.
- A universal materialization calendar (nightly cron, Bloque C) books what
  falls due: income/fixed auto or ask, loans auto-book, cards ask at BOTH
  cutoff and payment date, family/scheduled ask, reserve check-ins; users
  resolve by chat, notifications are AI-generated. Days 29–31 clamp to the
  month's real last day. Cards are ONE system (no ambient card dupes).
- Avoid double counting (recurring payment ≠ extra expense). If a recurring
  amount changes, learn whether it's one-time or permanent.

## Database rules

- Every user-owned table has `user_id` and RLS enabled. Service-role grants
  are intentional (channel handlers run without a user session).
- Never expose service-role keys to the browser.
- Additive migrations are allowed when a capability needs them; print exact
  DDL and let the human apply it. Never weaken RLS or drop applied objects.
  Applied migrations: 001–115 (088 + its fixes 089–092 applied 2026-07-28;
  093–095 applied 2026-07-29; Pre-M 096–099 applied 2026-07-31; M0 100–102
  applied 2026-08-02/03; M0 103–107 applied 2026-08-03; M0 108 applied
  2026-08-08; M0 109–111 applied 2026-08-09; M0.11A 112–113 applied
  2026-08-12; 114 applied 2026-08-13; 115 applied 2026-08-14). The next
  production migration is 116.
  Migration map: 048 adds `saldo_kipu`; 049–050 = installment_plans/cuotas; 051 = objetivo mensual: `transactions.budget_treatment` + `objective_month_closes` + ledger RPC; 052 = `objective_versions`; 053 = `amount_base` + RPC `kipu_upsert_budget_objective`; 054 = backfill + invariantes NOT NULL, ANCLA histórica atómica y RPC bulk de onboarding; 055 = historia inmutable POR PRIVILEGIO: `authenticated` pierde toda escritura sobre `objective_versions` (solo SELECT), las RPC pasan a SECURITY DEFINER y el servidor DERIVA el mes vigente (`kipu__user_month`) y qué categorías son objetivo — ambas comparten el helper `kipu__objective_write`; 056+058 = Bloque I: lease del ejecutor de cambios programados + intención durable con FIDELIDAD (`pending_prev_kind` value/null/row_missing + `pending_extra`); 057+059 = `kipu_apply_repayment` atómico, IDEMPOTENTE ante replay (dedupe_key obligatorio) y con moneda validada por asignación; 060+061 = household atómico: `kipu_add_shared_expense`, `kipu_settle_household` (CAS por counts Y TOTALES + lock compartido de la fila households), `kipu_update_shared_expense`, índice único parcial de `origin_transaction_id`; 062 = auditoría 3: `kipu_apply_repayment` valida `base_currency` contra el perfil, `kipu_cancel_shared_expense`/`kipu_mark_reimbursement_paid` toman el MISMO lock del settle, `kipu__household_actor` valida al actor en toda RPC household, y el update verifica el CONJUNTO persistido — miembro duplicado, cobertura exacta de splits y suma post-write en la misma transacción; 063 = auditoría 4: `kipu_apply_card_payment` — pago de tarjeta ATÓMICO (ledger + baja de `full_payment_due` en una transacción, CAS sobre el valor leído, replay idempotente por dedupe sin re-reducir) — y `kipu_apply_repayment` rechaza al usuario SIN fila de perfil (`v_pbase is null` ⇒ KIPU_VALIDATION, ya no es permiso para continuar); 064 = pasada 5: `kipu_set_card_statement` (corte con lock: updated / safe_newer_exists / raise — el UPDATE viejo daba éxito con cero filas y podía pisar un corte más nuevo), tabla `card_payment_applications` (la MARCA durable del pago aplicado, misma transacción que el ledger; un ledger genérico con el mismo dedupe SIN marca ⇒ KIPU_CONFLICT, jamás replayed) y `kipu_apply_card_payment` v2 (exige debt_payment, entry.debt = statement.debt, ownership+credit_card con lock, y coherencia del monto pagado); 065 = pasada 6 (integridad del ciclo de tarjeta): `statement_total_due`+`statement_covered` (un parcial jamás cubre el corte), corte idempotente con `safe_same_exists`/`corrected_same_statement` (corregir conserva lo pagado), trigger `transactions_debt_payment_currency_guard` (todo debt_payment exige cuenta/entry/deuda en la MISMA moneda nativa común y base = perfil), `kipu_override_debt_due` + `kipu_update_debt_snapshot` (declarativos con lock+CAS), `kipu_apply_card_payment` v3 (fingerprint + marca con transaction unique, cobertura y `last_payment_date` en la misma txn) y `kipu_reconcile_existing_card_payment` (pago manual previo: solo statement+marca)).
  La 066 (Bloque J-1) = trigger `transactions_cash_movement_currency_guard`: expense/income/goal_contribution exigen toda pata de cuenta en la moneda del movimiento y base = perfil (reversal/adjustment/transfer/refund exentos). La 067 (re-auditoría J-1) suma la pata de la META al mismo trigger: goals.currency debe = moneda del movimiento (el ledger suma el ORIGINAL a current_amount; meta sin moneda declarada también rehúsa).
  La 068 (re-auditoría 2 de J-1) = `kipu_change_account_currency` (lock + CAS + re-conteo de movimientos en la transacción), trigger `accounts_currency_change_guard` (moneda inmutable con historia) y `accounts.is_currency_default` + `kipu_set_currency_default_account` (preferencia moneda→cuenta estructurada, única por moneda).
  La 069 (re-auditoría 3 de J-1) = validadores de moneda con `for key share` (cuentas en orden determinista, tarjeta, meta y perfil) para cerrar la carrera contra un cambio de moneda concurrente, `kipu_change_base_currency` atómica, default solo en cuentas ordinarias activas, balances nuevos acotados sin reinterpret e idempotencia `already_changed`.
  La 070 (re-auditoría 4 de J-1) = validadores con `for no key update` (cierran el UPDATE directo, que el `for key share` no bloqueaba), guards de inmutabilidad de `profiles.base_currency` / `debt_accounts.currency` / `goals.currency`, y `kipu__user_base_data_witness`: la definición única y completa de «hay dinero en la base» (19 tablas) usada por la RPC y por el trigger, más pre-onboarding obligatorio.
  La 071 (re-auditoría 5 de J-1) = los guards miran VALOR: tarjeta y meta con moneda INMUTABLE tras el INSERT (el guard de meta mira OLD), la cuenta exige balances viejo y nuevo en cero salvo por la RPC (marca `kipu.sanctioned_currency_change`), y el witness se deriva del catálogo (`kipu__base_data_tables`) con montos ≠ 0 campo por campo.
  La 072 (re-auditoría 6 de J-1) = el witness deja de adivinar por nombre de columna (una regex no vio `mtd_seed` ni `saldo_kipu`): pasa a EXISTENCIA DE FILA sobre lista explícita de 26 tablas, con `kipu__base_data_coverage_gaps()` para ver la deriva; y la RPC rechaza cambiar la moneda de una cuenta cableada a meta/ingreso/plan/pago-de-deuda/gasto-fijo.
  La 073 (re-auditoría 7 de J-1) = coherencia cuenta↔dependencia por LOS DOS LADOS: el trigger de la cuenta usa el mismo helper que la RPC (+scheduled_payments y spending_alert_rules), y triggers INVERSOS bloquean la cuenta al vincularla (metas, ingresos, pagos programados, gastos fijos, cuenta de pago de deuda, planes de ahorro) — la carrera se cierra en cualquier orden. El onboarding deriva la moneda del instrumento vinculado.
  La 074 (re-auditoría 8 de J-1) = `savings_plans` valida la moneda NATIVA (`original_currency ?? base_currency`), `spending_alert_rules` gana trigger inverso, y los guards pasan a VOLATILE (STABLE usa el snapshot del caller: tras esperar un lock no veía lo commiteado). El endurecimiento posterior sin migración centraliza el onboarding en `planOnboardingCurrencies`: una sola decisión alimenta preflight FX, fila y acciones derivadas; una moneda omitida hereda el instrumento y un vínculo incompatible se rehúsa ANTES de cualquier write. Incluye los planes de ahorro: su origen debe existir como cuenta y su destino como cuenta o activo probado — nunca se reetiqueta el monto ni se pierde un vínculo en silencio. Y la contracara: un rechazo cuyo remedio no está en la pantalla es un cerrojo, no un guard — el draft del wizard solo emite un vínculo cuyo objetivo sigue vivo (borrar el activo borra el vínculo), así el preflight solo rehúsa lo que el usuario puede ver y arreglar.
  La 075 (Bloque J-3) = anotar un corte cierra su pregunta: wrappers atómicos sobre `kipu_set_card_statement`/`kipu_override_debt_due` (cores privados, sin service_role) que resuelven la ocurrencia `card_statement` en la MISMA transacción; varios avisos abiertos sin `occurrence_id` ⇒ `ambiguous` (no cierra ninguno y el corte igual se guarda).
  La 078 (Bloque J-7, APLICADA 2026-07-27) cierra la última exención de la 066: su
  propio comentario decía «transfer y refund (reglas propias — J-7 los audita
  aparte)» y esas reglas nunca se escribieron. El efecto `transfer` del ledger
  resta `v_eao` del origen y suma EL MISMO `v_eao` al destino (un monto para dos
  patas), así que ARS→USD inventaba dólares — el bug de J-1 por la puerta que J-1
  dejó abierta; `refund` acreditaba el original sin mirar la moneda del destino.
  El cuerpo es el VIVO de la 070 (bucle determinista de las dos patas con `for no
  key update`, perfil con lock): lo único que cambia es la lista de tipos
  guardados. Siguen exentos `reversal` (debe poder espejar filas históricas malas
  para CORREGIRLAS) y `adjustment` (reconcile y aporte a inversión escriben en la
  moneda de la cuenta por construcción) — verificado por E8/E9 del E2E.
  Las 079–081 (re-auditoría externa de J-7, APLICADAS 2026-07-27): la 079 hace
  ATÓMICO el cierre mensual (`kipu_publish_objective_month_close`: mensaje web +
  filas + finalización del claim en UNA transacción; Telegram queda best-effort
  después del commit) y la publicación del coach ambient
  (`kipu_publish_ambient_coach_message`: la procedencia durable aterriza ANTES del
  efecto externo), y suma `adjustment` al guard monetario — la 078 lo había dejado
  exento "por construcción", que es proteger una invariante con una convención.
  La 080 reemplaza la saga de la inversión recurrente por
  `kipu_apply_investment_occurrence` (caja + activo + ocurrencia + marcador en una
  transacción, replay por fingerprint, locks sobre ocurrencia/plan/cuenta/activo) y
  persiste `resolved_amount`/`resolved_currency` de las reservas. Ambas revocan las
  escrituras de `authenticated` sobre `objective_month_closes` y
  `recurring_occurrences` (SELECT sí, writes sólo service_role).
  La 081 corrige un defecto de las dos anteriores: **`40001` es
  `serialization_failure` y PostgREST REINTENTA ese SQLSTATE**, así que usarlo para
  un rechazo DETERMINISTA hacía que el cliente recibiera HTTP 504 en vez del
  conflicto — y como el caller lee 504 como fallo de infraestructura, reintentaba
  otra vez. La 081 pasó 10 rechazos deterministas a `22023`, pero su informe
  clasificó erróneamente como CAS tres ramas finales que ocurren DESPUÉS de
  bloquear claim/occurrence; la 082 las reclasifica en la frontera v2.
  Las 082–083 (rollout en dos pasos) están APLICADAS: 082 → deploy `bf7d7d4` →
  083. Agregan wrappers v2 para publicación/cierre/planes y doce writers
  financieros; los rechazos deterministas salen como `22023`, los quince cores
  legacy ya no son ejecutables por `service_role`, y `savings_plans` perdió el
  bypass autenticado. Los crons/resolvers relacionados usan lecturas tipadas y
  completas: error o tope nunca significan ausencia.
  La 084 (Bloque J-8: pago multifuente de tarjeta, drafts de captura, cierre atómico
  de cuenta/tarjeta/cuotas, undo universal) la aplicó el founder A MANO por el editor
  SQL, así que NO figura en `schema_migrations` — la cadena real es 084 (manual) →
  085 → 086. La 085 corrige un defecto que dejaba MUERTO el pago multifuente: su
  puente de fondos prestados etiquetaba `debt_account_id` en un `adjustment`, y el
  validador del ledger (051) lo prohíbe, así que la operación entera abortaba. La 084
  conserva ese defecto a propósito: una migración aplicada no se reescribe. La 086
  rehace el backfill de cuotas preservando también `status='paid_off'` (el esquema
  049 permite ese status con `paid_off_at` nulo, así que mirar sólo la fecha podía
  borrar una liquidación legítima). La 087 está APLICADA (2026-07-28): liga un
  draft de captura resuelto a `kind + dedupe + operation_id`, acepta únicamente
  el replay exacto y rehúsa un segundo consumo secuencial, cruzado o concurrente.
  La 088 (cierre first-principles de J) está APLICADA (2026-07-28): identidad
  durable de delivery/chat, challenges de autoridad decididos por el servidor,
  transferencia FX atómica de dos patas nativas, creates/replays idempotentes y
  writers household/instrumentos/correcciones endurecidos. La 089 corrige dos
  defectos suyos que sólo aparecieron ejecutando: `kipu_create_account_idempotent`
  y `kipu_create_debt_account_idempotent` estaban MUERTAS (text→enum sin cast, así
  que crear cuenta/tarjeta desde el agente fallaba siempre), y en
  `kipu_claim_agent_action_challenge` la adyacencia —que CANCELA— corría antes del
  chequeo de auto-confirmación, así que una redelivery tardía del turno que
  propuso mataba la propuesta que el usuario iba a confirmar. La 090 corrige un
  CERROJO suyo: el guard de meta compartida abortaba cuando `household_id` pasaba
  a NULL, y esa columna es ON DELETE SET NULL, así que un hogar con meta
  compartida quedaba imposible de borrar; ahora la meta se degrada a
  no-compartida en la misma operación. `scripts/qa/j-agent-088-probes.mjs` da
  61/61 con residuo cero. La 091 cierra además un defecto ANTERIOR al bloque que
  salió a la luz aquí: `shared_expenses.created_by` y
  `household_settlements.created_by` eran NOT NULL con ON DELETE SET NULL —dos
  reglas que se contradicen—, así que quien hubiera creado un gasto compartido o
  una liquidación no podía borrar su cuenta nunca; la columna cede y el write no
  (guard de INSERT). La 092 cierra ese contrato del todo: `created_by` es
  INMUTABLE mientras su autor exista (un UPDATE manual a NULL falsificaría la
  firma del cascade; reasignar la autoría reescribiría la historia), y añade
  `kipu__schema_contract_report()` —sólo service_role, sólo lectura— para que la
  sonda exija contra el CATÁLOGO cero columnas NOT NULL dentro de un FK
  ON DELETE SET NULL y los cuatro guards de autoría instalados y activos. Sondas
  **61/61**.
  La 048 es la que añadió `saldo_kipu` a `daily_financial_snapshots`.
  La 093 (Bloque K, **APLICADA 2026-07-29**) separa el plan declarado del
  fijo variable, su observación nativa por ciclo y la proyección prudente:
  `fixed_expense_forecasts`, `fixed_expense_observations` y operaciones
  idempotentes; estado abierto `observed`; writer atómico
  `kipu_record_variable_fixed_observation`; convergencia desde cualquier ledger
  ligado; régimen nuevo solo ante cambio permanente; p75 robusto sobre hasta 24
  observaciones de la misma moneda/cadencia/régimen; y orden de locks
  fixed→account común a calendario/legacy. `authenticated` solo lee las tablas
  aprendidas. La sonda real encontró que correct/zero/retract sobre una factura
  ya pagada chocan con la observación intermedia que crea la reversa genérica:
  la 094, **APLICADA 2026-07-29**, retira el hecho actual antes de esa reversa
  dentro de la misma transacción y elimina la convención muerta de
  `external_ref`. La sonda real ya certificó K7. K13 encontró la segunda mitad:
  la observación llevaba `operationId`, pero la clave del ledger no; un redo
  posterior al undo podía reusar la transacción ya revertida.
  `variableFixedPaymentLedgerDedupe` comparte ahora esa identidad durable
  (misma entrega = replay, nueva orden = nueva transacción). El E2E queda
  obligado a recorrer 79/79 casos; las lecturas históricas seleccionan
  `is_current` y los estados divergentes legacy nacen estables, se pagan por el
  ledger genérico con cero observaciones K y solo entonces activan el guard
  variable. Los grupos dependientes fallan por nombre sin abortar los checks
  posteriores. La 095, **APLICADA 2026-07-29**, hace ejecutable retract
  pagado (`sign=-1` en ambos reversos internos), limita el bloqueo de una factura
  histórica al mismo ciclo y repara una reversa legacy inequívoca como factura
  observada e impaga. Las **096–099** (cierre Pre-M) están **APLICADAS 2026-07-31**:
  cursores durables de catch-up y cierre mensual, reconciliación nativa auditable,
  cierre/reapertura v3 con snapshot reversible, guards de puerta lateral y el
  barrido de residuo acotado **por valor** (`|nativo × tasa vigente| < 0,005`,
  rechazo sin tasa). Las **100–102** (M0, APLICADAS 2026-08-02/03) crean la
  operación conversacional durable, hechos financieros universales y
  satisfacción hecho↔ocurrencia; la 101 reemplaza la llamada PostgreSQL
  inexistente `jsonb_object_length` que dejaba muerto todo claim. La **102** al
  reabrir una resolución restaura el hecho bancario
  exacto que ésta supersedió bajo el mismo lock de identidad y fecha las
  correcciones de corte con `observed_at=now()`. Las **103–106 están APLICADAS
  (2026-08-03)**: cast legacy seguro por CASE y pregunta pendiente durable para
  planes READY parciales. La 105 hace que las
  lecturas de operaciones usen el reloj de PostgreSQL, dueño de sus timestamps,
  y falla cerrado si esa frontera no puede leerse. La 106 alinea referencias
  tipadas del planner con el preflight. La 107 está APLICADA: el
  preflight deriva el pago en full desde el corte vivo bajo lock y liga también
  `expected_due`/`paid_in_card_currency`. La 108 deriva la reversibilidad del
  undo desde la ontología financiera persistida en `step.effects`. La 109 hace
  que la lectura de operaciones abiertas sea UNA RPC de snapshot único
  (`kipu_read_open_agent_operations`: padres + steps + deliveries + CAP+1
  contado + reloj del statement en un solo statement SQL). La 110 saca el
  mensaje crudo de `agent_intake_failures` conservando fingerprint e identidad
  (`request_text` nullable, filas depuradas, recorder sin persistirlo); la
  siguiente nueva es 111.

## UI rules

Mobile-first. Feels like financial wellness (Whoop-for-money), not accounting
software. Tone: close, playful, clear, zero-judgment, financially responsible.

The daily hero is **Saldo Kipu** (Bloque D): an accumulating spend-for-fun
balance — a tank refilled by monthly-free/30, capped at 10 days of gustos,
drained by real gustos; shown = min(tank, calendar-without-Reserva) —
rendered as a vertical quipu of knots. Money sits in layers Saldo → Reserva →
Metas → Ahorro → Patrimonio → Deuda; crossing a layer always warns, never
blocks. The protected layer is **Reserva** — the word "colchón" is banned in
UI. Day boundaries use the user's timezone. Retired from the product face:
Margen Kipu as a visible brand, Pulso Kipu (0–100 score), Flexibilidad,
Precisión, Realidad, the named states (Holgado/Justo/Estirando), and weekly
hero framing. `/app/margen`, `/app/readiness`, `/app/precision`, `/app/reality`
are redirects; `margenWeekly`/`margenDaily` survive only as engine internals.
Do not resurrect any of them.

Detail surfaces: `/app/saldo` (Tus capas + flow receipt + honest historical
curve from snapshot `saldo_kipu`) and `/app/cuentas` "Dónde está tu plata"
(per-account cashflow on the same calendar, per-account operating floors —
own obligations + 5-day burn buffer — ideal distribution, exact transfer
moves resolved via chat, physical layers, dead pockets; Tesorería/
TransferAlert is recommend-only; silent for single-account users). The chat
tool `plan_reserve_withdrawal` gathers $X into an account respecting floors,
warning on layer crossings.

## Testing

After meaningful changes: `npm run lint`, `npm run build`, `/dev/capture-test`
(currently 753/753 assertions green), and the behavior-level QA in
`docs/TEST_SCRIPTS.md`; larger stages also get a disposable-persona E2E
battery and a multi-agent red team. Check `git status`. Do not commit unless
told.
