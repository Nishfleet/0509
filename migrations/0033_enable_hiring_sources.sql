-- 0033_enable_hiring_sources.sql — switch the five job-board sources on.
--
-- 0020 seeded them disabled because nothing polled a board. The nightly
-- hiring-sweep Workflow (docs/engines/hiring.md) now finds each brand's board,
-- files each new job post as a signal, and Alerts and the competitor page
-- list them, so the rows go live together with their entries in
-- app/lib/coverage.ts. Data only: five rows flipped, no schema change.

UPDATE source SET is_enabled = 1 WHERE id IN (
  'src_hiring_greenhouse',
  'src_hiring_lever',
  'src_hiring_ashby',
  'src_hiring_workable',
  'src_hiring_smartrecruiters'
);
