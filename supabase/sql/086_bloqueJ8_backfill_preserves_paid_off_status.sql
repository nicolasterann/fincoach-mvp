-- Kipu — Bloque J-8. Auditoría de Codex sobre mi corrección (punto 3).
-- APLICADA 2026-07-28. Contenido EXACTO de lo ejecutado.
--
-- El backfill de cuotas de la 084 marcaba `status='cancelled'` para todo plan
-- cuya compra tuviera una reversa. Yo lo acoté con `and p.paid_off_at is null`,
-- pero el esquema 049 declara:
--
--     status text not null default 'active' check (status in ('active','cancelled','paid_off')),
--     paid_off_at date,          -- nullable, SIN constraint que lo ate al status
--
-- así que un plan puede estar `status='paid_off'` con `paid_off_at` NULO y mi
-- condición no lo protegía: la liquidación se perdía igual. Mirar UN solo indicio
-- de un hecho que el esquema representa de DOS formas es la misma clase de error
-- que vengo corrigiendo — proteger una invariante con una convención.
--
-- Se rehace el backfill preservando CUALQUIERA de los dos indicios. Idempotente:
-- sólo toca planes que hoy están 'active' con su compra revertida. En producción
-- hay 0 planes de cuotas, así que esto es reproducibilidad de la cadena, no
-- reparación de datos.
with historic_reversals as (
  select distinct on (a.id)
    a.id as application_id,
    a.installment_plan_id
  from public.installment_plan_purchase_applications a
  join public.transactions r
    on r.user_id = a.user_id
   and r.type = 'reversal'
   and r.related_transaction_id = a.transaction_id
  order by a.id, r.created_at, r.id
)
update public.installment_plans p
   set status = 'cancelled'
 where p.id in (select installment_plan_id from historic_reversals)
   and p.status = 'active'
   and p.paid_off_at is null;
