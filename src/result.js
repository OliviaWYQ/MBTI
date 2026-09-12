import { drawRadar } from './chart.js'
import { generateShareImage } from './share.js'
import QRCode from 'qrcode'

const LEVEL_LABEL = { L: '低', M: '中', H: '高' }
const LEVEL_CLASS = { L: 'level-low', M: 'level-mid', H: 'level-high' }

/** 领养证登记（本地 v1：localStorage；正式投放接表单服务） */
function setupAdoption(primary, config, priceIntent) {
  const input = document.getElementById('email-input')
  const btn = document.getElementById('btn-adopt')
  const note = document.getElementById('adopt-note')
  if (!input || !btn) return

  input.value = ''
  input.disabled = false
  btn.disabled = false
  btn.textContent = '登记领养证'
  note.textContent = '它预计明年上市，上市当天生成你的专属猫格领养证。'

  btn.onclick = async () => {
    const email = input.value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      note.textContent = '邮箱格式好像不太对，再检查一下？'
      return
    }
    const ch = new URLSearchParams(location.search).get('ch') || 'direct'
    const record = { email, code: primary.code, cn: primary.cn, ch, ts: new Date().toISOString() }
    if (priceIntent) Object.assign(record, priceIntent)

    // 有配置 key 则 POST 到表单服务（默认 Web3Forms），失败或未配置时降级 localStorage
    const endpoint = config.adoptEndpoint
    const accessKey = config.adoptKey
    let delivered = false
    if (endpoint && accessKey) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: accessKey, subject: `猫BTI领养证登记 ${primary.code}`, ...record }),
        })
        delivered = res.ok
      } catch (e) {
        delivered = false
      }
    }
    try {
      const key = 'maobi_adoptions'
      const list = JSON.parse(localStorage.getItem(key) || '[]')
      list.push({ ...record, delivered })
      localStorage.setItem(key, JSON.stringify(list))
    } catch (e) {
      console.warn('adoption persist failed', e)
    }
    input.disabled = true
    btn.disabled = true
    btn.textContent = '登记成功'
    note.textContent = accessKey && delivered
      ? `领养证排队中：${primary.code} · ${primary.cn}。上市当天见。`
      : `领养证排队中：${primary.code} · ${primary.cn}。（已本地记录）`
  }
}

/**
 * 渲染测试结果
 */
export function renderResult(result, userLevels, dimOrder, dimDefs, config) {
  const { primary, secondary, rankings, mode } = result
  const priceIntent = result.priceIntent || null

  // Kicker
  const kicker = document.getElementById('result-kicker')
  if (mode === 'hidden') kicker.textContent = '隐藏人格已激活'
  else if (mode === 'fallback') kicker.textContent = '系统强制兜底'
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

  // 领养证登记
  setupAdoption(primary, config, priceIntent)

  // 下载分享图
  const btnDownload = document.getElementById('btn-download')
  btnDownload.onclick = () => {
    generateShareImage(primary, userLevels, dimOrder, dimDefs, mode)
  }

  // 页面内二维码：扫码直达（带渠道码），与分享图底部 QR 一致
  const chParam = new URLSearchParams(location.search).get('ch')
  const pageUrl = 'https://oliviawyq.github.io/MBTI/' + (chParam ? `?ch=${chParam}` : '')
  const qrImg = document.getElementById('qr-onpage')
  if (qrImg) {
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
    })
  }
}
