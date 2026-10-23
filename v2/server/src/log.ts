// Structured JSON logs, one object per line on stdout. No dependency needed.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;

export function setLogLevel(level: string): void {
  threshold = ORDER[level as Level] ?? ORDER.info;
}

function errFields(v: unknown): unknown {
  if (v instanceof Error) {
    const cause = (v as { cause?: unknown }).cause;
    return { name: v.name, message: v.message, ...(cause ? { cause: String(cause) } : {}) };
  }
  return v;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const rec: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (fields) for (const [k, v] of Object.entries(fields)) rec[k] = errFields(v);
  process.stdout.write(JSON.stringify(rec) + '\n');
}

export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  child(bound: Record<string, unknown>): Logger;
}

function make(bound: Record<string, unknown>): Logger {
  const m = (level: Level) => (msg: string, f?: Record<string, unknown>) =>
    write(level, msg, f ? { ...bound, ...f } : bound);
  return {
    debug: m('debug'),
    info: m('info'),
    warn: m('warn'),
    error: m('error'),
    child: (more) => make({ ...bound, ...more }),
  };
}

export const log: Logger = make({});
