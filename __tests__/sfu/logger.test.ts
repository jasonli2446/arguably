import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock process.stdout.write to capture output
let output: string[] = []
const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
  output.push(String(chunk))
  return true
})

// Import after spy is set up
import { createLogger } from '../../realtime/src/logger'

describe('createLogger', () => {
  beforeEach(() => { output = [] })
  afterEach(() => { vi.clearAllMocks() })

  it('emits a JSON line for info', () => {
    const log = createLogger('test')
    log.info({ key: 'val' }, 'hello')
    expect(output).toHaveLength(1)
    const parsed = JSON.parse(output[0])
    expect(parsed.level).toBe('info')
    expect(parsed.component).toBe('test')
    expect(parsed.msg).toBe('hello')
    expect(parsed.key).toBe('val')
    expect(typeof parsed.time).toBe('string')
  })

  it('includes component in every log line', () => {
    const log = createLogger('signaling')
    log.warn({}, 'watch out')
    const parsed = JSON.parse(output[0])
    expect(parsed.component).toBe('signaling')
  })

  it('spreads context fields into the log entry', () => {
    const log = createLogger('test')
    log.error({ socketId: 'abc', error: 'oops' }, 'something failed')
    const parsed = JSON.parse(output[0])
    expect(parsed.socketId).toBe('abc')
    expect(parsed.error).toBe('oops')
    expect(parsed.msg).toBe('something failed')
  })

  it('emits correct level for each method', () => {
    const log = createLogger('test')
    const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const
    // Temporarily set env to debug level by restoring real stdout and re-importing
    // Instead, test via output content check
    log.warn({}, 'w')
    log.error({}, 'e')
    log.fatal({}, 'f')
    const levels_out = output.map((l) => JSON.parse(l).level)
    expect(levels_out).toEqual(['warn', 'error', 'fatal'])
  })

  it('output is valid newline-terminated JSON', () => {
    const log = createLogger('test')
    log.info({}, 'check')
    expect(output[0]).toMatch(/\n$/)
    expect(() => JSON.parse(output[0])).not.toThrow()
  })

  it('does not emit debug logs when LOG_LEVEL is info (default)', () => {
    const log = createLogger('test')
    log.debug({ x: 1 }, 'debug msg')
    expect(output).toHaveLength(0)
  })

  it('time field is an ISO timestamp', () => {
    const log = createLogger('test')
    log.info({}, 'ts check')
    const { time } = JSON.parse(output[0])
    expect(new Date(time).toISOString()).toBe(time)
  })
})
