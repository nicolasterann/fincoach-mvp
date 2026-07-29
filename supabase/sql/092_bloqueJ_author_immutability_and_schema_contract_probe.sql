-- Kipu — Bloque J. Tres huecos que dejó la 091, señalados por el founder.
--
-- 1. «La columna cede, el write no» sólo era cierto para ALTAS. El guard de la
--    091 es BEFORE INSERT, así que un writer con service_role todavía podía
--    hacer `update shared_expenses set created_by = null`. Ningún caller lo
--    hace hoy, pero la afirmación era más amplia que la defensa.
--
--    CONTRATO, explícito de aquí en adelante: `created_by` es INMUTABLE. Su
--    único valor legítimo distinto del original es NULL, y sólo cuando lo pone
--    la acción referencial porque el usuario autor fue eliminado. Un UPDATE
--    administrativo a NULL con el autor VIVO no es válido, y reescribir la
--    autoría hacia otra persona tampoco: la historia del hogar dice quién la
--    creó, o dice que esa cuenta ya no existe — nunca dice otra cosa.
--
--    Cómo se distingue una cosa de la otra sin recrear el cerrojo que la 091
--    eliminó: cuando corre el `ON DELETE SET NULL`, la fila de `auth.users` YA
--    fue borrada dentro de esa misma transacción (las acciones referenciales
--    son AFTER DELETE). Así que «el autor viejo ya no existe» es exactamente la
--    firma del cascade, y «el autor viejo sigue existiendo» es exactamente la
--    firma de un UPDATE manual. La sonda F1 sigue probando el cascade completo:
--    si este trigger se equivocara, F1 fallaría en vez de pasar.
--
-- 2. El barrido de CLASE no era una prueba. Vivía como regex por LÍNEA en el
--    capture gate, así que no veía un `foreign key (...) references ... on
--    delete set null` repartido en varias líneas ni un FK añadido después por
--    ALTER TABLE. Es el mismo sobreclaim que corrigió la 072 (una regex sobre
--    el nombre de la columna no puede garantizar completitud). La autoridad
--    pasa al CATÁLOGO, consultable por la sonda.
--
-- 3. El segundo guard de la 091 no estaba probado, y un reporte de catálogo es
--    también la forma de exigir que ambos sigan instalados y ACTIVOS.

begin;

create or replace function public.kipu__author_immutability_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not distinct from old.created_by then
    return new;
  end if;
  -- El autor viejo desapareció ⇒ esto es el `ON DELETE SET NULL`. Único cambio
  -- permitido, y sólo hacia NULL.
  if old.created_by is not null
     and not exists (select 1 from auth.users u where u.id = old.created_by)
  then
    if new.created_by is null then
      return new;
    end if;
    raise exception using
      errcode = '22023',
      message = 'KIPU_VALIDATION: a deleted author can only become NULL, never another user';
  end if;
  raise exception using
    errcode = '22023',
    message = 'KIPU_VALIDATION: created_by is immutable while its author exists';
end;
$$;

alter function public.kipu__author_immutability_guard() owner to postgres;
revoke all on function public.kipu__author_immutability_guard()
  from public, anon, authenticated;

drop trigger if exists shared_expenses_author_immutable on public.shared_expenses;
create trigger shared_expenses_author_immutable
before update of created_by on public.shared_expenses
for each row execute function public.kipu__author_immutability_guard();

drop trigger if exists household_settlements_author_immutable
  on public.household_settlements;
create trigger household_settlements_author_immutable
before update of created_by on public.household_settlements
for each row execute function public.kipu__author_immutability_guard();

-- Reporte de contrato del ESQUEMA, leído del catálogo y no de un texto. Sólo
-- lectura, sólo service_role: la sonda lo usa para exigir permanentemente cero
-- columnas NOT NULL participando en un FK ON DELETE SET NULL, y para probar que
-- los guards de autoría siguen instalados y habilitados.
create or replace function public.kipu__schema_contract_report()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'contradictory_set_null', coalesce((
      select jsonb_agg(jsonb_build_object(
               'table', src.relname,
               'column', a.attname,
               'constraint', con.conname
             ) order by src.relname, a.attname)
        from pg_constraint con
        join pg_class src on src.oid = con.conrelid
        join pg_namespace n on n.oid = src.relnamespace
        join unnest(con.conkey) k(attnum) on true
        join pg_attribute a
          on a.attrelid = src.oid and a.attnum = k.attnum
       where con.contype = 'f'
         and con.confdeltype = 'n'
         and a.attnotnull
         and n.nspname = 'public'
    ), '[]'::jsonb),
    'enabled_author_guards', coalesce((
      select jsonb_agg(t.tgname order by t.tgname)
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal
         and t.tgenabled = 'O'
         and n.nspname = 'public'
         and t.tgname in (
           'shared_expenses_require_author',
           'household_settlements_require_author',
           'shared_expenses_author_immutable',
           'household_settlements_author_immutable'
         )
    ), '[]'::jsonb)
  );
$$;

alter function public.kipu__schema_contract_report() owner to postgres;
revoke all on function public.kipu__schema_contract_report()
  from public, anon, authenticated;
grant execute on function public.kipu__schema_contract_report() to service_role;

commit;
