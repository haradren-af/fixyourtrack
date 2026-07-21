import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquireRouteDraftLock,
  clearRecoverableRouteDraftLease,
  routeDraftLeaseKey,
  routeDraftLockName,
} from '../src/routeDraftLock.js'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

function createEventEnvironment(storage, owner = '00000000-0000-4000-8000-000000000001') {
  const listeners = new Set()
  return {
    localStorage: storage,
    crypto: { randomUUID: () => owner },
    addEventListener(type, listener) {
      if (type === 'storage') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'storage') listeners.delete(listener)
    },
    dispatchStorage(key = routeDraftLeaseKey) {
      for (const listener of listeners) {
        listener({ key, storageArea: storage, newValue: storage.getItem(key) })
      }
    },
    listenerCount: () => listeners.size,
  }
}

function createTimers() {
  let nextId = 1
  const intervals = new Map()
  return {
    setInterval(callback, milliseconds) {
      const id = nextId
      nextId += 1
      intervals.set(id, { callback, milliseconds })
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
    fireIntervals() {
      for (const { callback } of [...intervals.values()]) callback()
    },
    intervals,
  }
}

function fallbackOptions(environment, timers, now) {
  return {
    environment,
    now: () => now.value,
    leaseDurationMs: 300,
    heartbeatIntervalMs: 1_000,
    contentionDelayMs: 0,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  }
}

test('holds a non-blocking Web Lock until release is called', async () => {
  let requestName
  let requestOptions
  let requestFinished = false
  let requestPromise
  const lockManager = {
    request(name, options, callback) {
      requestName = name
      requestOptions = options
      requestPromise = callback({ name })
      requestPromise.then(() => {
        requestFinished = true
      })
      return requestPromise
    },
  }

  const result = await acquireRouteDraftLock({
    environment: { navigator: { locks: lockManager } },
  })

  assert.equal(result.acquired, true)
  assert.equal(result.method, 'web-locks')
  assert.equal(result.isHeld(), true)
  assert.equal(requestName, routeDraftLockName)
  assert.deepEqual(requestOptions, { mode: 'exclusive', ifAvailable: true })
  assert.equal(requestFinished, false)

  result.release()
  result.release()
  assert.deepEqual(await result.lost, { reason: 'released' })
  await requestPromise
  assert.equal(result.isHeld(), false)
  assert.equal(requestFinished, true)
})

test('reports a busy Web Lock immediately without waiting', async () => {
  const result = await acquireRouteDraftLock({
    environment: {
      navigator: {
        locks: {
          request: (_name, _options, callback) => callback(null),
        },
      },
    },
  })

  assert.equal(result.acquired, false)
  assert.equal(result.method, 'web-locks')
  assert.equal(result.reason, 'unavailable')
  assert.equal(result.lost, null)
})

test('does not mix Web Locks with the fallback when a Web Lock request fails', async () => {
  const storage = new MemoryStorage()
  const failure = new Error('Web Locks disabled')
  const result = await acquireRouteDraftLock({
    environment: {
      localStorage: storage,
      navigator: { locks: { request: () => { throw failure } } },
    },
  })

  assert.equal(result.acquired, false)
  assert.equal(result.reason, 'request-failed')
  assert.equal(result.error, failure)
  assert.equal(storage.getItem(routeDraftLeaseKey), null)
})

test('acquires, renews, and releases a localStorage lease', async () => {
  const storage = new MemoryStorage()
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }
  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))

  assert.equal(result.acquired, true)
  assert.equal(result.method, 'local-storage')
  assert.equal(result.isHeld(), true)
  assert.equal(environment.listenerCount(), 1)
  assert.equal(timers.intervals.size, 1)
  assert.equal([...timers.intervals.values()][0].milliseconds, 100)
  assert.equal(JSON.parse(storage.getItem(routeDraftLeaseKey)).expiresAt, 1_300)

  now.value = 1_100
  timers.fireIntervals()
  assert.equal(JSON.parse(storage.getItem(routeDraftLeaseKey)).expiresAt, 1_400)

  result.release()
  assert.equal(result.isHeld(), false)
  assert.equal(storage.getItem(routeDraftLeaseKey), null)
  assert.equal(environment.listenerCount(), 0)
  assert.equal(timers.intervals.size, 0)
  assert.deepEqual(await result.lost, { reason: 'released' })
})

test('does not overwrite a live localStorage lease', async () => {
  const storage = new MemoryStorage()
  const existing = {
    version: 1,
    owner: 'existing-owner',
    expiresAt: 1_301,
  }
  storage.setItem(routeDraftLeaseKey, JSON.stringify(existing))
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }

  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))

  assert.equal(result.acquired, false)
  assert.equal(result.reason, 'unavailable')
  assert.deepEqual(JSON.parse(storage.getItem(routeDraftLeaseKey)), existing)
  assert.equal(timers.intervals.size, 0)
})

