import './styles.css'
import type { AssetItem, AssetTypeSummary as AssetType } from '../server/types'

const typeList = requiredElement<HTMLElement>('type-list')
const assetList = requiredElement<HTMLDivElement>('asset-list')
const search = requiredElement<HTMLInputElement>('search')
const picker = requiredElement<HTMLInputElement>('file-picker')
const filters = requiredElement<HTMLDivElement>('filters')
const addButton = requiredElement<HTMLButtonElement>('add-asset')
const total = requiredElement<HTMLElement>('asset-total')
const activeTitle = requiredElement<HTMLElement>('active-title')
const activeDescription = requiredElement<HTMLElement>('active-description')
const activeCount = requiredElement<HTMLElement>('active-count')
const activeDrift = requiredElement<HTMLElement>('active-drift')
const formatNote = requiredElement<HTMLElement>('format-note')
const empty = requiredElement<HTMLParagraphElement>('empty-state')
const toast = requiredElement<HTMLDivElement>('toast')

let types: AssetType[] = []
let activeTypeId = ''
let activeFilter = 'all'
let replacementTarget: string | undefined
let playingButton: HTMLButtonElement | undefined
let toastTimer: number | undefined

const player = new Audio()
player.preload = 'metadata'
player.addEventListener('ended', stopPlaybackState)
player.addEventListener('pause', stopPlaybackState)
player.addEventListener('error', () => {
  stopPlaybackState()
  showToast('This asset could not be played.', 'error')
})

// Separate from the player so probing durations never interrupts playback.
const probe = new Audio()
probe.preload = 'metadata'
const durations = new Map<string, Promise<number | undefined>>()
let probeQueue: Promise<unknown> = Promise.resolve()

void loadCatalogue()

for (const eventName of ['dragover', 'drop']) {
  assetList.addEventListener(eventName, (event) => event.preventDefault())
}

search.addEventListener('input', renderItems)
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    search.value = ''
    renderItems()
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== search) {
    event.preventDefault()
    search.focus()
  }
})

addButton.addEventListener('click', () => {
  replacementTarget = undefined
  picker.click()
})

picker.addEventListener('change', () => {
  const file = picker.files?.[0]
  const target = replacementTarget
  picker.value = ''
  if (!file) return
  if (target) void replaceAsset(target, file)
  else void addAsset(file)
})

async function loadCatalogue(): Promise<void> {
  try {
    const response = await fetch('/api/assets', { cache: 'no-store' })
    if (!response.ok) throw new Error('Asset catalogue request failed')
    const payload = (await response.json()) as { types: AssetType[] }
    types = payload.types
    activeTypeId = types[0]?.id ?? ''
    total.textContent = String(types.reduce((sum, type) => sum + type.count, 0))
    renderTypes()
    renderActiveType()
  } catch {
    typeList.innerHTML = '<p class="sidebar-error">Catalogue unavailable</p>'
    assetList.innerHTML =
      '<div class="error-state"><strong>Could not load game assets.</strong><span>Start the asset manager and try again.</span></div>'
  }
}

function renderTypes(): void {
  typeList.replaceChildren(
    ...types.map((type) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `type-button${type.id === activeTypeId ? ' is-active' : ''}`
      button.innerHTML = `
        <span class="type-icon" aria-hidden="true">${type.preview === 'audio' ? '◖' : '◆'}</span>
        <span><strong>${escapeHtml(type.label)}</strong><small>${type.count} assets</small></span>
        <em>${type.count}</em>
      `
      button.addEventListener('click', () => {
        activeTypeId = type.id
        activeFilter = type.filters[0]?.id ?? 'all'
        search.value = ''
        stopPlaybackState()
        renderTypes()
        renderActiveType()
      })
      return button
    })
  )
}

function renderActiveType(): void {
  const type = currentType()
  if (!type) return
  activeTitle.textContent = type.label
  activeDescription.textContent = type.description
  activeCount.textContent = String(type.count)
  const drifted = type.items.filter((asset) => asset.inSync === false).length
  activeDrift.textContent = `${drifted} out of sync`
  activeDrift.hidden = drifted === 0
  formatNote.textContent = `${type.accept.split(',')[0].toUpperCase()} · ${formatBytes(type.maxBytes)} max`
  picker.accept = type.accept

  // "Unused" is synthesised client-side for types whose server reports usage.
  const typeFilters = type.items.some((asset) => asset.used !== undefined)
    ? [...type.filters, { id: 'unused', label: 'Unused' }]
    : type.filters
  filters.replaceChildren(
    ...typeFilters.map((filter) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `filter${filter.id === activeFilter ? ' is-active' : ''}`
      button.textContent = filter.label
      button.addEventListener('click', () => {
        activeFilter = filter.id
        renderActiveType()
      })
      return button
    })
  )
  renderItems()
}

