-- Kipu — Stage H: make the objective's history GENUINELY immutable (founder
-- review round 3). Additive; 052 and 053 stay untouched (already applied).
--
-- WHY THIS EXISTS — three leaks survived round 2:
--
-- (A) THE ANCHOR. objective_versions is keyed (user, category, effective_month),
--     so changing the objective DURING its first month OVERWRITES the only row
--     that months before it resolve to. Seed July=500 → change to 900 in July →
--     the "earliest version" becomes July=900 → June is measured against 900 and
--     the excess that already drained the Saldo moves. Resolving differently in
--     TS cannot fix a write path that destroys the value. Fix: before the first
--     version of a category is overwritten, the RPC atomically preserves the OLD
--     value as an ANCHOR at the preceding month. The anchor is never touched
--     again, so every month before the first decision has an immutable answer.
--
-- (B) THE FREEZE MUST EXIST. A version with a NULL amount_base falls back to a
--     live rate, so FX still rewrites history. 053 added the columns but nothing
--     backfilled them: on a clean 052→053 install every seeded row stays NULL.
--     Fix: backfill here (honestly, or fail loudly), then FORBID null forever.
--
-- (C) THE WRITER MUST GUARANTEE IT. If the RPC accepts a version without a
--     frozen equivalence, (B) reopens the next day. Fix: reject it.
--
-- Data-wise this is a no-op on the current production DB (already backfilled by
-- hand): the UPDATEs match 0 rows and the checks pass. It is the CLEAN-INSTALL
-- and replay path that needs it.

-- ── 1. Backfill: same-currency versions are their own base ───────────────────
update public.objective_versions ov
   set amount_base = ov.amount,
       base_currency = upper(p.base_currency)
  from public.profiles p
 where p.id = ov.user_id
   and (ov.amount_base is null or ov.base_currency is null)
   and upper(ov.currency) = upper(p.base_currency);

-- ── 2. Backfill: foreign-currency versions, using ONLY the user's own trusted
--       rates — direct (native→base) or inverse (base→native), mirroring
--       findRate() in src/lib/fx/fx-rates.ts. NO triangulation, NO invented 1:1.
--       Ties resolve by source rank then recency, exactly like the TS reader.
with ranked as (
  select ov.id,
         ov.amount,
         upper(p.base_currency) as base_cur,
         fr.rate,
         case when upper(fr.base_currency) = upper(ov.currency) then 1 else 0 end as is_direct,
         row_number() over (
           partition by ov.id
           order by case lower(fr.source)
                      when 'manual' then 4 when 'historical' then 3
                      when 'provider' then 2 when 'cached' then 1 else 0 end desc,
                    fr.as_of desc nulls last
         ) as rn
    from public.objective_versions ov
    join public.profiles p on p.id = ov.user_id
    join public.fx_rates fr
      on fr.user_id = ov.user_id
     and fr.rate > 0
     and (
          (upper(fr.base_currency) = upper(ov.currency) and upper(fr.quote_currency) = upper(p.base_currency))
       or (upper(fr.base_currency) = upper(p.base_currency) and upper(fr.quote_currency) = upper(ov.currency))
     )
   where (ov.amount_base is null or ov.base_currency is null)
     and upper(ov.currency) <> upper(p.base_currency)
)
update public.objective_versions ov
   set amount_base = round(ranked.amount * (case when ranked.is_direct = 1 then ranked.rate else 1 / ranked.rate end), 2),
       base_currency = ranked.base_cur
  from ranked
 where ranked.id = ov.id
   and ranked.rn = 1;

-- ── 3. Fail LOUDLY rather than freeze a lie. A version we cannot value honestly
--       must stop the migration: the operator resolves the rate, then re-runs
--       (this file is idempotent).
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.objective_versions
   where amount_base is null or base_currency is null;
  if v_bad > 0 then
    raise exception 'KIPU_MIGRATION_054: % objective_versions row(s) have no trusted FX rate to freeze against. Kipu never invents a rate: add the missing fx_rates for those users and re-run this migration.', v_bad;
  end if;
end $$;

-- ── 4. Invariants: a version can never again exist unfrozen or nonsensical ───
alter table public.objective_versions
  alter column amount_base set not null,
  alter column base_currency set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'objective_versions_amount_base_nonneg') then
    alter table public.objective_versions
      add constraint objective_versions_amount_base_nonneg check (amount_base >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'objective_versions_base_currency_iso') then
    alter table public.objective_versions
      add constraint objective_versions_base_currency_iso check (base_currency ~ '^[A-Za-z]{3}$');
  end if;
end $$;

