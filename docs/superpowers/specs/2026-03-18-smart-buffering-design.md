# Smart TTS Buffering System

## Problem

The AudioPlayer starts playback on the very first TTS chunk. When generation is slower than consumption (especially at higher playback speeds), buffer underruns cause audible gaps. The existing `bufferUnderrunCtxTime` clock-shift mechanism papers over gaps but doesn't prevent them.

## Design

### Core Concepts

- **Generation rate (G)**: seconds of raw audio produced per wall-clock second, measured empirically from chunk arrival timing
- **Consumption rate (C)**: equals the playback speed (1x = 1 second consumed per real second)
- **Buffer lead**: `totalAudioDuration - currentTime` — how far ahead generated audio extends beyond playback cursor
- **Target buffer**: minimum buffer lead needed before starting playback, computed from G and C

### Target Buffer Formula

```typescript
function computeTargetBuffer(G: number, C: number, avgChunkDuration: number): number {
  const MIN = 1.5, MAX = 8.0, SAFETY = 2.5
  if (G >= 3 * C) return MIN
  const avgChunkRealTime = avgChunkDuration / G
  const worstCasePause = avgChunkRealTime * SAFETY
  const drainDuringPause = worstCasePause * C
  return Math.min(MAX, Math.max(MIN, drainDuringPause))
}
```

### State Machine

```
BUFFERING ──(target met)──► PLAYING ──(lead < LOW_WATERMARK)──► REBUFFERING
                               ▲                                     │
                               └──(lead > resumeThreshold)───────────┘
```

- **BUFFERING**: accumulating initial audio, showing progress, not scheduling Web Audio sources
- **PLAYING**: audio is scheduled, monitoring buffer lead each animation frame
- **REBUFFERING**: buffer lead dropped below LOW_WATERMARK (0.8s), AudioContext suspended, waiting for buffer to rebuild to 60% of target

### Thresholds

| Constant | Value | Purpose |
|----------|-------|---------|
| MIN_BUFFER | 1.5s | Absolute floor — never start with less |
| MAX_BUFFER | 8.0s | Cap — don't make user wait forever |
| LOW_WATERMARK | 0.8s | Trigger rebuffering when lead drops below |
| RESUME_RATIO | 0.6 | Resume at 60% of target (hysteresis) |
| SAFETY_MULTIPLIER | 2.5 | Covers worst-case chunk generation variance |

### BufferMonitor

Tracks chunk arrival times and computes generation rate:
- Records `(timestamp, rawDuration, stretchedDuration)` per chunk
- `getGenerationRate()`: overall average G from all chunks
- `getRecentRate()`: rolling window of last 5 chunks for responsiveness

### Changes

All changes are in `AudioPlayer.svelte`. No other files are modified.

1. Add `BufferMonitor` class to track generation timing
2. Add `bufferState` variable: `'buffering' | 'playing' | 'rebuffering'`
3. Modify `onChunk` handler: accumulate in BUFFERING state, check target, transition to PLAYING
4. Modify `tick()`: check buffer lead, transition to REBUFFERING if low
5. Add buffering UI indicator with progress percentage
6. On speed change: recalculate target buffer from current G
7. Existing `bufferUnderrunCtxTime` mechanism kept as edge-case fallback

### UI

- During BUFFERING/REBUFFERING: show "Buffering... N%" text indicator
- Loading spinner remains for initial TTS model loading (separate concern)
- Buffer progress = `min(100, (totalAudioDuration / targetBuffer) * 100)`
