<script lang="ts">
  import { parsedChapters, currentChapterIndex, chapterText, isPlaying, selectedVoice, playbackSpeed, segments, currentSegmentIndex, fileName, ttsModelStatus, autoAdvance, eagerProcessing, bookType, eagerProcessingChapters, volume, ttsEngine, browserVoiceURI } from '../lib/stores'
  import type { TimedSegment } from '../lib/stores'
  import { getCachedAudio, setCachedAudio, saveReadingState, refreshCachedChapters } from '../lib/storage'
  import { timeStretch } from '../lib/timeStretch'
  import { getTTSManagerInstance } from '../lib/tts'
  import type { TTSChunk } from '../lib/tts'
  import { onMount } from 'svelte'

  const KOKORO_VOICES = [
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

  // --- Browser TTS state ---
  let browserVoices: SpeechSynthesisVoice[] = []
  let browserSentences: string[] = []
  let browserSentenceIndex = 0
  let browserPlaying = false
  let browserPaused = false
  let browserKeepAliveTimer: ReturnType<typeof setInterval> | null = null

  function loadBrowserVoices() {
    const voices = speechSynthesis.getVoices()
    browserVoices = voices.filter(v => v.lang.startsWith('en'))
    if (browserVoices.length === 0) browserVoices = voices
    if (!$browserVoiceURI && browserVoices.length > 0) {
      // Prefer a default English voice
      const preferred = browserVoices.find(v => v.default) || browserVoices[0]
      $browserVoiceURI = preferred.voiceURI
    }
  }

  onMount(() => {
    loadBrowserVoices()
    speechSynthesis.addEventListener('voiceschanged', loadBrowserVoices)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadBrowserVoices)
      stopBrowserKeepAlive()
    }
  })

  function splitIntoSentences(text: string): string[] {
    const raw = text.match(/[^.!?…]+[.!?…]+[\s"]*/g)
    if (!raw) return text.trim() ? [text.trim()] : []
    return raw.map(s => s.trim()).filter(Boolean)
  }

  function startBrowserKeepAlive() {
    stopBrowserKeepAlive()
    // Chrome workaround: pause/resume every 10s to prevent silent cutoff
    browserKeepAliveTimer = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause()
        speechSynthesis.resume()
      }
    }, 10000)
  }

  function stopBrowserKeepAlive() {
    if (browserKeepAliveTimer !== null) {
      clearInterval(browserKeepAliveTimer)
      browserKeepAliveTimer = null
    }
  }

  function playBrowser() {
    if (!$fileName || $currentChapterIndex < 0) return

    speechSynthesis.cancel()
    stopBrowserKeepAlive()

    const sentences = splitIntoSentences($chapterText)
    if (sentences.length === 0) return

    browserSentences = sentences
    browserSentenceIndex = 0
    browserPlaying = true
    browserPaused = false
    $isPlaying = true

    // Set up segments for sentence highlighting
    $segments = sentences.map((text, i) => ({ text, start: i, end: i + 1 }))
    $currentSegmentIndex = 0

    startBrowserKeepAlive()
    speakNextSentence()
  }

  function speakNextSentence() {
    if (!browserPlaying || browserSentenceIndex >= browserSentences.length) {
      // Done with chapter
      browserPlaying = false
      $isPlaying = false
      $currentSegmentIndex = -1
      stopBrowserKeepAlive()
      if ($autoAdvance && $currentChapterIndex < $parsedChapters.length - 1) {
        advanceToNextChapter()
      }
      return
    }

    const utterance = new SpeechSynthesisUtterance(browserSentences[browserSentenceIndex])

    const voice = browserVoices.find(v => v.voiceURI === $browserVoiceURI)
    if (voice) utterance.voice = voice
    utterance.rate = $playbackSpeed
    utterance.volume = $volume

    utterance.onstart = () => {
      $currentSegmentIndex = browserSentenceIndex
    }

    utterance.onend = () => {
      browserSentenceIndex++
      if (browserPlaying) speakNextSentence()
    }

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return
      browserSentenceIndex++
      if (browserPlaying) speakNextSentence()
    }

    speechSynthesis.speak(utterance)
  }

  function stopBrowser() {
    speechSynthesis.cancel()
    stopBrowserKeepAlive()
    browserPlaying = false
    browserPaused = false
    browserSentences = []
    browserSentenceIndex = 0
    $isPlaying = false
    $currentSegmentIndex = -1
    $segments = []
  }

  function togglePlayPauseBrowser() {
    if (browserPlaying && !browserPaused) {
      speechSynthesis.pause()
      browserPaused = true
      $isPlaying = false
      stopBrowserKeepAlive()
    } else if (browserPaused) {
      speechSynthesis.resume()
      browserPaused = false
      $isPlaying = true
      startBrowserKeepAlive()
    } else {
      playBrowser()
    }
  }

  let loading = false
  let currentTime = 0
  let duration = 0

  // Web Audio API state
  let audioCtx: AudioContext | null = null
  let gainNode: GainNode | null = null
  let activeSourceNodes: AudioBufferSourceNode[] = []
  let decodedChunks: { buffer: AudioBuffer; startTime: number }[] = []
  let totalAudioDuration = 0
  let playbackStartCtxTime = 0
  let playbackStartOffset = 0
  let animFrameId: number | null = null
  let streamingDone = false
  let playGeneration = 0
  let lastSaveTime = 0
  let bufferUnderrunCtxTime: number | null = null

  // Client-side TTS
  let cachedAudioChunks: { audio: Float32Array; sampleRate: number }[] = []

  // Smart buffering
  type BufferState = 'idle' | 'buffering' | 'playing' | 'rebuffering'
  let bufferState: BufferState = 'idle'
  let bufferProgress = 0
  let currentTargetBuffer = 0
  let rebufferCount = 0

  const BUFFER_MIN = 0.8
  const BUFFER_MAX = 10.0
  const LOW_WATERMARK = 0.3
  const RESUME_BUFFER_BASE = 1.0
  const PAUSE_TOLERANCE = 1.5
  const EAGER_LOOKAHEAD = 3

  class BufferMonitor {
    private firstChunkTime = 0
    private totalRawAudio = 0
    private chunkCount = 0
    private recentRawDurations: number[] = []
    private recentTimestamps: number[] = []

    reset() {
      this.firstChunkTime = 0
      this.totalRawAudio = 0
      this.chunkCount = 0
      this.recentRawDurations = []
      this.recentTimestamps = []
    }

    recordChunk(rawDuration: number) {
      const now = performance.now()
      if (this.chunkCount === 0) this.firstChunkTime = now
      this.totalRawAudio += rawDuration
      this.chunkCount++
      this.recentRawDurations.push(rawDuration)
      this.recentTimestamps.push(now)
      if (this.recentRawDurations.length > 8) {
        this.recentRawDurations.shift()
        this.recentTimestamps.shift()
      }
    }

    getGenerationRate(): number | null {
      if (this.chunkCount < 2) return null
      const elapsed = (performance.now() - this.firstChunkTime) / 1000
      if (elapsed < 0.1) return null
      return this.totalRawAudio / elapsed
    }

    hasEnoughData(): boolean {
      return this.chunkCount >= 2
    }
  }

  const bufferMonitor = new BufferMonitor()

  function computeTargetBuffer(G: number, C: number): number {
    return Math.min(BUFFER_MAX, Math.max(BUFFER_MIN, PAUSE_TOLERANCE * C / Math.max(1, G)))
  }

  function ensureAudioCtx(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext()
      gainNode = audioCtx.createGain()
      gainNode.gain.value = $volume
      gainNode.connect(audioCtx.destination)
    }
    return audioCtx
  }

  // Sync volume store to gainNode
  $: if (gainNode) gainNode.gain.value = $volume

  function stopAllSources() {
    for (const s of activeSourceNodes) {
      try { s.onended = null; s.stop() } catch {}
    }
    activeSourceNodes = []
  }

  function stopTimeTracking() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  function persistPosition() {
    if ($fileName) {
      saveReadingState({
        fileName: $fileName,
        chapterIndex: $currentChapterIndex,
        currentTime,
        voice: $selectedVoice,
        speed: $playbackSpeed,
      })
    }
  }

  function startTimeTracking() {
    stopTimeTracking()
    function tick() {
      if (audioCtx && $isPlaying) {
        const elapsed = audioCtx.currentTime - playbackStartCtxTime
        currentTime = Math.min(playbackStartOffset + elapsed, totalAudioDuration)
        duration = totalAudioDuration

        if (bufferState === 'playing' && !streamingDone) {
          const bufferLead = totalAudioDuration - currentTime
          if (bufferLead < LOW_WATERMARK) {
            rebufferCount++
            bufferState = 'rebuffering'
            audioCtx.suspend()
            stopAllSources()
          }
        }

        if ($segments.length > 0) {
          let idx = $segments.findIndex(s => currentTime >= s.start && currentTime < s.end)
          if (idx === -1 && currentTime >= $segments[$segments.length - 1].start) {
            idx = $segments.length - 1
          }
          if (idx !== $currentSegmentIndex) {
            $currentSegmentIndex = idx
          }
        }

        const now = Date.now()
        if (now - lastSaveTime > 3000) {
          lastSaveTime = now
          persistPosition()
        }
      }
      animFrameId = requestAnimationFrame(tick)
    }
    animFrameId = requestAnimationFrame(tick)
  }

  function scheduleOneChunk(chunkIndex: number) {
    const ctx = audioCtx!
    const chunk = decodedChunks[chunkIndex]
    const curTime = (ctx.currentTime - playbackStartCtxTime) + playbackStartOffset
    const chunkEnd = chunk.startTime + chunk.buffer.duration
    if (chunkEnd <= curTime) return

    const offsetInChunk = Math.max(0, curTime - chunk.startTime)
    const source = ctx.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(gainNode!)

    const realTimeDelay = chunk.startTime + offsetInChunk - curTime
    source.start(ctx.currentTime + Math.max(0, realTimeDelay), offsetInChunk)

    source.onended = () => {
      const idx = activeSourceNodes.indexOf(source)
      if (idx >= 0) activeSourceNodes.splice(idx, 1)
      if (activeSourceNodes.length === 0 && $isPlaying) {
        if (streamingDone) {
          $isPlaying = false
          $currentSegmentIndex = -1
          stopTimeTracking()
          if ($autoAdvance && $currentChapterIndex < $parsedChapters.length - 1) {
            advanceToNextChapter()
          }
        } else {
          bufferUnderrunCtxTime = audioCtx!.currentTime
        }
      }
    }
    activeSourceNodes.push(source)
  }

  function rescheduleAllFrom(fromTime: number) {
    stopAllSources()
    bufferUnderrunCtxTime = null
    playbackStartOffset = Math.max(0, Math.min(fromTime, totalAudioDuration))
    playbackStartCtxTime = audioCtx!.currentTime
    currentTime = playbackStartOffset

    for (let i = 0; i < decodedChunks.length; i++) {
      const chunkEnd = decodedChunks[i].startTime + decodedChunks[i].buffer.duration
      if (chunkEnd <= playbackStartOffset) continue
      scheduleOneChunk(i)
    }
  }

  function float32ToAudioBuffer(ctx: AudioContext, samples: Float32Array, sampleRate: number, speed: number): AudioBuffer {
    const stretched = timeStretch(samples, speed, sampleRate)
    const audioBuffer = ctx.createBuffer(1, stretched.length, sampleRate)
    audioBuffer.getChannelData(0).set(stretched)
    return audioBuffer
  }

  function playFromCache(cached: { audioChunks: { audio: Float32Array; sampleRate: number }[]; segments: TimedSegment[] }) {
    loading = true
    const gen = ++playGeneration

    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()

    decodedChunks = []
    totalAudioDuration = 0
    $segments = cached.segments
    $currentSegmentIndex = -1
    currentTime = 0
    duration = 0
    cachedAudioChunks = []

    for (const chunk of cached.audioChunks) {
      if (gen !== playGeneration) return
      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate, $playbackSpeed)
      const chunkStart = totalAudioDuration
      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration
    }

    duration = totalAudioDuration
    streamingDone = true
    loading = false
    bufferState = 'playing'

    playbackStartCtxTime = ctx.currentTime
    playbackStartOffset = 0
    $isPlaying = true

    for (let i = 0; i < decodedChunks.length; i++) {
      scheduleOneChunk(i)
    }
    startTimeTracking()

    // Kick off eager generation for upcoming chapters
    if ($eagerProcessing && $autoAdvance) {
      startEagerQueue($currentChapterIndex + 1)
    }
  }

  function play() {
    if (!$fileName || $currentChapterIndex < 0 || loading) return

    const cached = getCachedAudio($fileName, $currentChapterIndex, $selectedVoice, $playbackSpeed)
    if (cached) {
      playFromCache(cached)
      return
    }

    const manager = getTTSManagerInstance()
    if (manager.getStatus() !== 'ready') return

    // If eager gen is in-flight for this exact chapter/voice/speed, take it over
    if (eagerChapterIndex === $currentChapterIndex &&
        eagerVoice === $selectedVoice &&
        eagerSpeed === $playbackSpeed &&
        eagerChunks.length > 0) {
      playFromEager()
      return
    }

    // Cancel any eager background generation — worker can only do one thing
    cancelEagerGen()

    // Re-populate the eager queue for sidebar display (won't process until onDone)
    if ($eagerProcessing && $autoAdvance && $fileName) {
      const queue: number[] = []
      for (let i = $currentChapterIndex + 1; i < $parsedChapters.length && queue.length < EAGER_LOOKAHEAD; i++) {
        if (!getCachedAudio($fileName, i, $selectedVoice, $playbackSpeed)) {
          queue.push(i)
        }
      }
      if (queue.length > 0) {
        eagerQueue = queue
        updateEagerStore()
      }
    }

    loading = true
    streamingDone = false
    bufferState = 'buffering'
    bufferProgress = 0
    currentTargetBuffer = BUFFER_MIN
    bufferMonitor.reset()
    const gen = ++playGeneration

    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()

    decodedChunks = []
    totalAudioDuration = 0
    $segments = []
    $currentSegmentIndex = -1
    currentTime = 0
    duration = 0
    cachedAudioChunks = []

    const allSegments: TimedSegment[] = []

    function startPlayback() {
      bufferState = 'playing'
      loading = false
      bufferProgress = 100

      if (ctx.state === 'suspended') ctx.resume()
      playbackStartCtxTime = ctx.currentTime
      playbackStartOffset = currentTime
      $isPlaying = true

      for (let i = 0; i < decodedChunks.length; i++) {
        const chunkEnd = decodedChunks[i].startTime + decodedChunks[i].buffer.duration
        if (chunkEnd <= currentTime) continue
        scheduleOneChunk(i)
      }
      startTimeTracking()
    }

    manager.setOnChunk((chunk: TTSChunk) => {
      if (gen !== playGeneration) return

      const rawDuration = chunk.audio.length / chunk.sampleRate
      bufferMonitor.recordChunk(rawDuration)

      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate, $playbackSpeed)
      const chunkStart = totalAudioDuration

      const segment: TimedSegment = {
        text: chunk.text,
        start: chunkStart,
        end: chunkStart + audioBuffer.duration,
      }
      allSegments.push(segment)
      $segments = [...allSegments]

      cachedAudioChunks.push({ audio: chunk.audio, sampleRate: chunk.sampleRate })

      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration
      duration = totalAudioDuration

      if (bufferMonitor.hasEnoughData()) {
        const G = bufferMonitor.getGenerationRate()!
        currentTargetBuffer = computeTargetBuffer(G, $playbackSpeed)
      }

      if (bufferState === 'buffering') {
        bufferProgress = currentTargetBuffer > 0
          ? Math.min(99, (totalAudioDuration / currentTargetBuffer) * 100)
          : 0

        if (totalAudioDuration >= currentTargetBuffer) {
          startPlayback()
        }
      } else if (bufferState === 'rebuffering') {
        const resumeTarget = Math.min(BUFFER_MAX, RESUME_BUFFER_BASE * Math.pow(2, rebufferCount - 1))
        const bufferLead = totalAudioDuration - currentTime
        bufferProgress = Math.min(99, (bufferLead / resumeTarget) * 100)

        if (bufferLead >= resumeTarget) {
          startPlayback()
        }
      } else if (bufferState === 'playing' && $isPlaying) {
        if (bufferUnderrunCtxTime !== null) {
          playbackStartCtxTime += (ctx.currentTime - bufferUnderrunCtxTime)
          bufferUnderrunCtxTime = null
        }
        scheduleOneChunk(decodedChunks.length - 1)
      }
    })

    manager.setOnDone(() => {
      if (gen !== playGeneration) return
      streamingDone = true

      if (bufferState === 'buffering' || bufferState === 'rebuffering') {
        if (decodedChunks.length > 0) {
          startPlayback()
        } else {
          loading = false
          bufferState = 'idle'
        }
      }

      if ($fileName && cachedAudioChunks.length > 0) {
        setCachedAudio($fileName, $currentChapterIndex, $selectedVoice, $playbackSpeed, {
          audioChunks: cachedAudioChunks,
          segments: [...allSegments],
        })
      }

      // Race fix: if all audio was consumed before streamingDone became true,
      // the last source.onended went to the buffer-underrun path instead of advancing.
      if (bufferState === 'playing' && activeSourceNodes.length === 0 && $isPlaying) {
        $isPlaying = false
        $currentSegmentIndex = -1
        stopTimeTracking()
        if ($autoAdvance && $currentChapterIndex < $parsedChapters.length - 1) {
          advanceToNextChapter()
        }
        return
      }

      // Eager processing: start generating next chapters in background
      if ($eagerProcessing && $autoAdvance) {
        startEagerQueue($currentChapterIndex + 1)
      }
    })

    manager.setOnError((error: string) => {
      if (gen !== playGeneration) return
      console.error('TTS generation failed:', error)
      loading = false
      streamingDone = true
      bufferState = 'idle'
    })

    manager.generate($chapterText, $selectedVoice)
  }

  function stop() {
    persistPosition()
    getTTSManagerInstance().cancel()
    stopAllSources()
    stopTimeTracking()
    $isPlaying = false
    $currentSegmentIndex = -1
    $segments = []
    currentTime = 0
    duration = 0
    decodedChunks = []
    totalAudioDuration = 0
    streamingDone = false
    bufferUnderrunCtxTime = null
    cachedAudioChunks = []
    bufferState = 'idle'
    bufferProgress = 0
    currentTargetBuffer = 0
    rebufferCount = 0
    bufferMonitor.reset()
  }

  function togglePlayPause() {
    if ($ttsEngine === 'browser') {
      togglePlayPauseBrowser()
      return
    }
    if (bufferState === 'buffering' || bufferState === 'rebuffering') {
      stop()
    } else if (!$isPlaying && decodedChunks.length === 0) {
      play()
    } else if ($isPlaying && audioCtx) {
      audioCtx.suspend()
      $isPlaying = false
      stopTimeTracking()
      persistPosition()
    } else if (!$isPlaying && audioCtx && decodedChunks.length > 0) {
      audioCtx.resume()
      rescheduleAllFrom(currentTime)
      $isPlaying = true
      startTimeTracking()
    }
  }

  function skip(seconds: number) {
    if (decodedChunks.length === 0) return
    rescheduleAllFrom(currentTime + seconds)
  }

  function handleSeek(e: Event) {
    const input = e.target as HTMLInputElement
    rescheduleAllFrom(parseFloat(input.value))
  }

  function rebuildAtSpeed(newSpeed: number) {
    if (cachedAudioChunks.length === 0) return

    const ctx = ensureAudioCtx()
    const progressRatio = duration > 0 ? currentTime / duration : 0

    stopAllSources()
    stopTimeTracking()

    decodedChunks = []
    totalAudioDuration = 0
    const newSegments: TimedSegment[] = []

    for (let i = 0; i < cachedAudioChunks.length; i++) {
      const chunk = cachedAudioChunks[i]
      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate, newSpeed)
      const chunkStart = totalAudioDuration
      decodedChunks.push({ buffer: audioBuffer, startTime: chunkStart })
      if ($segments.length > i) {
        newSegments.push({ text: $segments[i].text, start: chunkStart, end: chunkStart + audioBuffer.duration })
      }
      totalAudioDuration += audioBuffer.duration
    }

    duration = totalAudioDuration
    $segments = newSegments
    const newTime = progressRatio * duration
    rescheduleAllFrom(newTime)
    startTimeTracking()
  }

  function cycleSpeed() {
    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    const current = speeds.findIndex(s => Math.abs(s - $playbackSpeed) < 0.05)
    $playbackSpeed = speeds[(current + 1) % speeds.length]
    if (bufferMonitor.hasEnoughData()) {
      const G = bufferMonitor.getGenerationRate()!
      currentTargetBuffer = computeTargetBuffer(G, $playbackSpeed)
    }
    if (cachedAudioChunks.length > 0) {
      rebuildAtSpeed($playbackSpeed)
    }
  }

  function changeChapter(delta: number) {
    if (!$fileName) return
    const newIndex = $currentChapterIndex + delta
    if (newIndex < 0 || newIndex >= $parsedChapters.length) return

    const wasPlaying = $isPlaying || browserPlaying
    if ($ttsEngine === 'browser') {
      stopBrowser()
    } else {
      cancelEagerGen()
      stop()
    }

    prevChapterIndex = newIndex
    $currentChapterIndex = newIndex
    $chapterText = $parsedChapters[newIndex].text

    if (wasPlaying) {
      if ($ttsEngine === 'browser') playBrowser()
      else play()
    }
  }

  function advanceToNextChapter() {
    const newIndex = $currentChapterIndex + 1
    if (newIndex >= $parsedChapters.length) return

    if ($ttsEngine === 'browser') {
      stopBrowser()
    } else {
      cancelEagerGen()
      stop()
    }

    prevChapterIndex = newIndex
    $currentChapterIndex = newIndex
    $chapterText = $parsedChapters[newIndex].text

    if ($ttsEngine === 'browser') playBrowser()
    else play()
  }

  // --- Eager processing: background TTS generation with queue ---
  let eagerGenerationId = 0
  let eagerChapterIndex = -1
  let eagerChunks: { audio: Float32Array; sampleRate: number }[] = []
  let eagerSegmentTexts: string[] = []
  let eagerVoice = ''
  let eagerSpeed = 0
  let eagerQueue: number[] = []  // chapters waiting to be eagerly generated

  function updateEagerStore() {
    const s = new Set<number>(eagerQueue)
    if (eagerChapterIndex >= 0) s.add(eagerChapterIndex)
    $eagerProcessingChapters = s
  }

  /** Queue the next N uncached chapters starting from startIdx */
  function startEagerQueue(startIdx: number) {
    if (!$fileName) return
    const queue: number[] = []
    for (let i = startIdx; i < $parsedChapters.length && queue.length < EAGER_LOOKAHEAD; i++) {
      if (!getCachedAudio($fileName, i, $selectedVoice, $playbackSpeed)) {
        queue.push(i)
      }
    }
    if (queue.length === 0) return
    eagerQueue = queue
    updateEagerStore()
    processNextEagerItem()
  }

  /** Process the next item from the eager queue */
  function processNextEagerItem() {
    if (eagerQueue.length === 0) {
      eagerChapterIndex = -1
      updateEagerStore()
      return
    }

    const chapterIndex = eagerQueue[0]
    const manager = getTTSManagerInstance()
    if (manager.getStatus() !== 'ready') return
    if (!$fileName || chapterIndex < 0 || chapterIndex >= $parsedChapters.length) return

    // Already cached? (might have been cached while queued)
    if (getCachedAudio($fileName, chapterIndex, $selectedVoice, $playbackSpeed)) {
      eagerQueue = eagerQueue.slice(1)
      updateEagerStore()
      processNextEagerItem()
      return
    }

    // Don't start eager gen if playback generation is active
    if (bufferState === 'buffering' || bufferState === 'rebuffering' ||
        (bufferState === 'playing' && !streamingDone)) return

    const genId = ++eagerGenerationId
    eagerChapterIndex = chapterIndex
    eagerChunks = []
    eagerSegmentTexts = []
    eagerVoice = $selectedVoice
    eagerSpeed = $playbackSpeed
    updateEagerStore()

    const text = $parsedChapters[chapterIndex].text
    const voice = $selectedVoice
    const speed = $playbackSpeed
    const fn = $fileName

    manager.setOnChunk((chunk: TTSChunk) => {
      if (genId !== eagerGenerationId) return
      eagerChunks.push({ audio: chunk.audio, sampleRate: chunk.sampleRate })
      eagerSegmentTexts.push(chunk.text)
    })

    manager.setOnDone(() => {
      if (genId !== eagerGenerationId) return

      if (fn && eagerChunks.length > 0) {
        const ctx = ensureAudioCtx()
        let t = 0
        const timedSegments: TimedSegment[] = []
        for (let i = 0; i < eagerChunks.length; i++) {
          const audioBuffer = float32ToAudioBuffer(ctx, eagerChunks[i].audio, eagerChunks[i].sampleRate, speed)
          timedSegments.push({ text: eagerSegmentTexts[i], start: t, end: t + audioBuffer.duration })
          t += audioBuffer.duration
        }
        setCachedAudio(fn, chapterIndex, voice, speed, {
          audioChunks: eagerChunks,
          segments: timedSegments,
        })
      }

      eagerChapterIndex = -1
      eagerChunks = []
      eagerSegmentTexts = []

      // Move to next item in queue
      eagerQueue = eagerQueue.filter(i => i !== chapterIndex)
      updateEagerStore()
      processNextEagerItem()
    })

    manager.setOnError(() => {
      if (genId !== eagerGenerationId) return
      eagerChapterIndex = -1
      eagerChunks = []
      eagerSegmentTexts = []
      // Skip failed chapter, try next
      eagerQueue = eagerQueue.filter(i => i !== chapterIndex)
      updateEagerStore()
      processNextEagerItem()
    })

    manager.generate(text, voice)
  }

  function eagerGenerate(chapterIndex: number) {
    startEagerQueue(chapterIndex)
  }

  /** Take over an in-flight eager generation for playback instead of restarting */
  function playFromEager() {
    const manager = getTTSManagerInstance()

    loading = true
    streamingDone = false
    bufferState = 'buffering'
    bufferProgress = 0
    currentTargetBuffer = BUFFER_MIN
    bufferMonitor.reset()
    const gen = ++playGeneration

    // Stop eager gen's ownership — playback now owns the worker callbacks
    eagerChapterIndex = -1

    // Keep queue populated for sidebar display — remaining items process after onDone
    eagerQueue = eagerQueue.filter(i => i !== $currentChapterIndex)
    updateEagerStore()

    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()

    decodedChunks = []
    totalAudioDuration = 0
    $segments = []
    $currentSegmentIndex = -1
    currentTime = 0
    duration = 0
    cachedAudioChunks = []

    const allSegments: TimedSegment[] = []

    function startPlayback() {
      bufferState = 'playing'
      loading = false
      bufferProgress = 100

      if (ctx.state === 'suspended') ctx.resume()
      playbackStartCtxTime = ctx.currentTime
      playbackStartOffset = currentTime
      $isPlaying = true

      for (let i = 0; i < decodedChunks.length; i++) {
        const chunkEnd = decodedChunks[i].startTime + decodedChunks[i].buffer.duration
        if (chunkEnd <= currentTime) continue
        scheduleOneChunk(i)
      }
      startTimeTracking()
    }

    // Seed playback state with chunks already accumulated by eager gen
    for (const chunk of eagerChunks) {
      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate, $playbackSpeed)
      const chunkStart = totalAudioDuration
      const segIdx = cachedAudioChunks.length
      const segText = eagerSegmentTexts[segIdx] ?? ''

      const segment: TimedSegment = { text: segText, start: chunkStart, end: chunkStart + audioBuffer.duration }
      allSegments.push(segment)

      cachedAudioChunks.push({ audio: chunk.audio, sampleRate: chunk.sampleRate })
      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration

      bufferMonitor.recordChunk(chunk.audio.length / chunk.sampleRate)
    }
    $segments = [...allSegments]
    duration = totalAudioDuration

    if (bufferMonitor.hasEnoughData()) {
      const G = bufferMonitor.getGenerationRate()!
      currentTargetBuffer = computeTargetBuffer(G, $playbackSpeed)
    }

    if (totalAudioDuration >= currentTargetBuffer && decodedChunks.length > 0) {
      startPlayback()
    }

    manager.setOnChunk((chunk: TTSChunk) => {
      if (gen !== playGeneration) return

      const rawDuration = chunk.audio.length / chunk.sampleRate
      bufferMonitor.recordChunk(rawDuration)

      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate, $playbackSpeed)
      const chunkStart = totalAudioDuration

      const segment: TimedSegment = { text: chunk.text, start: chunkStart, end: chunkStart + audioBuffer.duration }
      allSegments.push(segment)
      $segments = [...allSegments]

      cachedAudioChunks.push({ audio: chunk.audio, sampleRate: chunk.sampleRate })
      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration
      duration = totalAudioDuration

      if (bufferMonitor.hasEnoughData()) {
        const G = bufferMonitor.getGenerationRate()!
        currentTargetBuffer = computeTargetBuffer(G, $playbackSpeed)
      }

      if (bufferState === 'buffering') {
        bufferProgress = currentTargetBuffer > 0
          ? Math.min(99, (totalAudioDuration / currentTargetBuffer) * 100)
          : 0
        if (totalAudioDuration >= currentTargetBuffer) {
          startPlayback()
        }
      } else if (bufferState === 'rebuffering') {
        const resumeTarget = Math.min(BUFFER_MAX, RESUME_BUFFER_BASE * Math.pow(2, rebufferCount - 1))
        const bufferLead = totalAudioDuration - currentTime
        bufferProgress = Math.min(99, (bufferLead / resumeTarget) * 100)
        if (bufferLead >= resumeTarget) {
          startPlayback()
        }
      } else if (bufferState === 'playing' && $isPlaying) {
        if (bufferUnderrunCtxTime !== null) {
          playbackStartCtxTime += (ctx.currentTime - bufferUnderrunCtxTime)
          bufferUnderrunCtxTime = null
        }
        scheduleOneChunk(decodedChunks.length - 1)
      }
    })

    manager.setOnDone(() => {
      if (gen !== playGeneration) return
      streamingDone = true

      if (bufferState === 'buffering' || bufferState === 'rebuffering') {
        if (decodedChunks.length > 0) {
          startPlayback()
        } else {
          loading = false
          bufferState = 'idle'
        }
      }

      if ($fileName && cachedAudioChunks.length > 0) {
        setCachedAudio($fileName, $currentChapterIndex, $selectedVoice, $playbackSpeed, {
          audioChunks: cachedAudioChunks,
          segments: [...allSegments],
        })
      }

      // Race fix: if all audio was consumed before streamingDone became true
      if (bufferState === 'playing' && activeSourceNodes.length === 0 && $isPlaying) {
        $isPlaying = false
        $currentSegmentIndex = -1
        stopTimeTracking()
        if ($autoAdvance && $currentChapterIndex < $parsedChapters.length - 1) {
          advanceToNextChapter()
        }
        return
      }

      if ($eagerProcessing && $autoAdvance) {
        startEagerQueue($currentChapterIndex + 1)
      }
    })

    manager.setOnError((error: string) => {
      if (gen !== playGeneration) return
      console.error('TTS generation failed:', error)
      loading = false
      streamingDone = true
      bufferState = 'idle'
    })

    // Clear eager state — playback now owns these chunks
    eagerChunks = []
    eagerSegmentTexts = []
  }

  function cancelEagerGen() {
    if (eagerChapterIndex >= 0 || eagerQueue.length > 0) {
      eagerGenerationId++
      getTTSManagerInstance().cancel()
      eagerChapterIndex = -1
      eagerChunks = []
      eagerSegmentTexts = []
      eagerQueue = []
      updateEagerStore()
    }
  }

  // Reset audio state when chapter changes externally (e.g. Sidebar clicks)
  let prevChapterIndex = $currentChapterIndex
  $: if ($currentChapterIndex !== prevChapterIndex) {
    prevChapterIndex = $currentChapterIndex
    if ($ttsEngine === 'browser') {
      stopBrowser()
    } else {
      cancelEagerGen()
      stop()
    }
  }

  // Stop playback when engine changes
  let prevEngine = $ttsEngine
  $: if ($ttsEngine !== prevEngine) {
    if (prevEngine === 'browser') stopBrowser()
    else { cancelEagerGen(); stop() }
    prevEngine = $ttsEngine
  }

  // Cancel eager generation when toggle is turned off
  $: if (!$eagerProcessing) {
    cancelEagerGen()
  }

  // Trigger eager generation when chapter changes and nothing is playing (Kokoro only)
  $: if ($ttsEngine === 'kokoro' && $eagerProcessing && $ttsModelStatus === 'ready' && $fileName &&
         $currentChapterIndex >= 0 && !$isPlaying && bufferState === 'idle' &&
         !getCachedAudio($fileName, $currentChapterIndex, $selectedVoice, $playbackSpeed)) {
    eagerGenerate($currentChapterIndex)
  }

  function formatTime(s: number): string {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Refresh cached chapters indicator when context changes
  $: if ($fileName) refreshCachedChapters($fileName, $selectedVoice, $playbackSpeed)

  $: isBrowser = $ttsEngine === 'browser'
  $: canPlay = $fileName && $currentChapterIndex >= 0 && !loading && (isBrowser || $ttsModelStatus === 'ready')
  $: hasPrev = $currentChapterIndex > 0
  $: hasNext = $currentChapterIndex < $parsedChapters.length - 1
  $: hasAudio = isBrowser ? browserPlaying || browserPaused : decodedChunks.length > 0
  $: progress = isBrowser
    ? (browserSentences.length > 0 ? (browserSentenceIndex / browserSentences.length) * 100 : 0)
    : (duration > 0 ? (currentTime / duration) * 100 : 0)
  $: isBuffering = bufferState === 'buffering' || bufferState === 'rebuffering'
  $: volumePercent = Math.round($volume * 100)
  $: volumeIcon = $volume === 0 ? 'muted' : $volume < 0.5 ? 'low' : 'high'
</script>

<footer class="relative border-t border-spine-900/[0.06] bg-parchment-50 shadow-[0_-1px_12px_rgba(0,0,0,0.03)]">
  <!-- Subtle top accent line -->
  <div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-accent/20 to-transparent"></div>

  <!-- Progress bar -->
  {#if hasAudio}
    <div class="relative h-1 w-full bg-spine-900/[0.04] {isBrowser ? '' : 'cursor-pointer'} group">
      <div
        class="absolute left-0 top-0 h-full bg-gradient-to-r from-amber-accent to-amber-glow transition-all duration-100"
        style="width: {progress}%"
      ></div>
      {#if !isBrowser}
        <input
          type="range"
          min="0"
          max={duration}
          step="0.1"
          value={currentTime}
          oninput={handleSeek}
          class="progress-seek absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      {/if}
    </div>
  {/if}

  {#if !isBrowser && isBuffering}
    <div class="relative h-0.5 w-full bg-spine-900/[0.04]">
      <div
        class="absolute left-0 top-0 h-full bg-amber-accent/60 transition-all duration-300"
        style="width: {bufferProgress}%"
      ></div>
    </div>
    <div class="text-xs text-amber-accent/70 text-center py-1">
      {bufferState === 'rebuffering' ? 'Rebuffering' : 'Buffering'}... {Math.round(bufferProgress)}%
    </div>
  {:else if !isBrowser && $ttsModelStatus === 'loading'}
    <div class="text-xs text-amber-accent/70 text-center py-1">Loading TTS model...</div>
  {:else if !isBrowser && $ttsModelStatus === 'error'}
    <div class="text-xs text-red-400/70 text-center py-1">TTS model failed to load</div>
  {:else if !isBrowser && $ttsModelStatus === 'idle'}
    <div class="text-xs text-parchment-400/40 text-center py-1">TTS model not loaded</div>
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

      <!-- Rewind 10s (Kokoro only) -->
      {#if !isBrowser}
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
      {/if}

      <!-- Play/Pause -->
      <button
        class="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300 {canPlay || isBuffering ? 'bg-amber-accent hover:bg-amber-glow shadow-[0_2px_12px_rgba(196,132,29,0.3)] hover:shadow-[0_4px_20px_rgba(196,132,29,0.4)]' : 'bg-spine-900/10'}"
        disabled={!canPlay && !isBuffering}
        onclick={togglePlayPause}
      >
        {#if loading || isBuffering}
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

      <!-- Forward 30s (Kokoro only) -->
      {#if !isBrowser}
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
      {/if}

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
        {#if isBrowser}
          {browserSentenceIndex + 1} / {browserSentences.length}
        {:else}
          {formatTime(currentTime)} / {formatTime(duration)}
        {/if}
      </span>
    {/if}

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Volume control -->
    <div class="flex items-center gap-1.5 group/vol">
      <button
        class="flex h-7 w-7 items-center justify-center rounded-md text-spine-800/40 transition-colors hover:text-spine-800/70"
        onclick={() => $volume = $volume > 0 ? 0 : 1}
        title="{volumePercent}% volume"
      >
        {#if volumeIcon === 'muted'}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V18.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.395C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        {:else if volumeIcon === 'low'}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.463 8.288a5.25 5.25 0 010 7.424" />
          </svg>
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        {/if}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={$volume}
        class="vol-slider h-1 w-16 cursor-pointer appearance-none rounded-full bg-spine-900/[0.08] accent-amber-accent transition-all [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-accent"
        title="{volumePercent}%"
      />
    </div>

    <!-- Voice selector -->
    <div class="flex items-center gap-1.5">
      <select
        value={isBrowser ? $browserVoiceURI : $selectedVoice}
        onchange={(e) => {
          const val = (e.target as HTMLSelectElement).value
          if (isBrowser) $browserVoiceURI = val
          else $selectedVoice = val
        }}
        class="max-w-[120px] rounded-lg border border-spine-900/[0.08] bg-parchment-100/80 px-2 py-1 font-sans text-xs text-spine-800 transition-colors hover:border-amber-accent/30 focus:border-amber-accent/50 focus:outline-none focus:ring-1 focus:ring-amber-accent/20"
      >
        {#if isBrowser}
          {#each browserVoices as v}
            <option value={v.voiceURI}>{v.name.replace(/^(Microsoft |Google |Apple )/, '')}</option>
          {/each}
        {:else}
          {#each KOKORO_VOICES as v}
            <option value={v.id}>{v.label}</option>
          {/each}
        {/if}
      </select>
    </div>

    <!-- Speed button -->
    <button
      class="rounded-lg border border-spine-900/[0.08] bg-parchment-100/80 px-2.5 py-1 font-serif text-sm font-semibold tabular-nums text-spine-800 transition-colors hover:border-amber-accent/30 hover:text-amber-accent"
      onclick={cycleSpeed}
      title="Click to cycle speed"
    >
      {$playbackSpeed.toFixed(2)}x
    </button>

    <!-- Playback option toggles -->
    <div class="flex items-center gap-3">
      <label class="flex items-center gap-1.5 cursor-pointer select-none" title="Auto-advance to next chapter">
        <input
          type="checkbox"
          bind:checked={$autoAdvance}
          class="h-3.5 w-3.5 rounded border-spine-900/20 text-amber-accent accent-amber-accent cursor-pointer"
        />
        <span class="text-xs text-spine-800/40">Autoplay</span>
      </label>
      {#if !isBrowser}
        <button
          class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-300 select-none
            {$eagerProcessing
              ? $eagerProcessingChapters.size > 0
                ? 'border-amber-accent/40 bg-amber-accent/10 text-amber-accent'
                : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400/80'
              : 'border-spine-900/[0.08] bg-parchment-100/80 text-spine-800/40 hover:border-amber-accent/30 hover:text-spine-800/60'
            }"
          onclick={() => $eagerProcessing = !$eagerProcessing}
          title={$eagerProcessing ? 'Disable background audio generation' : 'Pre-generate audio for upcoming chapters'}
        >
          {#if $eagerProcessing && $eagerProcessingChapters.size > 0}
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-accent animate-pulse"></span>
          {:else if $eagerProcessing}
            <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          {/if}
          <span>Eager</span>
        </button>
      {/if}
    </div>

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
</footer>
