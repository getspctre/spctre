-- Row-level security on the runtime_evidence_event partitions.
--
-- RLS is enabled on the partitioned parent, and a query through the parent is
-- filtered by its policy. A query against a partition *directly* is not: only
-- that partition's own policies apply, and the partitions had none. Every
-- partition is reachable by spctre_app, because
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO
-- spctre_app` grants each one as it is created. So
-- `SELECT * FROM runtime_evidence_event_2026_08` returned every tenant's
-- evidence to the application role while the identical query through the parent
-- returned one tenant's.
--
-- Nothing in the application queries a partition by name today — the retention
-- sweep does, but on the owner connection, which bypasses RLS either way. This
-- closes the path rather than relying on that staying true.
--
-- The backfill and the creation function both have to change:
-- spctre_ensure_runtime_evidence_partitions runs monthly and would otherwise
-- reopen the hole with each new partition.

CREATE OR REPLACE FUNCTION public.spctre_ensure_runtime_evidence_partitions(months_back integer DEFAULT 1, months_forward integer DEFAULT 3) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  month_start timestamptz;
  partition_start timestamptz;
  partition_end timestamptz;
  partition_name text;
begin
  month_start := date_trunc('month', now());
  for offset_months in -months_back..months_forward loop
    partition_start := month_start + make_interval(months => offset_months);
    partition_end := partition_start + interval '1 month';
    partition_name := format('runtime_evidence_event_%s', to_char(partition_start, 'YYYY_MM'));
    execute format(
      'create table if not exists %I partition of runtime_evidence_event for values from (%L) to (%L)',
      partition_name,
      partition_start,
      partition_end
    );
    -- A new partition inherits the parent's grants through ALTER DEFAULT
    -- PRIVILEGES but not its row security, so both are set explicitly here.
    execute format('alter table %I enable row level security', partition_name);
    execute format('drop policy if exists tenant_isolation on %I', partition_name);
    execute format(
      'create policy tenant_isolation on %I to spctre_app '
      'using (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) '
      'with check (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      partition_name
    );
  end loop;
end;
$$;

-- Backfill every existing partition, including runtime_evidence_event_default
-- and any partition the monthly function no longer covers.
DO $$
declare
  partition_name text;
begin
  for partition_name in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'runtime_evidence_event'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %I enable row level security', partition_name);
    execute format('drop policy if exists tenant_isolation on %I', partition_name);
    execute format(
      'create policy tenant_isolation on %I to spctre_app '
      'using (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) '
      'with check (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      partition_name
    );
  end loop;
end;
$$;
