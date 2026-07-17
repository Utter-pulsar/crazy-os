import { type JSX, type ReactNode, useEffect } from 'react'
import { motion } from 'framer-motion'
import { DoodleBox } from './DoodleBox'

/** A centered modal on a dim backdrop; click outside or press Esc to close. */
export function DialogShell({
  onClose,
  children,
  width = 'w-[420px]'
}: {
  onClose: () => void
  children: ReactNode
  width?: string
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-[210000] flex items-center justify-center bg-ink/25 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.7, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 460, damping: 22, mass: 0.7 }}
        className={`${width} max-w-[90vw]`}
      >
        <DoodleBox fill="--card" radius={16}>
          <div className="p-6 font-doodle text-ink">{children}</div>
        </DoodleBox>
      </motion.div>
    </div>
  )
}
