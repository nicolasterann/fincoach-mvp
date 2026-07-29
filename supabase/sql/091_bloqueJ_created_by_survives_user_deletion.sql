-- Kipu — Bloque J. Un esquema no puede pedir dos cosas incompatibles.
--
-- `shared_expenses.created_by` y `household_settlements.created_by` (027, líneas
-- 83 y 114) son `NOT NULL` y a la vez `references auth.users(id) ON DELETE SET
-- NULL`. Las dos reglas se contradicen: al borrar al usuario, PostgreSQL
-- EJECUTA el `SET NULL` y el `NOT NULL` lo aborta. Consecuencia real: cualquier
-- miembro que haya creado un gasto compartido o una liquidación —en su hogar o
-- en uno ajeno— NO PUEDE eliminar su cuenta, y el fallo llega como error crudo
-- desde dentro del cascade, no como una negativa entendible.
--
-- La intención del esquema es la que gana, porque es la que el propio FK
-- declara: **la historia del hogar se conserva y pierde su autor**. Un gasto
-- compartido pertenece al grupo, no sólo a quien lo tecleó; borrarlo en cascada
-- reescribiría las cuentas de los demás. Así que la que cede es la restricción
-- `NOT NULL`, no la acción referencial.
--
-- Pero ceder en la COLUMNA no es ceder en el WRITE: ningún writer puede insertar
-- una fila sin autor. Eso se sostiene con un guard de INSERT, igual que la 090
-- distingue «lo hizo la acción referencial» de «lo hizo un llamador». Las RPC
-- (`kipu_add_shared_expense_v2`, `kipu_mark_reimbursement_paid` y sus fronteras
-- idempotentes de la 088) ya exigen `created_by = actor`; el guard es la red que
-- impide que un writer futuro lo omita ahora que la columna lo permitiría.
--
-- Barrido: éstas son las DOS únicas columnas del esquema con el par
-- contradictorio (NOT NULL + ON DELETE SET NULL). Las sondas verifican que sigan
-- siendo cero.

begin;

alter table public.shared_expenses
  alter column created_by drop not null;
alter table public.household_settlements
  alter column created_by drop not null;

create or replace function public.kipu__require_author_on_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.created_by is null then
    raise exception using
      errcode = '22023',
      message = 'KIPU_VALIDATION: created_by is required when the row is written';
  end if;
  return new;
end;
$$;

alter function public.kipu__require_author_on_insert() owner to postgres;
revoke all on function public.kipu__require_author_on_insert()
  from public, anon, authenticated;

drop trigger if exists shared_expenses_require_author on public.shared_expenses;
create trigger shared_expenses_require_author
before insert on public.shared_expenses
for each row execute function public.kipu__require_author_on_insert();

drop trigger if exists household_settlements_require_author
  on public.household_settlements;
create trigger household_settlements_require_author
before insert on public.household_settlements
for each row execute function public.kipu__require_author_on_insert();

commit;
