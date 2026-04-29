/**
 * @file app/api/webhooks/inngest/route.ts
 * @description Inngest's serve endpoint — Inngest Cloud calls this URL to
 *              dispatch events to the registered functions. The `serve()`
 *              helper handles signature verification (using INNGEST_SIGNING_KEY)
 *              and route shape; we just plug in our client + functions list.
 */

import { serve } from 'inngest/next';

import { inngest } from '@/inngest/client';
import { functions } from '@/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...functions],
});
