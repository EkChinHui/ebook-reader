<script lang="ts">
  import { parseBook } from '../lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed, ttsModelStatus, bookType, pdfDocument, cachedChapters } from '../lib/stores'
  import { saveBookFile, saveReadingState, removeBookFile, removeReadingState, clearAudioCache } from '../lib/storage'
  import { getTTSManagerInstance } from '../lib/tts'

  interface Props {
    onGoHome?: () => void
  }
  let { onGoHome }: Props = $props()

  let uploading = false
  let error = ''
  let fileInput: HTMLInputElement

  function openFilePicker() {
    if (!uploading) fileInput.click()
  }

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    error = ''
    uploading = true
    try {
      if ($pdfDocument) {
        await $pdfDocument.destroy()
        $pdfDocument = null
      }
      const result = await parseBook(file)
      $parsedChapters = result.chapters
      $fileName = file.name
      $bookType = result.type
      $pdfDocument = result.pdfDocument ?? null
      saveBookFile(file)

      // Start loading TTS model on first book upload
      const tts = getTTSManagerInstance()
      tts.setOnStatusChange((status) => { $ttsModelStatus = status })
      tts.init()

      if (result.chapters.length > 0) {
        selectChapter(0)
      }
    } catch (err: any) {
      error = err.message || 'Failed to parse book'
    } finally {
      uploading = false
    }
  }

  async function removeBook() {
    if ($pdfDocument) {
      await $pdfDocument.destroy()
      $pdfDocument = null
    }
    $parsedChapters = []
    $currentChapterIndex = 0
    $chapterText = ''
    $fileName = ''
    $bookType = 'epub'
    await removeBookFile()
    await clearAudioCache()
    removeReadingState()
    onGoHome?.()
  }

  function selectChapter(index: number) {
    if ($parsedChapters.length === 0) return
    $currentChapterIndex = index
    $chapterText = $parsedChapters[index].text
    saveReadingState({ fileName: $fileName, chapterIndex: index, currentTime: 0, voice: $selectedVoice, speed: $playbackSpeed })
  }
</script>

<aside class="group relative w-72 flex flex-col h-full bg-spine-900 text-parchment-100 overflow-hidden">
  <!-- Decorative spine gradient -->
  <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/[0.06]"></div>

  <!-- Header -->
  <div class="relative z-10 p-5 pb-4">
    <div class="flex items-center gap-2.5 mb-4">
      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-accent/15">
        <svg class="h-4 w-4 text-amber-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>
      <h1 class="flex-1 font-serif text-xl font-semibold tracking-wide text-parchment-100">Narrator</h1>
      {#if onGoHome}
        <button
          type="button"
          onclick={onGoHome}
          class="flex h-8 w-8 items-center justify-center rounded-lg text-parchment-400/60 transition-colors hover:bg-parchment-400/10 hover:text-parchment-200"
          title="Back to home"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </button>
      {/if}
    </div>

    <input bind:this={fileInput} type="file" accept=".epub,.pdf" class="hidden" onchange={handleFile} disabled={uploading} />
    <button
      type="button"
      class="block w-full cursor-pointer rounded-xl border border-dashed border-parchment-400/20 p-4 text-center transition-all duration-300 hover:border-amber-accent/50 hover:bg-amber-accent/5"
      class:opacity-50={uploading}
      class:animate-pulse={uploading}
      onclick={openFilePicker}
    >
      {#if uploading}
        <span class="text-sm text-parchment-300">Processing book...</span>
      {:else if $fileName}
        <span class="block text-sm font-medium text-parchment-200 truncate">{$fileName}</span>
        <span class="mt-1 block text-xs text-parchment-400/60">Click to replace</span>
      {:else}
        <svg class="mx-auto mb-2 h-6 w-6 text-parchment-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span class="text-sm text-parchment-400/60">Drop EPUB/PDF or click to upload</span>
      {/if}
    </button>
    {#if error}
      <p class="mt-2 text-sm text-red-400/90">{error}</p>
    {/if}
    {#if $fileName}
      <button
        type="button"
        onclick={removeBook}
        class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-parchment-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
        Remove book
      </button>
    {/if}
  </div>

  <!-- Divider -->
  <div class="mx-5 h-px bg-gradient-to-r from-transparent via-parchment-400/15 to-transparent"></div>

  <!-- Chapter list -->
  <nav class="relative z-10 flex-1 overflow-y-auto py-2">
    {#if $parsedChapters.length === 0}
      <div class="px-5 py-8 text-center">
        <p class="font-serif text-sm italic text-parchment-400/30">Chapters will appear here</p>
      </div>
    {/if}
    {#each $parsedChapters as chapter, i (i)}
      {@const active = $currentChapterIndex === i}
      {@const cached = $cachedChapters.has(i)}
      <button
        class="group/ch relative w-full text-left px-5 py-3 text-sm transition-all duration-200 {active ? 'text-amber-warm' : 'text-parchment-400/60'}"
        onclick={() => selectChapter(i)}
        style={`animation-delay: ${i * 30}ms`}
      >
        {#if active}
          <div class="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-r bg-amber-accent"></div>
        {/if}
        <span class="inline-block transition-transform duration-200 group-hover/ch:translate-x-1" class:translate-x-1={active}>
          <span class="mr-2 font-serif text-xs tabular-nums {active ? 'text-amber-accent' : 'text-parchment-400/30'}">{i + 1}</span>
          <span class="group-hover/ch:text-parchment-200 transition-colors" class:font-medium={active}>{chapter.title}</span>
          {#if cached}
            <span class="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70" title="Audio ready"></span>
          {/if}
        </span>
      </button>
    {/each}
  </nav>

  <!-- Attribution -->
  <div class="relative z-10 px-5 py-3 text-center">
    <a href="https://www.ekchinhui.com/" target="_blank" rel="noopener noreferrer" class="text-[10px] text-parchment-400/40 underline transition-colors hover:text-parchment-400/70">
      Built by Ek Chin Hui
    </a>
  </div>

  <!-- Bottom fade -->
  <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-spine-900 to-transparent z-20"></div>
</aside>
