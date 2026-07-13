-- Stage G red-team fix — cuotas anniversaries must clamp from the card's REAL
-- billing day, not from a first due date that itself landed in a short month
-- (day 31 → first due Feb 28 froze every later cuota on the 28th, a drift the
-- statement estimate then double-counted around month-end). Additive.
alter table public.installment_plans
  add column if not exists anniversary_day int
  check (anniversary_day between 1 and 31);
