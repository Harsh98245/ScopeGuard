# ADR 003 — AI model: Claude Sonnet 4.6 with tool_use, not free-form text

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decider:** Founding engineer
- **Supersedes:** —
- **Superseded by:** —

## Context

Two AI calls sit on the critical path:

1. **`parseContract`** — extract structured deliverables / exclusions / ambiguous terms from a 5–30 page contract.
2. **`checkScope`** — given parsed contract context and a client email, return `IN_SCOPE | OUT_OF_SCOPE | AMBIGUOUS` plus a cited clause and drafted response.

Both must return strict JSON that downstream code consumes without further parsing. Both must reason over multi-thousand-token inputs.

The product spec lists `claude-sonnet-4-20250514` as the model. That string does not match Anthropic's actual published model identifiers — current production-grade Sonnet is **Claude Sonnet 4.6** (`claude-sonnet-4-6`).

Requirements:

1. Strong instruction-following on long inputs (legal text).
2. Native structured-output support (tool_use / function calling).
3. Good cost/latency profile — scope checks are user-facing.
4. Stable model identifier we can pin in env.

## Decision

Default model: **`claude-sonnet-4-6`** (configurable via `ANTHROPIC_MODEL` env var).

All AI calls use Claude's `tool_use` feature with a strict input schema. We never parse free-form text returned by the model. The "tool" in our case is a synthetic function (`record_parsed_contract`, `record_scope_verdict`) whose JSON schema is the structured output we want — Claude is instructed to call it.

Prompt-caching is enabled on the contract context block (the parsed deliverables list rarely changes between scope checks for the same project), reducing per-check cost meaningfully.

## Consequences

### Positive

- Tool_use schema enforces output shape at the model boundary, eliminating brittle JSON parsing and the "model returned prose, broke our regex" failure mode.
- Pinning a specific model version makes regressions reproducible — model upgrades become explicit changes, not silent ones.
- Prompt caching cuts the cost of high-frequency scope checks for the same project.

### Negative

- Single-vendor risk on the most differentiated capability of the product. Mitigation tracked below.
- Tool_use payloads are slightly more verbose than free-form, which costs a few tokens per request. Negligible at our scale.
- Pin-to-version means we have to deliberately upgrade. We update this ADR when we move.

## Alternatives considered

- **GPT-4.1 / o-series with JSON mode:** Comparable quality. Chose Claude for its longer effective context handling on legal text and the tool_use ergonomics. Optionality preserved by isolating model calls behind `lib/ai/*.ts` — the model can be swapped by editing one file.
- **Free-form Claude with regex parsing:** Tried in prototype; brittle. Tool_use is non-negotiable.
- **Anthropic Sonnet vs. Opus:** Opus is overkill for scope-check; the latency premium hurts the user-facing pipeline. Sonnet 4.6 hits the quality/latency sweet spot. We will A/B Opus on hard cases ("AMBIGUOUS at confidence < 0.6") in a future iteration.

## Operational notes

- Set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in env. The latter defaults to `claude-sonnet-4-6` so production cannot accidentally run on a deprecated model.
- `lib/ai/checkScope.ts` retries up to 3 times on `tool_use` schema validation failure (very rare with this model + a well-defined schema, but the retry guard means a one-off bad output never reaches users).
- Track per-call cost in PostHog event `ai.call.completed` so we can detect regressions.
