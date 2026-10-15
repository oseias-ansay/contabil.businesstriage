-- ════════════════════════════════════════════════════════════════════
--  Regras contábeis garantidas pelo PostgreSQL
--  Aplicado por `npm run db:migrate` depois das migrations e do RLS.
--  Idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
--
--  Mesmo que um bug na aplicação tente, o banco recusa:
--   1. lançamento com débitos ≠ créditos (checado no COMMIT)
--   2. lançamento em conta sintética, inativa ou de outra empresa
--   3. lançamento em período fechado
--   4. alterar ou apagar lançamentos e auditoria (correção = estorno)
--   5. acrescentar partidas a um lançamento já gravado
--   6. mudar tipo/natureza de conta movimentada ou apagá-la
--
--  Exceção única: exclusão de um tenant inteiro pelo Admin Global, que
--  liga `app.purge = on` na própria transação (ver src/db/index.ts).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION acc_purging() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.purge', true), '') = 'on'
$$;

-- ─────────────────────────── 1. Cabeçalho do lançamento ───────────────────────────
CREATE OR REPLACE FUNCTION acc_entry_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st period_status;
  co record;
  orig record;
BEGIN
  SELECT tenant_id, is_active, start_date INTO co FROM companies WHERE id = NEW.company_id;
  IF NOT FOUND OR co.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Empresa inválida para este lançamento' USING ERRCODE = 'P0001';
  END IF;
  IF NOT co.is_active THEN
    RAISE EXCEPTION 'Empresa inativa: não aceita novos lançamentos' USING ERRCODE = 'P0001';
  END IF;

  NEW.competence := date_trunc('month', NEW.entry_date)::date;
  NEW.created_tx := txid_current();

  SELECT status INTO st FROM periods WHERE company_id = NEW.company_id AND competence = NEW.competence;
  IF st = 'CLOSED' THEN
    RAISE EXCEPTION 'O período %/% está fechado', to_char(NEW.competence, 'MM'), to_char(NEW.competence, 'YYYY')
      USING ERRCODE = 'P0001', HINT = 'Reabra o mês (gestor) ou lance em um período aberto';
  END IF;

  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT company_id INTO orig FROM journal_entries WHERE id = NEW.reverses_entry_id;
    IF NOT FOUND OR orig.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'Lançamento a estornar não encontrado nesta empresa' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Número sequencial por empresa (trava só esta empresa até o fim da transação)
  PERFORM pg_advisory_xact_lock(hashtextextended('acc_entry_no:' || NEW.company_id::text, 0));
  SELECT coalesce(max(number), 0) + 1 INTO NEW.number FROM journal_entries WHERE company_id = NEW.company_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS acc_entry_before_insert ON journal_entries;
CREATE TRIGGER acc_entry_before_insert BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION acc_entry_before_insert();

-- ─────────────────────────── 2. Partidas ───────────────────────────
CREATE OR REPLACE FUNCTION acc_line_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e record;
  a record;
  cc record;
BEGIN
  SELECT tenant_id, company_id, created_tx INTO e FROM journal_entries WHERE id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento inexistente' USING ERRCODE = 'P0001';
  END IF;
  IF e.created_tx <> txid_current() THEN
    RAISE EXCEPTION 'Não é permitido acrescentar partidas a um lançamento já gravado' USING ERRCODE = 'P0001',
      HINT = 'Estorne o lançamento e faça um novo';
  END IF;
  NEW.tenant_id := e.tenant_id;

  SELECT company_id, is_analytic, is_active, code, name INTO a FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND OR a.company_id <> e.company_id THEN
    RAISE EXCEPTION 'Conta não pertence à empresa do lançamento' USING ERRCODE = 'P0001';
  END IF;
  IF NOT a.is_analytic THEN
    RAISE EXCEPTION 'A conta % - % é sintética e não recebe lançamentos', a.code, a.name USING ERRCODE = 'P0001';
  END IF;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'A conta % - % está inativa', a.code, a.name USING ERRCODE = 'P0001';
  END IF;

  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT company_id, is_active INTO cc FROM cost_centers WHERE id = NEW.cost_center_id;
    IF NOT FOUND OR cc.company_id <> e.company_id THEN
      RAISE EXCEPTION 'Centro de custo não pertence à empresa do lançamento' USING ERRCODE = 'P0001';
    END IF;
    IF NOT cc.is_active THEN
      RAISE EXCEPTION 'Centro de custo inativo' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS acc_line_before_insert ON journal_lines;
CREATE TRIGGER acc_line_before_insert BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION acc_line_before_insert();

-- ─────────────────────────── 3. Partidas dobradas (no COMMIT) ───────────────────────────
CREATE OR REPLACE FUNCTION acc_entry_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n int;
  d numeric;
  c numeric;
BEGIN
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, d, c
    FROM journal_lines WHERE entry_id = NEW.id;
  IF n < 2 THEN
    RAISE EXCEPTION 'Lançamento nº % precisa de pelo menos duas partidas', NEW.number USING ERRCODE = 'P0001';
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'Lançamento nº % desbalanceado: débitos % ≠ créditos %', NEW.number, d, c USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS acc_entry_check_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER acc_entry_check_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_entry_check_balanced();

