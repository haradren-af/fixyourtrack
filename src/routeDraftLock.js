export const routeDraftLockName = 'fixyourtrack:create-route-draft:active-route'
export const routeDraftLeaseKey = 'fixyourtrack:create-route-draft:active-route:lease'

const leaseSchemaVersion = 1
const defaultLeaseDurationMs = 60_000
const defaultHeartbeatIntervalMs = 10_000
const defaultContentionDelayMs = 50

const noOp = () => {}

/**
 * Acquires the single-writer lock for the active Create Route draft.
 *
 * Web Locks are used when available. The localStorage lease is a conservative
 * fallback for browsers without Web Locks: it never replaces a live or
 * malformed lease, verifies ownership after a contention window, renews while
 * held, and reports unexpected ownership loss through `lost`.
 */
export async function acquireRouteDraftLock(options = {}) {
  const environment = options.environment ?? getDefaultEnvironment()
  const lockManager = getLockManager(environment)

  if (lockManager) {
    return acquireWebLock(lockManager)
  }

  return acquireStorageLease(environment, options)
}

export function clearRecoverableRouteDraftLease(environment = getDefaultEnvironment()) {
  const storageResult = getStorage(environment)
  if (!storageResult.storage) {
    return { cleared: false, reason: storageResult.reason, error: storageResult.error }
  }
  const current = readLease(storageResult.storage)
  if (current.ok && current.lease?.expiresAt > Date.now()) {
    return { cleared: false, reason: 'live-lease' }
  }
  try {
    storageResult.storage.removeItem(routeDraftLeaseKey)
    return { cleared: true }
  }
  catch (error) {
    return { cleared: false, reason: 'storage-unavailable', error }
  }
}

function acquireWebLock(lockManager) {
  return new Promise((resolve) => {
    let acquisitionSettled = false
    let callbackEntered = false
    let held = false
    let releaseGate = noOp
    let settleLost = noOp
    const lost = new Promise((settle) => {
      settleLost = settle
    })
    const hold = new Promise((release) => {
      releaseGate = release
    })

    const settleAcquisition = (result) => {
      if (!acquisitionSettled) {
        acquisitionSettled = true
        resolve(result)
      }
    }

    let requestPromise
    try {
      requestPromise = Promise.resolve(lockManager.request(
        routeDraftLockName,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          callbackEntered = true
          if (!lock) {
            settleAcquisition(unavailableResult('web-locks', 'unavailable'))
            return
          }

          held = true
          const release = () => {
            if (!held) return
            held = false
            releaseGate()
            settleLost({ reason: 'released' })
          }
          settleAcquisition({
            acquired: true,
            method: 'web-locks',
            release,
            isHeld: () => held,
            lost,
          })
          await hold
        },
      ))
    }
    catch (error) {
      settleAcquisition(unavailableResult('web-locks', 'request-failed', error))
      return
    }

    requestPromise.then(
      () => {
        if (!callbackEntered) {
          settleAcquisition(unavailableResult('web-locks', 'request-ended'))
        }
      },
      (error) => {
        if (held) {
          held = false
          settleLost({ reason: 'request-failed', error })
        }
        settleAcquisition(unavailableResult('web-locks', 'request-failed', error))
      },
    )
  })
}

async function acquireStorageLease(environment, options) {
  const storageResult = getStorage(environment)
  if (!storageResult.storage) {
    return unavailableResult('none', storageResult.reason, storageResult.error)
  }

  const storage = storageResult.storage
  const now = typeof options.now === 'function' ? options.now : Date.now
  const leaseDurationMs = positiveDuration(options.leaseDurationMs, defaultLeaseDurationMs)
  const maximumHeartbeatIntervalMs = Math.max(1, Math.floor(leaseDurationMs / 3))
  const heartbeatIntervalMs = Math.min(
    positiveDuration(
      options.heartbeatIntervalMs,
      Math.min(defaultHeartbeatIntervalMs, maximumHeartbeatIntervalMs),
    ),
    maximumHeartbeatIntervalMs,
  )
  const contentionDelayMs = nonNegativeDuration(options.contentionDelayMs, defaultContentionDelayMs)
  const scheduleInterval = options.setInterval ?? globalThis.setInterval
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout
  const owner = createOwnerId(environment, now)

  const existing = readLease(storage)
  if (!existing.ok) {
    return unavailableResult('local-storage', existing.reason, existing.error)
  }
  if (existing.lease && existing.lease.expiresAt > now()) {
    return unavailableResult('local-storage', 'unavailable')
  }

  const claim = createLease(owner, now() + leaseDurationMs)
  const claimed = writeAndVerifyLease(storage, claim)
  if (!claimed.ok) {
    return unavailableResult('local-storage', claimed.reason, claimed.error)
  }

  if (contentionDelayMs > 0) {
    try {
      await delay(contentionDelayMs, scheduleTimeout)
    }
    catch (error) {
      removeLeaseIfOwned(storage, owner)
      return unavailableResult('local-storage', 'timer-unavailable', error)
    }
  }

  const verified = readLease(storage)
  if (!verified.ok || verified.lease?.owner !== owner) {
    return unavailableResult(
      'local-storage',
      verified.ok ? 'contention-lost' : verified.reason,
      verified.error,
    )
  }

  let held = true
  let heartbeatId = null
  let settleLost = noOp
  const lost = new Promise((settle) => {
    settleLost = settle
  })

  const removeStorageListener = addStorageListener(environment, storage, () => {
    if (!held) return
    const current = readLease(storage)
    if (!current.ok || current.lease?.owner !== owner) {
      loseOwnership(current.ok ? 'ownership-lost' : current.reason, current.error)
    }
  })

  const stopHeartbeat = () => {
    if (heartbeatId !== null) {
      try {
        cancelInterval(heartbeatId)
      }
      catch {
        // The ownership checks remain authoritative if timer cleanup fails.
      }
      heartbeatId = null
    }
  }

  function loseOwnership(reason, error) {
    if (!held) return
    held = false
    stopHeartbeat()
    removeStorageListener()
    settleLost(error ? { reason, error } : { reason })
  }

  const heartbeat = () => {
    if (!held) return
    const current = readLease(storage)
    if (!current.ok || current.lease?.owner !== owner) {
      loseOwnership(current.ok ? 'ownership-lost' : current.reason, current.error)
      return
    }

    const renewed = writeAndVerifyLease(storage, createLease(owner, now() + leaseDurationMs))
    if (!renewed.ok) {
      loseOwnership(renewed.reason, renewed.error)
    }
  }

  try {
    heartbeatId = scheduleInterval(heartbeat, heartbeatIntervalMs)
  }
  catch (error) {
    held = false
    removeStorageListener()
    removeLeaseIfOwned(storage, owner)
    return unavailableResult('local-storage', 'timer-unavailable', error)
  }

  const release = () => {
    if (!held) return
    held = false
    stopHeartbeat()
    removeStorageListener()

    removeLeaseIfOwned(storage, owner)
    settleLost({ reason: 'released' })
  }

  const isHeld = () => {
    if (!held) return false
    const current = readLease(storage)
    if (!current.ok || current.lease?.owner !== owner || current.lease.expiresAt <= now()) {
      loseOwnership(
        current.ok
          ? current.lease?.owner === owner
            ? 'lease-expired'
            : 'ownership-lost'
          : current.reason,
        current.error,
      )
      return false
    }
    return true
  }

  return {
    acquired: true,
    method: 'local-storage',
    release,
    isHeld,
    lost,
  }
}

