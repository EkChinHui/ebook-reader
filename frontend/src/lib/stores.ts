import { writable } from 'svelte/store'
import type { ChapterInfo } from './api'

export const bookId = writable<string | null>(null)
export const chapters = writable<ChapterInfo[]>([])
export const currentChapterIndex = writable<number>(-1)
export const chapterText = writable<string>('')
export const fileName = writable<string>('')
export const isPlaying = writable<boolean>(false)
export const selectedVoice = writable<string>('af_heart')
export const playbackSpeed = writable<number>(1.0)
