-- Up to five sourcing paths per program (was three).
--
-- A program sources its whole round from a cascade of (size bucket, yield)
-- paths: primary → secondary → tertiary, and now quaternary → quinary. The
-- engine tries them in that order, own month first and then each borrow month.
--
-- Three places carry one slot per path, so each gets the two new ones:
--   * programs           — quaternary/quinary bucket + yield, paired like the rest
--   * alloc_path enum    — own-month allocations are stored per path
--   * rolling_results    — one borrow column per (months back × path)
--
-- Existing programs have no 4th/5th path (null), and existing results default
-- the new borrow columns to 0, so nothing changes until someone adds a path and
-- recalculates. Plans that keep three paths compute exactly as before.

-- programs -------------------------------------------------------------------
alter table demand_planner.programs
  add column if not exists quaternary_bucket_id uuid references demand_planner.buckets (id),
  add column if not exists quaternary_yield     numeric(6,4) check (quaternary_yield > 0 and quaternary_yield <= 1),
  add column if not exists quinary_bucket_id    uuid references demand_planner.buckets (id),
  add column if not exists quinary_yield        numeric(6,4) check (quinary_yield > 0 and quinary_yield <= 1);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programs_quaternary_pair') then
    alter table demand_planner.programs add constraint programs_quaternary_pair check (
      (quaternary_bucket_id is null and quaternary_yield is null)
      or
      (quaternary_bucket_id is not null and quaternary_yield is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programs_quinary_pair') then
    alter table demand_planner.programs add constraint programs_quinary_pair check (
      (quinary_bucket_id is null and quinary_yield is null)
      or
      (quinary_bucket_id is not null and quinary_yield is not null)
    );
  end if;
end $$;

comment on column demand_planner.programs.quaternary_bucket_id is
  '4th sourcing path: size bucket tried after tertiary.';
comment on column demand_planner.programs.quinary_bucket_id is
  '5th sourcing path: size bucket tried after quaternary (last in the cascade).';

-- allocations.path -----------------------------------------------------------
alter type demand_planner.alloc_path add value if not exists 'quaternary';
alter type demand_planner.alloc_path add value if not exists 'quinary';

-- rolling_results borrow channels ------------------------------------------
alter table demand_planner.rolling_results
  add column if not exists borrow_m1_quat_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m1_quin_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m2_quat_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m2_quin_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m3_quat_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m3_quin_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m4_quat_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m4_quin_wr numeric(18,4) not null default 0;

comment on column demand_planner.rolling_results.borrow_m1_quat_wr is
  'WR borrowed from month M-1 in the program''s QUATERNARY (4th) bucket.';
comment on column demand_planner.rolling_results.borrow_m1_quin_wr is
  'WR borrowed from month M-1 in the program''s QUINARY (5th) bucket.';
comment on column demand_planner.rolling_results.borrow_m2_quat_wr is
  'WR borrowed from month M-2 in the program''s QUATERNARY (4th) bucket.';
comment on column demand_planner.rolling_results.borrow_m2_quin_wr is
  'WR borrowed from month M-2 in the program''s QUINARY (5th) bucket.';
comment on column demand_planner.rolling_results.borrow_m3_quat_wr is
  'WR borrowed from month M-3 in the program''s QUATERNARY (4th) bucket.';
comment on column demand_planner.rolling_results.borrow_m3_quin_wr is
  'WR borrowed from month M-3 in the program''s QUINARY (5th) bucket.';
comment on column demand_planner.rolling_results.borrow_m4_quat_wr is
  'WR borrowed from month M-4 in the program''s QUATERNARY (4th) bucket.';
comment on column demand_planner.rolling_results.borrow_m4_quin_wr is
  'WR borrowed from month M-4 in the program''s QUINARY (5th) bucket.';
