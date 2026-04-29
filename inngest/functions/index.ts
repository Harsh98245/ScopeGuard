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

import { parseUploadedContract } from '@/inngest/functions/parseUploadedContract';

export const functions = [parseUploadedContract] as const;
