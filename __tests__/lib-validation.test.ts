import { describe, it, expect } from 'vitest'
import { validatePassword, getPasswordStrength } from '@/lib/validation'

// ── validatePassword ──
describe('validatePassword', () => {
  it('accepts a fully valid password', () => {
    const result = validatePassword('Secure1!')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects passwords shorter than 8 characters', () => {
    const result = validatePassword('Ab1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Must be at least 8 characters')
  })

  it('rejects passwords with no uppercase letter', () => {
    const result = validatePassword('secure1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Must include an uppercase letter')
  })

  it('rejects passwords with no lowercase letter', () => {
    const result = validatePassword('SECURE1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Must include a lowercase letter')
  })

  it('rejects passwords with no digit', () => {
    const result = validatePassword('SecureABC!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Must include a number')
  })

  it('rejects passwords with no special character', () => {
    const result = validatePassword('Secure123')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Must include a special character')
  })

  it('collects multiple errors at once', () => {
    const result = validatePassword('short')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('accepts various special characters', () => {
    for (const ch of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')']) {
      const pw = `Secure1${ch}`
      expect(validatePassword(pw).valid).toBe(true)
    }
  })

  it('exactly 8-char password with all requirements passes', () => {
    expect(validatePassword('Abc123!x').valid).toBe(true)
  })
})

// ── getPasswordStrength ──
describe('getPasswordStrength', () => {
  it('rates a very short all-lowercase password as weak', () => {
    expect(getPasswordStrength('abc')).toBe('weak')
  })

  it('rates a password with only length + mixed case as weak', () => {
    expect(getPasswordStrength('abcABC')).toBe('weak')
  })

  it('rates a password with length + mixed case + digit as fair', () => {
    // 8+ chars (1) + mixed case (1) + digit (1) = score 3 → fair
    expect(getPasswordStrength('abcABC12')).toBe('fair')
  })

  it('rates a strong password as strong', () => {
    expect(getPasswordStrength('Secure1!')).toBe('strong')
  })

  it('12+ char password with all criteria is strong', () => {
    expect(getPasswordStrength('SecurePass1!')).toBe('strong')
  })

  it('returns weak for empty string', () => {
    expect(getPasswordStrength('')).toBe('weak')
  })
})
