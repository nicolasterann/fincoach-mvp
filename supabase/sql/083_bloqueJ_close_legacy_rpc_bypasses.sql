-- Kipu — Bloque J, cierre del rollout de la 082.
--
-- ORDEN OBLIGATORIO:
--   1) aplicar 082 (crea v2 sin romper el código desplegado);
--   2) desplegar el código que llama exclusivamente las v2;
--   3) aplicar ESTA 083;
--   4) correr el E2E J-7.
--
-- Separarlo evita dos fallos opuestos:
--   · revocar antes del deploy rompe el proceso viejo durante el rollout;
--   · no revocar nunca deja una puerta service_role que saltea las invariantes.

begin;

-- Activar este guard en 082 habría roto el deploy VIEJO durante la ventana de
-- rollout: ese código todavía actualiza monto/frecuencia/status de forma directa.
-- Recién aquí, con los callers v2 sirviendo, la convención se vuelve invariante.
-- Los dos RPC sancionados marcan su transacción localmente; todo otro UPDATE
-- monetario/de estado queda rechazado. Campos no monetarios siguen editables.
create or replace function public.kipu__guard_savings_plan_capacity_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active'
       and (
         round(coalesce(new.original_amount, new.amount_base, 0), 2) <= 0
         or round(coalesce(new.amount_base, 0), 2) <= 0
       )
    then
      raise exception 'KIPU_VALIDATION: an active savings plan requires a positive amount'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if current_setting('kipu.sanctioned_savings_plan_change', true) is distinct from '1'
  then
    raise exception 'KIPU_VALIDATION: savings plan amount, cadence and status require the atomic capacity writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

alter function public.kipu__guard_savings_plan_capacity_update()
  owner to postgres;
revoke all on function public.kipu__guard_savings_plan_capacity_update()
  from public, anon, authenticated, service_role;

drop trigger if exists savings_plans_capacity_update_guard
  on public.savings_plans;
create trigger savings_plans_capacity_update_guard
before update of original_amount, original_currency, amount_base, base_currency, frequency, status
on public.savings_plans
for each row execute function public.kipu__guard_savings_plan_capacity_update();

drop trigger if exists savings_plans_active_amount_insert_guard
  on public.savings_plans;
create trigger savings_plans_active_amount_insert_guard
before insert on public.savings_plans
for each row execute function public.kipu__guard_savings_plan_capacity_update();

revoke all on function public.kipu_publish_calendar_digest(
  uuid, uuid, uuid, text
) from service_role;

revoke all on function public.kipu_publish_objective_month_close(
  uuid, uuid, uuid, text, text, jsonb
) from service_role;

revoke all on function public.kipu_publish_ambient_coach_message(
  uuid, uuid, uuid, text, text, text
) from service_role;

revoke all on function public.kipu_add_shared_expense(jsonb)
  from service_role;
revoke all on function public.kipu_update_shared_expense(jsonb)
  from service_role;
revoke all on function public.kipu_set_card_statement(jsonb)
  from service_role;
revoke all on function public.kipu_override_debt_due(jsonb)
  from service_role;
revoke all on function public.kipu_apply_card_payment(jsonb, jsonb)
  from service_role;
revoke all on function public.kipu_reconcile_existing_card_payment(jsonb)
  from service_role;
revoke all on function public.kipu_apply_investment_occurrence(
  uuid, uuid, text, jsonb
) from service_role;
revoke all on function public.kipu_apply_repayment(jsonb, jsonb)
  from service_role;
revoke all on function public.kipu_settle_household(jsonb)
  from service_role;
revoke all on function public.kipu_update_debt_snapshot(jsonb)
  from service_role;
revoke all on function public.kipu_change_account_currency(jsonb)
  from service_role;
revoke all on function public.kipu_change_base_currency(jsonb)
  from service_role;

-- La frontera pública interna queda exclusivamente en las v2.
grant execute on function public.kipu_publish_calendar_digest_v2(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.kipu_publish_objective_month_close_v2(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;
grant execute on function public.kipu_publish_ambient_coach_message_v2(
  uuid, uuid, uuid, text, text, text
) to service_role;
grant execute on function public.kipu_add_shared_expense_v2(jsonb)
  to service_role;
grant execute on function public.kipu_update_shared_expense_v2(jsonb)
  to service_role;
grant execute on function public.kipu_set_card_statement_v2(jsonb)
  to service_role;
grant execute on function public.kipu_override_debt_due_v2(jsonb)
  to service_role;
grant execute on function public.kipu_apply_card_payment_v2(jsonb, jsonb)
  to service_role;
grant execute on function public.kipu_reconcile_existing_card_payment_v2(jsonb)
  to service_role;
grant execute on function public.kipu_apply_investment_occurrence_v2(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.kipu_apply_repayment_v2(jsonb, jsonb)
  to service_role;
grant execute on function public.kipu_settle_household_v2(jsonb)
  to service_role;
grant execute on function public.kipu_update_debt_snapshot_v2(jsonb)
  to service_role;
grant execute on function public.kipu_change_account_currency_v2(jsonb)
  to service_role;
grant execute on function public.kipu_change_base_currency_v2(jsonb)
  to service_role;

-- Todos los writers del producto para savings_plans usan service_role. Quitar
-- estas escrituras del cliente evita que un UPDATE directo vuelva a separar el
-- plan de su scalar de capacidad; SELECT autenticado permanece intacto.
revoke insert, update, delete on table public.savings_plans
  from authenticated;

commit;
