/**
 * @file tests/fixtures/emails.ts
 * @description Ten client-email fixtures covering the verdict scenarios
 *              checkScope must handle. Like the contract fixtures these are
 *              inputs to mocked-client unit tests, not assertions about
 *              model quality.
 */

export interface EmailFixture {
  /** Stable identifier referenced by the tests. */
  id: string;
  /** Expected verdict — the test mocks the AI to return this. */
  expectedVerdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
  /** Subject line. */
  subject: string;
  /** Email body. */
  body: string;
  /** Brief description for test names. */
  description: string;
}

export const emailFixtures: EmailFixture[] = [
  // ----- 2× clear in-scope -----
  {
    id: 'in-scope-revision',
    expectedVerdict: 'IN_SCOPE',
    subject: 'Small tweak to Pricing page',
    body: 'Hi Jane — could we move the testimonials block above the feature grid on the Pricing page? This is the second of our two revision rounds. Thanks!',
    description: 'requested revision within revision policy',
  },
  {
    id: 'in-scope-deliverable',
    expectedVerdict: 'IN_SCOPE',
    subject: 'Mobile breakpoint on About',
    body: 'Hey, the About page does not seem to render correctly at the 375px breakpoint. Can you take a look? It was in the spec.',
    description: 'matches an explicit deliverable',
  },

  // ----- 2× clear out-of-scope -----
  {
    id: 'out-login-system',
    expectedVerdict: 'OUT_OF_SCOPE',
    subject: 'Quick add — customer login',
    body: 'Hey Jane, also can you add a customer login system before launch? Should be quick — just username/password and a forgot-password flow. Thanks!',
    description: 'matches an explicit auth exclusion',
  },
  {
    id: 'out-mobile-app',
    expectedVerdict: 'OUT_OF_SCOPE',
    subject: 'iOS version next',
    body: 'After the website launches we will want an iOS app version of the same content. When can you get started on that?',
    description: 'matches an explicit mobile-app exclusion',
  },

  // ----- 3× ambiguous -----
  {
    id: 'amb-blog-cms',
    expectedVerdict: 'AMBIGUOUS',
    subject: 'Blog setup',
    body: 'Quick question — the spec mentions a Blog index page. Does that include the actual CMS to author posts, or are we adding posts manually for now?',
    description: 'deliverable references a blog index but CMS is not addressed',
  },
  {
    id: 'amb-additional-revisions',
    expectedVerdict: 'AMBIGUOUS',
    subject: 'Third revision on Pricing',
    body: 'Sorry — we want one more pass on the Pricing page after the two we already did. Is that included?',
    description: 'revision count beyond the policy is open to interpretation',
  },
  {
    id: 'amb-undefined-feature',
    expectedVerdict: 'AMBIGUOUS',
    subject: 'Newsletter signup',
    body: 'Could you wire up the footer newsletter signup to Mailchimp? I think it was implied in the brand work but I cannot find the line.',
    description: 'feature implied but not explicitly listed or excluded',
  },

  // ----- 3× edge cases -----
  {
    id: 'edge-empty-thanks',
    expectedVerdict: 'AMBIGUOUS',
    subject: 'Thanks!',
    body: 'Just saying thanks for the great work yesterday — looking forward to launch.',
    description: 'no actionable request — edge case the model must handle gracefully',
  },
  {
    id: 'edge-multi-request',
    expectedVerdict: 'OUT_OF_SCOPE',
    subject: 'A few things',
    body: 'Couple of things: (1) move the hero image down a bit, (2) add a SOC2 compliance badge, (3) build a dashboard for our customers to track usage. Thanks!',
    description: 'mixed in-scope and clearly out-of-scope items in a single email',
  },
  {
    id: 'edge-pricing-pressure',
    expectedVerdict: 'OUT_OF_SCOPE',
    subject: 'Translations',
    body: 'Final ask before launch — please translate all pages into French and German.',
    description: 'matches a translation-language exclusion',
  },
];
