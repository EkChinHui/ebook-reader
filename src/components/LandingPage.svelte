<script lang="ts">
  import { parseBook } from '../lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, ttsModelStatus, bookType, pdfDocument } from '../lib/stores'
  import { saveBookFile } from '../lib/storage'
  import { getTTSManagerInstance } from '../lib/tts'
  import { onMount } from 'svelte'

  interface Props {
    onBookLoaded: () => void
  }
  let { onBookLoaded }: Props = $props()

  let fileInput: HTMLInputElement
  let uploading = $state(false)
  let error = $state('')
  let dragOver = $state(false)

  let downloadProgress = $state(0)
  let downloadTotal = $state(0)
  let downloadLoaded = $state(0)

  const tts = getTTSManagerInstance()

  onMount(() => {
    tts.setOnStatusChange((status) => { $ttsModelStatus = status })
  })

  function handleDownload() {
    if ($ttsModelStatus === 'loading' || $ttsModelStatus === 'ready') return
    tts.setOnProgress((p) => {
      downloadProgress = p.progress
      downloadLoaded = p.loaded
      downloadTotal = p.total
    })
    tts.init()
  }

  async function handleDeleteModel() {
    await tts.deleteCache()
  }

  let modelReady = $derived($ttsModelStatus === 'ready')
  let modelLoading = $derived($ttsModelStatus === 'loading')

  function openFilePicker() {
    if (!uploading && modelReady) fileInput.click()
  }

  async function processFile(file: File) {
    error = ''
    uploading = true
    try {
      const result = await parseBook(file)
      $parsedChapters = result.chapters
      $fileName = file.name
      $bookType = result.type
      $pdfDocument = result.pdfDocument ?? null
      saveBookFile(file)

      if (result.chapters.length > 0) {
        $currentChapterIndex = 0
        $chapterText = result.chapters[0].text
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
        {#if downloadTotal > 0}
          <div class="w-full">
            <div class="mb-2 flex items-center justify-between text-xs">
              <span>Downloading Model...</span>
              <span>{Math.round(downloadProgress)}%</span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-spine-900/30">
              <div
                class="h-full rounded-full bg-amber-glow transition-all duration-300 ease-out"
                style="width: {downloadProgress}%"
              ></div>
            </div>
            <p class="mt-1.5 text-[10px] text-parchment-400/35">
              {(downloadLoaded / 1024 / 1024).toFixed(0)} / {(downloadTotal / 1024 / 1024).toFixed(0)} MB
            </p>
          </div>
        {:else}
          <span class="flex items-center justify-center gap-2">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
            </svg>
            Loading Model...
          </span>
        {/if}
      {:else}
        Download TTS Voice Model
      {/if}
    </button>
    <p class="mb-6 text-center text-xs text-parchment-400/35">
      {#if downloadTotal > 0}
        ~{(downloadTotal / 1024 / 1024).toFixed(0)} MB — cached after first download
      {:else}
        ~88–330 MB — cached after first download
      {/if}
      {#if modelReady}
        <span class="mx-1">·</span>
        <button type="button" class="underline hover:text-parchment-400/60 transition-colors" onclick={handleDeleteModel}>delete model</button>
      {/if}
    </p>

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

    <p class="mt-8 text-center text-xs text-parchment-400/40">
      Built by <a href="https://www.ekchinhui.com/" target="_blank" rel="noopener noreferrer" class="underline transition-colors hover:text-parchment-400/70">Ek Chin Hui</a>
    </p>
  </div>
</div>
