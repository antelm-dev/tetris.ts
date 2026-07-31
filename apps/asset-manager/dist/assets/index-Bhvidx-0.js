;(function () {
  const t = document.createElement('link').relList
  if (t && t.supports && t.supports('modulepreload')) return
  for (const a of document.querySelectorAll('link[rel="modulepreload"]')) r(a)
  new MutationObserver((a) => {
    for (const s of a)
      if (s.type === 'childList')
        for (const o of s.addedNodes) o.tagName === 'LINK' && o.rel === 'modulepreload' && r(o)
  }).observe(document, { childList: !0, subtree: !0 })
  function n(a) {
    const s = {}
    return (
      a.integrity && (s.integrity = a.integrity),
      a.referrerPolicy && (s.referrerPolicy = a.referrerPolicy),
      a.crossOrigin === 'use-credentials'
        ? (s.credentials = 'include')
        : a.crossOrigin === 'anonymous'
          ? (s.credentials = 'omit')
          : (s.credentials = 'same-origin'),
      s
    )
  }
  function r(a) {
    if (a.ep) return
    a.ep = !0
    const s = n(a)
    fetch(a.href, s)
  }
})()
const N = i('type-list'),
  w = i('asset-list'),
  d = i('search'),
  m = i('file-picker'),
  k = i('filters'),
  H = i('asset-total'),
  I = i('active-title'),
  P = i('active-description'),
  S = i('active-count'),
  O = i('format-note'),
  B = i('empty-state'),
  $ = i('toast')
let f = [],
  h = '',
  v = 'all',
  x,
  p,
  T
