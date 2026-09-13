import { getSource, shareUrl, saveLocal, postJSON } from './analytics.js'
import { drawRadar } from './chart.js'
import { generateShareImage } from './share.js'
import QRCode from 'qrcode'

const LEVEL_LABEL = { L: '低', M: '中', H: '高' }
const LEVEL_CLASS = { L: 'level-low', M: 'level-mid', H: 'level-high' }

const PREFERENCES = [
  ['recognize_me', '认得我，记住我们的小习惯'],
  ['chat', '陪我聊天，接住我的碎碎念'],
  ['move', '自己走动，探索身边的小世界'],
  ['personality', '有自己的性格，偶尔有点小脾气'],
  ['affection', '会撒娇，摸摸就有回应'],
  ['customize', '能换外观，打扮成我的专属猫'],
  ['quiet_company', '安静待在身边，陪着就好'],
]

async function submitRecord(config, kind, record) {
  if (!config.adoptEndpoint || !config.adoptKey) return false
  try {
    return await postJSON(config.adoptEndpoint, {
      access_key: config.adoptKey, subject: `猫BTI ${kind} ${record.code}`,
      kind, ...record,
    })
  } catch { return false }
}

function setupPreference(config, record, analytics) {
  const form = document.getElementById('preference-form')
  const options = document.getElementById('preference-options')
  const btn = document.getElementById('btn-preference')
  const status = document.getElementById('preference-status')
  options.querySelectorAll('label').forEach(el => el.remove())
  options.disabled = false
  btn.disabled = false
  btn.textContent = '许个愿'
  status.textContent = '可以直接跳过，继续看你的猫格 ↓'
  for (const [value, text] of PREFERENCES) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'product_preference'
    input.value = value
    label.append(input, document.createTextNode(text))
    options.append(label)
  }
  form.onsubmit = async event => {
    event.preventDefault()
    if (btn.disabled) return
    const selected = new FormData(form).get('product_preference')
    if (!selected) { status.textContent = '选一个最心动的，或直接跳过就好。'; return }
    record.product_preference = selected
    record.product_preference_label = PREFERENCES.find(([value]) => value === selected)[1]
    btn.disabled = true
    options.disabled = true
    btn.textContent = '愿望传送中…'
    const snapshot = { ...record, ts: new Date().toISOString() }
    const stored = saveLocal('maobi_preferences', snapshot)
    analytics.track('product_preference', { preference: selected, code: record.code }, record.run_id)
    const delivered = await submitRecord(config, 'product_preference', snapshot)
    analytics.track('preference_delivery', { delivered }, record.run_id)
    if (form.dataset.runId !== record.run_id) return
    if (delivered) {
      btn.textContent = '愿望已收到'
      status.textContent = '谢谢！这份小心愿会帮我们打磨未来的机器猫。'
    } else {
      btn.disabled = false
      options.disabled = false
      btn.textContent = '重新发送愿望'
      status.textContent = stored ? '愿望已保存在这台设备，暂未送达，可重试或继续看猫格。' : '愿望暂未送达，请重试或继续看猫格。'
    }
  }
  form.dataset.runId = record.run_id
}

function setupAdoption(config, record, analytics) {
  const form = document.getElementById('adopt-form')
  const input = document.getElementById('email-input')
  const btn = document.getElementById('btn-adopt')
  const note = document.getElementById('adopt-note')
  form.dataset.runId = record.run_id
  input.value = ''
  input.disabled = false
  btn.disabled = false
  btn.textContent = '登记领养证'
  note.textContent = '机器猫首批开放体验时，通知你来领取专属猫格领养证。'
  form.onsubmit = async event => {
    event.preventDefault()
    if (btn.disabled) return
    const email = input.value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      note.textContent = '邮箱格式好像不太对，再检查一下？'
      input.focus()
      return
    }
    btn.disabled = true
    input.disabled = true
    btn.textContent = '登记中…'
    analytics.track('adoption_submit', { code: record.code }, record.run_id)
    // Snapshot preferences at submission time; later preferences still join by run_id.
    const snapshot = { ...record, email, ts: new Date().toISOString() }
    const delivered = await submitRecord(config, 'adoption', snapshot)
    analytics.track(delivered ? 'adoption_success' : 'adoption_failure', { code: record.code }, record.run_id)
    // Do not persist contact information on a shared device.
    saveLocal('maobi_adoptions', { run_id: record.run_id, code: record.code, delivered, ts: snapshot.ts })
    if (form.dataset.runId !== record.run_id) return
    btn.disabled = delivered
    input.disabled = delivered
    btn.textContent = delivered ? '登记成功' : '重新登记'
    note.textContent = delivered
      ? `领养证排队中：${record.code} · ${record.cn}。首批开放体验时邮件通知你。`
      : '暂未登记成功，请稍后重试；只有成功送达后才能收到通知。'
  }
}

/**
 * 渲染测试结果
 */
