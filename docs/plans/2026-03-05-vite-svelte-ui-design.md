# Ebook Narrator: Vite + Svelte UI

## Overview
Replace the Gradio UI with a Svelte + Vite frontend backed by a FastAPI server.

## Architecture
- **Backend**: FastAPI serving REST endpoints + streaming audio
- **Frontend**: Svelte + Vite SPA with Tailwind CSS
- Production: FastAPI serves built static files from `frontend/dist/`

## API Endpoints
- `POST /api/upload` — accepts EPUB/PDF, returns chapter list
- `GET /api/chapters/{index}` — returns chapter text
- `GET /api/narrate?chapter={index}&voice={voice}&speed={speed}` — streams WAV audio chunks

## Frontend Structure
```
frontend/
  src/
    App.svelte          — root layout
    lib/
      stores.ts         — Svelte stores (book, playback state)
      api.ts            — fetch wrappers for backend
    components/
      Sidebar.svelte    — file upload + chapter list
      Reader.svelte     — chapter text display
      AudioPlayer.svelte — playback controls, voice/speed
  index.html
  vite.config.ts        — proxy /api to FastAPI
```

## UI Layout
- Left sidebar: file upload, scrollable chapter list
- Main area: chapter text with readable typography
- Bottom bar: audio player (play/pause, voice, speed, progress)

## Audio Streaming
- Backend streams WAV chunks via chunked HTTP response
- Frontend reads via fetch ReadableStream, feeds to `<audio>` element using blob URLs
- Sequential chunk playback with buffering

## State Management
- `bookStore`: chapters list, current chapter index, file name
- `playerStore`: playing/paused, current voice, speed, audio queue

## Styling
- Tailwind CSS for utility-first styling
- Dark/light mode support via Tailwind's dark: variant
- Responsive layout (sidebar collapses on mobile)
