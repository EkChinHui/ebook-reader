import type { TimedSegment } from './api'

// --- IndexedDB: book file persistence ---

const DB_NAME = 'ebook-reader'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

interface StoredFile {
  name: string
  data: ArrayBuffer
}

export async function saveBookFile(file: File): Promise<void> {
  const data = await file.arrayBuffer()
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite')
    tx.objectStore('files').put({ name: file.name, data } satisfies StoredFile, 'last')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadBookFile(): Promise<File | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const req = tx.objectStore('files').get('last')
      req.onsuccess = () => {
        const stored = req.result as StoredFile | undefined
        if (!stored) return resolve(null)
        const ext = stored.name.split('.').pop() || ''
        const mime = ext === 'epub' ? 'application/epub+zip' : 'application/pdf'
        resolve(new File([stored.data], stored.name, { type: mime }))
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

// --- localStorage: reading position ---

export interface ReadingState {
  fileName: string
  chapterIndex: number
  currentTime: number
  voice: string
  speed: number
}

const STATE_KEY = 'ebook-reader-state'

export function saveReadingState(state: ReadingState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

export function loadReadingState(): ReadingState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// --- In-memory audio cache ---

interface CachedAudio {
  wavChunks: ArrayBuffer[]
  segments: TimedSegment[]
}

const audioCache = new Map<string, CachedAudio>()

function audioCacheKey(bookId: string, chapter: number, voice: string, speed: number): string {
  return `${bookId}:${chapter}:${voice}:${speed}`
}

export function getCachedAudio(bookId: string, chapter: number, voice: string, speed: number): CachedAudio | null {
  return audioCache.get(audioCacheKey(bookId, chapter, voice, speed)) ?? null
}

export function setCachedAudio(bookId: string, chapter: number, voice: string, speed: number, data: CachedAudio): void {
  audioCache.set(audioCacheKey(bookId, chapter, voice, speed), data)
}
