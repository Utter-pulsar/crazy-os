/** Model-authored browser pages are declarative, but models occasionally emit
 * a generic app hook or forget the active tab's id prefix. Repair those routes
 * before validation so a harmless wiring mistake cannot discard a whole page.
 * The repaired controls can only call stable browser callbacks or a content
 * slot that physically belongs to this tab. */
export function normalizeBrowserPageRoutes(d: Document, source: string, tabId: string): string {
  const hookAttributes = [
    'data-hook',
    'data-hook-kind',
    'data-hook-target',
    'data-hook-placement',
    'data-hook-role',
    'data-hook-template'
  ]
  const root = d.createElement('template')
  root.innerHTML = source
  const safeTab = tabId.replace(/[^a-zA-Z0-9_]/g, '_')
  const idPrefix = `page-${safeTab}-`

  const elementsDeep = (parent: ParentNode): HTMLElement[] => {
    const direct = Array.from(parent.querySelectorAll<HTMLElement>('*'))
    const result = [...direct]
    for (const element of direct) {
      if (element.tagName === 'TEMPLATE') result.push(...elementsDeep((element as HTMLTemplateElement).content))
    }
    return result
  }
  const queryDeep = (parent: ParentNode, selector: string): HTMLElement | null => {
    try {
      const direct = parent.querySelector<HTMLElement>(selector)
      if (direct) return direct
    } catch {
      return null
    }
    for (const template of Array.from(parent.querySelectorAll<HTMLTemplateElement>('template'))) {
      const nested = queryDeep(template.content, selector)
      if (nested) return nested
    }
    return null
  }
  const removeHook = (element: HTMLElement): void => {
    for (const attribute of hookAttributes) element.removeAttribute(attribute)
    element.removeAttribute('data-crazyos-auto-hook')
    element.removeAttribute('data-crazyos-proxy-input')
  }
  const disable = (element: HTMLElement): void => {
    removeHook(element)
    element.removeAttribute('data-action')
    element.setAttribute('aria-disabled', 'true')
    if ('disabled' in element) (element as HTMLButtonElement).disabled = true
    if (element.tagName === 'A') element.removeAttribute('href')
  }

  const nextLocalId = (base: string): string => {
    const safeBase = base.replace(/[^a-zA-Z0-9_:.-]+/g, '-') || 'node'
    let candidate = `${idPrefix}${safeBase}`
    let suffix = 2
    while (usedIds.has(candidate)) candidate = `${idPrefix}${safeBase}-${suffix++}`
    usedIds.add(candidate)
    return candidate
  }

  const searchSelector = [
    '.browser-engine-search-input',
    'input[type="search"]',
    'input[name="q"]',
    'input[name="query"]',
    'input[name="wd"]',
    'input[name="search"]',
    'input[name="keyword"]',
    'input[type="text"]'
  ].join(',')

  const pairSearchControl = (element: HTMLElement): HTMLInputElement | null => {
    let field = element.matches(searchSelector) ? (element as HTMLInputElement) : null
    const form = element.closest('form')
    const scope = form ?? element.closest('[role="search"],.engine-search-row,.browser-search-form,.browser-serp-head,.search-bar,.search-box,.row,.toolbar')
    if (!field) field = scope?.querySelector<HTMLInputElement>(searchSelector) ?? null
    if (!field && element.parentElement) field = element.parentElement.querySelector<HTMLInputElement>(searchSelector)
    if (!field) return null
    field.classList.add('browser-engine-search-input')
    if (!field.name) field.name = 'query'
    field.setAttribute('data-action', 'browserSearchPage')
    if (!field.id) field.id = nextLocalId('search-input')
    element.setAttribute('data-search-input', `#${field.id}`)
    const engine = element.getAttribute('data-engine')?.trim()
    if (engine && !field.hasAttribute('data-engine')) field.setAttribute('data-engine', engine)
    return field
  }

  let all = elementsDeep(root.content)
  // Generic route auditing may have run against an isolated fragment that has
  // no browser runtime handlers. Those temporary host markers are not part of
  // the page contract and must never make an otherwise repaired control fatal.
  for (const element of all) {
    element.removeAttribute('data-crazyos-auto-hook')
    element.removeAttribute('data-crazyos-proxy-input')
  }
  const usedIds = new Set<string>()
  const idMap = new Map<string, string>()
  for (const element of all.filter((candidate) => candidate.hasAttribute('id'))) {
    const oldId = element.id.trim()
    const rawSuffix = oldId.startsWith(idPrefix) ? oldId.slice(idPrefix.length) : oldId
    const safeSuffix = rawSuffix.replace(/[^a-zA-Z0-9_:.-]+/g, '-').replace(/^-+|-+$/g, '') || 'node'
    let nextId = `${idPrefix}${safeSuffix}`
    let suffix = 2
    while (usedIds.has(nextId)) nextId = `${idPrefix}${safeSuffix}-${suffix++}`
    usedIds.add(nextId)
    if (oldId && !idMap.has(oldId)) idMap.set(oldId, nextId)
    element.id = nextId
  }

  const selectorAttributes = [
    'data-hook-target',
    'data-hook-template',
    'data-target',
    'data-user-template',
    'data-reply-template'
  ]
  for (const element of all) {
    for (const attribute of selectorAttributes) {
      const value = element.getAttribute(attribute)?.trim() ?? ''
      if (!value.startsWith('#')) continue
      const mapped = idMap.get(value.slice(1))
      if (mapped) element.setAttribute(attribute, `#${mapped}`)
    }
    for (const attribute of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
      const value = element.getAttribute(attribute)?.trim() ?? ''
      if (!value) continue
      const mapped = value.split(/\s+/).map((token) => idMap.get(token) ?? token).join(' ')
      element.setAttribute(attribute, mapped)
    }
  }

  all = elementsDeep(root.content)
  const contentTargets = all.filter(
    (element) => element.id.startsWith(idPrefix) && element.getAttribute('data-crazyos-slot') === 'content'
  )
  const replyTemplates = all.filter(
    (element) => element.tagName === 'TEMPLATE' && element.id.startsWith(idPrefix) && !!queryDeep((element as HTMLTemplateElement).content, '[data-crazy-content]')
  )
  const userTemplates = all.filter(
    (element) => element.tagName === 'TEMPLATE' && element.id.startsWith(idPrefix) && !!queryDeep((element as HTMLTemplateElement).content, '[data-crazy-user-content]')
  )

  const chooseBySelector = (selector: string, candidates: HTMLElement[]): HTMLElement | null => {
    if (selector.startsWith('#')) {
      const direct = queryDeep(root.content, selector)
      if (direct && candidates.includes(direct)) return direct
      const raw = selector.slice(1).replace(/[^a-zA-Z0-9_:.-]+/g, '-')
      const suffixMatches = candidates.filter((candidate) =>
        candidate.id === `${idPrefix}${raw}` || candidate.id.endsWith(`-${raw}`)
      )
      if (suffixMatches.length === 1) return suffixMatches[0]
    }
    return candidates.length === 1 ? candidates[0] : null
  }

  const routeToBrowser = (element: HTMLElement, allowComposerRoute: boolean): void => {
    const form = element.closest('form')
    const messageField = form?.querySelector<HTMLElement>('textarea[name="message"],input[name="message"]')
    const requestedTarget = element.getAttribute('data-target') || element.getAttribute('data-hook-target') || ''
    const contentTarget = chooseBySelector(requestedTarget, contentTargets)
    removeHook(element)
    if (allowComposerRoute && messageField && contentTarget) {
      element.setAttribute('data-action', 'browserSendContent')
      element.setAttribute('data-target', `#${contentTarget.id}`)
      return
    }
    const searchField = pairSearchControl(element)
    if (searchField) {
      element.setAttribute('data-action', 'browserSearchPage')
      return
    }
    const intent = (
      element.getAttribute('data-url') ||
      element.getAttribute('href') ||
      (element as HTMLInputElement).value ||
      element.textContent ||
      ''
    ).trim()
    if (!intent) {
      disable(element)
      return
    }
    element.setAttribute('data-action', 'browserOpenResult')
    element.setAttribute('data-url', intent.slice(0, 1000))
    if (!element.hasAttribute('data-title')) element.setAttribute('data-title', intent.slice(0, 160))
    if (element.tagName === 'A') element.removeAttribute('href')
  }

  for (const element of all.filter((candidate) => candidate.hasAttribute('data-hook'))) {
    const kind = element.getAttribute('data-hook-kind')?.trim() ?? ''
    const requestedTarget = element.getAttribute('data-hook-target')?.trim() ?? ''
    const contentTarget = chooseBySelector(requestedTarget, contentTargets)
    if (kind === 'content' || !!requestedTarget) {
      if (contentTarget) {
        const composerField = element.closest('form')?.querySelector('textarea[name="message"],input[name="message"]')
        const requestedTemplate = element.getAttribute('data-hook-template')?.trim() ?? ''
        const localTemplate = requestedTemplate ? chooseBySelector(requestedTemplate, replyTemplates) : null
        if (composerField) {
          const action = element.getAttribute('data-hook')?.trim() || 'browser_chat_reply'
          removeHook(element)
          element.setAttribute('data-action', 'browserSendContent')
          element.setAttribute('data-target', `#${contentTarget.id}`)
          element.setAttribute('data-content-action', action.slice(0, 120))
          if (localTemplate) element.setAttribute('data-reply-template', `#${localTemplate.id}`)
          continue
        }
        element.setAttribute('data-hook-kind', 'content')
        element.setAttribute('data-hook-target', `#${contentTarget.id}`)
        const placement = element.getAttribute('data-hook-placement')
        if (placement !== 'replace' && placement !== 'append') element.setAttribute('data-hook-placement', 'append')
        if (!element.hasAttribute('data-hook-role')) element.setAttribute('data-hook-role', '本标签页内的增量内容')
        if (requestedTemplate) {
          if (localTemplate) element.setAttribute('data-hook-template', `#${localTemplate.id}`)
          else element.removeAttribute('data-hook-template')
        }
      } else {
        // An ambiguous content destination is not safe to guess across several
        // message regions. Disable this one control; the rest of the page stays.
        disable(element)
      }
      continue
    }
    routeToBrowser(element, kind !== 'navigate')
  }

  const stableActions = new Set([
    'browserSearchPage',
    'browserOpenEngine',
    'browserOpenResult',
    'browserSendContent',
    'browserHome',
    'browserBack',
    'browserForward',
    'browserReload',
    'browserExternal'
  ])
  for (const element of all.filter((candidate) => candidate.hasAttribute('data-action'))) {
    const action = element.getAttribute('data-action')?.trim() ?? ''
    if (action === 'browserSearchPage') {
      const field = pairSearchControl(element)
      if (!field && !element.matches(searchSelector)) disable(element)
      continue
    }
    if (action === 'browserOpenResult') {
      const intent = (element.getAttribute('data-url') || element.getAttribute('href') || element.textContent || '').trim()
      if (intent) {
        element.setAttribute('data-url', intent.slice(0, 1000))
        if (!element.hasAttribute('data-title')) element.setAttribute('data-title', (element.textContent || intent).trim().slice(0, 160))
        if (element.tagName === 'A') element.removeAttribute('href')
      } else disable(element)
      continue
    }
    if (stableActions.has(action)) continue
    const contentTarget = chooseBySelector(element.getAttribute('data-target') ?? '', contentTargets)
    if (contentTarget) {
      element.setAttribute('data-action', 'browserSendContent')
      element.setAttribute('data-target', `#${contentTarget.id}`)
    } else if (element.matches('button,a,input[type="button"],input[type="submit"],[role="button"],.btn')) {
      routeToBrowser(element, true)
    } else {
      element.removeAttribute('data-action')
    }
  }

  for (const element of all.filter((candidate) => candidate.getAttribute('data-action') === 'browserSendContent')) {
    const target = chooseBySelector(element.getAttribute('data-target') ?? '', contentTargets)
    if (!target) {
      disable(element)
      continue
    }
    element.setAttribute('data-target', `#${target.id}`)
    for (const attribute of ['data-user-template', 'data-reply-template']) {
      const requested = element.getAttribute(attribute)?.trim() ?? ''
      if (!requested) continue
      const localTemplate = chooseBySelector(requested, attribute === 'data-user-template' ? userTemplates : replyTemplates)
      if (localTemplate) element.setAttribute(attribute, `#${localTemplate.id}`)
      else element.removeAttribute(attribute)
    }
  }

  return root.innerHTML.trim()
}
