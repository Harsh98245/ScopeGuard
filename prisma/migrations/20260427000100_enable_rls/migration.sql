-- =============================================================================
-- ScopeGuard — Row Level Security policies
-- =============================================================================
-- Enables RLS on every user-owned table and adds explicit policies for SELECT,
-- INSERT, UPDATE, DELETE keyed off `auth.uid()`. The Prisma migration above
-- installed the schema using the service role; once RLS is on, day-to-day
-- queries from the app use the user's anon-key JWT and these policies enforce
-- ownership.
--
-- Rules:
--   1. Server-side code that legitimately needs cross-user access (Stripe
--      webhooks, Postmark webhook lookups by alias) MUST run with the service
--      role key. Webhook handlers use lib/supabase/admin.ts for that.
--   2. Every new userId-bearing table needs an entry below in the same shape.
--   3. Project-owned tables (contracts, scope_checks) join through `projects`.
-- =============================================================================

ALTER TABLE "users"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scope_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;

-- ---------- users: row equals own auth user --------------------------------

CREATE POLICY "users_select_self" ON "users"
  FOR SELECT USING ("id" = auth.uid());

CREATE POLICY "users_update_self" ON "users"
  FOR UPDATE USING ("id" = auth.uid())
  WITH CHECK ("id" = auth.uid());

-- INSERT and DELETE on users are restricted to the service role; the Supabase
-- auth trigger handles row creation, account deletion goes through a server
-- action that uses the service role key.

-- ---------- projects -------------------------------------------------------

CREATE POLICY "projects_select_own" ON "projects"
  FOR SELECT USING ("userId" = auth.uid());

CREATE POLICY "projects_insert_own" ON "projects"
  FOR INSERT WITH CHECK ("userId" = auth.uid());

CREATE POLICY "projects_update_own" ON "projects"
  FOR UPDATE USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());

CREATE POLICY "projects_delete_own" ON "projects"
  FOR DELETE USING ("userId" = auth.uid());

-- ---------- contracts: ownership via project -------------------------------

CREATE POLICY "contracts_select_own" ON "contracts"
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "contracts"."projectId" AND p."userId" = auth.uid())
  );

CREATE POLICY "contracts_insert_own" ON "contracts"
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "contracts"."projectId" AND p."userId" = auth.uid())
  );

CREATE POLICY "contracts_update_own" ON "contracts"
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "contracts"."projectId" AND p."userId" = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "contracts"."projectId" AND p."userId" = auth.uid())
  );

CREATE POLICY "contracts_delete_own" ON "contracts"
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "contracts"."projectId" AND p."userId" = auth.uid())
  );

-- ---------- scope_checks: ownership via project ----------------------------

CREATE POLICY "scope_checks_select_own" ON "scope_checks"
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "scope_checks"."projectId" AND p."userId" = auth.uid())
  );

CREATE POLICY "scope_checks_insert_own" ON "scope_checks"
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "scope_checks"."projectId" AND p."userId" = auth.uid())
  );

CREATE POLICY "scope_checks_update_own" ON "scope_checks"
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "scope_checks"."projectId" AND p."userId" = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "scope_checks"."projectId" AND p."userId" = auth.uid())
  );

-- DELETE intentionally omitted — scope checks are append-only history.

-- ---------- transactions ---------------------------------------------------

CREATE POLICY "transactions_select_own" ON "transactions"
  FOR SELECT USING ("userId" = auth.uid());

CREATE POLICY "transactions_insert_own" ON "transactions"
  FOR INSERT WITH CHECK ("userId" = auth.uid());

CREATE POLICY "transactions_update_own" ON "transactions"
  FOR UPDATE USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());

CREATE POLICY "transactions_delete_own" ON "transactions"
  FOR DELETE USING ("userId" = auth.uid());

-- ---------- integrations ---------------------------------------------------

-- Tokens are encrypted, but RLS still scopes reads to owners as defense-in-depth.

CREATE POLICY "integrations_select_own" ON "integrations"
  FOR SELECT USING ("userId" = auth.uid());

CREATE POLICY "integrations_insert_own" ON "integrations"
  FOR INSERT WITH CHECK ("userId" = auth.uid());

CREATE POLICY "integrations_update_own" ON "integrations"
  FOR UPDATE USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());

CREATE POLICY "integrations_delete_own" ON "integrations"
  FOR DELETE USING ("userId" = auth.uid());
