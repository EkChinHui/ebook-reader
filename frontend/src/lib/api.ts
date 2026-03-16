export interface ChapterInfo {
  index: number
  title: string
}

export interface UploadResult {
  book_id: string
  chapters: ChapterInfo[]
}

export interface ChapterContent {
  title: string
  text: string
}

export interface TimedSegment {
  text: string
  start: number
  end: number
}

export async function uploadBook(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function fetchChapter(bookId: string, index: number): Promise<ChapterContent> {
  const res = await fetch(`/api/books/${bookId}/chapters/${index}`)
  if (!res.ok) throw new Error('Failed to load chapter')
  return res.json()
}
