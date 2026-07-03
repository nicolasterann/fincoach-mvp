-- Stage 32 — "Presupuesto vivo". Additive only.
-- (a) Per-category month-to-date SEED captured at onboarding ("¿ya gastaste algo
--     este mes en Comida?"): lets the engine reserve only what REMAINS of the
--     month's budget instead of the full estimate on top of already-spent money.
--     seed_month anchors the seed to the calendar month it belongs to — a stale
--     seed from a prior month is ignored, never carried over.
-- (b) Weekly/biweekly fixed expenses get a real pay anchor (mirrors
--     income_sources.pay_anchor_date from 032) so the 7/14-day phase is the
--     user's actual payment date, not "today".
-- (c) is_variable fixed expenses get last_confirmed_month so the monthly
--     ambient confirm loop ("¿cuánto te salió la luz este mes?") knows whether
--     this month's amount was already confirmed and never re-asks.
-- RLS unchanged: all columns on already-RLS'd user-scoped tables.

alter table public.budget_categories add column if not exists mtd_seed numeric;
alter table public.budget_categories add column if not exists seed_month date;

alter table public.fixed_expenses add column if not exists pay_anchor_date date;
alter table public.fixed_expenses add column if not exists last_confirmed_month date;
