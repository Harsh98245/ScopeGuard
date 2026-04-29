/**
 * @file inngest/client.ts
 * @description Inngest client + the canonical event-name registry. Functions
 *              register themselves under one of these names; the API route at
 *              /api/webhooks/inngest serves them.
 *
 *              Each event has a typed payload — adding a new event means
 *              extending the Events map, never publishing free-form data.
 */

import { EventSchemas, Inngest } from 'inngest';
import type { ScopeVerdict } from '@prisma/client';

/**
 * Registered Inngest event payloads. Strict typing here forces every send-side
 * caller to match the receive-side function's expectations.
 */
type Events = {
  /** Postmark webhook arrived. Triggers contract scope check pipeline. */
  'scope/email.received': {
    data: {
      /** Postmark MessageID — used as the idempotency key. */
      postmarkMessageId: string;
      /** Recipient inbound alias (matches User.inboundEmailAlias). */
      toAlias: string;
      /** From address as parsed by Postmark. */
      fromEmail: string;
      /** Subject line. May be empty. */
      subject: string;
      /** Plain-text body. */
      bodyText: string;
    };
  };
  /** Scope-check completed — used for downstream notifications. */
  'scope/check.completed': {
    data: {
      userId: string;
      projectId: string;
      scopeCheckId: string;
      verdict: ScopeVerdict;
      confidence: number;
    };
  };
  /** Contract uploaded to Storage; triggers async parsing. */
  'contract/uploaded': {
    data: {
      userId: string;
      projectId: string;
      contractId: string;
    };
  };
  /** Emitted by parseUploadedContract when a contract row reaches parsedAt
   *  != null. processInboundEmail listens for this with step.waitForEvent
   *  to handle the "email arrived before parsing finished" race. */
  'contract/parsed': {
    data: {
      userId: string;
      projectId: string;
      contractId: string;
    };
  };
  /** A user connected a new financial integration; trigger a backfill sync. */
  'integration/connected': {
    data: {
      userId: string;
      integrationId: string;
    };
  };
  /** Hourly cron trigger for incremental transaction syncs. */
  'cron/sync-transactions.tick': {
    data: Record<string, never>;
  };
};

/**
 * Inngest client used for both event publishing and function definitions.
 * The `id` is the app identifier in the Inngest dashboard.
 */
export const inngest = new Inngest({
  id: 'scopeguard',
  schemas: new EventSchemas().fromRecord<Events>(),
});
