let context: AudioContext | null = null

// Tiếng bíp lúc hiện BẤM! khi đo độ trễ. Trình duyệt không có WebAudio thì bỏ qua.
export function beep(frequency = 880, durationMs = 200): void {
  if (typeof AudioContext === 'undefined') return
  context ??= new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = frequency
  gain.gain.value = 0.3
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + durationMs / 1000)
}
