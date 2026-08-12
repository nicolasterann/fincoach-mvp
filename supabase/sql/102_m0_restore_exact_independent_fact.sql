-- Migration 102 — M0: reopening an occurrence must restore the exact live
-- independent fact, never an arbitrary historical version.
--
-- APPLIED 2026-08-03 after migrations 100 and 101. This file is historical and
-- must not be rewritten; migration 103 hardens its legacy numeric decoder.
--
-- The first PostgreSQL audit exposed an intermittent failure in M100.15a/b.
-- `kipu__publish_card_statement_fact` gave every correction of one statement
-- cycle the cycle row's immutable `created_at` as `observed_at`. Reopening a
-- terminal occurrence then selected a bank fact by
--   observed_at desc, id desc
-- so two versions tied on time and a random UUID decided whether the current
-- amount or an older amount became authoritative again.
--
-- The repaired contract is chain based:
--   1. serialize on the same fact-identity advisory lock as the fact writer;
--   2. if an independent bank fact is already current, preserve it;
--   3. otherwise restore the exact independent predecessor superseded by the
--      occurrence-resolution fact being retired;
--   4. only for legacy/incomplete chains, restore a bank fact whose complete
--      monetary payload still matches the live statement row — never infer
--      truth from UUID or tied timestamps;
--   5. future statement corrections use their actual publication time as
--      observed_at instead of the cycle's birth time.

create or replace function public.kipu__publish_terminal_occurrence_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_result jsonb;
  v_retired_resolution uuid;
  v_exact_predecessor uuid;
  v_restored_fact uuid;
begin
  if new.status not in ('confirmed','corrected','skipped','dismissed') then
    if tg_op = 'UPDATE'
       and old.status in ('confirmed','corrected','skipped','dismissed') then
      -- K-102: use the same identity lock as kipu_record_financial_fact. A
      -- concurrent statement correction and a reopen must agree on one chain,
      -- rather than each publishing from a different snapshot.
      perform pg_advisory_xact_lock(hashtextextended(
        new.user_id::text || ':' || new.satisfaction_kind || ':' ||
        new.satisfaction_entity_type || ':' ||
        new.satisfaction_entity_id || ':' || new.satisfaction_cycle_key,
        0
      ));

      -- Remember the exact independent fact that this resolution superseded.
      -- It is the strongest restoration witness when no newer independent fact
      -- has since become current.
      select f.id, f.supersedes_fact_id
        into v_retired_resolution, v_exact_predecessor
        from public.financial_facts f
       where f.user_id = new.user_id
         and f.fact_kind = new.satisfaction_kind
         and f.entity_type = new.satisfaction_entity_type
         and f.entity_id = new.satisfaction_entity_id
         and f.cycle_key = new.satisfaction_cycle_key
         and f.source_type = 'recurring_occurrence'
         and f.source_id = new.id::text
         and f.is_current
       for update;

      -- Retire only facts whose evidence was this resolution. A separate bank
      -- statement or other durable source for the same identity remains valid.
      update public.financial_facts f
         set is_current = false
       where f.user_id = new.user_id
         and f.source_type = 'recurring_occurrence'
         and f.source_id = new.id::text
         and f.is_current;

      -- Prefer a bank fact that independently became current after the
      -- resolution. Otherwise restore the exact predecessor from the chain.
      select f.id into v_restored_fact
        from public.financial_facts f
        join public.debt_statement_cycles s
          on f.source_type = 'debt_statement_cycle'
         and f.source_id = s.id::text
         and s.user_id = f.user_id
         and s.debt_account_id::text = f.entity_id
         and s.applied and s.is_current and s.statement_date is not null
         and to_char(s.statement_date,'YYYY-MM') = f.cycle_key
       where f.user_id = new.user_id
         and f.fact_kind = new.satisfaction_kind
         and f.entity_type = new.satisfaction_entity_type
         and f.entity_id = new.satisfaction_entity_id
         and f.cycle_key = new.satisfaction_cycle_key
         and (f.is_current or f.id = v_exact_predecessor)
       order by f.is_current desc,
                (f.id = v_exact_predecessor) desc,
                f.created_at desc,
                f.id desc
       limit 1
       for update of f;

      -- Legacy fallback: a pre-M0 or partially linked chain may not expose the
      -- predecessor. Source-row liveness alone is not enough: multiple facts
      -- can point to the same corrected statement row. Restore only a fact
      -- whose complete payload still agrees with the live monetary truth. If
      -- no such witness exists, leaving the occurrence unlinked is safer than
      -- reviving an arbitrary historical version.
      if v_restored_fact is null then
        select f.id into v_restored_fact
          from public.financial_facts f
          join public.debt_statement_cycles s
            on f.source_type = 'debt_statement_cycle'
           and f.source_id = s.id::text
           and s.user_id = f.user_id
           and s.debt_account_id::text = f.entity_id
           and s.applied and s.is_current and s.statement_date is not null
           and to_char(s.statement_date,'YYYY-MM') = f.cycle_key
          join public.debt_accounts d
            on d.id = s.debt_account_id
           and d.user_id = s.user_id
         where f.user_id = new.user_id
           and f.fact_kind = new.satisfaction_kind
           and f.entity_type = new.satisfaction_entity_type
           and f.entity_id = new.satisfaction_entity_id
           and f.cycle_key = new.satisfaction_cycle_key
           and (f.payload->>'amount') ~ '^[0-9]+([.][0-9]+)?$'
           and round((f.payload->>'amount')::numeric,2) = round(s.full_payment_due,2)
           and upper(f.payload->>'currency') = upper(d.currency::text)
           and f.payload->>'statement_date' = s.statement_date::text
           and (f.payload->>'due_day') is not distinct from s.due_day::text
         order by f.created_at desc
         limit 1
         for update of f;
      end if;

      if v_restored_fact is not null then
        update public.financial_facts
           set is_current = true, superseded_by_fact_id = null
         where id = v_restored_fact;
      end if;
      update public.recurring_occurrences o
         set satisfied_fact_id = v_restored_fact,
             satisfied_at = case
               when v_restored_fact is null then null
               else now()
             end
       where o.user_id = new.user_id
         and o.satisfaction_kind = new.satisfaction_kind
         and o.satisfaction_entity_type = new.satisfaction_entity_type
         and o.satisfaction_entity_id = new.satisfaction_entity_id
         and o.satisfaction_cycle_key = new.satisfaction_cycle_key;
    end if;
    return new;
  end if;
  v_payload := jsonb_build_object(
    'status',new.status,
    'amount',new.resolved_amount,
    'currency',new.resolved_currency,
    'transaction_id',new.created_transaction_id
  );
  v_result := public.kipu_record_financial_fact(jsonb_build_object(
    'user_id',new.user_id,
    'dedupe_key','occurrence:' || new.id::text || ':' || md5(v_payload::text),
    'fact_kind',new.satisfaction_kind,
    'entity_type',new.satisfaction_entity_type,
    'entity_id',new.satisfaction_entity_id,
    'cycle_key',new.satisfaction_cycle_key,
    'source_type','recurring_occurrence',
    'source_id',new.id,
    'provenance','occurrence_resolution',
    'payload',v_payload,
    'observed_at',coalesce(new.resolved_at,now())
  ));
  return new;
