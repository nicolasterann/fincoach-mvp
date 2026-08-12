-- Migration 105 — M0: operation snapshots use PostgreSQL's clock.
-- APPLIED 2026-08-03 after external review.
--
-- `agent_operations.updated_at/completed_at/expires_at` are written by
-- PostgreSQL. The TypeScript readers used `new Date()` from the app process as
-- an upper snapshot bound. Even a small negative app↔DB clock skew therefore
-- hid rows that had already committed: a continuation lost its clarification,
-- a completed multi-version operation disappeared from undo, and a semantic
-- archive search could not find the row it had just created.
--
-- Keep the stable snapshot boundary, but source it from the system that owns
-- those timestamps. A clock read failure is not absence; callers fail closed.

create or replace function public.kipu_agent_read_clock()
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select statement_timestamp();
$fn$;

alter function public.kipu_agent_read_clock() owner to postgres;
revoke all on function public.kipu_agent_read_clock()
  from public, anon, authenticated;
grant execute on function public.kipu_agent_read_clock() to service_role;
