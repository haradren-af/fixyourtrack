const databaseName = 'fixyourtrack'
const storeName = 'repair-drafts'
const activeDraftId = 'active'

export async function loadRepairDraft() {
  const database = await openDatabase()
  return runRequest(database, 'readonly', (store) => store.get(activeDraftId))
}
export async function saveRepairDraft(sourceTrack, workingTrack) {
  const database = await openDatabase()
  const savedAt = new Date().toISOString()

  await runRequest(database, 'readwrite', (store) => store.put({
    id: activeDraftId,
    savedAt,
    sourceTrack: serializeTrack(sourceTrack),
    workingTrack: serializeTrack(workingTrack),
  }))

  return savedAt
}

export async function deleteRepairDraft() {
  const database = await openDatabase()
  await runRequest(database, 'readwrite', (store) => store.delete(activeDraftId))
}

function serializeTrack(track) {
  return {
    name: track.name,
    format: track.format,
    samples: track.samples,
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function runRequest(database, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = createRequest(transaction.objectStore(storeName))

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error)
  })
}
