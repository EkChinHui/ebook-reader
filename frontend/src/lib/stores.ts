import { writable } from 'svelte/store'
import type { Chapter } from './book'
import type { TTSModelStatus } from './tts'

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