function unavailableResult(method, reason, error) {
  return {
    acquired: false,
    method,
    reason,
    release: noOp,
    isHeld: () => false,
    lost: null,
    ...(error ? { error } : {}),
  }
}

function getDefaultEnvironment() {
  return typeof globalThis === 'object' ? globalThis : undefined
}

function getLockManager(environment) {
  try {
    const lockManager = environment?.navigator?.locks
    return typeof lockManager?.request === 'function' ? lockManager : null
  }
  catch {
    return null
  }
}

function getStorage(environment) {
  try {
    const storage = environment?.localStorage
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return { storage }
    }
    return { storage: null, reason: 'unsupported' }
  }
  catch (error) {
    return { storage: null, reason: 'storage-unavailable', error }
  }
}

function createLease(owner, expiresAt) {
  return { version: leaseSchemaVersion, owner, expiresAt }
}

function readLease(storage) {
  let raw
  try {
    raw = storage.getItem(routeDraftLeaseKey)
  }
  catch (error) {
    return { ok: false, reason: 'storage-unavailable', error }
  }

  if (raw === null) {
    return { ok: true, lease: null }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!isLease(parsed)) {
      return { ok: false, reason: 'corrupt-lease' }
    }
    return { ok: true, lease: parsed }
  }
  catch {
    return { ok: false, reason: 'corrupt-lease' }
  }
}

function writeAndVerifyLease(storage, lease) {
  try {
    storage.setItem(routeDraftLeaseKey, JSON.stringify(lease))
  }
  catch (error) {
    return { ok: false, reason: 'storage-unavailable', error }
  }

  const current = readLease(storage)
  if (!current.ok) return current
  if (current.lease?.owner !== lease.owner || current.lease.expiresAt !== lease.expiresAt) {
    return { ok: false, reason: 'contention-lost' }
  }
  return { ok: true }
}

function isLease(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.version === leaseSchemaVersion &&
    typeof value.owner === 'string' &&
    value.owner.length >= 8 &&
    value.owner.length <= 200 &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt >= 0,
  )
}

function createOwnerId(environment, now) {
  try {
    if (typeof environment?.crypto?.randomUUID === 'function') {
      return environment.crypto.randomUUID()
    }
    if (typeof environment?.crypto?.getRandomValues === 'function') {
      const values = new Uint32Array(4)
      environment.crypto.getRandomValues(values)
      return [...values].map((value) => value.toString(16).padStart(8, '0')).join('')
    }
  }
  catch {
    // Continue with the compatibility fallback below.
  }
  const firstRandomPart = Math.random().toString(36).slice(2).padEnd(16, '0')
  const secondRandomPart = Math.random().toString(36).slice(2).padEnd(16, '0')
  return `fallback-${now().toString(36)}-${firstRandomPart}-${secondRandomPart}`
}

function addStorageListener(environment, storage, onChange) {
  if (typeof environment?.addEventListener !== 'function') return noOp

  const listener = (event) => {
    if (event?.key !== routeDraftLeaseKey) return
    if (event.storageArea && event.storageArea !== storage) return
    onChange()
  }
  try {
    environment.addEventListener('storage', listener)
  }
  catch {
    return noOp
  }
  return () => {
    if (typeof environment?.removeEventListener === 'function') {
      try {
        environment.removeEventListener('storage', listener)
      }
      catch {
        // Listener cleanup must not prevent lock release.
      }
    }
  }
}

function removeLeaseIfOwned(storage, owner) {
  const current = readLease(storage)
  if (!current.ok || current.lease?.owner !== owner) return
  try {
    storage.removeItem(routeDraftLeaseKey)
  }
  catch {
    // Releasing is best-effort; the bounded lease will expire on its own.
  }
}

function positiveDuration(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeDuration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function delay(milliseconds, scheduleTimeout) {
  return new Promise((resolve) => scheduleTimeout(resolve, milliseconds))
}
