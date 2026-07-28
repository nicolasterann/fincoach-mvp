-- Kipu — Bloque J-8. Auditoría de Claude sobre la 084, sonda P1 contra la base real.
--
-- APLICADA 2026-07-28 (registrada en schema_migrations como
-- `085_bloqueJ8_fix_multi_source_loan_bridge`). Este archivo es el contenido
-- EXACTO que se ejecutó.
--
-- Nota de reproducibilidad: la 084 se aplicó a mano por el editor SQL de
-- Supabase, así que NO figura en `schema_migrations`. La cadena real es
-- 084 (manual) → 085 (esta). La 084 conserva su defecto a propósito: una
-- migración aplicada no se reescribe, se corrige con la siguiente.
--
-- EL DEFECTO: el pago multifuente —la pieza central de la 084 y el arreglo del
-- bug original del founder— fallaba en su CAMINO FELIZ:
--
--     KIPU_VALIDATION: adjustment must not set debt/goal
--
-- El puente de los fondos prestados se construye como `adjustment` y etiquetaba
-- `debt_account_id` con el préstamo. El validador del ledger
-- (051_stageH_objetivo_mensual.sql, línea 212) exige que un `adjustment` toque
-- exactamente UN lado y prohíbe debt/goal, así que la operación ENTERA abortaba.
-- La 084 nunca se había ejecutado contra Postgres, y ningún gate estático podía
-- verlo: es una invariante que vive dentro de OTRA función SQL.
--
-- El campo era además REDUNDANTE: el aumento del préstamo ya se aplica con su
-- propio UPDATE dentro de la misma transacción, y el vínculo auditable vive en
-- `card_payment_group_legs` (préstamo, cuenta puente, transacción de fondos y
-- transacción del pago), que es lo que usa la reversa. No se pierde trazabilidad.
--
-- El cuerpo nuevo se DERIVA del vivo y la migración aborta si no sustituye
-- exactamente una vez — cero transcripción manual de 2449 líneas.

do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kipu_apply_card_payment_multi_source';
  if v_def is null then
    raise exception 'KIPU_MIGRATION: kipu_apply_card_payment_multi_source no existe';
  end if;

  v_new := replace(
    v_def,
    E'        ''destination_account_id'', v_clearing,\n        ''debt_account_id'', v_instrument,\n',
    E'        ''destination_account_id'', v_clearing,\n'
  );
  if v_new = v_def then
    raise exception 'KIPU_MIGRATION: no se encontró el puente a corregir';
  end if;
  if position('''debt_account_id'', v_instrument,' in v_new) > 0 then
    raise exception 'KIPU_MIGRATION: quedó otra etiqueta debt_account_id en el puente';
  end if;
  execute v_new;
end
$mig$;

alter function public.kipu_apply_card_payment_multi_source(jsonb) owner to postgres;
revoke all on function public.kipu_apply_card_payment_multi_source(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment_multi_source(jsonb) to service_role;
