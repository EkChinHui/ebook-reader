# Ebook Reader

A web-based ebook reader with text-to-speech narration powered by [Kokoro TTS](https://github.com/hexgrad/kokoro). Upload EPUB or PDF files, read chapters in a clean interface, and listen to them read aloud with word-level highlighting.

## Features

- **EPUB & PDF support** — Upload and read both formats with automatic chapter/page extraction
- **TTS narration** — Natural-sounding text-to-speech with 11 voice options
- **Word-level highlighting** — Synchronized text highlighting follows along as audio plays
- **Adjustable playback** — Control voice selection and speed (0.5x–2.5x)
- **Streaming audio** — Audio streams as it generates, no waiting for full synthesis

## Tech Stack

- **Backend:** Python, FastAPI, Kokoro TTS, ebooklib, PyMuPDF
- **Frontend:** Svelte 5, Vite, Tailwind CSS, TypeScript

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+

### Installation

```bash
# Clone the repo
git clone git@github.com:EkChinHui/ebook-reader.git
cd ebook-reader

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
cd ..
```

### Development

Run both the backend and frontend dev servers:

```bash
./dev.sh
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173

### Production

Build the frontend and serve everything from FastAPI:

```bash
./run.sh
```

The app will be available at http://localhost:8000.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload an EPUB or PDF file |
| GET | `/api/books/{id}/chapters/{index}` | Get chapter text |
| GET | `/api/voices` | List available TTS voices |
| GET | `/api/narrate/{id}/{index}` | Stream chapter audio (WAV) |
| GET | `/api/narrate-timed/{id}/{index}` | Generate audio with word-level timing |
| GET | `/api/audio/{audio_id}` | Retrieve generated audio |
