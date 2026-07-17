-- Kipu — Bloque I (re-auditoría): la devolución de un préstamo se vuelve ATÓMICA.
-- Aditiva; el single-writer del ledger (019/051) queda intacto — esta función lo
-- LLAMA, no lo duplica.
--
-- POR QUÉ: el flujo viejo registraba primero el ingreso en el ledger y DESPUÉS
-- descontaba el receivable con un update aparte, alimentado por una lectura que
-- colapsaba error→[]. Resultado posible: el movimiento registrado y el préstamo
-- figurando pendiente para siempre — o descontado dos veces en un reintento.
-- Ahora el caller LEE y castea antes (readOpenReceivables), calcula la asignación
-- exacta, y esta función hace ledger + descuentos en UNA transacción: o aterrizan
-- juntos, o ninguno.
--
-- p_entry: el payload EXACTO de kipu_apply_ledger_entry (mismo contrato).
-- p_allocations: [{receivable_id, amount, expected_outstanding}] — el
--   expected_outstanding es el CAS: si el receivable cambió entre la lectura y
--   esta llamada, TODO se revierte (40001) y el caller re-lee. Un conflicto
--   cuesta un reintento, nunca una devolución a medias.
create or replace function public.kipu_apply_repayment(p_entry jsonb, p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := nullif(p_entry->>'user_id','')::uuid;
  v_tx      uuid;
  v_alloc   jsonb;
  v_id      uuid;
  v_amt     numeric;
  v_expected numeric;
  v_new     numeric;
  v_matched numeric := 0;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'KIPU_VALIDATION: allocations[] required';
  end if;

  v_tx := public.kipu_apply_ledger_entry(p_entry);

  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    v_id       := nullif(v_alloc->>'receivable_id','')::uuid;
    v_amt      := (v_alloc->>'amount')::numeric;
    v_expected := (v_alloc->>'expected_outstanding')::numeric;
    if v_id is null or v_amt is null or v_amt <= 0 or v_expected is null then
      raise exception 'KIPU_VALIDATION: allocation malformed';
    end if;
    if v_amt > v_expected + 0.005 then
      raise exception 'KIPU_VALIDATION: allocation exceeds outstanding';
    end if;
    v_new := round(greatest(v_expected - v_amt, 0), 2);
    update public.receivables
       set outstanding_amount = v_new,
           status = case when v_new <= 0.005 then 'settled' else 'partial' end
     where id = v_id
       and user_id = v_user
       and outstanding_amount = v_expected
       and status in ('open','partial');
    if not found then
      raise exception 'KIPU_CONFLICT: receivable % changed since read', v_id using errcode = '40001';
    end if;
    v_matched := v_matched + v_amt;
  end loop;

  return jsonb_build_object('transaction_id', v_tx, 'matched', round(v_matched, 2));
end;
$$;

revoke all on function public.kipu_apply_repayment(jsonb, jsonb) from public;
grant execute on function public.kipu_apply_repayment(jsonb, jsonb) to service_role;