-- ── 5. The writer: atomic anchor + mandatory freeze ─────────────────────────
-- p = { user_id, category, amount, currency, effective_month?, amount_base?, base_currency? }
-- effective_month omitted → only the budget pointer moves (non-objective
-- categories keep exactly the old behavior, no version written).
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
  v_prev    public.objective_versions%rowtype;
  v_anchor  text;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_cat is null then raise exception 'KIPU_VALIDATION: category required'; end if;
  if v_cur is null then raise exception 'KIPU_VALIDATION: currency required'; end if;
  if v_amount is null or v_amount < 0 then raise exception 'KIPU_VALIDATION: amount must be >= 0'; end if;

  insert into public.budget_categories (user_id, category, amount, currency, period, is_active)
  values (v_user, v_cat::public.financial_category, v_amount, v_cur, 'monthly', true)
  on conflict (user_id, category, period) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        is_active = true;

  if v_month is null then
    return; -- budget-only category: no history to keep
  end if;

  if v_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'KIPU_VALIDATION: effective_month must be YYYY-MM';
  end if;
  -- A version with no frozen equivalence would silently fall back to a live rate
  -- and let FX rewrite history. Refuse it (and roll the budget write back with it).
  if v_base is null or v_base < 0 then
    raise exception 'KIPU_VALIDATION: amount_base required (>= 0) for a versioned objective';
  end if;
  if v_basecur is null or v_basecur !~ '^[A-Za-z]{3}$' then
    raise exception 'KIPU_VALIDATION: base_currency required (ISO 3-letter) for a versioned objective';
  end if;

  -- ANCHOR: if we are about to overwrite the EARLIEST recorded decision with a
  -- different value, first preserve the old one at the preceding month. Every
  -- month before the first decision then resolves to a row that no later change
  -- can touch. Only fires when no earlier row exists (otherwise the past already
  -- has an immutable answer) and only for a REAL change (idempotent retries and
  -- same-value rewrites create nothing).
  select * into v_prev from public.objective_versions
   where user_id = v_user and category = v_cat and effective_month = v_month;

  if found
     and (v_prev.amount is distinct from v_amount
          or upper(v_prev.currency) is distinct from upper(v_cur)
          or v_prev.amount_base is distinct from v_base)
     and not exists (
       select 1 from public.objective_versions
        where user_id = v_user and category = v_cat and effective_month < v_month
     )
  then
    v_anchor := to_char((to_date(v_month || '-01', 'YYYY-MM-DD') - interval '1 month'), 'YYYY-MM');
    insert into public.objective_versions (
      user_id, category, effective_month, amount, currency, amount_base, base_currency
    ) values (
      v_user, v_cat, v_anchor, v_prev.amount, v_prev.currency, v_prev.amount_base, v_prev.base_currency
    )
    on conflict (user_id, category, effective_month) do nothing;
  end if;

  insert into public.objective_versions (user_id, category, effective_month, amount, currency, amount_base, base_currency, updated_at)
  values (v_user, v_cat, v_month, v_amount, v_cur, v_base, v_basecur, now())
  on conflict (user_id, category, effective_month) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        amount_base = excluded.amount_base,
        base_currency = excluded.base_currency,
        updated_at = now();
end;
$$;

revoke all on function public.kipu_upsert_budget_objective(jsonb) from public;
grant execute on function public.kipu_upsert_budget_objective(jsonb) to authenticated, service_role;

-- ── 6. Onboarding writes the whole category-budget set + first versions in ONE
--       transaction. A budget that lands without its version leaves a month the
--       Saldo can never reconstruct honestly, so "best effort" is not an option:
--       all of it commits, or none of it does.
-- p = { user_id, effective_month, rows: [ { category, amount, currency, amount_base,
--       base_currency, mtd_seed?, seed_month?, is_objective } ] }
create or replace function public.kipu_upsert_onboarding_budgets(p jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user   uuid := nullif(p->>'user_id','')::uuid;
  v_month  text := nullif(p->>'effective_month','');
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
  if v_month is null or v_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'KIPU_VALIDATION: effective_month (YYYY-MM) required';
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
      set amount = excluded.amount,
          currency = excluded.currency,
          is_active = true,
          mtd_seed = excluded.mtd_seed,
          seed_month = excluded.seed_month;

    -- An objective is BORN with its first version, frozen, in this same
    -- transaction. Idempotent: re-running onboarding rewrites the same month.
    if (v_row->>'is_objective') = 'true' and v_amount > 0 then
      if v_base is null or v_base < 0 or v_bcur is null or v_bcur !~ '^[A-Za-z]{3}$' then
        raise exception 'KIPU_VALIDATION: amount_base/base_currency required for objective %', v_cat;
      end if;
      insert into public.objective_versions (user_id, category, effective_month, amount, currency, amount_base, base_currency, updated_at)
      values (v_user, v_cat, v_month, v_amount, v_cur, v_base, v_bcur, now())
      on conflict (user_id, category, effective_month) do update
        set amount = excluded.amount,
            currency = excluded.currency,
            amount_base = excluded.amount_base,
            base_currency = excluded.base_currency,
            updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.kipu_upsert_onboarding_budgets(jsonb) from public;
grant execute on function public.kipu_upsert_onboarding_budgets(jsonb) to authenticated, service_role;