test('claims a well-formed lease only after its expiry', async () => {
  const storage = new MemoryStorage()
  storage.setItem(routeDraftLeaseKey, JSON.stringify({
    version: 1,
    owner: 'expired-owner',
    expiresAt: 1_000,
  }))
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }

  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))

  assert.equal(result.acquired, true)
  assert.equal(JSON.parse(storage.getItem(routeDraftLeaseKey)).owner, '00000000-0000-4000-8000-000000000001')
  result.release()
})

test('fails closed instead of replacing a malformed lease', async () => {
  const storage = new MemoryStorage()
  storage.setItem(routeDraftLeaseKey, '{broken')
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }

  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))

  assert.equal(result.acquired, false)
  assert.equal(result.reason, 'corrupt-lease')
  assert.equal(storage.getItem(routeDraftLeaseKey), '{broken')
})

test('rechecks ownership after the fallback contention window', async () => {
  const storage = new MemoryStorage()
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }
  const foreignLease = {
    version: 1,
    owner: 'simultaneous-contender',
    expiresAt: 2_000,
  }

  const result = await acquireRouteDraftLock({
    ...fallbackOptions(environment, timers, now),
    contentionDelayMs: 50,
    setTimeout(callback) {
      storage.setItem(routeDraftLeaseKey, JSON.stringify(foreignLease))
      callback()
    },
  })

  assert.equal(result.acquired, false)
  assert.equal(result.reason, 'contention-lost')
  assert.deepEqual(JSON.parse(storage.getItem(routeDraftLeaseKey)), foreignLease)
  assert.equal(timers.intervals.size, 0)
})

test('storage events report ownership loss and stop heartbeats', async () => {
  const storage = new MemoryStorage()
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }
  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))
  const foreignLease = {
    version: 1,
    owner: 'foreign-owner',
    expiresAt: 2_000,
  }

  storage.setItem(routeDraftLeaseKey, JSON.stringify(foreignLease))
  environment.dispatchStorage()

  assert.deepEqual(await result.lost, { reason: 'ownership-lost' })
  assert.equal(result.isHeld(), false)
  assert.equal(timers.intervals.size, 0)
  assert.equal(environment.listenerCount(), 0)
  result.release()
  assert.deepEqual(JSON.parse(storage.getItem(routeDraftLeaseKey)), foreignLease)
})

test('release compares ownership and preserves a foreign lease', async () => {
  const storage = new MemoryStorage()
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }
  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))
  const foreignLease = {
    version: 1,
    owner: 'foreign-owner',
    expiresAt: 2_000,
  }

  storage.setItem(routeDraftLeaseKey, JSON.stringify(foreignLease))
  result.release()

  assert.deepEqual(JSON.parse(storage.getItem(routeDraftLeaseKey)), foreignLease)
  assert.deepEqual(await result.lost, { reason: 'released' })
})

test('reports unsupported and inaccessible storage without throwing', async () => {
  const unsupported = await acquireRouteDraftLock({ environment: {} })
  assert.equal(unsupported.acquired, false)
  assert.equal(unsupported.method, 'none')
  assert.equal(unsupported.reason, 'unsupported')

  const inaccessible = await acquireRouteDraftLock({
    environment: {
      get localStorage() {
        throw new Error('denied')
      },
    },
  })
  assert.equal(inaccessible.acquired, false)
  assert.equal(inaccessible.method, 'none')
  assert.equal(inaccessible.reason, 'storage-unavailable')
})

test('revalidates lease ownership and expiry before reporting that a fallback lock is held', async () => {
  const storage = new MemoryStorage()
  const environment = createEventEnvironment(storage)
  const timers = createTimers()
  const now = { value: 1_000 }
  const result = await acquireRouteDraftLock(fallbackOptions(environment, timers, now))
  now.value = 1_301
  assert.equal(result.isHeld(), false)
  assert.deepEqual(await result.lost, { reason: 'lease-expired' })
})

test('recovery clearing removes only malformed or expired leases', () => {
  const storage = new MemoryStorage()
  const environment = { localStorage: storage }
  storage.setItem(routeDraftLeaseKey, '{broken')
  assert.deepEqual(clearRecoverableRouteDraftLease(environment), { cleared: true })
  storage.setItem(routeDraftLeaseKey, JSON.stringify({
    version: 1,
    owner: 'live-owner',
    expiresAt: Date.now() + 60_000,
  }))
  assert.deepEqual(clearRecoverableRouteDraftLease(environment), {
    cleared: false,
    reason: 'live-lease',
  })
})
