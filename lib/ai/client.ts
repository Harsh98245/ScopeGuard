/**
 * @file lib/ai/client.ts
 * @description Thin wrapper around the Anthropic SDK. Centralises the model
 *              choice, the lazy singleton, and the {@link callTool} helper
 *              every AI feature uses.
 *
 *              Tests mock this module via `vi.mock('@/lib/ai/client', ...)`
 *              rather than mocking @anthropic-ai/sdk directly — keeps the
 *              mock surface tiny and stable across SDK upgrades.
 */

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageParam, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';

let _client: Anthropic | null = null;

/** Lazy SDK instance. Reads ANTHROPIC_API_KEY at first call. */
export function getAnthropicClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY env var is required for the AI layer.');
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/** Resolve the model identifier, defaulting to the value chosen in ADR-003. */
export function getAnthropicModel(): string {
  return process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6';
}

/** Reset the cached client. Test-only helper — never call from app code. */
export function resetAnthropicClient(): void {
  _client = null;
}

/** Parameters for the high-level `callTool` helper. */
export interface CallToolParams {
  /** System prompt content. May be a plain string or an array of text blocks
   *  (use the array form to attach `cache_control` markers for prompt caching). */
  system: string | TextBlockParam[];
  /** Conversation messages — typically a single user turn for our use cases. */
  messages: MessageParam[];
  /** Tool definitions sent to Claude. We always force one specific tool. */
  tools: Tool[];
  /** The exact tool name Claude must call. */
  toolName: string;
  /** Hard limit on output tokens. */
  maxTokens?: number;
}

/** Return shape of a forced tool_use call. `input` is the raw JSON Claude
 *  emitted; the caller validates it against the matching Zod schema. */
export interface ToolUseResult {
  /** The tool_use payload. Validate with Zod before treating as trusted. */
  input: unknown;
  /** Why the model stopped; expected to be 'tool_use' on success. */
  stopReason: Message['stop_reason'];
  /** Anthropic usage stats — used for cost tracking. */
  usage: Message['usage'];
}

/**
 * Run a forced tool_use call against Claude and return the structured input.
 *
 * @param params - System prompt, messages, tool definitions, forced tool name.
 * @returns The tool_use input plus stop_reason + usage stats.
 * @throws Error when Claude does not emit a tool_use block matching toolName.
 *         (The schema validity of `input` is the caller's concern.)
 */
export async function callTool(params: CallToolParams): Promise<ToolUseResult> {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: getAnthropicModel(),
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    tool_choice: { type: 'tool', name: params.toolName },
  });

  const toolBlock = message.content.find(
    (block) => block.type === 'tool_use' && block.name === params.toolName,
  );

  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error(
      `Anthropic response did not contain a tool_use block for "${params.toolName}".`,
    );
  }

  return {
    input: toolBlock.input,
    stopReason: message.stop_reason,
    usage: message.usage,
  };
}
