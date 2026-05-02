/**
 * @file tests/unit/finances/categorize.test.ts
 * @description Tests for the AI categoriser. `@/lib/ai/client` is mocked
 *              so we never hit the network. Tests verify:
 *                - Happy path returns a parsed CategorizeResult.
 *                - Empty descriptions are rejected synchronously.
 *                - Invalid Claude payloads trigger a retry; exhaustion
 *                  throws CategorizeError carrying the attempt count.
 *                - The retry prompt includes the prior validation issues.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callToolMock = vi.fn();

vi.mock('@/lib/ai/client', () => ({
  callTool: callToolMock,
  // Provide stubs so accidental imports don't blow up.
  getAnthropicClient: vi.fn(),
  getAnthropicModel: vi.fn(() => 'claude-sonnet-4-6'),
  resetAnthropicClient: vi.fn(),
}));

import { CategorizeError, categorizeExpense } from '@/lib/finances/categorize';

beforeEach(() => {
  callToolMock.mockReset();
});

afterEach(() => {
  callToolMock.mockReset();
});

describe('categorizeExpense', () => {
  it('throws synchronously on an empty description (no AI call)', async () => {
    await expect(
      categorizeExpense({ description: '   ' }),
    ).rejects.toThrow(CategorizeError);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it('returns a validated result on the first attempt', async () => {
    callToolMock.mockResolvedValueOnce({
      input: {
        category: 'software',
        taxDeductible: true,
        confidence: 0.95,
        reasoning: 'GitHub.com is a developer software service.',
      },
      stopReason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 30 },
    });

    const result = await categorizeExpense({
      description: 'GITHUB.COM 4-MONTH-CHARGE',
      amount: '17.00',
      currency: 'USD',
    });

    expect(result.category).toBe('software');
    expect(result.taxDeductible).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(callToolMock).toHaveBeenCalledTimes(1);
  });

  it('retries on an invalid payload, succeeds on the second try', async () => {
    callToolMock
      .mockResolvedValueOnce({
        input: { category: 'NOT_A_CATEGORY', taxDeductible: true, confidence: 0.5, reasoning: 'x' },
        stopReason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        input: {
          category: 'office',
          taxDeductible: true,
          confidence: 0.7,
          reasoning: 'Office supplies vendor.',
        },
        stopReason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const result = await categorizeExpense({ description: 'STAPLES 1234' });
    expect(result.category).toBe('office');
    expect(callToolMock).toHaveBeenCalledTimes(2);

    // Second call should include the prior validation issues in the prompt
    // text so Claude can self-correct.
    const secondCallArgs = callToolMock.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userText = secondCallArgs.messages[0]!.content;
    expect(userText).toMatch(/previous answer failed validation/i);
    expect(userText).toMatch(/category/i);
  });

  it('throws CategorizeError after MAX_ATTEMPTS exhaustion', async () => {
    callToolMock.mockResolvedValue({
      input: { category: 'BOGUS' }, // always invalid
      stopReason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(
      categorizeExpense({ description: 'unknown vendor' }),
    ).rejects.toMatchObject({ name: 'CategorizeError', attempts: 3 });

    expect(callToolMock).toHaveBeenCalledTimes(3);
  });
});
