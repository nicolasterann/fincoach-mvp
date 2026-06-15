-- Kipu — Stage 12 hardening (additive over the already-applied 017).
--
-- capture_evidence.status gains 'needs_clarification' so the evidence
-- lifecycle can record "extracted + asked the user one question" as a real
-- outcome, distinct from processed/failed/rejected. Widening a CHECK
-- constraint only ADDS allowed values — it weakens nothing and drops no data.
--
-- NOTE — the unique index on transactions(user_id, external_ref) that appeared
-- in an earlier draft of this migration has been REMOVED after analysis:
--
--   Bank authorization codes are NOT globally unique within a user's history.
--   The same short ref code can appear on two different cards, two different
--   banks, or two back-to-back recurring charges. Enforcing uniqueness on only
--   (user_id, external_ref) would silently reject a legitimate second transaction
--   with the same ref before the application-level matcher can apply the
--   necessary financial context (amount, currency, type, source account).
--
--   Cross-channel deduplication is correctly handled by:
--   1. content-hash idempotency on capture_evidence (the same file/bytes
--      delivered twice never reaches the model or writer — handled in 017).
--   2. The application-level matcher with full trusted context:
--      external_ref + exact amount + currency + compatible type + same financial
--      source → strength-30 "duplicate" verdict → agent instructed not to write.
--      External ref with supporting context disagreement → strength-12 "ask"
--      → user confirms before any write.
--   3. evidence_id threaded into every insert so the ledger audit trail links
--      each movement to the evidence that produced it.
--
--   The non-unique index transactions_user_external_ref_idx from 017 remains
--   for fast matcher lookups.
--
-- Apply manually in the Supabase SQL editor. Do NOT rewrite migration 017.

alter table public.capture_evidence
  drop constraint if exists capture_evidence_status_check;
alter table public.capture_evidence
  add constraint capture_evidence_status_check check (status in (
    'processing', 'processed', 'needs_clarification', 'failed', 'rejected'
  ));
