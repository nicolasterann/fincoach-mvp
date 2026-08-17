-- M0.11A — closing a paid card must distinguish CURRENT obligation from the
-- historical statement snapshot.
--
-- Card payment intentionally preserves statement_total_due/minimum_payment as
-- facts about the cycle while setting full_payment_due=0 and
-- statement_covered=true. The v84 close writer treated those historical
-- figures as live debt, so a four-card manifest could pay every card and then
-- refuse to close all four. Current native/base balances always remain hard
-- blockers. Historical cycle figures stop blocking only for a credit card
-- whose server-owned covered flag and remaining due prove the cycle settled.

begin;

create or replace function public.kipu_close_debt_account_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_row public.debt_accounts%rowtype;
  v_statement_total numeric;
  v_cycle_settled boolean;
begin
  if v_user is null or v_debt is null then
    raise exception 'KIPU_VALIDATION: user/debt required'
      using errcode = '22023';
  end if;
  select * into v_row
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: debt account not found/not owned'
      using errcode = '42501';
  end if;
  v_statement_total := coalesce(
    nullif(to_jsonb(v_row)->>'statement_total_due','')::numeric,
    0
  );
  v_cycle_settled :=
    v_row.type::text = 'credit_card'
    and v_row.statement_covered is true
    and abs(coalesce(v_row.full_payment_due,0)) <= 0.005;

  if abs(coalesce(v_row.current_balance_original,0)) > 0.005
     or abs(coalesce(v_row.current_balance_base,0)) > 0.005
     or (
       not v_cycle_settled
       and (
         abs(coalesce(v_row.full_payment_due,0)) > 0.005
         or abs(coalesce(v_row.minimum_payment,0)) > 0.005
         or abs(v_statement_total) > 0.005
       )
     )
  then
    return jsonb_build_object(
      'outcome',
      case when v_row.status = 'closed' then 'closed_with_debt_requires_review'
           else 'outstanding_debt_requires_payment' end,
      'debt_account_id',v_debt
    );
  end if;
  if v_row.status = 'closed' then
    return jsonb_build_object('outcome','already_closed','debt_account_id',v_debt);
  end if;
  update public.debt_accounts
     set status = 'closed'
   where id = v_debt and user_id = v_user;
  return jsonb_build_object('outcome','closed','debt_account_id',v_debt);
end;
$$;

alter function public.kipu_close_debt_account_v2(jsonb) owner to postgres;
revoke all on function public.kipu_close_debt_account_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_close_debt_account_v2(jsonb)
  to service_role;

comment on function public.kipu_close_debt_account_v2(jsonb) is
  'M0.11A v114: locks the owned debt; current balances always block closing, while a covered credit-card cycle may retain historical statement/minimum figures without masquerading as live debt.';

commit;
