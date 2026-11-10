-- 121_f1_switch_on.sql
--
-- Shows F1 in the sport chooser. Run this ONLY once the app build with F1 is
-- live (App Store and Netlify). Before that, an older app would show F1 with
-- football's screens.
--
-- Run on Dev any time you want to test F1 there; on Prod after release.
-- To hide it again: update public.sports set enabled = false where id = 'f1';

-- STEP 1 — Switch F1 on.
update public.sports set enabled = true where id = 'f1';

-- STEP 2 — Check. F1 should say true.
select id, name, enabled from public.sports order by sort_order;
