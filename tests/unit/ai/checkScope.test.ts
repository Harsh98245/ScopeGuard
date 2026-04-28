/**
 * @file tests/unit/ai/checkScope.test.ts
 * @description Behaviour tests for checkScope. Anthropic client mocked.
 *
 *              What we verify:
 *                1. Each of the 10 email fixtures round-trips when the model
 *                   returns the matching valid verdict payload.
 *                2. The contract-context block carries the cache_control
 *                   marker (prompt caching wired correctly).
 *                3. Schema-invalid payloads trigger re-prompts.
 *                4. Three invalid payloads → ScopeCheckError with attempts=3.
 *                5. Empty / oversized email content rejected before any
 *                   model call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailFixtures } from '@/tests/fixtures/emails';

vi.mock('@/lib/ai/client', () => ({
  callTool: vi.fn(),
  getAnthropicClient: vi.fn(),
  getAnthropicModel: vi.fn(() => 'claude-sonnet-4-6'),
  resetAnthropicClient: vi.fn(),
}));

import { callTool } from '@/lib/ai/client';
import { checkScope } from '@/lib/ai/checkScope';
import { ScopeCheckError } from '@/lib/ai/errors';
import type { ParsedContract } from '@/lib/ai/types';

const mockedCallTool = vi.mocked(callTool);

const PARSED: ParsedContract = {
  deliverables: [
    {
      id: 'd1',
      clauseReference: '§2.1',
      text: 'Static marketing pages.',
      isAmbiguous: false,
    },
  ],
  exclusions: [
    { clauseReference: '§3.1', text: 'Authentication, dashboards, and payment integrations.' },
  ],
  paymentTerms: { amount: 8500, currency: 'USD', schedule: '50/50' },
  overallRiskScore: 4,
  riskFlags: [],
  revisionPolicy: 'Up to two rounds of revisions per page.',
};

function validVerdict(verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS'): unknown {
  return {
    verdict,
    confidence: 0.9,
    reasoning: 'Matches an explicit deliverable.',
    citedClause: 'Static marketing pages.',
    clauseReference: '§2.1',
    draftPoliteDecline: 'Hi — happy to help, but this would fall outside our current scope.',
    draftChangeOrder: 'Change Order #1 — see attached for line items.',
    estimatedAdditionalHours: null,
  };
}

function toolUseResponse(input: unknown) {
  return {
    input,
    stopReason: 'tool_use' as const,
    usage: { input_tokens: 2000, output_tokens: 500 },
  };
}

describe('checkScope — happy path across all 10 email scenarios', () => {
  beforeEach(() => mockedCallTool.mockReset());
  afterEach(() => mockedCallTool.mockReset());

  it.each(emailFixtures.map((f) => [f.id, f] as const))(
    'returns the expected verdict for %s',
    async (_id, fixture) => {
      mockedCallTool.mockResolvedValueOnce(toolUseResponse(validVerdict(fixture.expectedVerdict)));

      const result = await checkScope({
        emailContent: fixture.body,
        emailSubject: fixture.subject,
        parsedContract: PARSED,
        projectContext: { hourlyRate: 125, currency: 'USD', clientName: 'Acme Corp' },
      });

      expect(mockedCallTool).toHaveBeenCalledTimes(1);
      expect(result.verdict).toBe(fixture.expectedVerdict);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.draftPoliteDecline.length).toBeGreaterThan(0);
      expect(result.draftChangeOrder.length).toBeGreaterThan(0);
    },
  );
});

describe('checkScope — prompt construction', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('attaches cache_control to the contract-context block', async () => {
    mockedCallTool.mockResolvedValueOnce(toolUseResponse(validVerdict('IN_SCOPE')));

    await checkScope({
      emailContent: 'Quick request — please tweak the hero copy.',
      parsedContract: PARSED,
    });

    const call = mockedCallTool.mock.calls[0]![0];
    const blocks = call.messages[0]!.content as Array<{
      type: string;
      cache_control?: { type: string };
      text?: string;
    }>;

    expect(Array.isArray(blocks)).toBe(true);
    const cached = blocks.find((b) => b.cache_control?.type === 'ephemeral');
    expect(cached).toBeDefined();
    expect(cached?.text).toContain('=== CONTRACT CONTEXT ===');
    // The email block must NOT be cached (it changes per call).
    const emailBlock = blocks.find((b) => b.text?.includes('=== CLIENT EMAIL ==='));
    expect(emailBlock?.cache_control).toBeUndefined();
  });

  it('renders deliverables, exclusions, and revision policy deterministically', async () => {
    mockedCallTool.mockResolvedValueOnce(toolUseResponse(validVerdict('IN_SCOPE')));
    await checkScope({ emailContent: 'tweak', parsedContract: PARSED });

    const blocks = mockedCallTool.mock.calls[0]![0].messages[0]!.content as Array<{
      text?: string;
    }>;
    const ctx = blocks.find((b) => b.text?.includes('=== CONTRACT CONTEXT ==='))?.text ?? '';
    expect(ctx).toContain('Deliverables:');
    expect(ctx).toContain('Static marketing pages.');
    expect(ctx).toContain('Explicit exclusions:');
    expect(ctx).toContain('Authentication, dashboards, and payment integrations.');
    expect(ctx).toContain('Revision policy: Up to two rounds of revisions per page.');
  });
});

describe('checkScope — input validation', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('rejects empty email content', async () => {
    await expect(
      checkScope({ emailContent: '   ', parsedContract: PARSED }),
    ).rejects.toBeInstanceOf(ScopeCheckError);
    expect(mockedCallTool).not.toHaveBeenCalled();
  });

  it('rejects oversize email content', async () => {
    await expect(
      checkScope({ emailContent: 'a'.repeat(40_001), parsedContract: PARSED }),
    ).rejects.toBeInstanceOf(ScopeCheckError);
  });
});

describe('checkScope — retry behaviour', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('retries on invalid payload, then succeeds', async () => {
    // Attempt 1: confidence out of range.
    mockedCallTool.mockResolvedValueOnce(
      toolUseResponse({ ...(validVerdict('IN_SCOPE') as object), confidence: 1.5 }),
    );
    mockedCallTool.mockResolvedValueOnce(toolUseResponse(validVerdict('IN_SCOPE')));

    const result = await checkScope({ emailContent: 'tweak', parsedContract: PARSED });
    expect(mockedCallTool).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe(0.9);
  });

  it('throws ScopeCheckError after MAX_ATTEMPTS', async () => {
    mockedCallTool.mockResolvedValue(toolUseResponse({ verdict: 'NOPE' }));

    await expect(
      checkScope({ emailContent: 'tweak', parsedContract: PARSED }),
    ).rejects.toMatchObject({
      name: 'ScopeCheckError',
      attempts: 3,
    });
    expect(mockedCallTool).toHaveBeenCalledTimes(3);
  });
});
