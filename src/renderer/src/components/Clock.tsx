import { useEffect, useState, type JSX } from 'react'
import { useStore } from '../store'

/**
 * The desktop clock: reads the HOST computer's time/date (plain `new Date()` in the renderer),
 * ticking live. Its config lives in the store (mirrored to settings.json) so the crazy 助手 can
 * reconfigure it — 12/24h, show/hide date & seconds, a custom label, or hide it entirely.
 */
export function Clock(): JSX.Element | null {
  const clock = useStore((s) => s.clock)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!clock.visible) return
    const id = setInterval(() => setNow(new Date()), clock.showSeconds ? 1000 : 15_000)
    return () => clearInterval(id)
  }, [clock.visible, clock.showSeconds])

  if (!clock.visible) return null

  const tz = clock.timeZone || undefined // undefined = host system timezone
  let time: string
  let date: string
  try {
    time = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      ...(clock.showSeconds ? { second: '2-digit' } : {}),
      hour12: clock.hour12,
      timeZone: tz
    })
    date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: tz })
  } catch {
    // an invalid timezone string → fall back to system time rather than crashing
    time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: clock.hour12 })
    date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-[2] flex -translate-x-1/2 select-none flex-col items-center text-ink">
      <div className="font-doodle text-4xl font-bold tabular-nums tracking-wide drop-shadow-[2px_2px_0_rgba(43,43,43,0.12)]">{time}</div>
      {clock.showDate && <div className="font-doodle text-sm text-ink/60">{date}</div>}
      {clock.label && <div className="mt-0.5 font-doodle text-sm text-ink/70">{clock.label}</div>}
    </div>
  )
}
