/**
 * WSOLA (Waveform Similarity Overlap-Add) time-stretching.
 * Changes playback speed without altering pitch.
 */
export function timeStretch(input: Float32Array, speed: number, sampleRate: number): Float32Array {
  if (Math.abs(speed - 1.0) < 0.01) return input

  const N = input.length
  if (N === 0) return input

  const winLen = Math.round(sampleRate * 0.025) // 25ms analysis window
  const hopOut = Math.round(winLen / 2)          // 50% overlap → Hann sums to 1
  const hopIn = Math.round(hopOut * speed)       // input advance per step
  const searchRange = Math.round(winLen / 4)     // ± search for best overlap

  const outLen = Math.round(N / speed) + winLen
  const output = new Float32Array(outLen)

  // Pre-compute Hann window
  const win = new Float32Array(winLen)
  for (let i = 0; i < winLen; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winLen - 1)))
  }

  let inPos = 0
  let outPos = 0

  while (outPos + winLen < outLen) {
    let readPos = inPos

    // WSOLA: search for the best-correlated overlap position
    if (outPos > 0) {
      const lo = Math.max(0, inPos - searchRange)
      const hi = Math.min(N - winLen, inPos + searchRange)
      if (hi > lo) {
        let bestCorr = -Infinity
        // Subsample correlation for speed (every 4th sample)
        for (let candidate = lo; candidate <= hi; candidate++) {
          let corr = 0
          for (let i = 0; i < winLen; i += 4) {
            corr += output[outPos + i] * input[candidate + i]
          }
          if (corr > bestCorr) {
            bestCorr = corr
            readPos = candidate
          }
        }
      }
    }

    if (readPos + winLen > N) break

    // Overlap-add with Hann window
    for (let i = 0; i < winLen; i++) {
      output[outPos + i] += input[readPos + i] * win[i]
    }

    inPos += hopIn
    outPos += hopOut
  }

  const finalLen = Math.min(outPos, Math.round(N / speed))
  return output.subarray(0, finalLen)
}
