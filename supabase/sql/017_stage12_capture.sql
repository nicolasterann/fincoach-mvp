-- Kipu — Stage 12: universal financial capture (evidence → one truth).
--
-- ADDITIVE and NON-DESTRUCTIVE. Three pieces:
--
-- 1. capture_evidence: every piece of financial evidence the user shares
--    (text, voice note, receipt photo, screenshot, PDF/statement, forwarded
--    email). (user_id, content_hash) is UNIQUE: it is the idempotency key and
--    the concurrency CLAIM. The same file delivered twice (double-tap, retried
--    webhook, re-forward) cannot create two rows; the second delivery loses the
--    insert race and is short-circuited BEFORE any model call or write. status
--    starts at 'processing' (the claim) and transitions to processed/failed/
--    rejected. updated_at powers the optimistic-lock reclaim of failed or
--    interrupted ('processing' but stale) rows.
-- 2. transactions.evidence_id / transactions.external_ref: link movements to
--    the evidence that produced them, and to the bank's own reference/auth
--    code when one exists. external_ref is a STRONG signal but NOT an absolute
--    identity (bank refs are not globally unique across cards/accounts), so the
--    matcher only treats it as a duplicate together with amount, currency,
--    type, and — when resolvable — the same financial source. evidence_id is
--    ON DELETE SET NULL so the canonical financial movement survives if a
--    piece of evidence is ever removed administratively.
-- 3. user_financial_preferences.inbound_email_token: the per-user secret slug
--    behind the personal forwarding address (token@inbox domain). The token —
--    never the From header — is the user identity for inbound email.
--
-- All capture_evidence writes happen through the service role (channel handlers
-- run without a user session); authenticated users only ever READ their own
-- rows (RLS), so no authenticated insert/update grant is needed.
--
-- Apply manually in the Supabase SQL editor BEFORE deploying Stage 12 code.

create table if not exists public.capture_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in (
    'web_chat', 'web_upload', 'telegram_text', 'telegram_photo',
    'telegram_voice', 'telegram_document', 'email'
  )),
  kind text not null check (kind in ('text', 'image', 'audio', 'pdf')),
  content_hash text not null,
  summary text,
  status text not null default 'processing' check (status in (
    'processing', 'processed', 'failed', 'rejected'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency + claim key: one row per (user, content). Race-safe and isolated
-- per user (the same hash for two different users is two distinct rows).
drop index if exists public.capture_evidence_user_hash_idx;
create unique index if not exists capture_evidence_user_hash_uidx
  on public.capture_evidence (user_id, content_hash);
create index if not exists capture_evidence_user_created_idx
  on public.capture_evidence (user_id, created_at desc);

alter table public.capture_evidence enable row level security;

-- Read-only for the owner (e.g. a future "your captures" view). Every WRITE is
-- service-role only; there is intentionally no authenticated insert/update
-- policy or grant.
drop policy if exists "Users can view own capture evidence" on public.capture_evidence;
create policy "Users can view own capture evidence"
on public.capture_evidence
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own capture evidence" on public.capture_evidence;

grant select on public.capture_evidence to authenticated;
grant all on public.capture_evidence to service_role;

alter table public.transactions
  add column if not exists evidence_id uuid
    references public.capture_evidence(id) on delete set null,
  add column if not exists external_ref text;

create index if not exists transactions_user_external_ref_idx
  on public.transactions (user_id, external_ref)
  where external_ref is not null;

alter table public.user_financial_preferences
  add column if not exists inbound_email_token text;

create unique index if not exists user_financial_preferences_inbound_token_idx
  on public.user_financial_preferences (inbound_email_token)
  where inbound_email_token is not null;
