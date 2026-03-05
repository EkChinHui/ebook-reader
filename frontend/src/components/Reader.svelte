<script lang="ts">
  import { chapterText, chapters, currentChapterIndex } from '../lib/stores'

  let currentTitle: string
  $: currentTitle = $chapters.find(c => c.index === $currentChapterIndex)?.title ?? ''
</script>

<main class="flex-1 overflow-y-auto bg-zinc-950 p-8">
  {#if $chapterText}
    <div class="mx-auto max-w-2xl">
      <h2 class="mb-6 text-2xl font-semibold text-zinc-100">{currentTitle}</h2>
      <div class="prose prose-invert prose-zinc max-w-none leading-relaxed text-zinc-300 whitespace-pre-wrap">
        {$chapterText}
      </div>
    </div>
  {:else}
    <div class="flex h-full items-center justify-center text-zinc-600">
      <p class="text-lg">Upload an ebook to start reading</p>
    </div>
  {/if}
</main>
