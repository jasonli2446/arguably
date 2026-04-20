import { describe, it, expect } from 'vitest'

function validateRoomName(roomName: string): string | null {
  if (!roomName.trim()) return 'Room name is required'
  if (roomName.trim().length > 200) return 'Room name must be 200 characters or fewer'
  return null
}

describe('Create page room name validation', () => {
  it('accepts a normal room name', () => {
    expect(validateRoomName('Climate Change Debate')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateRoomName('')).toBe('Room name is required')
  })

  it('rejects whitespace-only string', () => {
    expect(validateRoomName('   ')).toBe('Room name is required')
  })

  it('accepts exactly 200 characters', () => {
    expect(validateRoomName('A'.repeat(200))).toBeNull()
  })

  it('rejects 201 characters', () => {
    expect(validateRoomName('A'.repeat(201))).toBe('Room name must be 200 characters or fewer')
  })

  it('trims before checking length — 200 non-whitespace chars after trim passes', () => {
    const name = '  ' + 'A'.repeat(200) + '  '
    expect(validateRoomName(name)).toBeNull()
  })

  it('trims before checking length — 201 non-whitespace chars after trim fails', () => {
    const name = '  ' + 'A'.repeat(201) + '  '
    expect(validateRoomName(name)).toBe('Room name must be 200 characters or fewer')
  })
})
