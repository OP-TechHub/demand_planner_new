-- ============================================================================
-- SECONDARY PRODUCTS: PER-USER EDIT GRANT
-- ============================================================================
-- By-product definitions and other products have been admin-only since they
-- shipped, which is heavier than the job needs: maintaining a yield percentage
-- and a price is not the same trust level as creating plans, editing buckets,
-- or reading what the fish costs to grow.
--
-- These three tables move onto the grant mechanism the rest of the app already
-- uses (20260716000002). can_edit_section() is true for an admin, and true for
-- an active user holding the section in users.edit_sections — so admins keep
-- exactly the access they have today, and nobody else gains anything until an
-- admin ticks the box on the Users screen.
--
-- One grant covers all three tables because they are one screen. The monthly
-- quantities in particular are meaningless apart from the products they hang
-- off, so a second rule for them would only be a way to get them out of step.
--
-- Reads are untouched: everyone in the org could already see these.

drop policy if exists secondary_products_admin_write on demand_planner.secondary_products;
drop policy if exists secondary_products_write on demand_planner.secondary_products;
create policy secondary_products_write on demand_planner.secondary_products for all
  using (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  )
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  );

drop policy if exists other_products_admin_write on demand_planner.other_products;
drop policy if exists other_products_write on demand_planner.other_products;
create policy other_products_write on demand_planner.other_products for all
  using (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  )
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  );

drop policy if exists other_product_months_admin_write on demand_planner.other_product_months;
drop policy if exists other_product_months_write on demand_planner.other_product_months;
create policy other_product_months_write on demand_planner.other_product_months for all
  using (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  )
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_edit_section('secondary_products')
  );
