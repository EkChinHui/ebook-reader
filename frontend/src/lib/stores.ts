import { writable } from 'svelte/store'
import type { ChapterInfo, TimedSegment } from './api'
import type { TTSModelStatus } from './tts'

export const bookId = writable<string | null>(null)
export const chapters = writable<ChapterInfo[]>([])
export const currentChapterIndex = writable<number>(-1)
export const chapterText = writable<string>('')
export const fileName = writable<string>('')
export const isPlaying = writable<boolean>(false)
export const selectedVoice = writable<string>('af_heart')
export const playbackSpeed = writable<number>(1.0)
export const segments = writable<TimedSegment[]>([])
export const currentSegmentIndex = writable<number>(-1)
export const ttsModelStatus = writable<TTSModelStatus>('idle')
