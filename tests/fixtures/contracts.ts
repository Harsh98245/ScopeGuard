/**
 * @file tests/fixtures/contracts.ts
 * @description Five contract fixtures covering the shapes parseContract must
 *              handle. The fixtures here ARE the inputs to the unit tests —
 *              the tests then mock the Anthropic client to assert on what
 *              parseContract sends and how it handles the response.
 *
 *              Real-quality verification of the model's output against these
 *              contracts belongs in an integration test that hits the live
 *              API; that suite is intentionally out of scope for this file.
 */

/** A short, well-defined contract — the easy case. */
export const simpleContract = `MASTER SERVICES AGREEMENT

1. Engagement
1.1 Acme Corp ("Client") engages Jane Doe ("Contractor") to design and
develop a static marketing website.

2. Deliverables
2.1 Five static marketing pages (Home, About, Pricing, Contact, Blog index)
implemented per the Figma file linked in Appendix A.
2.2 Mobile-responsive layouts for all pages at 375px, 768px, and 1280px breakpoints.

3. Exclusions
3.1 Authentication, dashboards, and payment integrations are explicitly out of scope.
3.2 Ongoing maintenance after the initial delivery is not included.

4. Payment
4.1 Total fee: USD 8,500 payable 50% on signing, 50% on final delivery.
4.2 Late payments accrue interest at 1.5% per month.

5. Revisions
5.1 Up to two rounds of revisions per page are included in the fee.`;

/** A complex multi-deliverable contract with structured exclusions and detailed payment. */
export const complexContract = `STATEMENT OF WORK — ACME / JANE DOE

§1 Background
Client (Acme Corp) is launching a new product and engages Contractor (Jane Doe) to deliver
the assets and code described herein.

§2 Deliverables
2.1 Brand identity refresh: new logo, secondary marks, color tokens, type system.
2.2 Marketing site (Next.js, deployed to Vercel): up to 12 static pages, internationalised
    in English and Spanish.
2.3 Email templates (3 transactional, 1 newsletter) compatible with Postmark.
2.4 Documentation: a written README plus a recorded 30-minute Loom walkthrough.

§3 Out of Scope
3.1 Native mobile apps (iOS/Android) of any kind.
3.2 Backend services, APIs, or any persistent data store.
3.3 Translation into any language other than English and Spanish.
3.4 SEO consulting or paid-media campaign management.

§4 Payment
4.1 Total: USD 42,500.
4.2 Schedule: 25% on signing; 25% on brand-identity delivery; 25% on site staging;
    25% on final go-live.
4.3 Net-15 from invoice. Late fee of 2% per month after 15 days.

§5 Revisions
5.1 Up to three rounds of revisions on the brand identity.
5.2 Up to two rounds of revisions on each marketing page.
5.3 Additional rounds billed at the contractor's prevailing hourly rate.

§6 Term & Termination
6.1 Term: signed date through final delivery, expected within 14 weeks.
6.2 Either party may terminate for material breach with 14 days written notice.`;

/** A vague, dispute-bait contract — minimal exclusions, lots of weasel words. */
export const vagueContract = `WEBSITE PROJECT AGREEMENT

Jane will help Acme with their website. Jane will deliver a "modern, professional" site
that reflects Acme's "brand vision" and includes "all the standard features customers
expect from a B2B SaaS landing page".

Jane will provide reasonable revisions until Acme is happy.

Payment: $5,000, paid when the project feels done.

The contractor will be available as needed for support after launch.`;

/** Heavy on exclusions — common when a freelancer learned a hard lesson. */
export const exclusionHeavyContract = `SCOPE-OF-WORK — JANE / ACME

DELIVERABLES
- One marketing landing page in Webflow.
- One contact form integrated with Acme's existing HubSpot account.

EXPLICIT EXCLUSIONS
The following are NOT included and would require a separate change order:
1. Any authentication system (login, signup, SSO).
2. Any ecommerce checkout flow or payment integration.
3. Any blog, CMS, or content authoring interface.
4. SEO audit, keyword research, or technical SEO implementation beyond standard meta tags.
5. Multi-language support of any kind.
6. Custom illustrations or photography (stock assets only).
7. Email template design.
8. Analytics setup beyond GA4 default snippet.
9. Hosting, domain registration, or DNS configuration.
10. Ongoing maintenance after final delivery.

PAYMENT
$3,200, paid 100% on delivery.`;

/** A minimal contract that has deliverables but NO exclusions section. */
export const noExclusionsContract = `PROJECT AGREEMENT

Jane Doe will deliver to Acme Corp:

1. A two-page portfolio site (Home, Projects).
2. Hosting setup on Netlify.
3. A simple contact form.

Total: $1,800. Payable on completion. Two rounds of revisions per page.`;

/** All five fixtures in a map keyed by name — handy for table-driven tests. */
export const contractFixtures = {
  simple: simpleContract,
  complex: complexContract,
  vague: vagueContract,
  exclusionHeavy: exclusionHeavyContract,
  noExclusions: noExclusionsContract,
} as const;
