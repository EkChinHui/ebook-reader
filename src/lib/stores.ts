import { writable } from 'svelte/store'
import type { Chapter } from './book'
import type { TTSModelStatus } from './tts'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface TimedSegment {
  text: string
  start: number
  end: number
}

/** All parsed chapters (title + full text) held in memory */
export const parsedChapters = writable<Chapter[]>([])
export const currentChapterIndex = writable<number>(-1)
export const chapterText = writable<string>('')
export const fileName = writable<string>('')
export const isPlaying = writable<boolean>(false)
export const selectedVoice = writable<string>('af_heart')
export const playbackSpeed = writable<number>(1.0)
export const segments = writable<TimedSegment[]>([])
export const currentSegmentIndex = writable<number>(-1)
export const ttsModelStatus = writable<TTSModelStatus>('idle')
export const autoAdvance = writable<boolean>(true)
export const bookType = writable<'epub' | 'pdf'>('epub')
export const pdfDocument = writable<PDFDocumentProxy | null>(null)

/** TTS engine: 'browser' uses Web Speech API, 'kokoro' uses the ONNX model */
export const ttsEngine = writable<'browser' | 'kokoro'>('kokoro')
/** When true, eagerly generate audio for the current chapter in the background */
export const eagerProcessing = writable<boolean>(false)
/** Set of chapter indices that have cached audio (for current file/voice/speed) */
export const cachedChapters = writable<Set<number>>(new Set())
/** Set of chapter indices currently being eagerly generated or queued */
export const eagerProcessingChapters = writable<Set<number>>(new Set())
/** Volume level 0–1 */
export const volume = writable<number>(1.0)
/** Selected browser voice URI (from speechSynthesis.getVoices()) */
export const browserVoiceURI = writable<string>('')
