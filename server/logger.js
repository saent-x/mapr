/**
 * Minimal structured logs (one JSON object per line) for production aggregators.
 */

function emit(level, msg, meta = {}) {
  const line = JSON.stringify({
    level,
    msg,
    t: new Date().toISOString(),
    ...meta
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};
