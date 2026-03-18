import type { TimedSegment } from './stores'
import { cachedChapters, fileName as fileNameStore, selectedVoice as voiceStore, playbackSpeed as speedStore } from './stores'
import { get } from 'svelte/store'

// --- IndexedDB: book file persistence ---

const DB_NAME = 'ebook-reader'
const DB_VERSION = 2

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files')
      }
      if (!db.objectStoreNames.contains('audioCache')) {
        db.createObjectStore('audioCache')
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

export async function removeBookFile(): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').delete('last')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {}
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

export function removeReadingState(): void {
  localStorage.removeItem(STATE_KEY)
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

export interface CachedAudio {
  audioChunks: { audio: Float32Array; sampleRate: number }[]
  segments: TimedSegment[]
}

const audioCache = new Map<string, CachedAudio>()

function audioCacheKey(fileName: string, chapter: number, voice: string, speed: number): string {
  return `${fileName}:${chapter}:${voice}:${speed}`
}

export function getCachedAudio(fileName: string, chapter: number, voice: string, speed: number): CachedAudio | null {
  return audioCache.get(audioCacheKey(fileName, chapter, voice, speed)) ?? null
}

export function setCachedAudio(fileName: string, chapter: number, voice: string, speed: number, data: CachedAudio): void {
  const key = audioCacheKey(fileName, chapter, voice, speed)
  audioCache.set(key, data)
  // Update reactive store if this cache entry matches current context
  if (fileName === get(fileNameStore) && voice === get(voiceStore) && speed === get(speedStore)) {
    cachedChapters.update(s => { s.add(chapter); return new Set(s) })
  }
  // Persist to IndexedDB (fire-and-forget)
  persistAudioCacheEntry(key, data)
}

async function persistAudioCacheEntry(key: string, data: CachedAudio): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audioCache', 'readwrite')
      tx.objectStore('audioCache').put(data, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('[AudioCache] Failed to persist:', e)
  }
}

/** Load all audio cache entries from IndexedDB into memory. Call on app startup. */
export async function loadAudioCache(): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audioCache', 'readonly')
      const store = tx.objectStore('audioCache')
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          audioCache.set(cursor.key as string, cursor.value as CachedAudio)
          cursor.continue()
        } else {
          // Done — refresh the reactive store
          const fn = get(fileNameStore)
          const voice = get(voiceStore)
          const speed = get(speedStore)
          if (fn) refreshCachedChapters(fn, voice, speed)
          resolve()
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.warn('[AudioCache] Failed to load:', e)
  }
}

/** Clear all persisted audio cache (e.g. when removing a book) */
export async function clearAudioCache(): Promise<void> {
  audioCache.clear()
  cachedChapters.set(new Set())
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audioCache', 'readwrite')
      tx.objectStore('audioCache').clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {}
}

/** Rebuild the cachedChapters store by scanning the cache for the current file/voice/speed */
export function refreshCachedChapters(fn: string, voice: string, speed: number): void {
  const result = new Set<number>()
  for (const key of audioCache.keys()) {
    const prefix = `${fn}:`
    const suffix = `:${voice}:${speed}`
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      const chapterStr = key.slice(prefix.length, key.length - suffix.length)
      const chapter = parseInt(chapterStr, 10)
      if (!isNaN(chapter)) result.add(chapter)
    }
  }
  cachedChapters.set(result)
}
