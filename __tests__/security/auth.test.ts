import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SignJWT } from 'jose'

const TEST_SECRET = 'test-jwt-secret-that-is-long-enough'
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET)

async function createValidToken(sub = 'user-123') {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(SECRET_KEY)
}

async function createExpiredToken() {
  return new SignJWT({ sub: 'user-123' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('-1h')
    .sign(SECRET_KEY)
}

async function createTokenWithoutSub() {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(SECRET_KEY)
}

function createMockSocket(token?: string) {
  return {
    handshake: {
      auth: token !== undefined ? { token } : {},
    },
    data: {} as Record<string, unknown>,
  }
}

describe('createAuthMiddleware', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('skips auth when SUPABASE_JWT_SECRET is not set (dev mode)', async () => {
    delete process.env.SUPABASE_JWT_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const socket = createMockSocket()
    const next = vi.fn()

    middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('rejects connection when no token is provided', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const socket = createMockSocket()
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Authentication required')
  })

  it('accepts connection with valid token and attaches userId', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const token = await createValidToken('user-456')
    const socket = createMockSocket(token)
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith()
    expect(socket.data.userId).toBe('user-456')
  })

  it('rejects connection with expired token', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const token = await createExpiredToken()
    const socket = createMockSocket(token)
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Invalid or expired token')
  })

  it('rejects connection with invalid token', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const socket = createMockSocket('garbage-token')
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Invalid or expired token')
  })

  it('rejects connection with token signed by wrong secret', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const wrongKey = new TextEncoder().encode('wrong-secret-key-long-enough-here')
    const wrongToken = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(wrongKey)

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const socket = createMockSocket(wrongToken)
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Invalid or expired token')
  })

  it('rejects token without sub claim', async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET
    delete process.env.NODE_ENV

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    const middleware = createAuthMiddleware()
    const token = await createTokenWithoutSub()
    const socket = createMockSocket(token)
    const next = vi.fn()

    await middleware(socket as any, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toBe('Invalid token: missing sub claim')
  })

  it('exits process in production when SUPABASE_JWT_SECRET is not set', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.SUPABASE_JWT_SECRET

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    const { createAuthMiddleware } = await import('../../realtime/src/auth')
    createAuthMiddleware()

    expect(mockExit).toHaveBeenCalledWith(1)
    mockExit.mockRestore()
  })
})
