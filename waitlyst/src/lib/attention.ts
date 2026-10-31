/**
 * Getting a waiting guest's attention when they're called, without email or
 * push: a vibration and a short chime from the open page.
 */

let audio: AudioContext | null = null

/**
 * Browsers only let a page play sound after the person has tapped it, so
 * this runs on their first tap and the chime is ready when they're called.
 */
export function primeChime() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return
  audio ??= new AudioContext()
  if (audio.state === "suspended") audio.resume().catch(() => {})
}

export function alertTurn() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([300, 150, 300])
  if (!audio || audio.state !== "running") return
  const start = audio.currentTime
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = freq
    const t = start + i * 0.25
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  }
}
