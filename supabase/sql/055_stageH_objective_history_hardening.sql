-- Kipu — Stage H: make the objective history immutable BY PRIVILEGE, not by
-- convention (founder review round 4). Additive; 052-054 stay as applied.
--
-- WHY: 054 put the anchor inside kipu_upsert_budget_objective, but 052 had also
-- granted `authenticated` direct INSERT/UPDATE on objective_versions (with
-- permissive RLS). So the immutability was a convention any authenticated client
-- could walk around: write straight to the table and rewrite a past month, or
-- call the RPC with effective_month='2026-06' and rewrite it through the front
-- door. The RPCs also trusted two client-supplied facts — `effective_month` and
-- `is_objective` — that the SERVER already knows.
--
-- THE FIX, in three parts:
--   1. Revoke direct writes. Only the trusted functions may write history.
--   2. The functions become SECURITY DEFINER (the house pattern from 020's
--      kipu_reconcile_account_balance): they write as the table owner, so the
--      revoked grant cannot be bypassed, and they enforce ownership explicitly
--      because RLS no longer backstops them.
--   3. The server DERIVES what it knows: the effective month (from the user's
--      timezone — the SAME calendar the engine's tank walk uses) and whether a
--      category is an objective (food/transport). Client input is ignored.
-- Both RPCs then funnel through ONE private helper, so the anchor rule cannot
-- drift between the onboarding path and the chat path.

-- ── 1. Only the trusted functions write history ─────────────────────────────
-- TRUNCATE bypasses RLS entirely and would wipe EVERY user's history, so it goes
-- too (Supabase grants it to `authenticated` on every table by default; PostgREST
-- never exposes it, but this table's whole promise is immutability).
revoke insert, update, delete, truncate, references, trigger on public.objective_versions from authenticated;
drop policy if exists "objective_versions_insert_own" on public.objective_versions;
drop policy if exists "objective_versions_update_own" on public.objective_versions;
-- SELECT stays: a user may read their own history (RLS still scopes it).

-- ── 2. The user's month, derived server-side ────────────────────────────────
-- The user's OWN calendar, never the UTC server's: the same default the engine
-- falls back to (makeDayKey → America/Guayaquil) so a version can never be
-- stamped with a month the tank walk disagrees with.
create or replace function public.kipu__user_month(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_char(
    now() at time zone coalesce(nullif((select ue.timezone from public.user_engagement ue where ue.user_id = p_user), ''), 'America/Guayaquil'),
    'YYYY-MM'
  );
$$;

-- ── 3. THE one place history is written ─────────────────────────────────────
-- Shared by both RPCs so the anchor rule can never drift. Writes the CURRENT
-- month's decision, first preserving the previous value as an immutable ANCHOR
-- at the preceding month when it would otherwise be destroyed (i.e. when the
-- row being overwritten is the EARLIEST one a past month resolves to).
create or replace function public.kipu__objective_write(
  p_user uuid, p_cat text, p_amount numeric, p_cur text, p_base numeric, p_bcur text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month  text := public.kipu__user_month(p_user);
  v_prev   public.objective_versions%rowtype;
  v_anchor text;
begin
  if p_base is null or p_base < 0 then
    raise exception 'KIPU_VALIDATION: amount_base required (>= 0) for a versioned objective';
  end if;
  if p_bcur is null or p_bcur !~ '^[A-Za-z]{3}$' then
    raise exception 'KIPU_VALIDATION: base_currency required (ISO 3-letter) for a versioned objective';
  end if;

  select * into v_prev from public.objective_versions
   where user_id = p_user and category = p_cat and effective_month = v_month;

  if found
     and (v_prev.amount is distinct from p_amount
          or upper(v_prev.currency) is distinct from upper(p_cur)
          or v_prev.amount_base is distinct from p_base)
     and not exists (
       select 1 from public.objective_versions
        where user_id = p_user and category = p_cat and effective_month < v_month
     )
  then
    v_anchor := to_char((to_date(v_month || '-01', 'YYYY-MM-DD') - interval '1 month'), 'YYYY-MM');
    insert into public.objective_versions (user_id, category, effective_month, amount, currency, amount_base, base_currency)
    values (p_user, p_cat, v_anchor, v_prev.amount, v_prev.currency, v_prev.amount_base, v_prev.base_currency)
    on conflict (user_id, category, effective_month) do nothing;
  end if;

  insert into public.objective_versions (user_id, category, effective_month, amount, currency, amount_base, base_currency, updated_at)
  values (p_user, p_cat, v_month, p_amount, p_cur, p_base, p_bcur, now())
  on conflict (user_id, category, effective_month) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        amount_base = excluded.amount_base,
        base_currency = excluded.base_currency,
        updated_at = now();
end;
$$;

revoke all on function public.kipu__objective_write(uuid, text, numeric, text, numeric, text) from public;
revoke all on function public.kipu__user_month(uuid) from public;

-- ── 4. Chat path: set ONE category's budget (+ its version when it is an
--       objective). effective_month is NO LONGER accepted from the caller.
create or replace function public.kipu_upsert_budget_objective(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_user    uuid := nullif(p->>'user_id','')::uuid;
  v_cat     text := nullif(p->>'category','');
  v_amount  numeric := (p->>'amount')::numeric;
  v_cur     text := nullif(p->>'currency','');
  v_base    numeric := nullif(p->>'amount_base','')::numeric;
  v_basecur text := nullif(p->>'base_currency','');
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  -- SECURITY DEFINER: RLS no longer backstops us, so ownership is explicit.
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_cat is null then raise exception 'KIPU_VALIDATION: category required'; end if;
  if v_cur is null then raise exception 'KIPU_VALIDATION: currency required'; end if;
  if v_amount is null or v_amount < 0 then raise exception 'KIPU_VALIDATION: amount must be >= 0'; end if;

  insert into public.budget_categories (user_id, category, amount, currency, period, is_active)
  values (v_user, v_cat::public.financial_category, v_amount, v_cur, 'monthly', true)
  on conflict (user_id, category, period) do update
    set amount = excluded.amount, currency = excluded.currency, is_active = true;

  -- The SERVER decides what an objective is — never the caller.
  if v_cat in ('food', 'transport') and v_amount > 0 then
    perform public.kipu__objective_write(v_user, v_cat, v_amount, v_cur, v_base, v_basecur);
  end if;
end;
$$;

revoke all on function public.kipu_upsert_budget_objective(jsonb) from public;
grant execute on function public.kipu_upsert_budget_objective(jsonb) to authenticated, service_role;

-- ── 5. Onboarding path: the whole category-budget set in ONE transaction.
--       Neither effective_month nor is_objective is accepted from the caller.
create or replace function public.kipu_upsert_onboarding_budgets(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user   uuid := nullif(p->>'user_id','')::uuid;
  v_row    jsonb;
  v_cat    text;
  v_amount numeric;
  v_cur    text;
  v_base   numeric;
  v_bcur   text;
  v_seed   numeric;
  v_seedm  date;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if p->'rows' is null or jsonb_typeof(p->'rows') <> 'array' then
    raise exception 'KIPU_VALIDATION: rows[] required';
  end if;

  for v_row in select * from jsonb_array_elements(p->'rows') loop
    v_cat    := nullif(v_row->>'category','');
    v_amount := (v_row->>'amount')::numeric;
    v_cur    := nullif(v_row->>'currency','');
    v_base   := nullif(v_row->>'amount_base','')::numeric;
    v_bcur   := nullif(v_row->>'base_currency','');
    v_seed   := nullif(v_row->>'mtd_seed','')::numeric;
    v_seedm  := nullif(v_row->>'seed_month','')::date;

    if v_cat is null or v_cur is null then raise exception 'KIPU_VALIDATION: category and currency required'; end if;
    if v_amount is null or v_amount < 0 then raise exception 'KIPU_VALIDATION: amount must be >= 0'; end if;

    insert into public.budget_categories (user_id, category, amount, currency, period, is_active, mtd_seed, seed_month)
    values (v_user, v_cat::public.financial_category, v_amount, v_cur, 'monthly', true, v_seed, v_seedm)
    on conflict (user_id, category, period) do update
      set amount = excluded.amount, currency = excluded.currency, is_active = true,
          mtd_seed = excluded.mtd_seed, seed_month = excluded.seed_month;

    -- Server-derived, exactly like the chat path, through the SAME helper: an
    -- objective is born with its anchored, frozen first version or the whole
    -- onboarding write rolls back.
    if v_cat in ('food', 'transport') and v_amount > 0 then
      perform public.kipu__objective_write(v_user, v_cat, v_amount, v_cur, v_base, v_bcur);
    end if;
  end loop;
end;
$$;

revoke all on function public.kipu_upsert_onboarding_budgets(jsonb) from public;
grant execute on function public.kipu_upsert_onboarding_budgets(jsonb) to authenticated, service_role;
