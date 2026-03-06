<script lang="ts">
  import { chapterText, chapters, currentChapterIndex, segments, currentSegmentIndex, isPlaying } from '../lib/stores'
  import { tick } from 'svelte'
  import type { TimedSegment } from '../lib/api'

  let currentTitle: string
  $: currentTitle = $chapters.find(c => c.index === $currentChapterIndex)?.title ?? ''

  $: hasSegments = $segments.length > 0 && $isPlaying

  type Piece = { type: 'gap', text: string } | { type: 'seg', index: number, seg: TimedSegment }
  let pieces: Piece[] = []
  $: {
    if (hasSegments) {
      const result: Piece[] = []
      let pos = 0
      const full = $chapterText
      for (let i = 0; i < $segments.length; i++) {
        const seg = $segments[i]
        const found = full.indexOf(seg.text, pos)
        if (found > pos) {
          result.push({ type: 'gap', text: full.slice(pos, found) })
        }
        result.push({ type: 'seg', index: i, seg })
        pos = found === -1 ? pos + seg.text.length : found + seg.text.length
      }
      if (pos < full.length) {
        result.push({ type: 'gap', text: full.slice(pos) })
      }
      pieces = result
    } else {
      pieces = []
    }
  }

  let readerEl: HTMLElement

  // Scroll to top when chapter changes
  $: if ($currentChapterIndex >= 0 && readerEl) {
    readerEl.scrollTop = 0
  }

  $: if ($currentSegmentIndex >= 0 && readerEl) {
    tick().then(() => {
      const active = readerEl.querySelector('[data-active="true"]')
      if (active) {
        active.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }
</script>

<main
  class="relative flex-1 overflow-y-auto"
  bind:this={readerEl}
  style="background: linear-gradient(135deg, #faf8f4 0%, #f5f0e8 50%, #faf8f4 100%);"
>
  <!-- Subtle paper texture -->
  <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-accent/[0.02] via-transparent to-amber-accent/[0.01]"></div>

  <!-- Left edge shadow from sidebar -->
  <div class="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-black/[0.02] to-transparent"></div>

  {#if $chapterText}
    <div class="relative mx-auto max-w-2xl px-8 py-12 animate-fade-up" style="animation-duration: 0.6s;">
      <!-- Chapter number ornament -->
      {#if $currentChapterIndex >= 0}
        <div class="mb-4 flex items-center gap-3">
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent"></div>
          <span class="font-serif text-xs font-medium uppercase tracking-[0.25em] text-amber-accent/50">
            Chapter {$currentChapterIndex + 1}
          </span>
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent"></div>
        </div>
      {/if}

      <h2 class="mb-10 text-center font-serif text-3xl font-semibold leading-snug text-spine-900/90 tracking-wide">
        {currentTitle}
      </h2>

      <!-- Drop cap initial -->
      <div class="font-serif text-[1.2rem] leading-[1.9] tracking-[0.01em] text-spine-800/80 whitespace-pre-wrap">
        {#if hasSegments}
          {#each pieces as piece}
            {#if piece.type === 'gap'}
              <span class="text-spine-800/25 transition-colors duration-300">{piece.text}</span>
            {:else}
              {@const active = piece.index === $currentSegmentIndex}
              <span
                class="transition-all duration-300 ease-out {active ? 'text-spine-900 font-medium' : 'text-spine-800/25'}"
                style={active ? 'background: linear-gradient(to top, rgba(196,132,29,0.15) 0%, rgba(196,132,29,0.08) 40%, transparent 40%); border-radius: 2px; padding: 0 2px; margin: 0 -2px;' : ''}
                data-active={active}
              >{piece.seg.text}</span>
            {/if}
          {/each}
        {:else}
          <span class="text-spine-800/80">{$chapterText}</span>
        {/if}
      </div>

      <!-- Chapter end ornament -->
      <div class="mt-16 flex justify-center">
        <div class="flex items-center gap-2 text-amber-accent/20">
          <div class="h-px w-8 bg-current"></div>
          <svg class="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 0L7.5 4.5L12 6L7.5 7.5L6 12L4.5 7.5L0 6L4.5 4.5Z"/>
          </svg>
          <div class="h-px w-8 bg-current"></div>
        </div>
      </div>
    </div>
  {:else}
    <div class="flex h-full flex-col items-center justify-center animate-fade-in" style="animation-duration: 0.8s;">
      <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-spine-900/[0.04]">
        <svg class="h-10 w-10 text-spine-900/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>
      <p class="font-serif text-xl text-spine-900/25 italic">Upload a book to begin</p>
    </div>
  {/if}
</main>
