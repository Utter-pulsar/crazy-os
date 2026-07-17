import { type JSX } from 'react'

/**
 * Hand-drawn line icons for the built-in system UI (settings, files, agent…). Every glyph is a
 * stroke SVG rendered through the global `#doodle-wobble` filter (`.doodle-edge`), so it reads as
 * sketched — never an emoji. Sized by `size`; inherits `currentColor`.
 */
export type IconName =
  | 'soul'
  | 'palette'
  | 'monitor'
  | 'tag'
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'doc'
  | 'json'
  | 'plus'
  | 'history'
  | 'new-chat'
  | 'close'
  | 'trash'
  | 'pencil'
  | 'back'
  | 'check'
  | 'cross'
  | 'brain'
  | 'dock'
  | 'shortcut'
  | 'gear'
  | 'eye'
  | 'eye-off'

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }): JSX.Element {
  return (
    <svg
      className={`doodle-edge ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPH[name]}
    </svg>
  )
}

const GLYPH: Record<IconName, JSX.Element> = {
  soul: (
    <>
      {/* a little sprout / spirit in a bulb */}
      <path d="M12 3c3.6 0 6 2.6 6 5.7 0 2.3-1.3 3.6-2.3 4.6-.6.6-.9 1.2-.9 2.1v.6H9.2v-.6c0-.9-.3-1.5-.9-2.1C7.3 12.3 6 11 6 8.7 6 5.6 8.4 3 12 3Z" />
      <line x1="9.4" y1="19" x2="14.6" y2="19" />
      <line x1="10.2" y1="21" x2="13.8" y2="21" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5c4.7 0 8.5 3.3 8.5 7.4 0 2.4-2 3.6-3.9 3.6h-1.7c-1 0-1.6.9-1.2 1.8.4.9-.2 2-1.6 2C7.5 18.3 3.5 14.9 3.5 10.9 3.5 6.8 7.3 3.5 12 3.5Z" />
      <circle cx="8" cy="10" r="1" />
      <circle cx="12" cy="7.5" r="1" />
      <circle cx="16" cy="10" r="1" />
    </>
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11" rx="1.5" />
      <line x1="9" y1="19.5" x2="15" y2="19.5" />
      <line x1="12" y1="15.5" x2="12" y2="19.5" />
    </>
  ),
  tag: (
    <>
      <path d="M4 12.2 11.6 4.6c.4-.4.9-.6 1.4-.6H18c.6 0 1 .4 1 1v5c0 .5-.2 1-.6 1.4L10.8 19c-.6.6-1.5.6-2.1 0L4 14.3c-.6-.6-.6-1.5 0-2.1Z" />
      <circle cx="15" cy="9" r="1.1" />
    </>
  ),
  folder: <path d="M3 6.5c0-.6.5-1 1-1h4.6l2 2H20c.6 0 1 .5 1 1V18c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V6.5Z" />,
  'folder-open': (
    <>
      <path d="M3 6.5c0-.6.5-1 1-1h4.6l2 2H19c.6 0 1 .5 1 1v1.5H6.4c-.7 0-1.3.4-1.5 1L3 17V6.5Z" />
      <path d="m4.9 11.2 15-.2c.7 0 1.2.7 1 1.4L19.3 18c-.2.6-.7 1-1.4 1H4c-.6 0-1-.4-1-1v-.4l1.9-6.4Z" />
    </>
  ),
  file: (
    <>
      <path d="M6.5 3.5h7L18 8v11.5c0 .6-.4 1-1 1H6.5c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1Z" />
      <path d="M13 3.6V8h4.4" />
    </>
  ),
  doc: (
    <>
      <path d="M6.5 3.5h7L18 8v11.5c0 .6-.4 1-1 1H6.5c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1Z" />
      <path d="M13 3.6V8h4.4" />
      <line x1="8.5" y1="12" x2="15" y2="12" />
      <line x1="8.5" y1="15" x2="15" y2="15" />
    </>
  ),
  json: (
    <>
      <path d="M6.5 3.5h7L18 8v11.5c0 .6-.4 1-1 1H6.5c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1Z" />
      <path d="M13 3.6V8h4.4" />
      <path d="M10 11.5c-1 0-1.3.6-1.3 1.4v.6c0 .6-.3.9-.8.9.5 0 .8.3.8.9v.6c0 .8.3 1.4 1.3 1.4" />
      <path d="M14 11.5c1 0 1.3.6 1.3 1.4v.6c0 .6.3.9.8.9-.5 0-.8.3-.8.9v.6c0 .8-.3 1.4-1.3 1.4" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5.5" x2="12" y2="18.5" />
      <line x1="5.5" y1="12" x2="18.5" y2="12" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 1 2.3 5.4" />
      <path d="M4.2 17.6 4.5 12l5.4 1" strokeLinecap="round" />
      <path d="M12 8.5V12l2.6 1.6" />
    </>
  ),
  'new-chat': (
    <>
      <path d="M4.5 6.5c0-.6.4-1 1-1H15c.6 0 1 .4 1 1V13c0 .6-.4 1-1 1H9l-3.2 2.8c-.4.3-.9 0-.9-.5V6.5Z" />
      <line x1="18.5" y1="6" x2="18.5" y2="11" />
      <line x1="16" y1="8.5" x2="21" y2="8.5" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  trash: (
    <>
      <path d="M5.5 6.5h13" />
      <path d="M9 6.5V5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v1.5" />
      <path d="M6.8 6.5 7.5 19c0 .6.5 1 1 1h7c.5 0 1-.4 1-1l.7-12.5" />
      <line x1="10" y1="9.5" x2="10.3" y2="17" />
      <line x1="14" y1="9.5" x2="13.7" y2="17" />
    </>
  ),
  pencil: (
    <>
      <path d="M14.5 5.5 18 9 8.5 18.5l-4 1 1-4L14.5 5.5Z" />
      <line x1="13" y1="7" x2="16.5" y2="10.5" />
    </>
  ),
  back: (
    <>
      <line x1="19" y1="12" x2="6" y2="12" />
      <path d="M11 7 6 12l5 5" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19 6.5" />,
  cross: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 5c-1.6 0-2.7 1-2.7 2.3-1.2.2-2 1.1-2 2.3 0 .8.4 1.5 1 1.9-.3.4-.5.9-.5 1.5 0 1.3 1 2.3 2.4 2.4.2 1.1 1.2 1.9 2.3 1.9V5Z" />
      <path d="M14.5 5c1.6 0 2.7 1 2.7 2.3 1.2.2 2 1.1 2 2.3 0 .8-.4 1.5-1 1.9.3.4.5.9.5 1.5 0 1.3-1 2.3-2.4 2.4-.2 1.1-1.2 1.9-2.3 1.9V5Z" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </>
  ),
  dock: <rect x="4.5" y="4.5" width="15" height="15" rx="2" />,
  shortcut: (
    <>
      <path d="M5 18.5h7.5c3.8 0 6-2.1 6-5.7V8" />
      <path d="m13.5 12.5 5-5 5 5" transform="translate(-5 0)" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 3.4v3M12 17.6v3M3.4 12h3M17.6 12h3M5.9 5.9l2.1 2.1M16 16l2.1 2.1M18.1 5.9 16 8M8 16l-2.1 2.1" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4.5c-.8 1.4-1.5 2.5-1.5 2.5S6 13.5 12 13.5c1 0 1.9-.2 2.7-.4" />
      <path d="M9 6c.9-.3 1.9-.5 3-.5 6 0 9.5 6.5 9.5 6.5s-1 1.9-2.9 3.5" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </>
  )
}
