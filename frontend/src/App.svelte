<script lang="ts">
  import { onMount } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
  import { uploadBook, fetchChapter } from './lib/api'
  import { bookId, chapters, currentChapterIndex, chapterText, fileName, selectedVoice, playbackSpeed } from './lib/stores'
  import { loadBookFile, loadReadingState } from './lib/storage'

  onMount(async () => {
    const file = await loadBookFile()
    if (!file) return

    try {
      const result = await uploadBook(file)
      $bookId = result.book_id
      $chapters = result.chapters
      $fileName = file.name

      const state = loadReadingState()
      if (state && state.fileName === file.name) {
        $selectedVoice = state.voice
        $playbackSpeed = state.speed

        const idx = Math.min(state.chapterIndex, result.chapters.length - 1)
        $currentChapterIndex = idx
        const content = await fetchChapter(result.book_id, idx)
        $chapterText = content.text
      } else if (result.chapters.length > 0) {
        $currentChapterIndex = 0
        const content = await fetchChapter(result.book_id, 0)
        $chapterText = content.text
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
