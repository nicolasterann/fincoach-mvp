-- Kipu — Stage 9: clean chat starting point.
--
-- ADDITIVE and NON-DESTRUCTIVE. Adds a nullable timestamp to
-- user_financial_preferences: messages created BEFORE chat_cleared_at are
-- hidden from the chat VIEW (never deleted — the ledger of conversation stays
-- intact for memory/audit). Lets the user start a clean conversation and stops
-- old fallback-era replies from misrepresenting the current agent.
--
-- Apply manually in the Supabase SQL editor BEFORE deploying the Stage 9 code.

alter table public.user_financial_preferences
  add column if not exists chat_cleared_at timestamptz;
