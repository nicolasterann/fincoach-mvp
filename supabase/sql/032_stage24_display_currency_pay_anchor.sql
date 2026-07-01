-- Stage 24 — two ADDITIVE, NULLABLE columns. No default, no backfill, RLS untouched.
-- Both degrade gracefully in code (absent => base_currency / no anchor), so applying
-- this before OR after the deploy is safe. Nothing here drops or rewrites an object.

-- (7) Web-display-only currency preference. NULL => fall back to base_currency.
-- Never read by the engine / agent / Telegram — presentation re-expression only.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_currency text;
COMMENT ON COLUMN public.profiles.display_currency IS
  'Web-display-only currency preference. NULL => fall back to base_currency. Never used by the engine/agent/Telegram — presentation re-expression only.';

-- (8) Optional known real payday (ISO date) anchoring a weekly (7d) / biweekly (14d)
-- cadence. NULL => both date engines fall back to expectedWeekday / default-Friday
-- exactly as today.
ALTER TABLE public.income_sources
  ADD COLUMN IF NOT EXISTS pay_anchor_date date;
COMMENT ON COLUMN public.income_sources.pay_anchor_date IS
  'Optional known real payday (ISO date) anchoring a weekly (7d) / biweekly (14d) cadence. NULL => engines fall back to expectedWeekday/default-Friday unchanged.';
