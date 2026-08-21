-- The ERP's export item number (EXPORT006, EXPORT055, …) alongside each program.
--
-- This is NOT the same thing as `item_code`, which holds the V30 workbook's SKU
-- ("7372") and is load-bearing: it is the plan-unique key that scenario forks,
-- snapshot restores and every wide CSV import resolve programs through. Renaming
-- it to the export number would silently repoint all of that, so the export
-- number gets its own nullable column instead.
--
-- Nullable and NOT unique on purpose: not every program has one yet, and the
-- mapping is maintained by hand — a half-filled column has to be a legal state,
-- and a typo should be correctable rather than rejected at 2am.

alter table demand_planner.programs
  add column if not exists export_code text;

create index if not exists programs_export_code_idx
  on demand_planner.programs (plan_id, export_code)
  where export_code is not null;

comment on column demand_planner.programs.export_code is
  'ERP export item number (e.g. EXPORT006). Reference only — item_code remains the plan-unique key.';

-- Seed the mapping supplied for the current demand plan products.
--
-- Matched on item_description, trimmed and case-insensitive, because that is the
-- only column the supplied sheet shares with this table. Deliberately narrow:
--
--   • only fills rows where export_code IS NULL, so re-running never overwrites a
--     correction someone made in the UI;
--   • only assigns when the description matches EXACTLY ONE program in a plan, so
--     a description reused across two plans/programs is left for a human rather
--     than being guessed at.
--
-- A description that has since been edited simply won't match and stays null —
-- visible as a blank in the Programs tab, which is the right failure mode.

with mapping (export_code, description) as (
  values
    ('EXPORT006', 'Frozen Barramundi Regular Portions 80-120 Retail bag'),
    ('EXPORT055', 'Barramundi S/On Ptn 80-120g -6x2Kg Ctn'),
    ('EXPORT008', 'Frozen Barramundi Center Cut Portions 180g'),
    ('EXPORT005', 'Frozen Barramundi Flts S/L - Ocean Chef 3Kg ctn'),
    ('EXPORT056', 'Chapmans 6 - whole round'),
    ('EXPORT017', 'Frozen Barramundi Skin on fillet 170/230g -20% Glz 5kg'),
    ('EXPORT016', 'Skin on fillet 170/230g -20% Glazing (bags)'),
    ('EXPORT064', 'Frozen skin on fillets 250g-500g 15% GLZ'),
    ('EXPORT011', 'Barramundi Fillets with smoked S&P glaze, skin-on 350')
),
-- Kept as a guard, not because the current list needs it: if a future edit ever
-- gives two export codes the same description, assigning either would be a coin
-- flip, so both are dropped and left for a human instead.
unambiguous as (
  select export_code, description
  from mapping
  where description in (select description from mapping group by description having count(*) = 1)
),
targets as (
  select p.id, u.export_code
  from demand_planner.programs p
  join unambiguous u
    on lower(trim(p.item_description)) = lower(trim(u.description))
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
  v_filled int;
begin
  select count(*) into v_filled
  from demand_planner.programs
  where export_code is not null and deleted_at is null;

  raise notice 'export_code set on % program(s). Any left blank in the Programs tab had no exact description match.', v_filled;
end $$;
