import { describe, it, expect, vi, beforeEach } from 'vitest'

// mediasoup is a native C++ addon — vitest cannot intercept its ESM binding.
// We test the error path (no workers) via a fresh module with NUM_WORKERS=0,
// and validate the round-robin logic indirectly through the rooms test suite
// (which mocks getNextWorker).

describe('workers module', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getNextWorker throws when no workers exist', async () => {
    vi.doMock('mediasoup', () => ({
      createWorker: vi.fn(),
    }))
    vi.doMock('../../realtime/src/config.js', () => ({
      workerSettings: {},
      NUM_WORKERS: 0,
    }))

    const { getNextWorker, createWorkers } = await import(
      '../../realtime/src/mediasoup/workers.js'
    )

    await createWorkers()
    expect(() => getNextWorker()).toThrow('No mediasoup workers available')
  })
})
