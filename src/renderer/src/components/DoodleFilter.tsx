import { type JSX } from 'react'

/**
 * A reusable SVG turbulence filter. Add the `doodle-edge` class to any straight-edged
 * SVG/icon to give its strokes a gentle hand-drawn wobble. Mounted once at app root.
 */
export function DoodleFilter(): JSX.Element {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <filter id="doodle-wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={2} seed={7} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}
