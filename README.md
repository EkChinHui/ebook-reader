# Ebook Reader

A fully client-side ebook reader with text-to-speech narration powered by [kokoro-js](https://github.com/hexgrad/kokoro). Upload EPUB or PDF files, read chapters in a clean interface, and listen to them read aloud with sentence-level highlighting. Everything runs in your browser — no server required.

## Features

- **EPUB & PDF support** — Upload and read both formats with automatic chapter/page extraction
- **TTS narration** — Natural-sounding text-to-speech with 11 voice options, powered by Kokoro 82M running locally in a Web Worker
- **Sentence-level highlighting** — Synchronized text highlighting follows along as audio plays
- **Adjustable playback** — Control voice selection and speed (0.75x–2.0x)
- **Streaming audio** — Audio plays sentence-by-sentence as it generates, no waiting for full synthesis
- **Offline-capable** — After first model download (~165 MB), everything works offline
- **Persistent state** — Book file, reading position, voice, and speed saved across sessions

## Tech Stack

- **UI:** Svelte 5, Vite, Tailwind CSS, TypeScript
- **Book parsing:** [epub.js](https://github.com/futurepress/epub.js) (EPUB), [PDF.js](https://github.com/nicolo-ribaudo/pdfjs-dist) (PDF)
- **TTS:** [kokoro-js](https://www.npmjs.com/package/kokoro-js) — Kokoro 82M ONNX model running via Web Worker + WebAssembly
- **Audio:** Web Audio API with AudioBufferSourceNode scheduling

## Setup

### Prerequisites

- Node.js 20.19+

### Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Production Build

```bash
npm run build
npx vite preview
```

The `dist/` folder is fully static and can be deployed to any static host (Vercel, Netlify, GitHub Pages, etc).

## How It Works

1. **Upload** an EPUB or PDF — parsed entirely in the browser
2. **TTS model** (~165 MB, q8 quantized) downloads on first book load and is cached by the browser
3. **Click Play** — text is streamed sentence-by-sentence through a Web Worker running kokoro-js
4. **Audio chunks** are scheduled via Web Audio API for gapless playback
5. **Highlighting** tracks the current sentence in the reader view
6. **Caching** — generated audio is cached in memory; book file and reading position persist in IndexedDB/localStorage
