-- Categories for a salary that mostly goes to home, plus gym and supplements as wants.
insert into categories (name, icon, bucket, monthly_budget, sort_order) values
  ('Home contribution', '🏡', 'NEED', 15000, 105),
  ('Gym & fitness',     '🏋️', 'WANT', 1500,  212),
  ('Supplements',       '💪', 'WANT', 1500,  214);

-- Starting limits for wants (₹9,300 = 30% of ₹31,000). Only where none is set yet; change them in the app.
update categories set monthly_budget = 2500 where name = 'Food delivery & eating out' and monthly_budget is null;
update categories set monthly_budget = 2000 where name = 'Shopping'                   and monthly_budget is null;
update categories set monthly_budget = 800  where name = 'Personal care'              and monthly_budget is null;
