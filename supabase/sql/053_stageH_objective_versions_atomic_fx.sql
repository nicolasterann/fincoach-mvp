-- Kipu — Stage H fixes: freeze the historical FX equivalence + make an objective
-- change ATOMIC (founder review points 3 and 6).
--
-- (6) FX COULD STILL REWRITE THE PAST. objective_versions stores the NATIVE
--     amount (500.000 ARS) and the reader re-valued it at the LIVE rate every
--     turn, while transactions keep their own historical base_amount. So a rate
--     move alone created or erased HISTORICAL excess — the Saldo changed with no
--     new spend and no objective change. Fix: freeze the base equivalence on the
--     row (amount_base + base_currency, stamped when the decision is made). The
--     reader uses the FROZEN value for PAST months (immutable history) and keeps
--     re-valuing LIVE only for the CURRENT month (planning honesty — a peso
--     objective must not freeze at one day's rate while you're living it).
--
-- (3) AN OBJECTIVE CHANGE WAS TWO NON-ATOMIC WRITES (budget_categories, then
--     objective_versions) with the second's result ignored: a partial failure
--     changed the current objective while silently losing its history, and Kipu
--     still confirmed success. Fix: ONE PL/pgSQL function = one transaction.
--     Either both land or neither does.
--
-- Additive only. Apply BEFORE deploying the fix code.

alter table public.objective_versions
  add column if not exists amount_base numeric,
  add column if not exists base_currency text;

comment on column public.objective_versions.amount_base is
  'The objective valued in the user base currency AT THE MOMENT IT WAS DECIDED. Frozen: the reader uses it for PAST months so an FX move can never rewrite historical excess. NULL (pre-053 rows) → the reader falls back to live conversion.';

-- Atomic "set the objective": current pointer + this month's immutable version.
-- p = { user_id, category, amount, currency, effective_month?, amount_base?, base_currency? }
-- effective_month omitted → only the budget pointer is written (non-objective
-- categories keep exactly the old behavior).
create or replace function public.kipu_upsert_budget_objective(p jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_user    uuid := nullif(p->>'user_id','')::uuid;
  v_cat     text := nullif(p->>'category','');
  v_amount  numeric := (p->>'amount')::numeric;
  v_cur     text := nullif(p->>'currency','');
  v_month   text := nullif(p->>'effective_month','');
  v_base    numeric := nullif(p->>'amount_base','')::numeric;
  v_basecur text := nullif(p->>'base_currency','');
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_cat is null then raise exception 'KIPU_VALIDATION: category required'; end if;
  if v_cur is null then raise exception 'KIPU_VALIDATION: currency required'; end if;
  if v_amount is null or v_amount < 0 then raise exception 'KIPU_VALIDATION: amount must be >= 0'; end if;
  if v_month is not null and v_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'KIPU_VALIDATION: effective_month must be YYYY-MM';
  end if;

  insert into public.budget_categories (user_id, category, amount, currency, period, is_active)
  values (v_user, v_cat::public.financial_category, v_amount, v_cur, 'monthly', true)
  on conflict (user_id, category, period) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        is_active = true;

  if v_month is not null then
    insert into public.objective_versions (user_id, category, effective_month, amount, currency, amount_base, base_currency, updated_at)
    values (v_user, v_cat, v_month, v_amount, v_cur, v_base, v_basecur, now())
    on conflict (user_id, category, effective_month) do update
      set amount = excluded.amount,
          currency = excluded.currency,
          amount_base = excluded.amount_base,
          base_currency = excluded.base_currency,
          updated_at = now();
  end if;
end;
$$;

revoke all on function public.kipu_upsert_budget_objective(jsonb) from public;
grant execute on function public.kipu_upsert_budget_objective(jsonb) to authenticated, service_role;
