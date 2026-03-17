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

  let view = $state<'loading' | 'landing' | 'reader'>('loading')

  function goToReader() {
    view = 'reader'
  }

  onMount(async () => {
    const tts = getTTSManagerInstance()

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
