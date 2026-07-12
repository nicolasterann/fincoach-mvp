-- Stage D (Saldo Kipu) — record the daily Saldo in the snapshot so the detail
-- page can chart the REAL saldo history instead of the retired weekly margin.
-- Additive + nullable: old rows stay null (the chart only plots recorded days),
-- and code deployed before this migration never references the column.

alter table public.daily_financial_snapshots
  add column if not exists saldo_kipu numeric;
