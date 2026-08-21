-- Corrected mapping for EXPORT055 / EXPORT064.
--
-- The sheet the previous migration was written from listed BOTH codes against
-- "Barramundi S/On Ptn 80-120g -6x2Kg Ctn". That was a transcription error:
-- EXPORT064 is a different product ("Frozen skin on fillets 250g-500g 15% GLZ").
-- Because the two descriptions collided, the previous migration's ambiguity guard
-- correctly refused to assign either.
--
-- 20260821000001 now carries the corrected pair, which covers a database that
-- has not run it yet. This migration exists for one that HAS: a migration already
-- applied never re-runs, so those two programs would sit blank forever.
--
-- Safe either way. It only fills rows where export_code IS NULL, so a database
-- that picked up the corrected version — or where someone set these by hand in
-- the Programs tab first — is left untouched.

with mapping (export_code, description) as (
  values
    ('EXPORT055', 'Barramundi S/On Ptn 80-120g -6x2Kg Ctn'),
    ('EXPORT064', 'Frozen skin on fillets 250g-500g 15% GLZ')
),
targets as (
  select p.id, m.export_code
  from demand_planner.programs p
  join mapping m
    on lower(trim(p.item_description)) = lower(trim(m.description))
  where p.deleted_at is null
    and p.export_code is null
),
-- One program per (plan, description) or we are guessing.
single as (
  select t.id, t.export_code
  from targets t
  where (
    select count(*) from demand_planner.programs p2
    where p2.deleted_at is null
      and p2.plan_id = (select plan_id from demand_planner.programs where id = t.id)
      and lower(trim(p2.item_description)) = (
        select lower(trim(item_description)) from demand_planner.programs where id = t.id
      )
  ) = 1
)
update demand_planner.programs p
   set export_code = s.export_code
  from single s
 where p.id = s.id;

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from demand_planner.programs
  where deleted_at is null
    and export_code is null
    and lower(trim(item_description)) in (
      'barramundi s/on ptn 80-120g -6x2kg ctn',
      'frozen skin on fillets 250g-500g 15% glz'
    );

  if v_missing > 0 then
    raise notice '% program(s) matching the EXPORT055 / EXPORT064 descriptions still have no export_code — set them in the Programs tab.', v_missing;
  end if;
end $$;
