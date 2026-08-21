-- Replace the demand plan's product descriptions with the ERP's fuller wording.
--
-- Joined on export_code, NOT on the old description. The two preceding migrations
-- have already established export_code -> program, so this is an exact join; a
-- second round of description matching would be fuzzy for no reason and would
-- break the moment one of them had a stray space.
--
-- Consequence worth stating: this migration MUST run after 20260821000001 and
-- ...0002, because it depends on export_code being populated. Filename ordering
-- gives that. A program whose export_code never got set is simply not renamed —
-- the right failure mode, and the same rows already showing blank in the
-- Programs tab.
--
-- `item_description` is display-only. `item_code` is the plan-unique key that
-- scenario forks, snapshot restores and every CSV import resolve through, and it
-- is untouched here, so nothing downstream repoints. The old text is preserved in
-- the `was` column below purely so this file records what it replaced.
--
-- Applied to every non-deleted program carrying the code, scenarios included:
-- they are the same physical product, and leaving forks on the old wording would
-- make the same item read two different ways depending on the plan selected.

with mapping (export_code, was, description) as (
  values
    ('EXPORT006',
     'Frozen Barramundi Regular Portions 80-120 Retail bag',
     'Barramundi Portions skin on 80G-120G Ocean Chef 6x1kg ctn - 7372'),
    ('EXPORT055',
     'Barramundi S/On Ptn 80-120g -6x2Kg Ctn',
     'Costco - skin on portions - 7390'),
    ('EXPORT008',
     'Frozen Barramundi Center Cut Portions 180g',
     'ASC Barramundi CC Portions, Skin On 180g -5Kg Ctn - 7374'),
    ('EXPORT005',
     'Frozen Barramundi Flts S/L - Ocean Chef 3Kg ctn',
     'Barramundi Fillets skinless Ocean Chef 3kg ctn - 7370'),
    ('EXPORT056',
     'Chapmans 6 - whole round',
     'Barramundi Whole Round Gill Bled (1.5kg+) 20kg'),
    ('EXPORT017',
     'Frozen Barramundi Skin on fillet 170/230g -20% Glz 5kg',
     'Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr -5kg Carton'),
    ('EXPORT016',
     'Skin on fillet 170/230g -20% Glazing (bags)',
     'Barramundi Fillet Asc S/O Pbo 20% 170-230 Gr -1kg Bag / 8kg Carton'),
    ('EXPORT064',
     'Frozen skin on fillets 250g-500g 15% GLZ',
     'Frozen skin on fillets 250g-500g 15% GLZ'),
    ('EXPORT011',
     'Barramundi Fillets with smoked S&P glaze, skin-on 350',
     'Barramundi Fillets with smoked S&P glaze, skin-on 350 g ASC-C-43724 (Skipper&Co) - 8979')
)
update demand_planner.programs p
   set item_description = m.description,
       updated_at       = now()
  from mapping m
 where p.export_code = m.export_code
   and p.deleted_at is null
   -- Idempotent: re-running, or a row already carrying the ERP wording, is a no-op
   -- and doesn't bump updated_at (which would mark every plan stale for nothing).
   and p.item_description is distinct from m.description;

do $$
declare
  r record;
begin
  for r in
    select m.export_code
    from (values
      ('EXPORT006'), ('EXPORT055'), ('EXPORT008'), ('EXPORT005'), ('EXPORT056'),
      ('EXPORT017'), ('EXPORT016'), ('EXPORT064'), ('EXPORT011')
    ) as m (export_code)
    where not exists (
      select 1 from demand_planner.programs p
      where p.deleted_at is null and p.export_code = m.export_code
    )
  loop
    raise notice '% is not on any program, so its description was not applied.', r.export_code;
  end loop;
end $$;
