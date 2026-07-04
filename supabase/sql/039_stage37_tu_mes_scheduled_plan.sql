-- Stage 37 — "Tu mes" scheduled plan changes. Lets the scheduled-changes engine
-- target the monthly PLAN commitments (ahorro / inversión / estimado de esenciales,
-- stored on user_financial_preferences) and a goal's APORTE (contribution_amount):
-- "desde el próximo mes bajo mi inversión a 500". Additive in spirit: the
-- target_type CHECK is re-created only to WIDEN its allowed set (no data change,
-- no RLS change); target_field is a new nullable column. Code degrades gracefully
-- until this is applied (those plans just refuse to save with a friendly message).

alter table public.scheduled_changes
  drop constraint if exists scheduled_changes_target_type_check;
alter table public.scheduled_changes
  add constraint scheduled_changes_target_type_check
  check (target_type in ('income_source','fixed_expense','goal','reminder','savings_plan'));

alter table public.scheduled_changes
  add column if not exists target_field text
  check (target_field in ('savings','investment','essential','contribution'));
