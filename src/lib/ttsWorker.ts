import { KokoroTTS, TextSplitterStream } from 'kokoro-js'

let tts: KokoroTTS | null = null

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as any).gpu
    if (gpu) {
      const adapter = await gpu.requestAdapter()
      if (adapter) return 'webgpu'
    }
  } catch {}
  return 'wasm'
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'check') {
    try {
      const cache = await caches.open('transformers-cache')
      const keys = await cache.keys()
      const cached = keys.some(r => r.url.includes(MODEL_ID))
      self.postMessage({ type: 'check-result', cached })
    } catch {
      self.postMessage({ type: 'check-result', cached: false })
    }
    return
  }

  if (msg.type === 'init') {
    try {
      self.postMessage({ type: 'status', status: 'loading' })
      const device = await detectDevice()
      // kokoro-js docs recommend fp32 for WebGPU, q4 for WASM
      const dtype = device === 'webgpu' ? 'fp32' : 'q4'
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: (() => {
          const files = new Map<string, { loaded: number; total: number }>()
          return (p: any) => {
            if (p.status === 'initiate') {
              files.set(p.file, { loaded: 0, total: 0 })
            } else if (p.status === 'progress') {
              files.set(p.file, { loaded: p.loaded, total: p.total })
              let totalLoaded = 0, totalSize = 0
              for (const f of files.values()) {
                totalLoaded += f.loaded
                totalSize += f.total
              }
              const progress = totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0
              self.postMessage({ type: 'progress', progress, loaded: totalLoaded, total: totalSize })
            }
          }
        })(),
      })
      self.postMessage({ type: 'status', status: 'ready', device, dtype })
    } catch (err: any) {
      self.postMessage({ type: 'status', status: 'error', error: err.message })
    }
    return
  }

  if (msg.type === 'generate') {
    const { text, voice, generationId } = msg
    if (!tts) {
      self.postMessage({ type: 'error', generationId, error: 'Model not loaded' })
      return
    }

    try {
      const splitter = new TextSplitterStream()
      const stream = tts.stream(splitter)

      // Push text in paragraph-sized chunks to reduce memory pressure
      // and allow the splitter to start yielding sentences sooner
      const paragraphs = text.split(/\n\s*\n/)
      for (const para of paragraphs) {
        const trimmed = para.trim()
        if (trimmed) splitter.push(trimmed + '\n')
      }
      splitter.close()

      for await (const { text: chunkText, audio } of stream) {
        const samples = audio.audio
        const sampleRate = audio.sampling_rate
        self.postMessage(
          { type: 'chunk', generationId, text: chunkText, audio: samples, sampleRate },
          { transfer: [samples.buffer] }
        )
      }

      self.postMessage({ type: 'done', generationId })
    } catch (err: any) {
      self.postMessage({ type: 'error', generationId, error: err.message })
    }
    return
  }
}
