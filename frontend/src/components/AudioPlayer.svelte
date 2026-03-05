<script lang="ts">
  import { bookId, currentChapterIndex, isPlaying, selectedVoice, playbackSpeed } from '../lib/stores'
  import { narrateUrl } from '../lib/api'

  const VOICES = [
    'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
    'am_adam', 'am_michael',
    'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis',
  ]

  let audioEl: HTMLAudioElement

  function play() {
    if (!$bookId || $currentChapterIndex < 0) return
    const url = narrateUrl($bookId, $currentChapterIndex, $selectedVoice, $playbackSpeed)
    audioEl.src = url
    audioEl.play()
    $isPlaying = true
  }

  function stop() {
    audioEl.pause()
    audioEl.src = ''
    $isPlaying = false
  }

  function handleEnded() {
    $isPlaying = false
  }
</script>

<footer class="border-t border-zinc-800 bg-zinc-900 px-6 py-3">
  <div class="mx-auto flex max-w-4xl items-center gap-4">
    <button
      class="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
      disabled={!$bookId || $currentChapterIndex < 0}
      onclick={() => $isPlaying ? stop() : play()}
    >
      {$isPlaying ? 'Stop' : 'Play'}
    </button>

    <label class="flex items-center gap-2 text-sm text-zinc-400">
      Voice
      <select
        bind:value={$selectedVoice}
        class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 text-sm border border-zinc-700"
      >
        {#each VOICES as v}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </label>

    <label class="flex items-center gap-2 text-sm text-zinc-400">
      Speed
      <input
        type="range"
        min="0.5"
        max="2.5"
        step="0.1"
        bind:value={$playbackSpeed}
        class="w-24"
      />
      <span class="w-8 text-zinc-200">{$playbackSpeed.toFixed(1)}</span>
    </label>
  </div>

  <audio bind:this={audioEl} onended={handleEnded} class="hidden"></audio>
</footer>
