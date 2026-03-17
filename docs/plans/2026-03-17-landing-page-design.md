# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a landing page where users download the TTS model and drop their book before entering the reader.

**Architecture:** New `LandingPage.svelte` component with hero-stack layout. `App.svelte` gains a reactive `view` state (`'landing' | 'reader'`) that gates which UI is shown. The TTS worker gets a new `'check'` message type so we can detect a cached model without triggering a full download. Returning users with a cached model + saved book skip the landing page entirely.

**Tech Stack:** Svelte 5, Tailwind CSS v4, existing TTSManager/ttsWorker, existing storage utilities.

---

### Task 1: Add `ttsWorker` support for model-cache detection

**Files:**
- Modify: `src/lib/ttsWorker.ts`
- Modify: `src/lib/tts.ts`

**Step 1: Add `check` message type to ttsWorker**

In `src/lib/ttsWorker.ts`, the worker currently only handles `init` (which downloads if not cached) and `generate`. Add a `check` handler that uses the Transformers.js Cache API to detect whether the model files already exist without downloading them.

Since `kokoro-js` wraps `@huggingface/transformers` under the hood, we can attempt `KokoroTTS.from_pretrained` with `{ local_files_only: true }`. If it succeeds, the model was cached. If it throws, it wasn't.

```ts
// Add before the existing `if (msg.type === 'init')` block:
if (msg.type === 'check') {
  try {
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      local_files_only: true,
    })
    self.postMessage({ type: 'status', status: 'ready' })
  } catch {
    // Not cached — report idle so landing page knows to show download button
    self.postMessage({ type: 'status', status: 'idle' })
  }
  return
}
```

**Step 2: Add `checkCached()` method to TTSManager**

In `src/lib/tts.ts`, add a method that posts the `check` message:

```ts
checkCached() {
  if (this.worker) return
  this.worker = new Worker(
    new URL('./ttsWorker.ts', import.meta.url),
    { type: 'module' }
  )
  this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data)
  this.worker.postMessage({ type: 'check' })
}
```

Also update `init()` so it doesn't create a duplicate worker if `checkCached()` already created one — just post `{ type: 'init' }` to the existing worker:

```ts
init() {
  if (this.status === 'ready') return  // already loaded via check
  if (!this.worker) {
    this.worker = new Worker(
      new URL('./ttsWorker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data)
  }
  this.worker.postMessage({ type: 'init' })
}
```

**Step 3: Verify manually**

