export type TTSModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TTSChunk {
  text: string
  audio: Float32Array
  sampleRate: number
}

type StatusCallback = (status: TTSModelStatus, error?: string) => void
type ChunkCallback = (chunk: TTSChunk) => void
type DoneCallback = () => void
type ErrorCallback = (error: string) => void

export class TTSManager {
  private worker: Worker | null = null
  private status: TTSModelStatus = 'idle'
  private currentGenerationId = 0
  private onStatusChange: StatusCallback | null = null
  private onChunk: ChunkCallback | null = null
  private onDone: DoneCallback | null = null
  private onError: ErrorCallback | null = null

  setOnStatusChange(cb: StatusCallback) { this.onStatusChange = cb }
  setOnChunk(cb: ChunkCallback) { this.onChunk = cb }
  setOnDone(cb: DoneCallback) { this.onDone = cb }
  setOnError(cb: ErrorCallback) { this.onError = cb }
  getStatus(): TTSModelStatus { return this.status }

  init() {
    if (this.worker) return
    this.worker = new Worker(
      new URL('./ttsWorker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data)
    this.worker.postMessage({ type: 'init' })
  }

  private handleMessage(msg: any) {
    if (msg.type === 'status') {
      this.status = msg.status
      this.onStatusChange?.(msg.status, msg.error)
      return
    }

    // Ignore messages from stale generations
    if (msg.generationId !== this.currentGenerationId) return

    if (msg.type === 'chunk') {
      this.onChunk?.({
        text: msg.text,
        audio: msg.audio,
        sampleRate: msg.sampleRate,
      })
    } else if (msg.type === 'done') {
      this.onDone?.()
    } else if (msg.type === 'error') {
      this.onError?.(msg.error)
    }
  }

  generate(text: string, voice: string): number {
    if (!this.worker || this.status !== 'ready') return -1
    const generationId = ++this.currentGenerationId
    this.worker.postMessage({ type: 'generate', text, voice, generationId })
    return generationId
  }

  cancel() {
    this.currentGenerationId++
  }

  destroy() {
    this.cancel()
    this.worker?.terminate()
    this.worker = null
    this.status = 'idle'
  }
}

/** Singleton TTS manager instance */
let _instance: TTSManager | null = null

export function getTTSManagerInstance(): TTSManager {
  if (!_instance) {
    _instance = new TTSManager()
  }
  return _instance
}
