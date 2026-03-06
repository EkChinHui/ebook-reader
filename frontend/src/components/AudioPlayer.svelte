<script lang="ts">
  import { bookId, currentChapterIndex, chapters, chapterText, isPlaying, selectedVoice, playbackSpeed, segments, currentSegmentIndex } from '../lib/stores'
  import { narrateTimed, audioUrl, fetchChapter } from '../lib/api'

  const VOICES = [
    { id: 'af_heart', label: 'Heart' },
    { id: 'af_bella', label: 'Bella' },
    { id: 'af_nicole', label: 'Nicole' },
    { id: 'af_sarah', label: 'Sarah' },
    { id: 'af_sky', label: 'Sky' },
    { id: 'am_adam', label: 'Adam' },
    { id: 'am_michael', label: 'Michael' },
    { id: 'bf_emma', label: 'Emma' },
    { id: 'bf_isabella', label: 'Isabella' },
    { id: 'bm_george', label: 'George' },
    { id: 'bm_lewis', label: 'Lewis' },
  ]

  let audioEl: HTMLAudioElement
  let loading = false
  let currentTime = 0
  let duration = 0

  async function play() {
    if (!$bookId || $currentChapterIndex < 0 || loading) return

    loading = true
    try {
      const result = await narrateTimed($bookId, $currentChapterIndex, $selectedVoice, 1.0)
      $segments = result.segments
      $currentSegmentIndex = -1
      audioEl.src = audioUrl(result.audio_id)
      audioEl.playbackRate = $playbackSpeed
      await audioEl.play()
      $isPlaying = true
    } catch (e) {
      console.error('Narration failed:', e)
    } finally {
      loading = false
    }
  }

  function stop() {
    audioEl.pause()
    audioEl.src = ''
    $isPlaying = false
    $currentSegmentIndex = -1
    $segments = []
    currentTime = 0
    duration = 0
  }

  function togglePlayPause() {
    if (!$isPlaying && !audioEl.src) {
      play()
    } else if ($isPlaying) {
      audioEl.pause()
      $isPlaying = false
    } else if (audioEl.src) {
      audioEl.play()
      $isPlaying = true
    }
  }

  function skip(seconds: number) {
    if (!audioEl.src) return
    audioEl.currentTime = Math.max(0, Math.min(audioEl.currentTime + seconds, audioEl.duration || 0))
  }

  async function changeChapter(delta: number) {
    if (!$bookId) return
    const newIndex = $currentChapterIndex + delta
    if (newIndex < 0 || newIndex >= $chapters.length) return

    const wasPlaying = $isPlaying
    if ($isPlaying) stop()

    $currentChapterIndex = newIndex
    const content = await fetchChapter($bookId, newIndex)
    $chapterText = content.text

    if (wasPlaying) play()
  }

  // Apply speed changes in real-time
  $: if (audioEl) {
    audioEl.playbackRate = $playbackSpeed
  }

  function cycleSpeed() {
    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    const current = speeds.findIndex(s => Math.abs(s - $playbackSpeed) < 0.05)
    $playbackSpeed = speeds[(current + 1) % speeds.length]
  }

  function handleTimeUpdate() {
    currentTime = audioEl.currentTime
    duration = audioEl.duration || 0
    if ($segments.length === 0) return
    const t = audioEl.currentTime
    let idx = $segments.findIndex(s => t >= s.start && t < s.end)
    if (idx === -1 && t >= $segments[$segments.length - 1].start) {
      idx = $segments.length - 1
    }
    if (idx !== $currentSegmentIndex) {
      $currentSegmentIndex = idx
    }
  }

  function handleEnded() {
    $isPlaying = false
    $currentSegmentIndex = -1
  }

  function handleSeek(e: Event) {
    const input = e.target as HTMLInputElement
    audioEl.currentTime = parseFloat(input.value)
  }

  function formatTime(s: number): string {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  $: canPlay = $bookId && $currentChapterIndex >= 0 && !loading
  $: hasPrev = $currentChapterIndex > 0
  $: hasNext = $currentChapterIndex < $chapters.length - 1
  $: hasAudio = !!audioEl?.src
  $: progress = duration > 0 ? (currentTime / duration) * 100 : 0
</script>

<footer class="relative border-t border-spine-900/[0.06] bg-parchment-50 shadow-[0_-1px_12px_rgba(0,0,0,0.03)]">
  <!-- Subtle top accent line -->
  <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent"></div>

  <!-- Progress bar -->
  {#if hasAudio}
    <div class="relative h-1 w-full bg-spine-900/[0.04] cursor-pointer group">
      <div
        class="absolute left-0 top-0 h-full bg-gradient-to-r from-amber-accent to-amber-glow transition-all duration-100"
        style="width: {progress}%"
      ></div>
      <input
        type="range"
        min="0"
        max={duration}
        step="0.1"
        value={currentTime}
        oninput={handleSeek}
        class="progress-seek absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  {/if}

  <div class="mx-auto flex max-w-4xl items-center gap-2 px-6 py-3">
    <!-- Transport controls -->
    <div class="flex items-center gap-1">
      <!-- Previous chapter -->
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors {hasPrev ? 'text-spine-800/50 hover:text-spine-800 hover:bg-spine-900/[0.05]' : 'text-spine-900/15'}"
        disabled={!hasPrev}
        onclick={() => changeChapter(-1)}
        title="Previous chapter"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
        </svg>
      </button>

      <!-- Rewind 10s -->
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors {hasAudio ? 'text-spine-800/50 hover:text-spine-800 hover:bg-spine-900/[0.05]' : 'text-spine-900/15'}"
        disabled={!hasAudio}
        onclick={() => skip(-10)}
        title="Rewind 10s"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12.5 8.5L9 5l3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 5a8 8 0 11-1 10" stroke-linecap="round"/>
          <text x="12" y="15.5" font-size="7" font-weight="600" fill="currentColor" stroke="none" text-anchor="middle">10</text>
        </svg>
      </button>

      <!-- Play/Pause -->
      <button
        class="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300 {canPlay ? 'bg-amber-accent hover:bg-amber-glow shadow-[0_2px_12px_rgba(196,132,29,0.3)] hover:shadow-[0_4px_20px_rgba(196,132,29,0.4)]' : 'bg-spine-900/10'}"
        disabled={!canPlay}
        onclick={togglePlayPause}
      >
        {#if loading}
          <svg class="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"/>
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"/>
          </svg>
        {:else if $isPlaying}
          <svg class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        {:else}
          <svg class="h-4 w-4 transition-transform duration-200 group-hover:scale-110 {canPlay ? 'text-white' : 'text-spine-900/25'}" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z"/>
          </svg>
        {/if}
      </button>

      <!-- Forward 30s -->
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors {hasAudio ? 'text-spine-800/50 hover:text-spine-800 hover:bg-spine-900/[0.05]' : 'text-spine-900/15'}"
        disabled={!hasAudio}
        onclick={() => skip(30)}
        title="Forward 30s"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11.5 8.5L15 5l-3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M15 5a8 8 0 101 10" stroke-linecap="round"/>
          <text x="12" y="15.5" font-size="7" font-weight="600" fill="currentColor" stroke="none" text-anchor="middle">30</text>
        </svg>
      </button>

      <!-- Next chapter -->
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors {hasNext ? 'text-spine-800/50 hover:text-spine-800 hover:bg-spine-900/[0.05]' : 'text-spine-900/15'}"
        disabled={!hasNext}
        onclick={() => changeChapter(1)}
        title="Next chapter"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 6h2v12h-2zm-1.5 6L6 6v12z"/>
        </svg>
      </button>
    </div>

    <!-- Time display -->
    {#if hasAudio}
      <span class="ml-2 text-xs tabular-nums text-spine-800/40 font-sans">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    {/if}

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Voice selector -->
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-spine-900/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
      </svg>
      <select
        bind:value={$selectedVoice}
        class="rounded-lg border border-spine-900/[0.08] bg-parchment-100/80 px-3 py-1.5 font-sans text-sm text-spine-800 transition-colors hover:border-amber-accent/30 focus:border-amber-accent/50 focus:outline-none focus:ring-1 focus:ring-amber-accent/20"
      >
        {#each VOICES as v}
          <option value={v.id}>{v.label}</option>
        {/each}
      </select>
    </div>

    <!-- Speed button (clickable cycle) -->
    <button
      class="rounded-lg border border-spine-900/[0.08] bg-parchment-100/80 px-2.5 py-1 font-serif text-sm font-semibold tabular-nums text-spine-800 transition-colors hover:border-amber-accent/30 hover:text-amber-accent"
      onclick={cycleSpeed}
      title="Click to cycle speed"
    >
      {$playbackSpeed.toFixed(2)}x
    </button>

    <!-- Status indicator -->
    {#if $isPlaying}
      <div class="flex items-center gap-2">
        <div class="flex items-end gap-0.5">
          <div class="h-2 w-0.5 animate-pulse rounded-full bg-amber-accent" style="animation-duration: 0.4s;"></div>
          <div class="h-3 w-0.5 animate-pulse rounded-full bg-amber-accent" style="animation-duration: 0.6s; animation-delay: 0.1s;"></div>
          <div class="h-1.5 w-0.5 animate-pulse rounded-full bg-amber-accent" style="animation-duration: 0.5s; animation-delay: 0.2s;"></div>
          <div class="h-2.5 w-0.5 animate-pulse rounded-full bg-amber-accent" style="animation-duration: 0.7s; animation-delay: 0.15s;"></div>
        </div>
      </div>
    {/if}
  </div>

  <audio bind:this={audioEl} ontimeupdate={handleTimeUpdate} onended={handleEnded} class="hidden"></audio>
</footer>
