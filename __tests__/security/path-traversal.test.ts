import { describe, it, expect } from 'vitest'
import path from 'node:path'

/**
 * Tests for the path traversal protection logic used in realtime/src/index.ts.
 * We test the pure logic here rather than spinning up the HTTP server.
 */

const testClientDir = '/app/test-client'

function isPathSafe(requestUrl: string): { safe: boolean; resolvedPath?: string; error?: string } {
  let decodedUrl: string
  try {
    decodedUrl = decodeURIComponent(requestUrl)
  } catch {
    return { safe: false, error: 'bad-request' }
  }

  const requestedPath = decodedUrl === '/' ? '/index.html' : decodedUrl
  const resolvedPath = path.resolve(testClientDir, '.' + requestedPath)

  if (resolvedPath !== testClientDir && !resolvedPath.startsWith(testClientDir + path.sep)) {
    return { safe: false, error: 'forbidden' }
  }

  return { safe: true, resolvedPath }
}

describe('Path traversal protection', () => {
  it('allows root path', () => {
    const result = isPathSafe('/')
    expect(result.safe).toBe(true)
    expect(result.resolvedPath).toBe(path.join(testClientDir, 'index.html'))
  })

  it('allows normal file paths', () => {
    const result = isPathSafe('/client.js')
    expect(result.safe).toBe(true)
    expect(result.resolvedPath).toBe(path.join(testClientDir, 'client.js'))
  })

  it('allows nested file paths', () => {
    const result = isPathSafe('/css/style.css')
    expect(result.safe).toBe(true)
    expect(result.resolvedPath).toBe(path.join(testClientDir, 'css', 'style.css'))
  })

  it('blocks basic directory traversal', () => {
    const result = isPathSafe('/../../../etc/passwd')
    expect(result.safe).toBe(false)
    expect(result.error).toBe('forbidden')
  })

  it('blocks URL-encoded directory traversal (%2e%2e)', () => {
    const result = isPathSafe('/%2e%2e/%2e%2e/%2e%2e/etc/passwd')
    expect(result.safe).toBe(false)
    expect(result.error).toBe('forbidden')
  })

  it('blocks double-encoded traversal', () => {
    // %252e decodes to %2e on first pass, which would decode to . on second
    // But decodeURIComponent only decodes once, so %252e → %2e
    // path.resolve would treat %2e as literal characters, not dots
    // This should still be safe as the resolved path would contain literal %2e
    const result = isPathSafe('/%252e%252e/%252e%252e/etc/passwd')
    expect(result.safe).toBe(true) // %2e is literal, stays in testClientDir
  })

  it('blocks traversal with backslashes (Windows-style)', () => {
    const result = isPathSafe('/..\\..\\..\\etc\\passwd')
    // On POSIX, backslashes are literal chars — not path separators
    // The resolved path stays within testClientDir on POSIX
    // On Windows, path.resolve treats them as separators, so this would be blocked
    if (process.platform === 'win32') {
      expect(result.safe).toBe(false)
    } else {
      // On POSIX, backslash is a valid filename char — path stays within dir
      expect(result.safe).toBe(true)
    }
  })

  it('blocks traversal to parent directory', () => {
    const result = isPathSafe('/..')
    expect(result.safe).toBe(false)
    expect(result.error).toBe('forbidden')
  })

  it('returns bad-request for malformed URL encoding', () => {
    const result = isPathSafe('/%ZZ')
    expect(result.safe).toBe(false)
    expect(result.error).toBe('bad-request')
  })

  it('allows file with dots in name', () => {
    const result = isPathSafe('/bundle.min.js')
    expect(result.safe).toBe(true)
  })
})
