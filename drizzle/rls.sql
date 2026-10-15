-- ════════════════════════════════════════════════════════════════════
--  Row Level Security — isolamento de tenants no próprio PostgreSQL
--  Aplicado por `npm run db:migrate` depois das migrations (idempotente).
--
--  Regra: uma linha só é visível/alterável se
--     tenant_id = current_setting('app.tenant_id')
--  ou se a sessão estiver em modo administrativo (app.bypass_rls = 'on'),
--  usado apenas pelo painel Super Admin, webhooks e workers.
--
--  FORCE garante que a regra vale até para o dono das tabelas.
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenant_id'
       AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id::text = current_setting('app.tenant_id', true)
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id::text = current_setting('app.tenant_id', true)
        )
    $p$, r.table_name);
  END LOOP;
END $$;
