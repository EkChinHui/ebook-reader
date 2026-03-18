<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { TextLayer } from 'pdfjs-dist'
  import { pdfDocument, parsedChapters, currentChapterIndex, segments, currentSegmentIndex, isPlaying, chapterText } from '../lib/stores'
  import type { PDFPageProxy } from 'pdfjs-dist'

  let containerEl: HTMLElement
  let canvasEl: HTMLCanvasElement
  let textLayerEl: HTMLDivElement
  let pageRendered = false
  let currentPage: PDFPageProxy | null = null

  // Mapping: for each span index, store start/end offsets into chapter text
  let spanRanges: { start: number; end: number }[] = []
  let textDivs: HTMLElement[] = []
  let highlightedSpans: Set<HTMLElement> = new Set()

  // Track chapter changes
  let renderedChapterIndex = -1

  $: pageNumber = $parsedChapters[$currentChapterIndex]?.pageNumber

  // Re-render when chapter changes
  $: if ($currentChapterIndex >= 0 && $pdfDocument && pageNumber && $currentChapterIndex !== renderedChapterIndex) {
    renderedChapterIndex = $currentChapterIndex
    renderPage()
  }

  // Update highlights when segment changes — use store values directly so
  // Svelte tracks them as dependencies and re-runs when they change
  $: {
    const segs = $segments
    const segIdx = $currentSegmentIndex
    const playing = $isPlaying
    if (segs.length > 0 && playing && segIdx >= 0 && pageRendered) {
      highlightSegment(segIdx, segs)
    } else {
      clearHighlights()
    }
  }

  async function renderPage() {
    if (!$pdfDocument || !pageNumber) return

    pageRendered = false
    clearHighlights()
    spanRanges = []
    textDivs = []

    try {
      currentPage = await $pdfDocument.getPage(pageNumber)
    } catch {
      return
    }

    // Fit to container width
    const baseViewport = currentPage.getViewport({ scale: 1 })
    const containerWidth = containerEl?.clientWidth || 800
    const maxWidth = Math.min(containerWidth - 64, 900)
    const scale = maxWidth / baseViewport.width
    const viewport = currentPage.getViewport({ scale })

    // Render at higher resolution for crisp text on HiDPI displays
    const dpr = window.devicePixelRatio || 1
    canvasEl.width = Math.floor(viewport.width * dpr)
    canvasEl.height = Math.floor(viewport.height * dpr)
    canvasEl.style.width = `${viewport.width}px`
    canvasEl.style.height = `${viewport.height}px`

    const ctx = canvasEl.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    await currentPage.render({ canvas: null, canvasContext: ctx, viewport }).promise

    // Render text layer
    textLayerEl.innerHTML = ''
    textLayerEl.style.width = `${viewport.width}px`
    textLayerEl.style.height = `${viewport.height}px`
    textLayerEl.style.setProperty('--total-scale-factor', `${scale}`)

    const textContent = await currentPage.getTextContent()

    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
    })
    await textLayer.render()

    textDivs = textLayer.textDivs as HTMLElement[]
    const textContentItems = textLayer.textContentItemsStr as string[]

    buildSpanRanges(textContentItems)

    pageRendered = true
  }

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim()
  }

  function buildSpanRanges(textContentItems: string[]) {
    // Strategy: normalize both the chapter text and the concatenated span texts,
    // then walk through both in lockstep to find where each span's characters
    // land in the chapter text.
    const chapterStr = $chapterText
    const normChapter = normalize(chapterStr)

    spanRanges = []
    let chapterPos = 0

    for (let i = 0; i < textContentItems.length; i++) {
      const spanText = textContentItems[i]
      if (!spanText) {
        spanRanges.push({ start: chapterPos, end: chapterPos })
        continue
      }

      const normSpan = normalize(spanText)
      if (!normSpan) {
        spanRanges.push({ start: chapterPos, end: chapterPos })
        continue
      }

      // Try to find this span's text in the chapter text starting from current position
      const foundAt = normChapter.indexOf(normSpan, chapterPos)
      if (foundAt !== -1 && foundAt < chapterPos + 200) {
        // Found it — map back to original chapter text positions
        const origStart = mapNormToOrig(chapterStr, foundAt)
        const origEnd = mapNormToOrig(chapterStr, foundAt + normSpan.length)
        spanRanges.push({ start: origStart, end: origEnd })
        chapterPos = foundAt + normSpan.length
      } else {
        // Couldn't find span text — use a character-by-character fallback
        const start = chapterPos
        // Advance chapterPos by the length of non-whitespace chars in the span
        let remaining = normSpan.replace(/\s/g, '').length
        let pos = chapterPos
        while (remaining > 0 && pos < normChapter.length) {
          if (normChapter[pos] !== ' ') remaining--
          pos++
        }
        spanRanges.push({ start: mapNormToOrig(chapterStr, start), end: mapNormToOrig(chapterStr, pos) })
        chapterPos = pos
      }
    }
  }

  // Map a position in the normalized (whitespace-collapsed) string back to the
  // original chapter text position
  function mapNormToOrig(original: string, normPos: number): number {
    let ni = 0
    let oi = 0
    // Skip leading whitespace
    while (oi < original.length && /\s/.test(original[oi])) oi++

    while (ni < normPos && oi < original.length) {
      if (/\s/.test(original[oi])) {
        // In the original, skip all whitespace; in normalized, it's a single space
        while (oi < original.length && /\s/.test(original[oi])) oi++
        ni++ // the single space in normalized
      } else {
        oi++
        ni++
      }
    }
    return oi
  }

  function highlightSegment(segIdx: number, segs: typeof $segments) {
    clearHighlights()

    if (segIdx < 0 || segIdx >= segs.length) return
    if (spanRanges.length === 0 || textDivs.length === 0) return

    const segment = segs[segIdx]
    const chapterStr = $chapterText

    // Find segment position in chapter text, searching past previous segments
    let searchFrom = 0
    for (let i = 0; i < segIdx; i++) {
      const prev = chapterStr.indexOf(segs[i].text, searchFrom)
      if (prev !== -1) searchFrom = prev + segs[i].text.length
    }
    const segStart = chapterStr.indexOf(segment.text, searchFrom)
    if (segStart === -1) return
    const segEnd = segStart + segment.text.length

    // Find which spans overlap with [segStart, segEnd)
    const matchedIndices: number[] = []
    for (let i = 0; i < spanRanges.length; i++) {
      const range = spanRanges[i]
      // Check overlap: span range intersects segment range
      if (range.end > segStart && range.start < segEnd) {
        matchedIndices.push(i)
      }
    }

    if (matchedIndices.length === 0) return

    // Apply highlight
    for (const idx of matchedIndices) {
      if (idx < textDivs.length) {
        textDivs[idx].classList.add('tts-active')
        highlightedSpans.add(textDivs[idx])
      }
    }

    // Scroll first highlighted span into view
    tick().then(() => {
      const first = textDivs[matchedIndices[0]]
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }

  function clearHighlights() {
    for (const span of highlightedSpans) {
      span.classList.remove('tts-active')
    }
    highlightedSpans = new Set()
  }

  // Handle resize with debounce
  let resizeObserver: ResizeObserver | null = null
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (pageRendered && $currentChapterIndex >= 0) {
          renderPage()
        }
      }, 200)
    })
    if (containerEl) resizeObserver.observe(containerEl)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
  })
