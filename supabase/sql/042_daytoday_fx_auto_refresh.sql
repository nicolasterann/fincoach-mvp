-- Migration 042 — day-to-day S6: opt-in FX auto-refresh.
-- Additive only. Marks a per-user manual rate as "auto-tracked" so the weekly FX
-- refresh cron updates its value from a live market source (e.g. the ARS blue rate).
-- When false (the default), the rate is a deliberate PIN the cron never touches, so a
-- user who set an exact rate keeps it. No RLS change (fx_rates stays service-role only).

alter table public.fx_rates
  add column if not exists auto_refresh boolean not null default false;
