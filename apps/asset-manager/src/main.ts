import './styles.css'

interface AssetItem {
  name: string
  bytes: number
  updatedAt: string
  filter: string
  badge: string
}

interface AssetFilter {
  id: string
  label: string
}

interface AssetType {
  id: string
  label: string
  singular: string
  description: string
  accept: string
  preview: 'audio' | 'none'
  maxBytes: number
  filters: AssetFilter[]
  count: number
  items: AssetItem[]
}

const typeList = requiredElement<HTMLElement>('type-list')
const assetList = requiredElement<HTMLDivElement>('asset-list')
const search = requiredElement<HTMLInputElement>('search')
const picker = requiredElement<HTMLInputElement>('file-picker')
const filters = requiredElement<HTMLDivElement>('filters')
const total = requiredElement<HTMLElement>('asset-total')
const activeTitle = requiredElement<HTMLElement>('active-title')
const activeDescription = requiredElement<HTMLElement>('active-description')
const activeCount = requiredElement<HTMLElement>('active-count')
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

void loadCatalogue()

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

picker.addEventListener('change', () => {
  const file = picker.files?.[0]
  const target = replacementTarget
  picker.value = ''
  if (file && target) void replaceAsset(target, file)
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
        <span class="type-icon" aria-hidden="true">${type.id === 'sounds' ? '◖' : '◆'}</span>
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
  formatNote.textContent = `${type.accept.split(',')[0].toUpperCase()} · ${formatBytes(type.maxBytes)} max`
  picker.accept = type.accept

  filters.replaceChildren(
    ...type.filters.map((filter) => {
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
    (asset) => (activeFilter === 'all' || asset.filter === activeFilter) && asset.name.toLowerCase().includes(query)
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
  identity.innerHTML = `
    <span class="asset-chip asset-chip-${asset.filter}">${escapeHtml(asset.badge)}</span>
    <span class="asset-name"><strong>${escapeHtml(friendlyName(asset.name))}</strong><small>${escapeHtml(asset.name)}</small></span>
  `

  const size = document.createElement('span')
  size.className = 'asset-size'
  size.textContent = formatBytes(asset.bytes)

  const actions = document.createElement('div')
  actions.className = 'asset-actions'

  if (type.preview === 'audio') {
    const play = document.createElement('button')
    play.className = 'play-button'
    play.type = 'button'
    play.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'
    play.setAttribute('aria-label', `Play ${friendlyName(asset.name)}`)
    play.addEventListener('click', () => togglePlayback(type, asset, play))
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

  actions.append(replace)
  row.append(identity, size, actions)
  return row
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
  player.src = `/api/assets/${encodeURIComponent(type.id)}/${encodeURIComponent(asset.name)}?v=${encodeURIComponent(asset.updatedAt)}`
  void player.play().catch(() => {
    stopPlaybackState()
    showToast(`This ${type.singular} could not be played.`, 'error')
  })
}

function stopPlaybackState(): void {
  if (!playingButton) return
  playingButton.classList.remove('is-playing')
  playingButton.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'
  playingButton = undefined
}

async function replaceAsset(name: string, file: File): Promise<void> {
  const type = currentType()
  if (!type) return
  if (!type.accept.toLowerCase().includes(file.name.slice(file.name.lastIndexOf('.')).toLowerCase())) {
    showToast(`Choose a supported ${type.singular} file.`, 'error')
    return
  }

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
    renderItems()
    showToast(`${friendlyName(name)} replaced successfully.`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'The replacement failed.', 'error')
  } finally {
    row?.classList.remove('is-uploading')
  }
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
