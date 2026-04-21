import { describe, it, expect } from 'vitest'

interface SessionStub {
  id: string
  name: string
  type: string
  status: string
}

function filterSessions(
  sessions: SessionStub[],
  searchQuery: string,
  typeFilter: string[],
  statusFilter: string[],
): SessionStub[] {
  return sessions.filter((s) => {
    if (!s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (typeFilter.length > 0 && !typeFilter.includes(s.type)) return false
    if (statusFilter.length > 0 && !statusFilter.includes(s.status)) return false
    return true
  })
}

const SESSIONS: SessionStub[] = [
  { id: '1', name: 'Climate Debate', type: 'ONE_ON_ONE', status: 'LIVE' },
  { id: '2', name: 'AI Ethics Panel', type: 'PANEL', status: 'WAITING' },
  { id: '3', name: 'Expert vs Crowd on Tech', type: 'EXPERT_VS_CROWD', status: 'LIVE' },
  { id: '4', name: 'Team Politics', type: 'TEAM', status: 'PAUSED' },
]

describe('BrowseClient filter logic', () => {
  it('returns all sessions with empty filters', () => {
    expect(filterSessions(SESSIONS, '', [], [])).toHaveLength(4)
  })

  it('filters by search query (case-insensitive)', () => {
    const result = filterSessions(SESSIONS, 'climate', [], [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('search query matches partial name', () => {
    const result = filterSessions(SESSIONS, 'panel', [], [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('search query is case-insensitive', () => {
    expect(filterSessions(SESSIONS, 'CLIMATE', [], [])).toHaveLength(1)
    expect(filterSessions(SESSIONS, 'Climate', [], [])).toHaveLength(1)
    expect(filterSessions(SESSIONS, 'climate', [], [])).toHaveLength(1)
  })

  it('returns empty array when search matches nothing', () => {
    expect(filterSessions(SESSIONS, 'xyz-no-match', [], [])).toHaveLength(0)
  })

  it('filters by type when typeFilter is set', () => {
    const result = filterSessions(SESSIONS, '', ['PANEL'], [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('filters by multiple types', () => {
    const result = filterSessions(SESSIONS, '', ['PANEL', 'TEAM'], [])
    expect(result).toHaveLength(2)
  })

  it('does not filter by type when typeFilter is empty', () => {
    expect(filterSessions(SESSIONS, '', [], [])).toHaveLength(4)
  })

  it('filters by status when statusFilter is set', () => {
    const result = filterSessions(SESSIONS, '', [], ['LIVE'])
    expect(result).toHaveLength(2)
    expect(result.every((s) => s.status === 'LIVE')).toBe(true)
  })

  it('filters by multiple statuses', () => {
    const result = filterSessions(SESSIONS, '', [], ['LIVE', 'PAUSED'])
    expect(result).toHaveLength(3)
  })

  it('combines search and type filters', () => {
    const result = filterSessions(SESSIONS, 'Tech', ['EXPERT_VS_CROWD'], [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('3')
  })

  it('combines type and status filters', () => {
    const result = filterSessions(SESSIONS, '', ['ONE_ON_ONE'], ['LIVE'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('type filter that excludes all returns empty', () => {
    expect(filterSessions(SESSIONS, '', ['ONE_ON_ONE'], ['PAUSED'])).toHaveLength(0)
  })
})
