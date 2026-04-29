/** Supported structured log severity levels. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
/** Arbitrary structured fields attached to a log event. */
export type LogContext = Record<string, unknown>

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel
const MIN_LEVEL = LEVEL_VALUES[envLevel] ?? LEVEL_VALUES.info

function emit(level: LogLevel, component: string, ctx: LogContext, msg: string): void {
  if (LEVEL_VALUES[level] < MIN_LEVEL) return
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), level, component, msg, ...ctx }) + '\n',
  )
}

/** Component-scoped structured logger API. */
export interface Logger {
  debug(ctx: LogContext, msg: string): void
  info(ctx: LogContext, msg: string): void
  warn(ctx: LogContext, msg: string): void
  error(ctx: LogContext, msg: string): void
  fatal(ctx: LogContext, msg: string): void
}

/** Creates a JSON logger that tags every event with the given component name. */
export function createLogger(component: string): Logger {
  return {
    debug: (ctx, msg) => emit('debug', component, ctx, msg),
    info:  (ctx, msg) => emit('info',  component, ctx, msg),
    warn:  (ctx, msg) => emit('warn',  component, ctx, msg),
    error: (ctx, msg) => emit('error', component, ctx, msg),
    fatal: (ctx, msg) => emit('fatal', component, ctx, msg),
  }
}
