<script lang="ts">
  import { onMount } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
  import { parseBook } from './lib/book'
  import { parsedChapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed, ttsModelStatus } from './lib/stores'
  import { loadBookFile, loadReadingState } from './lib/storage'
  import { getTTSManagerInstance } from './lib/tts'

  onMount(async () => {
    const file = await loadBookFile()
    if (!file) return

    try {
      const chapters = await parseBook(file)
      $parsedChapters = chapters
      $fileName = file.name

      // Start loading TTS model eagerly
      const tts = getTTSManagerInstance()
      tts.setOnStatusChange((status) => { $ttsModelStatus = status })
      tts.init()

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
    } catch (e) {
      console.error('Failed to restore book:', e)
    }
  })
</script>

<div class="flex h-screen flex-col bg-parchment-50 text-spine-900">
  <div class="flex flex-1 overflow-hidden">
    <Sidebar />
    <Reader />
  </div>
  <AudioPlayer />
</div>
