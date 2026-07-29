-- Kipu — Bloque J. Corrección de la 088 (aplicada; no se reescribe).
--
-- `kipu__shared_goal_currency_guard` levantaba
-- `KIPU_VALIDATION: shared goal requires household` cuando una meta compartida
-- se quedaba sin `household_id`. Pero `goals.household_id` es
-- **ON DELETE SET NULL**: borrar un hogar hace que PostgreSQL ejecute
-- exactamente ese UPDATE. Resultado: cualquier hogar que alguna vez tuvo una
-- meta compartida quedaba IMPOSIBLE de borrar, y el borrado del usuario dueño
-- también, porque la acción referencial abortaba dentro del propio cascade.
--
-- Es la regla del proyecto, otra vez: **un rechazo cuyo remedio no está en la
-- pantalla es un cerrojo, no un guard.** El usuario no elige ese UPDATE, no lo
-- ve, y no existe superficie para «desmarcar la meta como compartida antes de
-- borrar el hogar».
--
-- La invariante real que había que sostener es «no existe meta compartida sin
-- hogar». Degradar la fila la sostiene igual de bien que abortar, sin crear el
-- cerrojo: una meta sin hogar NO es una meta compartida. El INSERT conserva el
-- rechazo estricto, porque ahí sí es un error del llamador con remedio a mano.
--
-- La comprobación de moneda —el motivo por el que la 088 añadió este trigger—
-- queda intacta.

begin;

create or replace function public.kipu__shared_goal_currency_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
begin
  if coalesce(new.is_shared,false) is not true then
    return new;
  end if;
  if new.household_id is null then
    if tg_op = 'INSERT' then
      raise exception 'KIPU_VALIDATION: shared goal requires household'
        using errcode = '22023';
    end if;
    -- Cascade de borrado del hogar (ON DELETE SET NULL) o desvinculación
    -- explícita: la meta deja de ser compartida en la MISMA operación.
    new.is_shared := false;
    return new;
  end if;
  select upper(base_currency) into v_base
    from public.households
   where id = new.household_id
   for no key update;
  if not found or upper(coalesce(new.currency,'')) <> v_base then
    raise exception 'KIPU_VALIDATION: shared goal currency must equal household base'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

alter function public.kipu__shared_goal_currency_guard() owner to postgres;
revoke all on function public.kipu__shared_goal_currency_guard()
  from public, anon, authenticated, service_role;

commit;
