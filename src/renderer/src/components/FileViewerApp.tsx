import { useEffect, useRef, useState, type JSX } from 'react'
import type { FsNode } from '@shared/types'
import { useStore, type WinState } from '../store'
import { WindowFrame } from './WindowFrame'
import { DoodleInput, DoodleTextarea } from './DoodleField'
import { Icon } from './Icon'
import { useDoodleScrollbar } from '../lib/useDoodleScrollbar'
import { commitFsMutation, dispatchFs, FS_CHANGED_EVENT, isOwnFs, newOrigin } from '../lib/fsClipboard'

/**
 * A standalone, opaque file editor window (kind:'fileviewer') — a real app, not an overlay on the
 * file manager. Reads its file from the virtual FS, autosaves edits back, and follows external
 * changes (e.g. the agent rewriting the file) when the user isn't actively typing.
 */
export function FileViewerApp({ win }: { win: WinState }): JSX.Element {
  const fileId = win.openFileId!
  const closeWindow = useStore((s) => s.closeWindow)
  const [node, setNode] = useState<FsNode | null>(null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const typingRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const originRef = useRef(newOrigin())
  useDoodleScrollbar(bodyRef)

  // load + follow external changes (unless the user is mid-edit)
  useEffect(() => {
    const load = (): void => {
      void window.crazyos.fsRead().then((t) => {
        const n = t.nodes[fileId]
        if (!n) {
          closeWindow(win.instanceId) // file was deleted elsewhere
          return
        }
        setNode(n)
        if (!typingRef.current) {
          setText(n.content ?? '')
          setName(n.name)
        }
      })
    }
    load()
    const onFs = (e: Event): void => {
      if (isOwnFs(e, originRef.current)) return
      load()
    }
    window.addEventListener(FS_CHANGED_EVENT, onFs)
    return () => window.removeEventListener(FS_CHANGED_EVENT, onFs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  const persist = (patch: { content?: string; name?: string }): void => {
    void commitFsMutation((t) => {
      const n = t.nodes[fileId]
      if (!n) throw new Error('文件已被删除')
      t.nodes[fileId] = { ...n, ...patch, updatedAt: Date.now() }
    })
      .then(() => dispatchFs(originRef.current))
      .catch((err) => console.error('[FileViewer] save failed:', err))
  }

  // debounce-save content while typing
  useEffect(() => {
    if (!node) return
    if (text === (node.content ?? '')) return
    typingRef.current = true
    const t = setTimeout(() => {
      persist({ content: text })
      typingRef.current = false
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <WindowFrame win={win} initialWidth={560} initialHeight={460} titleIcon={<Icon name="doc" size={19} />}>
      <div className="flex h-full flex-col bg-card p-3 font-doodle text-ink">
        <div className="flex items-center gap-2 border-b-2 border-dashed border-ink/25 pb-2">
          <Icon name="doc" size={20} />
          <DoodleInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && node && name !== node.name && persist({ name: name.trim() })}
            className="grow"
          />
        </div>
        <div ref={bodyRef} className="mt-2 flex grow overflow-auto">
          <DoodleTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="在这里写点什么……（自动保存）"
            className="grow"
            radius={12}
          />
        </div>
      </div>
    </WindowFrame>
  )
}
