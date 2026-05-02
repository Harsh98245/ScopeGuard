/**
 * @file lib/utils/logger.ts
 * @description Structured JSON logger. Every log line is a single JSON object
 *              with `timestamp`, `level`, `msg`, and arbitrary structured fields.
 *              Designed to be parsed by Vercel + Sentry breadcrumb capture.
 *
 *              Usage rule: NEVER use `console.log` in production code paths.
 *              ESLint enforces this via `no-console`. Use `logger.info` etc.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /encryption[-_]?key/i,
];

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) return '[redacted]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redact(v, k);
  }
  return out;
}

function minLevel(): Level {
  const env = (process.env['LOG_LEVEL'] ?? '').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  return process.env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel()]) return;

  const redactedFields = fields ? (redact(fields) as Record<string, unknown>) : undefined;

  const line = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...(redactedFields ?? {}),
  };

  // We deliberately use console here — this is the *one* allowed call site
  // because it's the actual transport. ESLint's no-console rule still allows
  // warn/error; debug/info we route through warn to ensure visibility on Vercel.
  if (level === 'error') console.error(JSON.stringify(line));
  else console.warn(JSON.stringify(line));

  // Best-effort Sentry bridge. Fire-and-forget — never blocks the request
  // path. The bridge module gracefully no-ops when SENTRY_DSN is unset.
  void bridgeToSentry(level, msg, redactedFields);
}

/**
 * Forward log lines to Sentry as breadcrumbs (info/warn/error) and
 * captured messages (warn/error). Lazy-imported so the bare logger has
 * no Sentry dependency at module init — tests that don't load Sentry
 * still pass cleanly.
 */
async function bridgeToSentry(
  level: Level,
  msg: string,
  fields: Record<string, unknown> | undefined,
): Promise<void> {
  if (typeof window !== 'undefined') return; // server-side only
  try {
    const { addBreadcrumb, captureMessage } = await import('@/lib/observability/sentry');
    addBreadcrumb('logger', `${level}: ${msg}`, fields);
    if (level === 'warn') captureMessage(msg, 'warning');
    else if (level === 'error') captureMessage(msg, 'error');
  } catch {
    // observability module unavailable (test env, partial install) — no-op.
  }
}

/**
 * Structured logger. Pass a message and an optional context object.
 *
 * @example
 *   logger.info('scope.check.completed', {
 *     userId, projectId, verdict, confidence, latencyMs,
 *   });
 */
export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info:  (msg: string, fields?: Record<string, unknown>) => emit('info',  msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => emit('warn',  msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
