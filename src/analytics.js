// Lightweight funnel: local history + optional JSON collector. Never includes email.
export function newId() {
  return globalThis.crypto?.randomUUID?.() || `r${Date.now()}${Math.random().toString(36).slice(2)}`
}

export function getSource(search = location.search) {
  const params = new URLSearchParams(search)
  const source = {}
  for (const key of ['ch', 'utm_source', 'utm_medium', 'utm_campaign', 'via']) {
    const value = params.get(key)
    if (value) source[key] = value.slice(0, 120)
  }
  source.ch ||= source.utm_source || 'direct'
  return source
}

export function shareUrl(via) {
  const url = new URL(import.meta.env.BASE_URL, location.origin)
  for (const [key, value] of Object.entries(getSource())) url.searchParams.set(key, value)
  url.searchParams.set('via', via)
  return url.href
}

export function saveLocal(key, record, limit = 200) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]')
    const list = Array.isArray(stored) ? stored : []
    localStorage.setItem(key, JSON.stringify([...list, record].slice(-limit)))
    return true
  } catch { return false }
}

export async function postJSON(endpoint, record) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(record), signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    if (body.success !== true) throw new Error('Submission not confirmed')
    return true
  } finally { clearTimeout(timer) }
}

export function createAnalytics(config) {
  const visitId = newId()
  const source = getSource()
  let runId = null
  return {
    source,
    start() { runId = newId(); this.track('quiz_start'); return runId },
    track(event, details = {}, eventRunId = runId) {
      const record = { ...details, event, event_id: newId(), visit_id: visitId, run_id: eventRunId, ...source, ts: new Date().toISOString() }
      saveLocal('maobi_events', record, 500)
      // Separate from the email form service: configure a collector for aggregate funnels.
      if (config.analyticsEndpoint) {
        fetch(config.analyticsEndpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record), keepalive: true,
        }).then(res => { if (!res.ok) console.warn('Analytics delivery failed') })
          .catch(() => console.warn('Analytics delivery failed'))
      }
    },
  }
}
