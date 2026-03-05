<script lang="ts">
  import { uploadBook, fetchChapter } from '../lib/api'
  import { bookId, chapters, currentChapterIndex, chapterText, fileName } from '../lib/stores'

  let uploading = false
  let error = ''

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    error = ''
    uploading = true
    try {
      const result = await uploadBook(file)
      $bookId = result.book_id
      $chapters = result.chapters
      $fileName = file.name
      if (result.chapters.length > 0) {
        await selectChapter(0)
      }
    } catch (err: any) {
      error = err.message || 'Upload failed'
    } finally {
      uploading = false
    }
  }

  async function selectChapter(index: number) {
    if (!$bookId) return
    $currentChapterIndex = index
    const content = await fetchChapter($bookId, index)
    $chapterText = content.text
  }
</script>

<aside class="w-72 bg-zinc-900 text-zinc-100 flex flex-col h-full border-r border-zinc-800">
  <div class="p-4 border-b border-zinc-800">
    <h1 class="text-lg font-semibold mb-3">Ebook Narrator</h1>
    <label
      class="block w-full cursor-pointer rounded-lg border-2 border-dashed border-zinc-600 p-4 text-center text-sm text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-200"
      class:opacity-50={uploading}
    >
      {#if uploading}
        Uploading...
      {:else if $fileName}
        {$fileName} — click to replace
      {:else}
        Drop EPUB/PDF or click to upload
      {/if}
      <input type="file" accept=".epub,.pdf" class="hidden" onchange={handleFile} disabled={uploading} />
    </label>
    {#if error}
      <p class="mt-2 text-sm text-red-400">{error}</p>
    {/if}
  </div>

  <nav class="flex-1 overflow-y-auto">
    {#each $chapters as chapter (chapter.index)}
      <button
        class="w-full text-left px-4 py-2.5 text-sm transition hover:bg-zinc-800"
        class:bg-zinc-800={$currentChapterIndex === chapter.index}
        class:text-white={$currentChapterIndex === chapter.index}
        class:text-zinc-400={$currentChapterIndex !== chapter.index}
        onclick={() => selectChapter(chapter.index)}
      >
        {chapter.title}
      </button>
    {/each}
  </nav>
</aside>