function renderItems(): void {
  const type = currentType()
  if (!type) return
  const query = search.value.trim().toLowerCase()
  const visible = type.items.filter(
    (asset) =>
      (activeFilter === 'all' ||
        asset.filter === activeFilter ||
        (activeFilter === 'unused' && asset.used === false)) &&
      asset.name.toLowerCase().includes(query)
  )

  assetList.replaceChildren(...visible.map((asset) => assetRow(type, asset)))
  empty.hidden = visible.length !== 0 || type.items.length === 0
}

function assetRow(type: AssetType, asset: AssetItem): HTMLElement {
  const row = document.createElement('article')
  row.className = 'asset-row'
  row.dataset.name = asset.name

  const identity = document.createElement('div')
  identity.className = 'asset-identity'
  const url = assetUrl(type, asset)
  identity.innerHTML = `
    <span class="asset-chip asset-chip-${asset.filter}">${escapeHtml(asset.badge)}</span>
    ${type.preview === 'image' ? `<img class="asset-thumb" src="${escapeHtml(url)}" alt="" loading="lazy" />` : ''}
    <span class="asset-name"><strong>${escapeHtml(friendlyName(asset.name))}</strong><small>${escapeHtml(asset.name)}</small></span>
    ${asset.used === false ? '<span class="asset-flag asset-flag-unused">Unused</span>' : ''}
    ${asset.modified === true ? '<span class="asset-flag asset-flag-modified">Modified</span>' : ''}
    ${asset.inSync === false ? '<span class="asset-flag asset-flag-drift">Out of sync</span>' : ''}
  `

  const size = document.createElement('span')
  size.className = 'asset-size'
  size.textContent = formatBytes(asset.bytes)

  // Drops reuse the replace flow; the list itself cancels the browser's default navigation.
  row.addEventListener('dragover', () => row.classList.add('is-drop-target'))
  row.addEventListener('dragleave', (event) => {
    if (!row.contains(event.relatedTarget as Node | null)) row.classList.remove('is-drop-target')
  })
  row.addEventListener('drop', (event) => {
    row.classList.remove('is-drop-target')
    const files = event.dataTransfer?.files
    if (!files?.length) return
    if (files.length > 1) showToast(`Drop a single ${type.singular} file.`, 'error')
    else void replaceAsset(asset.name, files[0])
  })

  const actions = document.createElement('div')
  actions.className = 'asset-actions'

  if (type.preview === 'audio') {
    const duration = document.createElement('small')
    duration.className = 'asset-duration'
    size.append(duration)
    // Durations are probed lazily (first hover or Play); render only reuses lookups already made.
    const showDuration = (lookup: Promise<number | undefined>): void => {
      void lookup.then((seconds) => {
        if (seconds !== undefined) duration.textContent = formatDuration(seconds)
      })
    }
    const known = durations.get(url)
    if (known) showDuration(known)
    else row.addEventListener('pointerenter', () => showDuration(loadDuration(url)), { once: true })

    const play = document.createElement('button')
    play.className = 'play-button'
    play.type = 'button'
    play.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'
    play.setAttribute('aria-label', `Play ${friendlyName(asset.name)}`)
    play.addEventListener('click', () => {
      showDuration(loadDuration(url))
      togglePlayback(type, asset, play)
    })
    actions.append(play)
  }

  const replace = document.createElement('button')
  replace.className = 'replace-button'
  replace.type = 'button'
  replace.innerHTML = '<span aria-hidden="true">↥</span><span>Replace</span>'
  replace.addEventListener('click', () => {
    replacementTarget = asset.name
    picker.click()
  })

  const remove = document.createElement('button')
  remove.className = 'delete-button'
  remove.type = 'button'
  remove.innerHTML = '<span aria-hidden="true">✕</span>'
  remove.title = 'Delete'
  remove.setAttribute('aria-label', `Delete ${friendlyName(asset.name)}`)
  remove.addEventListener('click', () => void deleteAsset(asset.name))

  actions.append(replace, remove)
  row.append(identity, size, actions)
  return row
}

function assetUrl(type: AssetType, asset: AssetItem): string {
  return `/api/assets/${encodeURIComponent(type.id)}/${encodeURIComponent(asset.name)}?v=${encodeURIComponent(asset.updatedAt)}`
}

