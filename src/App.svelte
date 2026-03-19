<script lang="ts">
  import { onMount } from 'svelte'
  import LandingPage from './components/LandingPage.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
  import { parseBook } from './lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed, ttsModelStatus, bookType, pdfDocument, ttsEngine } from './lib/stores'
  import { loadBookFile, loadReadingState, loadAudioCache } from './lib/storage'
  import { getTTSManagerInstance } from './lib/tts'

  let view = $state<'landing' | 'reader'>('landing')

  function goToReader() {
    view = 'reader'
  }

  function goToLanding() {
    view = 'landing'
  }

  onMount(async () => {
    const tts = getTTSManagerInstance()
    tts.setOnStatusChange((status) => { $ttsModelStatus = status })

    // Restore saved engine preference
    const savedEngine = localStorage.getItem('ttsEngine') as 'browser' | 'kokoro' | null
    if (savedEngine) $ttsEngine = savedEngine

    const isCached = await tts.checkCached()

    if (isCached) {
      // Model is cached — start loading it in the background
      tts.init()
    } else if ($ttsEngine !== 'browser') {
      // No cached model and not using browser TTS — stay on landing
      return
    }

    // Try to restore saved book
    const file = await loadBookFile()
    if (!file) return

    try {
      const result = await parseBook(file)
      $parsedChapters = result.chapters
      $fileName = file.name
      $bookType = result.type
      $pdfDocument = result.pdfDocument ?? null

      const state = loadReadingState()
      if (state && state.fileName === file.name) {
        $selectedVoice = state.voice
        $playbackSpeed = state.speed
        const idx = Math.min(state.chapterIndex, result.chapters.length - 1)
        $currentChapterIndex = idx
        $chapterText = result.chapters[idx].text
      } else if (result.chapters.length > 0) {
        $currentChapterIndex = 0
        $chapterText = result.chapters[0].text
      }

      // Hydrate audio cache from IndexedDB after stores are set
      await loadAudioCache()

      view = 'reader'
    } catch (e) {
      console.error('Failed to restore book:', e)
    }
  })

  // Persist engine preference
  $effect(() => {
    localStorage.setItem('ttsEngine', $ttsEngine)
  })
</script>

{#if view === 'landing'}
  <LandingPage onBookLoaded={goToReader} />
{:else}
  <div class="flex h-screen flex-col bg-parchment-50 text-spine-900">
    <div class="flex flex-1 overflow-hidden">
      <Sidebar onGoHome={goToLanding} />
      <Reader />
    </div>
    <AudioPlayer />
  </div>
{/if}
