/**
 * @file tests/unit/ai/parseContract.test.ts
 * @description Behaviour tests for parseContract. The Anthropic client
 *              wrapper (`@/lib/ai/client`) is mocked so these tests never
 *              touch the network and don't need an ANTHROPIC_API_KEY.
 *
 *              What we verify here:
 *                1. Each contract fixture round-trips when the (mocked)
 *                   model returns a schema-valid payload.
 *                2. Schema-invalid responses trigger a re-prompt.
 *                3. Three consecutive invalid responses raise
 *                   ContractParseError with attempts=3.
 *                4. Empty / oversized contract text is rejected before any
 *                   model call is made.
 *
 *              Live-quality tests against real Claude responses live in a
 *              separate integration suite that's intentionally NOT part
 *              of `pnpm test`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractFixtures } from '@/tests/fixtures/contracts';

// IMPORTANT: vi.mock must come BEFORE the module under test is imported.
vi.mock('@/lib/ai/client', () => ({
  callTool: vi.fn(),
  getAnthropicClient: vi.fn(),
  getAnthropicModel: vi.fn(() => 'claude-sonnet-4-6'),
  resetAnthropicClient: vi.fn(),
}));

import { callTool } from '@/lib/ai/client';
import { ContractParseError } from '@/lib/ai/errors';
import { parseContract } from '@/lib/ai/parseContract';

const mockedCallTool = vi.mocked(callTool);

/** Helper: build a valid ParsedContract payload. */
function validParsedContract(overrides: Record<string, unknown> = {}): unknown {
  return {
    deliverables: [
      {
        id: 'd1',
        clauseReference: 'Section 2.1',
        text: 'Static marketing pages.',
        isAmbiguous: false,
      },
    ],
    exclusions: [
      { clauseReference: 'Section 3.1', text: 'Authentication is out of scope.' },
    ],
    paymentTerms: { amount: 8500, currency: 'USD', schedule: '50/50' },
    overallRiskScore: 4,
    riskFlags: ['No revision-overflow rate specified'],
    ...overrides,
  };
}

function toolUseResponse(input: unknown) {
  return {
    input,
    stopReason: 'tool_use' as const,
    usage: { input_tokens: 1234, output_tokens: 456 },
  };
}

describe('parseContract — happy path', () => {
  beforeEach(() => {
    mockedCallTool.mockReset();
  });
  afterEach(() => {
    mockedCallTool.mockReset();
  });

  it.each(Object.entries(contractFixtures))(
    'parses the %s fixture when the model returns a valid payload',
    async (_name, contractText) => {
      mockedCallTool.mockResolvedValueOnce(toolUseResponse(validParsedContract()));

      const parsed = await parseContract({ contractText });

      expect(mockedCallTool).toHaveBeenCalledTimes(1);
      const call = mockedCallTool.mock.calls[0]![0];
      expect(call.toolName).toBe('record_parsed_contract');
      // Contract text reaches the user message.
      const firstMessage = call.messages[0]!;
      expect(JSON.stringify(firstMessage.content)).toContain(contractText.slice(0, 60));
      expect(parsed.deliverables).toHaveLength(1);
      expect(parsed.exclusions).toHaveLength(1);
      expect(parsed.overallRiskScore).toBe(4);
    },
  );
});

describe('parseContract — input validation', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('rejects empty contract text without calling the model', async () => {
    await expect(parseContract({ contractText: '   ' })).rejects.toBeInstanceOf(
      ContractParseError,
    );
    expect(mockedCallTool).not.toHaveBeenCalled();
  });

  it('rejects oversize contract text without calling the model', async () => {
    const huge = 'a'.repeat(120_001);
    await expect(parseContract({ contractText: huge })).rejects.toBeInstanceOf(
      ContractParseError,
    );
    expect(mockedCallTool).not.toHaveBeenCalled();
  });
});

describe('parseContract — retry on invalid payload', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('retries when the model returns a schema-invalid payload, then succeeds', async () => {
    // Attempt 1: missing required field "exclusions".
    mockedCallTool.mockResolvedValueOnce(
      toolUseResponse({
        deliverables: [],
        paymentTerms: {},
        overallRiskScore: 5,
        riskFlags: [],
        // exclusions: missing
      }),
    );
    // Attempt 2: valid.
    mockedCallTool.mockResolvedValueOnce(toolUseResponse(validParsedContract()));

    const parsed = await parseContract({ contractText: contractFixtures.simple });

    expect(mockedCallTool).toHaveBeenCalledTimes(2);
    // Retry user text references the validation issue.
    const retryCall = mockedCallTool.mock.calls[1]![0];
    const retryUser = JSON.stringify(retryCall.messages[0]!.content);
    expect(retryUser).toMatch(/did not match the required schema/i);
    expect(parsed.deliverables).toHaveLength(1);
  });

  it('throws ContractParseError after MAX_ATTEMPTS invalid payloads', async () => {
    const invalid = toolUseResponse({ deliverables: 'not-an-array' });
    mockedCallTool.mockResolvedValue(invalid);

    await expect(parseContract({ contractText: contractFixtures.simple })).rejects.toMatchObject({
      name: 'ContractParseError',
      attempts: 3,
    });
    expect(mockedCallTool).toHaveBeenCalledTimes(3);
  });
});

describe('parseContract — surfaces transport errors', () => {
  beforeEach(() => mockedCallTool.mockReset());

  it('wraps a thrown SDK error in ContractParseError on the same attempt', async () => {
    mockedCallTool.mockRejectedValueOnce(new Error('connection reset'));

    await expect(parseContract({ contractText: contractFixtures.simple })).rejects.toMatchObject({
      name: 'ContractParseError',
      attempts: 1,
    });
  });
});