function togglePlayback(type: AssetType, asset: AssetItem, button: HTMLButtonElement): void {
  if (playingButton === button && !player.paused) {
    player.pause()
    return
  }
  stopPlaybackState()
  playingButton = button
  button.classList.add('is-playing')
  button.innerHTML = '<span aria-hidden="true">■</span><span>Stop</span>'
  player.src = assetUrl(type, asset)
  void player.play().catch(() => {
    stopPlaybackState()
    showToast(`This ${type.singular} could not be played.`, 'error')
  })
}

/** One shared lookup per asset URL; the URL embeds updatedAt, so a replaced file is probed again. */
function loadDuration(url: string): Promise<number | undefined> {
  const known = durations.get(url)
  if (known) return known
  const lookup = probeQueue.then(() => probeDuration(url))
  probeQueue = lookup
  durations.set(url, lookup)
  return lookup
}

function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const listeners = new AbortController()
    const settle = (): void => {
      listeners.abort()
      resolve(Number.isFinite(probe.duration) ? probe.duration : undefined)
    }
    probe.addEventListener('loadedmetadata', settle, { signal: listeners.signal })
    probe.addEventListener('error', settle, { signal: listeners.signal })
    probe.src = url
  })
}

function formatDuration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function stopPlaybackState(): void {
  if (!playingButton) return
  playingButton.classList.remove('is-playing')
  playingButton.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'
  playingButton = undefined
}

async function replaceAsset(name: string, file: File): Promise<void> {
  const type = currentType()
  if (!type || !isAccepted(type, file)) return

  const row = assetList.querySelector<HTMLElement>(`[data-name="${CSS.escape(name)}"]`)
  row?.classList.add('is-uploading')
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(type.id)}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file
    })
    const payload = (await response.json()) as { asset?: AssetItem; error?: string }
    if (!response.ok || !payload.asset) throw new Error(payload.error ?? 'The replacement failed.')
    type.items = type.items.map((asset) => (asset.name === name ? payload.asset! : asset))
    renderActiveType()
    showToast(`${friendlyName(name)} replaced successfully.`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The replacement failed.', 'error')
  } finally {
    row?.classList.remove('is-uploading')
  }
}

async function addAsset(file: File): Promise<void> {
  const type = currentType()
  if (!type || !isAccepted(type, file)) return
  const name = file.name

  addButton.disabled = true
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(type.id)}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file
    })
    const payload = (await response.json()) as { asset?: AssetItem; error?: string }
    if (!response.ok || !payload.asset) throw new Error(payload.error ?? 'The upload failed.')
    type.items = [...type.items, payload.asset].sort((a, b) => a.name.localeCompare(b.name))
    updateCounts(type)
    showToast(`${friendlyName(name)} added successfully.`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The upload failed.', 'error')
  } finally {
    addButton.disabled = false
  }
}

async function deleteAsset(name: string): Promise<void> {
  const type = currentType()
  if (!type || !window.confirm(`Delete ${name} from every configured copy?`)) return

  const row = assetList.querySelector<HTMLElement>(`[data-name="${CSS.escape(name)}"]`)
  row?.classList.add('is-uploading')
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(type.id)}/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error ?? 'The deletion failed.')
    }
    type.items = type.items.filter((asset) => asset.name !== name)
    updateCounts(type)
    showToast(`${friendlyName(name)} deleted.`, 'success')
  } catch (error) {
    row?.classList.remove('is-uploading')
    showToast(error instanceof Error ? error.message : 'The deletion failed.', 'error')
  }
}

function updateCounts(type: AssetType): void {
  type.count = type.items.length
  total.textContent = String(types.reduce((sum, entry) => sum + entry.count, 0))
  renderTypes()
  renderActiveType()
}

function isAccepted(type: AssetType, file: File): boolean {
  if (type.accept.toLowerCase().includes(file.name.slice(file.name.lastIndexOf('.')).toLowerCase())) return true
  showToast(`Choose a supported ${type.singular} file.`, 'error')
  return false
}

function currentType(): AssetType | undefined {
  return types.find((type) => type.id === activeTypeId)
}

function friendlyName(filename: string): string {
  return filename
    .replace(/^(SFX|VO)_/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replaceAll('_', ' ')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function showToast(message: string, kind: 'success' | 'error'): void {
  window.clearTimeout(toastTimer)
  toast.textContent = message
  toast.className = `toast is-visible toast-${kind}`
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600)
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

function escapeHtml(value: string): string {
  const span = document.createElement('span')
  span.textContent = value
  return span.innerHTML
}