const c = new Audio()
c.preload = 'metadata'
c.addEventListener('ended', u)
c.addEventListener('pause', u)
c.addEventListener('error', () => {
  ;(u(), y('This asset could not be played.', 'error'))
})
R()
d.addEventListener('input', L)
d.addEventListener('keydown', (e) => {
  e.key === 'Escape' && ((d.value = ''), L())
})
document.addEventListener('keydown', (e) => {
  e.key === '/' && document.activeElement !== d && (e.preventDefault(), d.focus())
})
m.addEventListener('change', () => {
  const e = m.files?.[0],
    t = x
  ;((m.value = ''), e && t && F(t, e))
})
async function R() {
  try {
    const e = await fetch('/api/assets', { cache: 'no-store' })
    if (!e.ok) throw new Error('Asset catalogue request failed')
    ;((f = (await e.json()).types),
      (h = f[0]?.id ?? ''),
      (H.textContent = String(f.reduce((n, r) => n + r.count, 0))),
      M(),
      C())
  } catch {
    ;((N.innerHTML = '<p class="sidebar-error">Catalogue unavailable</p>'),
      (w.innerHTML =
        '<div class="error-state"><strong>Could not load game assets.</strong><span>Start the asset manager and try again.</span></div>'))
  }
}
function M() {
  N.replaceChildren(
    ...f.map((e) => {
      const t = document.createElement('button')
      return (
        (t.type = 'button'),
        (t.className = `type-button${e.id === h ? ' is-active' : ''}`),
        (t.innerHTML = `
        <span class="type-icon" aria-hidden="true">${e.id === 'sounds' ? '◖' : '◆'}</span>
        <span><strong>${g(e.label)}</strong><small>${e.count} assets</small></span>
        <em>${e.count}</em>
      `),
        t.addEventListener('click', () => {
          ;((h = e.id), (v = e.filters[0]?.id ?? 'all'), (d.value = ''), u(), M(), C())
        }),
        t
      )
    })
  )
}
function C() {
  const e = b()
  e &&
    ((I.textContent = e.label),
    (P.textContent = e.description),
    (S.textContent = String(e.count)),
    (O.textContent = `${e.accept.split(',')[0].toUpperCase()} · ${A(e.maxBytes)} max`),
    (m.accept = e.accept),
    k.replaceChildren(
      ...e.filters.map((t) => {
        const n = document.createElement('button')
        return (
          (n.type = 'button'),
          (n.className = `filter${t.id === v ? ' is-active' : ''}`),
          (n.textContent = t.label),
          n.addEventListener('click', () => {
            ;((v = t.id), C())
          }),
          n
        )
      })
    ),
    L())
}
function L() {
  const e = b()
  if (!e) return
  const t = d.value.trim().toLowerCase(),
    n = e.items.filter((r) => (v === 'all' || r.filter === v) && r.name.toLowerCase().includes(t))
  ;(w.replaceChildren(...n.map((r) => U(e, r))), (B.hidden = n.length !== 0 || e.items.length === 0))
}
function U(e, t) {
  const n = document.createElement('article')
  ;((n.className = 'asset-row'), (n.dataset.name = t.name))
  const r = document.createElement('div')
  ;((r.className = 'asset-identity'),
    (r.innerHTML = `
    <span class="asset-chip asset-chip-${t.filter}">${g(t.badge)}</span>
    <span class="asset-name"><strong>${g(E(t.name))}</strong><small>${g(t.name)}</small></span>
  `))
  const a = document.createElement('span')
  ;((a.className = 'asset-size'), (a.textContent = A(t.bytes)))
  const s = document.createElement('div')
  if (((s.className = 'asset-actions'), e.preview === 'audio')) {
    const l = document.createElement('button')
    ;((l.className = 'play-button'),
      (l.type = 'button'),
      (l.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'),
      l.setAttribute('aria-label', `Play ${E(t.name)}`),
      l.addEventListener('click', () => q(e, t, l)),
      s.append(l))
  }
  const o = document.createElement('button')
  return (
    (o.className = 'replace-button'),
    (o.type = 'button'),
    (o.innerHTML = '<span aria-hidden="true">↥</span><span>Replace</span>'),
    o.addEventListener('click', () => {
      ;((x = t.name), m.click())
    }),
    s.append(o),
    n.append(r, a, s),
    n
  )
}
function q(e, t, n) {
  if (p === n && !c.paused) {
    c.pause()
    return
  }
  ;(u(),
    (p = n),
    n.classList.add('is-playing'),
    (n.innerHTML = '<span aria-hidden="true">■</span><span>Stop</span>'),
    (c.src = `/api/assets/${encodeURIComponent(e.id)}/${encodeURIComponent(t.name)}?v=${encodeURIComponent(t.updatedAt)}`),
    c.play().catch(() => {
      ;(u(), y(`This ${e.singular} could not be played.`, 'error'))
    }))
}
function u() {
  p &&
    (p.classList.remove('is-playing'),
    (p.innerHTML = '<span aria-hidden="true">▶</span><span>Play</span>'),
    (p = void 0))
}
async function F(e, t) {
  const n = b()
  if (!n) return
  if (!n.accept.toLowerCase().includes(t.name.slice(t.name.lastIndexOf('.')).toLowerCase())) {
    y(`Choose a supported ${n.singular} file.`, 'error')
    return
  }
  const r = w.querySelector(`[data-name="${CSS.escape(e)}"]`)
  r?.classList.add('is-uploading')
  try {
    const a = await fetch(`/api/assets/${encodeURIComponent(n.id)}/${encodeURIComponent(e)}`, {
        method: 'PUT',
        headers: { 'content-type': t.type || 'application/octet-stream' },
        body: t
      }),
      s = await a.json()
    if (!a.ok || !s.asset) throw new Error(s.error ?? 'The replacement failed.')
    ;((n.items = n.items.map((o) => (o.name === e ? s.asset : o))), L(), y(`${E(e)} replaced successfully.`, 'success'))
  } catch (a) {
    y(a instanceof Error ? a.message : 'The replacement failed.', 'error')
  } finally {
    r?.classList.remove('is-uploading')
  }
}
function b() {
  return f.find((e) => e.id === h)
}
function E(e) {
  return e
    .replace(/^(SFX|VO)_/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replaceAll('_', ' ')
}
function A(e) {
  return e >= 1024 * 1024 ? `${Math.round(e / 1024 / 1024)} MB` : e >= 1024 ? `${(e / 1024).toFixed(1)} KB` : `${e} B`
}
function y(e, t) {
  ;(window.clearTimeout(T),
    ($.textContent = e),
    ($.className = `toast is-visible toast-${t}`),
    (T = window.setTimeout(() => $.classList.remove('is-visible'), 3600)))
}
function i(e) {
  const t = document.getElementById(e)
  if (!t) throw new Error(`Missing #${e}`)
  return t
}
function g(e) {
  const t = document.createElement('span')
  return ((t.textContent = e), t.innerHTML)
}
