import { KokoroTTS, TextSplitterStream } from 'kokoro-js'

let tts: KokoroTTS | null = null

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    try {
      self.postMessage({ type: 'status', status: 'loading' })
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
      })
      self.postMessage({ type: 'status', status: 'ready' })
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

      // Push all text and close - kokoro-js splits into sentences internally
      splitter.push(text)
      splitter.close()

      for await (const { text: chunkText, audio } of stream) {
        // audio is a RawAudio with .audio (Float32Array) and .sampling_rate
        const samples = audio.audio
        const sampleRate = audio.sampling_rate
        self.postMessage(
          { type: 'chunk', generationId, text: chunkText, audio: samples, sampleRate },
          { transfer: [samples.buffer] }  // Transfer ownership for zero-copy
        )
      }

      self.postMessage({ type: 'done', generationId })
    } catch (err: any) {
      self.postMessage({ type: 'error', generationId, error: err.message })
    }
    return
  }
}
