/**
 * @file lib/auth/inboundAlias.ts
 * @description Generates the per-user Postmark inbound forwarding alias.
 *              Format: `<slug>-<random>@<domain>` where:
 *                - <slug>   is a kebab-cased, ASCII-safe local part derived
 *                            from the email's local part. Falls back to "user"
 *                            when the slug would be empty.
 *                - <random> is 8 lowercase alphanumeric chars from
 *                            crypto.randomBytes — collision-resistant enough
 *                            for the User.inboundEmailAlias UNIQUE constraint.
 *                - <domain> comes from INBOUND_EMAIL_DOMAIN env var.
 *
 *              The alias is stable for the user's lifetime and is what they
 *              forward client emails to. Never reuse aliases — even after a
 *              user deletes their account, the alias is held to prevent a
 *              new account from inheriting routed mail.
 */

import { randomBytes } from 'node:crypto';

const ALIAS_RANDOM_LEN = 8;
const SLUG_MAX_LEN = 24;

/**
 * Derive a URL-safe slug from an email's local part.
 *
 * @param email - Full email address.
 * @returns Kebab-cased slug (lowercase a-z, 0-9, hyphen) of length 1..24.
 *          Returns "user" when the source has no usable characters.
 *
 * @example
 *   slugFromEmail('Jane.Doe+invoices@gmail.com') // "jane-doe-invoices"
 *   slugFromEmail('!!!@example.com')             // "user"
 */
export function slugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LEN);
  return slug.length > 0 ? slug : 'user';
}

/**
 * Generate a random alphanumeric suffix using node:crypto. Lowercase only so
 * the alias is case-canonical (email local parts are technically case-
 * sensitive but most providers normalise).
 */
function randomSuffix(): string {
  // base36 encoding of a random buffer, sliced to ALIAS_RANDOM_LEN.
  // randomBytes(6) -> ~48 bits -> >9 base36 chars; we take 8 for compactness.
  return randomBytes(6).toString('hex').slice(0, ALIAS_RANDOM_LEN);
}

/**
 * Generate a fresh inbound email alias for a user.
 *
 * @param email - The user's signup email — used to seed the human-readable slug.
 * @param domain - Override the configured domain. Defaults to
 *                 `process.env.INBOUND_EMAIL_DOMAIN`.
 * @returns Full email address, e.g. `jane-doe-7a2b9f1c@inbound.scopeguard.app`.
 * @throws Error when `domain` is not provided and INBOUND_EMAIL_DOMAIN is
 *         missing — failing here is preferable to silently writing a half-
 *         constructed alias to the database.
 *
 * @example
 *   const alias = generateInboundAlias('jane@gmail.com');
 *   await prisma.user.create({ data: { ...rest, inboundEmailAlias: alias } });
 */
export function generateInboundAlias(email: string, domain?: string): string {
  const resolvedDomain = domain ?? process.env['INBOUND_EMAIL_DOMAIN'];
  if (!resolvedDomain) {
    throw new Error('INBOUND_EMAIL_DOMAIN env var is required to generate inbound aliases.');
  }
  const slug = slugFromEmail(email);
  const suffix = randomSuffix();
  return `${slug}-${suffix}@${resolvedDomain}`;
}
