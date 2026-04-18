export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push("Must be at least 8 characters")
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Must include an uppercase letter")
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Must include a lowercase letter")
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Must include a number")
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Must include a special character")
  }

  return { valid: errors.length === 0, errors }
}

export function getPasswordStrength(password: string): 'weak' | 'fair' | 'strong' {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++

  if (score <= 2) return 'weak'
  if (score <= 3) return 'fair'
  return 'strong'
}
