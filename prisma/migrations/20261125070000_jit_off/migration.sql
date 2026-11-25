-- Postgres JIT spent ~29s compiling each KPI query (lib/kpi.ts countKpis:
-- dozens of per-lead subqueries push its cost estimate past the JIT
-- thresholds) for ~1s of actual work. Off for this database; new
-- connections pick it up.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET jit = off', current_database()); END $$;
