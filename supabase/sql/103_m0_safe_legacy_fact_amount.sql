-- Migration 103 — M0: a malformed legacy fact is absence, never a cast failure.
--
-- APPLIED 2026-08-03. Migration 102 is already applied and is intentionally
-- not rewritten.
--
-- The external execution audit noticed that 102 guarded a legacy text amount
-- with a regex and cast it in a neighbouring AND predicate. SQL does not
-- promise left-to-right evaluation of WHERE predicates; PostgreSQL may execute
-- the numeric cast first. A malformed historical payload could therefore abort
-- every occurrence reopen instead of being ignored by the fail-closed fallback.
--
-- CASE is the evaluation boundary: numeric JSON is read directly, numeric text
-- is cast only inside the matching regex arm, and every other shape becomes
-- NULL/non-matching. The monetary comparison and all chain/lock behaviour from
-- 102 stay unchanged.

do $$
declare
  v_definition text;
  v_next text;
  v_anchor text := $anchor$
           and (f.payload->>'amount') ~ '^[0-9]+([.][0-9]+)?$'
           and round((f.payload->>'amount')::numeric,2) = round(s.full_payment_due,2)$anchor$;
  v_replacement text := $replacement$
           -- K-103: CASE, not predicate order, owns cast safety.
           and case
                 when jsonb_typeof(f.payload->'amount') = 'number' then
                   round((f.payload->>'amount')::numeric,2)
                 when jsonb_typeof(f.payload->'amount') = 'string' then
                   case
                     when (f.payload->>'amount') ~ '^[0-9]+([.][0-9]+)?$' then
                       round((f.payload->>'amount')::numeric,2)
                     else null
                   end
                 else null
               end = round(s.full_payment_due,2)$replacement$;
  v_hits integer;
begin
  select pg_get_functiondef(
    'public.kipu__publish_terminal_occurrence_fact()'::regprocedure
  ) into v_definition;

  if position('K-103: CASE, not predicate order, owns cast safety.' in v_definition) > 0 then
    return;
  end if;

  v_hits := (
    length(v_definition) - length(replace(v_definition, v_anchor, ''))
  ) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'KIPU_MIGRATION: expected one K-102 legacy amount anchor, found %',
      v_hits;
  end if;

  v_next := replace(v_definition, v_anchor, v_replacement);
  if v_next = v_definition
     or position('K-103: CASE, not predicate order, owns cast safety.' in v_next) = 0 then
    raise exception 'KIPU_MIGRATION: K-103 replacement did not land';
  end if;
  execute v_next;
end;
$$;

alter function public.kipu__publish_terminal_occurrence_fact() owner to postgres;
revoke all on function public.kipu__publish_terminal_occurrence_fact()
  from public, anon, authenticated, service_role;
