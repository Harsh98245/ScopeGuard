/**
 * @file inngest/functions/notifyUserOfVerdict.ts
 * @description Fires after every saved ScopeCheck. Sends the user a short
 *              email summary with a deep link back to the inbox so they can
 *              act on the verdict without opening the dashboard first.
 *
 *              Realtime browser notifications are out of scope here — those
 *              ride Supabase Realtime subscribed to the `scope_checks` table
 *              from the Inbox UI (lands in session 7). Saving the row in
 *              processInboundEmail is what triggers them; this function
 *              handles only the email channel.
 */

import { sendEmail } from '@/lib/email/outbound';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { inngest } from '@/inngest/client';

const VERDICT_LABELS: Record<'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS', string> = {
  IN_SCOPE: 'In scope',
  OUT_OF_SCOPE: 'Out of scope',
  AMBIGUOUS: 'Ambiguous',
};

export const notifyUserOfVerdict = inngest.createFunction(
  {
    id: 'notify-user-of-verdict',
    name: 'Notify user of verdict',
    retries: 3,
    // One email per scope check, even if the upstream event arrives twice.
    idempotency: 'event.data.scopeCheckId',
  },
  { event: 'scope/check.completed' },
  async ({ event, step }) => {
    const { userId, projectId, scopeCheckId, verdict, confidence } = event.data;

    const data = await step.run('load', async () => {
      const [user, scopeCheck, project] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
        prisma.scopeCheck.findUnique({
          where: { id: scopeCheckId },
          select: {
            emailSubject: true,
            emailFromAddress: true,
            citedClause: true,
            clauseReference: true,
            draftResponse: true,
            estimatedHours: true,
          },
        }),
        prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      ]);
      if (!user || !scopeCheck || !project) {
        throw new Error('notify-user-of-verdict: row missing — bailing');
      }
      return { user, scopeCheck, project };
    });

    const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? '';
    const inboxUrl = `${appUrl}/inbox`;
    const projectUrl = `${appUrl}/projects/${projectId}`;

    const verdictLabel = VERDICT_LABELS[verdict];
    const subject = `[${verdictLabel}] ${data.project.name} — ${data.scopeCheck.emailSubject ?? 'New client request'}`;

    const lines: string[] = [
      `Verdict: ${verdictLabel} (confidence ${(confidence * 100).toFixed(0)}%)`,
      '',
      `Project: ${data.project.name}`,
      `From: ${data.scopeCheck.emailFromAddress ?? 'unknown'}`,
    ];

    if (data.scopeCheck.clauseReference && data.scopeCheck.citedClause) {
      lines.push('', `Cited clause (${data.scopeCheck.clauseReference}):`);
      lines.push(data.scopeCheck.citedClause);
    }

    if (verdict === 'OUT_OF_SCOPE' && data.scopeCheck.estimatedHours) {
      lines.push('', `Estimated additional hours: ${data.scopeCheck.estimatedHours}`);
    }

    lines.push('', `Open the inbox to see the drafted reply: ${inboxUrl}`);
    lines.push(`Project page: ${projectUrl}`);
    lines.push('', '— ScopeGuard');

    await step.run('send-email', async () => {
      const messageId = await sendEmail({
        to: data.user.email,
        subject,
        textBody: lines.join('\n'),
      });
      logger.info('notify.email.sent', { userId, scopeCheckId, postmarkId: messageId });
    });

    return { delivered: true };
  },
);