end;
$$;

create or replace function public.kipu__publish_card_statement_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_currency text;
declare v_result jsonb;
declare v_payload jsonb;
begin
  if not new.applied or not new.is_current or new.statement_date is null
     or new.full_payment_due is null then
    return new;
  end if;
  select upper(currency) into v_currency
    from public.debt_accounts
   where id = new.debt_account_id and user_id = new.user_id;
  if v_currency is null then
    raise exception 'KIPU_OWNERSHIP: statement card not owned'
      using errcode = '42501';
  end if;
  v_payload := jsonb_build_object(
    'amount',round(new.full_payment_due,2),
    'currency',v_currency,
    'statement_date',new.statement_date,
    'due_day',new.due_day
  );
  v_result := public.kipu_record_financial_fact(jsonb_build_object(
    'user_id',new.user_id,
    'dedupe_key','statement-cycle:' || new.id::text || ':' || md5(v_payload::text),
    'fact_kind','card_statement',
    'entity_type','debt_account',
    'entity_id',new.debt_account_id,
    'cycle_key',to_char(new.statement_date,'YYYY-MM'),
    'source_type','debt_statement_cycle',
    'source_id',new.id,
    'provenance','statement_writer',
    'payload',v_payload,
    -- K-102: a correction is observed when that corrected evidence is
    -- published, not when the statement-cycle row was first created.
    'observed_at',now()
  ));
  return new;
end;
$$;

alter function public.kipu__publish_terminal_occurrence_fact() owner to postgres;
alter function public.kipu__publish_card_statement_fact() owner to postgres;
revoke all on function public.kipu__publish_terminal_occurrence_fact()
  from public, anon, authenticated, service_role;
revoke all on function public.kipu__publish_card_statement_fact()
  from public, anon, authenticated, service_role;