</script>

<main
  class="relative flex-1 overflow-y-auto"
  bind:this={containerEl}
  style="background: linear-gradient(135deg, #faf8f4 0%, #f5f0e8 50%, #faf8f4 100%);"
>
  <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-accent/[0.02] via-transparent to-amber-accent/[0.01]"></div>
  <div class="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-black/[0.02] to-transparent"></div>

  {#if pageNumber}
    <div class="relative mx-auto px-8 py-8 flex flex-col items-center">
      <!-- Page number label -->
      <div class="mb-4 flex items-center gap-3">
        <div class="h-px flex-1 bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent" style="min-width: 40px;"></div>
        <span class="font-serif text-xs font-medium uppercase tracking-[0.25em] text-amber-accent/50">
          Page {pageNumber}
        </span>
        <div class="h-px flex-1 bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent" style="min-width: 40px;"></div>
      </div>

      <!-- PDF page container -->
      <div class="pdf-page-wrapper relative shadow-lg rounded-sm overflow-hidden">
        <canvas bind:this={canvasEl}></canvas>
        <div class="textLayer" bind:this={textLayerEl}></div>
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

<style>
  /* pdfjs-dist text layer styles */
  .textLayer {
    position: absolute;
    text-align: initial;
    inset: 0;
    overflow: clip;
    opacity: 1;
    line-height: 1;
    -webkit-text-size-adjust: none;
    -moz-text-size-adjust: none;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    z-index: 1;
  }

  .textLayer :global(span),
  .textLayer :global(br) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
  }

  .textLayer {
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor, 1) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }

  .textLayer > :global(:not(.markedContent)),
  .textLayer :global(.markedContent span:not(.markedContent)) {
    z-index: 1;
    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  .textLayer :global(.markedContent) {
    display: contents;
  }

  /* TTS highlight styling */
  .textLayer :global(span.tts-active) {
    background-color: rgba(196, 132, 29, 0.35);
    border-radius: 2px;
  }
</style>
