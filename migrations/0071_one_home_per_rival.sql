-- 0071_one_home_per_rival.sql — the page-role judge gave role 'home' to extra pages of a
-- rival (linear.app /homepage and /now), so every query that joins page on role = 'home'
-- saw several homes per entity. app/lib/data/page.server.ts now keeps 'home' for one page
-- per entity; this demotes the strays already stored. The home kept is the one with an active watch,
-- else one the judge never touched (the real home is stored before any judging), else the
-- site root, else the shortest url, else the lowest id. Undo: none needed, the rows
-- are not deleted and their role_decided_for_hash is untouched, so the judge re-decides
-- them only when their title or links change. The partial unique index then makes a second
-- home per entity an error for every writer (https://www.sqlite.org/partialindex.html).

WITH ranked AS (
  SELECT p.id AS id,
         ROW_NUMBER() OVER (
           PARTITION BY p.entity_id
           ORDER BY EXISTS (
                      SELECT 1 FROM watch w
                      WHERE w.entity_id = p.entity_id AND w.target_key = p.url AND w.is_active = 1
                    ) DESC,
                    p.role_decided_for_hash IS NULL DESC,
                    instr(substr(p.url, instr(p.url, '://') + 3) || '/', '/') >= length(substr(p.url, instr(p.url, '://') + 3)) DESC,
                    length(p.url) ASC,
                    p.id ASC
         ) AS rank
  FROM page p
  WHERE p.role = 'home'
)
UPDATE page SET role = 'other' WHERE id IN (SELECT id FROM ranked WHERE rank > 1);

CREATE UNIQUE INDEX page_one_home ON page(entity_id) WHERE role = 'home';
