import { type JSX } from 'react'

/** A hand-drawn on/off switch: ink outline, marker-green when on. */
export function DoodleToggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-ink transition-colors ${
        checked ? 'bg-marker-green/70' : 'bg-card'
      }`}
    >
      <span
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper transition-all ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}
