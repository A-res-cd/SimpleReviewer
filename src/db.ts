import type { StudyDocument } from './types'

const DATABASE_NAME = 'simple-reviewer'
const DATABASE_VERSION = 1
const STORE_NAME = 'documents'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local study storage.'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = run(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Could not save your study data.'))
    }
  })
}

export const listDocuments = async (): Promise<StudyDocument[]> => {
  const documents = await withStore('readonly', (store) => store.getAll())
  return documents.sort((a, b) => b.createdAt - a.createdAt)
}

export const saveDocument = (document: StudyDocument): Promise<IDBValidKey> =>
  withStore('readwrite', (store) => store.put(document))

export const removeDocument = (id: string): Promise<undefined> =>
  withStore('readwrite', (store) => store.delete(id))