-- ─────────────────────────── 4. Imutabilidade ───────────────────────────
CREATE OR REPLACE FUNCTION acc_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF acc_purging() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Registros de % não podem ser alterados nem apagados', TG_TABLE_NAME
    USING ERRCODE = 'P0001', HINT = 'Para corrigir um lançamento, faça o estorno';
END $$;

DROP TRIGGER IF EXISTS acc_entry_immutable ON journal_entries;
CREATE TRIGGER acc_entry_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION acc_immutable();
DROP TRIGGER IF EXISTS acc_line_immutable ON journal_lines;
CREATE TRIGGER acc_line_immutable BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION acc_immutable();
DROP TRIGGER IF EXISTS acc_audit_immutable ON audit_log;
CREATE TRIGGER acc_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION acc_immutable();

-- ─────────────────────────── 5. Plano de contas ───────────────────────────
CREATE OR REPLACE FUNCTION acc_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p record;
  used boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF acc_purging() THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id) THEN
      RAISE EXCEPTION 'A conta % já foi movimentada e não pode ser excluída', OLD.code
        USING ERRCODE = 'P0001', HINT = 'Inative a conta em vez de excluir';
    END IF;
    RETURN OLD;
  END IF;

  -- Conta-mãe: mesma empresa e sintética
  IF NEW.parent_id IS NOT NULL THEN
    SELECT company_id, is_analytic, type INTO p FROM accounts WHERE id = NEW.parent_id;
    IF NOT FOUND OR p.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'Conta-mãe não pertence à mesma empresa' USING ERRCODE = 'P0001';
    END IF;
    IF p.is_analytic THEN
      RAISE EXCEPTION 'Conta analítica não pode ter subcontas' USING ERRCODE = 'P0001';
    END IF;
    -- mesmo tipo da mãe; única exceção: Patrimônio Líquido sob o grupo 2 (Passivo e PL)
    IF p.type <> NEW.type AND NOT (p.type = 'LIABILITY' AND NEW.type = 'EQUITY') THEN
      RAISE EXCEPTION 'Subconta deve ter o mesmo tipo da conta-mãe' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id <> OLD.company_id OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'Conta não pode mudar de empresa' USING ERRCODE = 'P0001';
    END IF;
    used := EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id);
    IF used AND (NEW.type <> OLD.type OR NEW.nature <> OLD.nature OR NEW.is_analytic <> OLD.is_analytic) THEN
      RAISE EXCEPTION 'A conta % já foi movimentada: tipo, natureza e analítica/sintética não podem mudar', OLD.code
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_analytic = false AND NEW.is_analytic = true AND EXISTS (SELECT 1 FROM accounts WHERE parent_id = OLD.id) THEN
      RAISE EXCEPTION 'Conta com subcontas não pode virar analítica' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS acc_account_guard ON accounts;
CREATE TRIGGER acc_account_guard BEFORE INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION acc_account_guard();

-- ─────────────────────────── 6. Centros de custo e empresas ───────────────────────────
CREATE OR REPLACE FUNCTION acc_cost_center_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF acc_purging() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM journal_lines WHERE cost_center_id = OLD.id) THEN
    RAISE EXCEPTION 'Centro de custo já usado em lançamentos: inative em vez de excluir' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS acc_cost_center_guard ON cost_centers;
CREATE TRIGGER acc_cost_center_guard BEFORE DELETE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION acc_cost_center_guard();

CREATE OR REPLACE FUNCTION acc_company_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF acc_purging() THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE company_id = OLD.id) THEN
    RAISE EXCEPTION 'Empresa com lançamentos não pode ser excluída: inative em vez de excluir' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS acc_company_guard ON companies;
CREATE TRIGGER acc_company_guard BEFORE DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION acc_company_guard();

-- ─────────────────────────── 7. Períodos ───────────────────────────
CREATE OR REPLACE FUNCTION acc_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.competence := date_trunc('month', NEW.competence)::date;
  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.competence <> OLD.competence) THEN
    RAISE EXCEPTION 'Período não pode mudar de empresa nem de competência' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS acc_period_guard ON periods;
CREATE TRIGGER acc_period_guard BEFORE INSERT OR UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION acc_period_guard();

-- ─────────────────────────── 8. Linhas de extrato ───────────────────────────
-- O que veio do banco não se edita: data, valor, histórico e conta bancária ficam
-- como no arquivo. Só mudam a classificação e o status. Linha lançada só pode
-- ser excluída junto com o tenant.
CREATE OR REPLACE FUNCTION acc_bank_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF acc_purging() THEN RETURN OLD; END IF;
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'Movimento de extrato já lançado não pode ser excluído' USING ERRCODE = 'P0001',
        HINT = 'Desfaça o lançamento (estorno) antes';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.line_date <> OLD.line_date OR NEW.amount <> OLD.amount OR NEW.description <> OLD.description
     OR NEW.bank_account_id <> OLD.bank_account_id OR NEW.dedupe_key <> OLD.dedupe_key OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'Data, valor e histórico do extrato não podem ser alterados' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'POSTED' AND NEW.entry_id IS NULL THEN
    RAISE EXCEPTION 'Movimento lançado precisa do lançamento correspondente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS acc_bank_line_guard ON bank_lines;
CREATE TRIGGER acc_bank_line_guard BEFORE UPDATE OR DELETE ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION acc_bank_line_guard();
