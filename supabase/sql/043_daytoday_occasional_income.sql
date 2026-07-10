-- Migration 043 — day-to-day S7: occasional / windfall income.
-- Additive only. Marks an income as OCCASIONAL (e.g. freelance that lands every few
-- months, a bonus, an unpredictable side gig). Occasional income is EXCLUDED from the
-- recurring monthly capacity/Margen so it never inflates the steady-state plan; Kipu
-- still remembers it and factors it when the money actually arrives. No RLS change.

alter table public.income_sources
  add column if not exists is_occasional boolean not null default false;
