-- =============================================================================
-- ScopeGuard — User subscription fields
-- =============================================================================
-- Adds Stripe subscription tracking columns to the `users` table. All four
-- columns are nullable: a row remains on the FREE plan until checkout fires
-- the first webhook, at which point the columns are populated by the
-- `customer.subscription.created` / `checkout.session.completed` handlers.
--
-- These columns are mutated EXCLUSIVELY by the Stripe webhook handler.
-- Application code reads them but never writes them directly.
-- =============================================================================

ALTER TABLE "users"
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripePriceId"        TEXT,
  ADD COLUMN "subscriptionStatus"   TEXT,
  ADD COLUMN "currentPeriodEnd"     TIMESTAMP(3);

-- Stripe subscription IDs are globally unique; mirror that constraint.
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key"
  ON "users" ("stripeSubscriptionId");

-- Speeds up lookups in the webhook handler when a subscription event arrives
-- and we need to find the user by their Stripe customer ID. (The unique index
-- on stripeCustomerId from the init migration already covers exact lookups,
-- so no additional index is needed here.)

COMMENT ON COLUMN "users"."stripeSubscriptionId" IS
  'Active Stripe subscription. Null on FREE or after cancellation.';

COMMENT ON COLUMN "users"."stripePriceId" IS
  'Currently-billed Stripe price ID. Drives tierFromPriceId resolution.';

COMMENT ON COLUMN "users"."subscriptionStatus" IS
  'Stripe subscription status. active|trialing means the user has access.';

COMMENT ON COLUMN "users"."currentPeriodEnd" IS
  'End of the current billing period. Surfaced as "Renews on" / "Cancels on".';
