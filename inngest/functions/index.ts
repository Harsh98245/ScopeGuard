/**
 * @file inngest/functions/index.ts
 * @description Barrel of every registered Inngest function. The `serve()`
 *              endpoint at /api/webhooks/inngest reads from this list, so
 *              adding a new function only requires:
 *                1. Implement it under inngest/functions/<name>.ts.
 *                2. Export it from this file.
 *
 *              Inngest will auto-register it on the next deploy.
 */

import { categorizeTransaction } from '@/inngest/functions/categorizeTransaction';
import { notifyUserOfVerdict } from '@/inngest/functions/notifyUserOfVerdict';
import { parseUploadedContract } from '@/inngest/functions/parseUploadedContract';
import { processInboundEmail } from '@/inngest/functions/processInboundEmail';
import {
  syncIntegrationOnConnect,
  syncIntegrationsHourly,
} from '@/inngest/functions/syncIntegration';

export const functions = [
  parseUploadedContract,
  processInboundEmail,
  notifyUserOfVerdict,
  categorizeTransaction,
  syncIntegrationOnConnect,
  syncIntegrationsHourly,
] as const;
