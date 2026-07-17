import { type JSX, type ReactNode } from 'react'
import { DoodleBox } from './DoodleBox'

/**
 * A hand-drawn form field: a Rough.js sketched border (via DoodleBox) behind a fully
 * borderless input/textarea, so text fields match the whiteboard aesthetic instead of a
 * crisp rectangle. `as="textarea"` for multiline; extra props pass straight through.
 */
type Common = {
  className?: string
  radius?: number
}

export function DoodleInput({
  className = '',
  radius = 10,
  ...rest
}: Common & React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <FieldShell radius={radius} className={className}>
      <input
        {...rest}
        className="relative w-full rounded-[inherit] bg-transparent px-3 py-1.5 font-doodle text-ink outline-none placeholder:text-ink/40"
      />
    </FieldShell>
  )
}

export function DoodleTextarea({
  className = '',
  radius = 10,
  ...rest
}: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <FieldShell radius={radius} className={className}>
      <textarea
        {...rest}
        className="relative block h-full w-full resize-none rounded-[inherit] bg-transparent px-3 py-1.5 font-doodle text-ink outline-none placeholder:text-ink/40"
      />
    </FieldShell>
  )
}

function FieldShell({ radius, className, children }: { radius: number; className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={`relative flex ${className}`}>
      <DoodleBox fill="--paper" radius={radius} roughness={1.1} className="absolute inset-0" />
      {children}
    </div>
  )
}
