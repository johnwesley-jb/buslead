import { cn } from '@/lib/format'

function hash(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function bars(seed: string, count: number) {
  let a = hash(seed)
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: count }, (_, i) => {
    const envelope = 0.45 + 0.55 * Math.abs(Math.sin((i / count) * Math.PI * (2 + (hash(seed) % 3))))
    return Math.max(0.12, Math.min(1, envelope * (0.35 + rnd() * 0.65)))
  })
}

/**
 * A call's voice "signature": deterministic from the call id, so every call is visually
 * recognizable in lists and in the player. Decorative only; the player has its own slider.
 */
export function Waveform({ seed, count = 56, progress = 0, className, barClass }: { seed: string; count?: number; progress?: number; className?: string; barClass?: string }) {
  const heights = bars(seed, count)
  const played = Math.round(progress * count)
  return (
    <div aria-hidden className={cn('flex items-center gap-[2px]', className)}>
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn('wave-bar block w-full min-w-[2px] flex-1 rounded-full transition-colors', i < played ? 'bg-teal' : barClass ?? 'bg-line', )}
          style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${Math.min(i * 6, 300)}ms` }}
        />
      ))}
    </div>
  )
}