export function renderResult(result, userLevels, dimOrder, dimDefs, config, analytics) {
  const { primary, secondary, rankings, mode } = result
  const priceIntent = result.priceIntent || null

  // Kicker
  const kicker = document.getElementById('result-kicker')
  if (mode === 'hidden') kicker.textContent = '隐藏人格已激活'
  else if (mode === 'fallback') kicker.textContent = '不被定义的自由猫格'
  else kicker.textContent = '你的主猫格'

  // 主类型
  document.getElementById('result-code').textContent = primary.code
  document.getElementById('result-name').textContent = primary.cn

  // 匹配度
  document.getElementById('result-badge').textContent =
    `匹配度 ${primary.similarity}%` + (primary.exact != null ? ` · 精准命中 ${primary.exact}/${dimOrder.length} 维` : '')

  // Intro & 描述（desc 支持 \n 分段）
  document.getElementById('result-intro').textContent = primary.intro || ''
  const descEl = document.getElementById('result-desc')
  descEl.innerHTML = ''
  ;(primary.desc || '').split('\n').filter((p) => p.trim()).forEach((para) => {
    const p = document.createElement('p')
    p.textContent = para
    descEl.appendChild(p)
  })

  // 次要匹配
  const secEl = document.getElementById('result-secondary')
  if (secondary && (mode === 'hidden' || mode === 'fallback')) {
    secEl.style.display = ''
    const labelEl = secEl.querySelector('.secondary-label')
    if (labelEl) {
      labelEl.textContent = mode === 'hidden' ? '你本来会是' : '最接近的猫格'
    }
    document.getElementById('secondary-info').textContent =
      `${secondary.code}（${secondary.cn}）· 匹配度 ${secondary.similarity}%`
  } else {
    secEl.style.display = 'none'
  }

  // 雷达图
  const canvas = document.getElementById('radar-chart')
  drawRadar(canvas, userLevels, dimOrder, dimDefs)

  // 维度详情
  const detailEl = document.getElementById('dimensions-detail')
  detailEl.innerHTML = ''
  for (const dim of dimOrder) {
    const level = userLevels[dim] || 'M'
    const def = dimDefs[dim]
    if (!def) continue

    const row = document.createElement('div')
    row.className = 'dim-row'
    row.innerHTML = `
      <div class="dim-header">
        <span class="dim-name">${def.name}</span>
        <span class="dim-level ${LEVEL_CLASS[level]}">${LEVEL_LABEL[level]}</span>
      </div>
      <div class="dim-desc">${def.levels[level]}</div>
    `
    detailEl.appendChild(row)
  }

  // TOP 5
  const topEl = document.getElementById('top-list')
  topEl.innerHTML = ''
  const top5 = rankings.slice(0, 5)
  top5.forEach((t, i) => {
    const item = document.createElement('div')
    item.className = 'top-item'
    item.innerHTML = `
      <span class="top-rank">#${i + 1}</span>
      <span class="top-code">${t.code}</span>
      <span class="top-name">${t.cn}</span>
      <span class="top-sim">${t.similarity}%</span>
    `
    topEl.appendChild(item)
  })

  // 免责声明
  document.getElementById('disclaimer').textContent =
    mode === 'normal' ? config.display.funNote : config.display.funNoteSpecial

  const runId = result.runId
  const record = {
    run_id: runId, code: primary.code, cn: primary.cn, mode,
    ...getSource(), levels: dimOrder.map(d => userLevels[d] || 'M').join(''),
    answers: JSON.stringify(result.answers || {}), ...priceIntent,
    product_preference: null, ts: new Date().toISOString(),
  }
  submitRecord(config, 'anonymous_result', record).then(delivered => {
    analytics.track('anonymous_delivery', { delivered }, runId)
  })
  setupPreference(config, record, analytics)
  setupAdoption(config, record, analytics)

  const shareStatus = document.getElementById('share-status')
  shareStatus.textContent = ''
  const btnDownload = document.getElementById('btn-download')
  btnDownload.disabled = false
  btnDownload.textContent = '保存分享图片'
  btnDownload.onclick = async () => {
    btnDownload.disabled = true
    analytics.track('share_image_click', {}, runId)
    try {
      await generateShareImage(primary, userLevels, dimOrder, dimDefs, mode)
      analytics.track('share_image_generated', {}, runId)
      shareStatus.textContent = '图片已生成；若未自动保存，请检查浏览器下载。'
    } catch {
      analytics.track('share_image_failure', {}, runId)
      shareStatus.textContent = '图片生成失败，请重试，或复制测试链接。'
    } finally { btnDownload.disabled = false }
  }
  document.getElementById('btn-copy-link').onclick = async () => {
    analytics.track('share_link_click', {}, runId)
    try {
      await navigator.clipboard.writeText(shareUrl('share_link'))
      analytics.track('share_link_copied', {}, runId)
      shareStatus.textContent = '链接已复制，发给朋友一起测吧。'
    } catch { shareStatus.textContent = '暂时无法复制，可分享下方二维码。' }
  }

  const pageUrl = shareUrl('result_qr')
  const qrImg = document.getElementById('qr-onpage')
  if (qrImg) {
    qrImg.style.display = ''
    QRCode.toDataURL(pageUrl, { margin: 1, width: 296 })
      .then((u) => { qrImg.src = u })
      .catch(() => { qrImg.style.display = 'none' })
  }
  const qrLink = document.getElementById('qr-link')
  if (qrLink) qrLink.textContent = pageUrl.replace(/^https:\/\//, '')

  // 复制开源部署命令（保留原项目出处）
  const btnAgent = document.getElementById('btn-agent')
  btnAgent.onclick = () => {
    const cmd = `git clone https://github.com/OliviaWYQ/MBTI.git && cd MBTI && npm install && npm run dev`
    navigator.clipboard.writeText(cmd).then(() => {
      btnAgent.textContent = '已复制!'
      setTimeout(() => { btnAgent.textContent = '复制一键部署命令' }, 2000)
    }).catch(() => { btnAgent.textContent = '复制失败，请手动复制上方命令' })
  }
}