Run: `npm run check`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/lib/ttsWorker.ts src/lib/tts.ts
git commit -m "feat: add TTS model cache detection via check message"
```

---

### Task 2: Create LandingPage.svelte

**Files:**
- Create: `src/components/LandingPage.svelte`

**Step 1: Create the component**

The landing page is a full-screen centered card on the dark background. It has:
1. Logo + title
2. Tagline
3. Privacy info box
4. Model download button (with progress states)
5. Drop zone (disabled until model ready)

The component accepts a callback prop `onBookLoaded` that App.svelte will use to transition to the reader.

```svelte
<script lang="ts">
  import { parseBook } from '../lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed, ttsModelStatus } from '../lib/stores'
  import { saveBookFile, saveReadingState } from '../lib/storage'
  import { getTTSManagerInstance } from '../lib/tts'
  import { onMount } from 'svelte'

  interface Props {
    onBookLoaded: () => void
  }
  let { onBookLoaded }: Props = $props()

  let fileInput: HTMLInputElement
  let uploading = false
  let error = ''
  let dragOver = false

  const tts = getTTSManagerInstance()

  onMount(() => {
    tts.setOnStatusChange((status) => { $ttsModelStatus = status })
    tts.checkCached()
  })

  function handleDownload() {
    if ($ttsModelStatus === 'loading' || $ttsModelStatus === 'ready') return
    tts.init()
  }

  $: modelReady = $ttsModelStatus === 'ready'
  $: modelLoading = $ttsModelStatus === 'loading'

  function openFilePicker() {
    if (!uploading && modelReady) fileInput.click()
  }

  async function processFile(file: File) {
    error = ''
    uploading = true
    try {
      const chapters = await parseBook(file)
      $parsedChapters = chapters
      $fileName = file.name
      saveBookFile(file)

      if (chapters.length > 0) {
        $currentChapterIndex = 0
        $chapterText = chapters[0].text
      }
      onBookLoaded()
    } catch (err: any) {
      error = err.message || 'Failed to parse book'
    } finally {
      uploading = false
    }
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    if (!modelReady || uploading) return
    const file = e.dataTransfer?.files[0]
    if (file) processFile(file)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (modelReady && !uploading) dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-spine-900 px-4">
  <!-- Subtle radial glow behind card -->
  <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(196,132,29,0.06)_0%,transparent_70%)]"></div>

  <div class="relative w-full max-w-md animate-fade-up">
    <!-- Header -->
    <div class="mb-8 text-center">
      <div class="mb-3 flex items-center justify-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-accent/15">
          <svg class="h-5 w-5 text-amber-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <h1 class="font-serif text-3xl font-semibold tracking-wide text-parchment-100">Narrator</h1>
      </div>
      <p class="text-sm text-parchment-400/60">Listen to your books, entirely in the browser</p>
    </div>

    <!-- Privacy info box -->
    <div class="mb-6 rounded-xl border border-amber-accent/15 bg-amber-accent/[0.04] px-5 py-4">
      <h3 class="mb-1.5 text-sm font-semibold text-amber-glow">Fully Client-Side</h3>
      <p class="text-xs leading-relaxed text-parchment-400/60">
        Your books never leave your device. All parsing, text extraction, and text-to-speech run locally in the browser — no servers, no uploads, complete privacy.
      </p>
    </div>

    <!-- Model download -->
    <button
      type="button"
      class="mb-2 block w-full rounded-xl px-5 py-3.5 text-center text-sm font-semibold transition-all duration-300
        {modelReady
          ? 'bg-green-600/20 text-green-400 cursor-default'
          : modelLoading
            ? 'bg-amber-accent/20 text-amber-warm cursor-wait'
            : 'bg-gradient-to-r from-amber-accent to-amber-glow text-spine-900 hover:shadow-lg hover:shadow-amber-accent/20 cursor-pointer'
        }"
      onclick={handleDownload}
      disabled={modelReady || modelLoading}
    >
      {#if modelReady}
        <span class="flex items-center justify-center gap-2">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Voice Model Ready
        </span>
      {:else if modelLoading}
        <span class="flex items-center justify-center gap-2">
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
          </svg>
          Downloading Model...
        </span>
      {:else}
        Download TTS Voice Model
      {/if}
    </button>
    <p class="mb-6 text-center text-xs text-parchment-400/35">~165 MB — cached after first download</p>

    <!-- Drop zone -->
    <input bind:this={fileInput} type="file" accept=".epub,.pdf" class="hidden" onchange={handleFileInput} disabled={!modelReady || uploading} />
    <button
      type="button"
      class="block w-full rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300
        {modelReady
          ? dragOver
            ? 'border-amber-accent/60 bg-amber-accent/10'
            : 'border-parchment-400/20 hover:border-amber-accent/40 hover:bg-amber-accent/[0.03] cursor-pointer'
          : 'border-parchment-400/10 opacity-40 cursor-not-allowed'
        }"
      onclick={openFilePicker}
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      disabled={!modelReady || uploading}
    >
      {#if uploading}
        <svg class="mx-auto mb-2 h-6 w-6 animate-spin text-parchment-400/40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
        </svg>
        <span class="text-sm text-parchment-300">Processing book...</span>
      {:else}
        <svg class="mx-auto mb-3 h-8 w-8 text-parchment-400/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span class="text-sm text-parchment-400/50">
          {#if modelReady}
            Drop your EPUB or PDF here, or click to browse
          {:else}
            Download the voice model first to continue
          {/if}
        </span>
      {/if}
    </button>

    {#if error}
      <p class="mt-3 text-center text-sm text-red-400/90">{error}</p>
    {/if}
  </div>
</div>
```

**Step 2: Verify**

Run: `npm run check`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/LandingPage.svelte
git commit -m "feat: add LandingPage component with model download and book drop zone"
```

---

### Task 3: Wire up App.svelte with view routing

**Files:**
- Modify: `src/App.svelte`

**Step 1: Replace App.svelte with view-routing logic**

App.svelte needs to:
1. On mount, check if model is cached AND a book is saved → go straight to reader
2. If model is cached but no book → show landing page with drop zone enabled
3. Otherwise → show landing page

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import LandingPage from './components/LandingPage.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
  import { parseBook } from './lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed, ttsModelStatus } from './lib/stores'
  import { loadBookFile, loadReadingState } from './lib/storage'
  import { getTTSManagerInstance } from './lib/tts'

  let view: 'loading' | 'landing' | 'reader' = $state('loading')

  function goToReader() {
    view = 'reader'
  }

  onMount(async () => {
    const tts = getTTSManagerInstance()

    // Wait for cache check to complete
    const cachedStatus = await new Promise<string>((resolve) => {
      tts.setOnStatusChange((status) => {
        $ttsModelStatus = status
        if (status === 'ready' || status === 'idle') resolve(status)
      })
      tts.checkCached()
    })

    if (cachedStatus !== 'ready') {
      view = 'landing'
      return
    }

    // Model is cached — try to restore saved book
    const file = await loadBookFile()
    if (!file) {
      view = 'landing'
      return
    }

    try {
      const chapters = await parseBook(file)
      $parsedChapters = chapters
      $fileName = file.name

      const state = loadReadingState()
      if (state && state.fileName === file.name) {
        $selectedVoice = state.voice
        $playbackSpeed = state.speed
        const idx = Math.min(state.chapterIndex, chapters.length - 1)
        $currentChapterIndex = idx
        $chapterText = chapters[idx].text
      } else if (chapters.length > 0) {
        $currentChapterIndex = 0
        $chapterText = chapters[0].text
      }

      view = 'reader'
    } catch (e) {
      console.error('Failed to restore book:', e)
      view = 'landing'
    }
  })
</script>

{#if view === 'loading'}
  <!-- Brief loading state while checking cache -->
  <div class="flex h-screen items-center justify-center bg-spine-900">
    <div class="text-center animate-fade-in">
      <svg class="mx-auto mb-3 h-8 w-8 text-amber-glow/60 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
      </svg>
      <p class="text-sm text-parchment-400/40">Loading...</p>
    </div>
  </div>
{:else if view === 'landing'}
  <LandingPage onBookLoaded={goToReader} />
{:else}
  <div class="flex h-screen flex-col bg-parchment-50 text-spine-900">
    <div class="flex flex-1 overflow-hidden">
      <Sidebar />
      <Reader />
    </div>
    <AudioPlayer />
  </div>
{/if}
```

**Step 2: Verify**

Run: `npm run check`
Expected: No type errors.

**Step 3: Test manually**

Run: `npm run dev`

Test scenarios:
1. Fresh browser (no cache): should see landing page with active download button, disabled drop zone
2. Click download → button shows spinner → eventually "Model Ready" → drop zone activates
3. Drop/upload an EPUB → transitions to reader view
4. Refresh page → should skip landing and go straight to reader (model cached + book saved)
5. Clear IndexedDB but keep model cache → should show landing with drop zone enabled

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add view routing — landing page gates reader until model downloaded"
```

---

### Task 4: Clean up mockup file

**Files:**
- Delete: `mockup.html`

**Step 1: Remove the temporary mockup**

```bash
rm mockup.html
```

**Step 2: Commit**

```bash
git add -u mockup.html
git commit -m "chore: remove temporary landing page mockup"
```
