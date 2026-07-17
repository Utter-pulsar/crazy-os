export const INTERACTIVE_CONTROL_SELECTOR =
  'button, a[href], input[type="button"], input[type="submit"], .btn, [role="button"], [data-action], [data-hook]'

/** Make every generated control routable before its HTML becomes a runtime
 * source file. Working app.* handlers stay local; anything missing is explicitly
 * hooked to Crazy under the intended action name (or continue_ui as a fallback).
 * A single imperfect button must never invalidate an otherwise usable app. */
export function ensureControlRoutes(d: Document): number {
  const appObj = (d.defaultView as (Window & { app?: Record<string, unknown> }) | null)?.app ?? null
  const controls = Array.from(d.querySelectorAll<HTMLElement>(INTERACTIVE_CONTROL_SELECTOR))
  let changed = 0
  for (const el of controls) {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-crazyos-host')) continue
    const action = el.getAttribute('data-action')?.trim()
    const hook = el.getAttribute('data-hook')?.trim()
    if (hook) {
      const autoHook = el.getAttribute('data-crazyos-auto-hook') === 'true'
      const nowHasLocalHandler = (action && typeof appObj?.[action] === 'function') || typeof el.onclick === 'function'
      // Auto hooks are only scaffolding while generated local logic is absent.
      // A later clean audit may discover that Crazy has supplied the handler;
      // remove the scaffolding so the new local implementation can actually run.
      if (autoHook && nowHasLocalHandler) {
        el.removeAttribute('data-hook')
        el.removeAttribute('data-crazyos-auto-hook')
        el.removeAttribute('data-crazyos-proxy-input')
        changed++
      }
      continue
    }
    if ((action && typeof appObj?.[action] === 'function') || typeof el.onclick === 'function') continue
    const nearby = !action
      ? el.closest('.toolbar, .row, form, .card, .col')?.querySelector<HTMLElement>('input[data-hook], textarea[data-hook]')?.getAttribute('data-hook')?.trim()
      : undefined
    el.setAttribute('data-hook', action || nearby || 'continue_ui')
    if (nearby) el.setAttribute('data-crazyos-proxy-input', 'true')
    el.setAttribute('data-crazyos-auto-hook', 'true')
    changed++
  }
  return changed
}

export function hasRenderableContent(d: Document): boolean {
  if (!d.body) return false
  const view = d.defaultView
  const isVisible = (el: Element): boolean => {
    if (el.matches('script, style, link, meta, template, [data-crazyos-host]')) return false
    if (el.closest('[hidden], [aria-hidden="true"]')) return false
    const inline = (el as HTMLElement).style
    if (inline?.display === 'none' || inline?.visibility === 'hidden' || inline?.opacity === '0') return false
    const computed = view?.getComputedStyle(el)
    if (computed && (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0')) return false
    return true
  }
  const semantic = 'button, input:not([type="hidden"]), textarea, select, img, canvas, video, iframe, svg:not([width="0"]), [role="button"], [role="link"]'
  if (Array.from(d.body.querySelectorAll(semantic)).some(isVisible)) return true
  const walker = d.createTreeWalker(d.body, 4)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue
    const parent = node.parentElement
    if (parent && isVisible(parent)) return true
  }
  return false
}
