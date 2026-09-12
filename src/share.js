/**
 * 生成分享图片 — Canvas 绘制 + qrcode 生成底部二维码
 */
import QRCode from 'qrcode'

const LEVEL_NUM = { L: 1, M: 2, H: 3 }
const LEVEL_LABEL = { L: '低', M: '中', H: '高' }

// 猫BTI 暖橙主题
const C = {
  bg: '#faf3ea',
  card: '#ffffff',
  text: '#3d2b1f',
  textSecondary: '#8a7360',
  accent: '#d96c2f',
  accentLight: '#fbe8d8',
  accentDeep: '#b8551f',
}

/**
 * 生成分享卡片并下载
 */
export async function generateShareImage(primary, userLevels, dimOrder, dimDefs, mode) {
  const dpr = 2
  const W = 720
  // 先画在超高画布上量内容高度，再裁剪，避免底部大片空白
  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = 10000 * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  // 背景
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, 10000)

  // 卡片白底
  const cardX = 32, cardY = 32, cardW = W - 64, cardH = 10000 - 64
  roundRect(ctx, cardX, cardY, cardW, cardH, 20)
  ctx.fillStyle = C.card
  ctx.fill()
  ctx.shadowColor = 'transparent'

  let y = cardY + 48

  // Kicker
  ctx.textAlign = 'center'
  ctx.font = '400 22px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = C.textSecondary
  const kickerText = mode === 'hidden' ? '隐藏人格已激活' : mode === 'fallback' ? '系统强制兜底' : '你的主猫格'
  ctx.fillText(kickerText, W / 2, y)
  y += 56

  // 类型代码
  ctx.font = '900 72px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = C.accent
  ctx.fillText(primary.code, W / 2, y)
  y += 40

  // 中文名
  ctx.font = '600 32px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = C.text
  ctx.fillText(primary.cn, W / 2, y)
  y += 36

  // 匹配度徽章
  const badgeText = `匹配度 ${primary.similarity}%` + (primary.exact != null ? ` · 精准命中 ${primary.exact}/${dimOrder.length} 维` : '')
  ctx.font = '500 20px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  const badgeW = ctx.measureText(badgeText).width + 40
  roundRect(ctx, (W - badgeW) / 2, y - 16, badgeW, 36, 18)
  ctx.fillStyle = C.accentLight
  ctx.fill()
  ctx.fillStyle = C.accentDeep
  ctx.fillText(badgeText, W / 2, y + 6)
  y += 44

  // Intro
  ctx.font = 'italic 600 22px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = C.text
  const introLines = wrapText(ctx, primary.intro || '', cardW - 80)
  for (const line of introLines) {
    ctx.fillText(line, W / 2, y)
    y += 30
  }
  y += 16

  // 雷达图
  const radarCx = W / 2
  const radarCy = y + 150
  const radarR = 130
  drawShareRadar(ctx, radarCx, radarCy, radarR, userLevels, dimOrder, dimDefs)
  y = radarCy + radarR + 40

  // 维度条形图
  y += 10
  ctx.textAlign = 'left'
  const barX = cardX + 48
  const barMaxW = cardW - 96
  const dimNameW = 110

  for (const dim of dimOrder) {
    const level = userLevels[dim] || 'M'
    const val = LEVEL_NUM[level]
    const def = dimDefs[dim]
    if (!def) continue

    const name = def.name.replace(/^[A-Za-z0-9]+\s*/, '')

    // 维度名
    ctx.font = '600 16px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = C.text
    ctx.fillText(name, barX, y)

    // 进度条背景
    const progX = barX + dimNameW
    const progW = barMaxW - dimNameW - 50
    const progH = 12
    roundRect(ctx, progX, y - 10, progW, progH, 6)
    ctx.fillStyle = C.accentLight
    ctx.fill()

    // 进度条填充
    const fillW = (val / 3) * progW
    roundRect(ctx, progX, y - 10, fillW, progH, 6)
    ctx.fillStyle = val === 3 ? C.accent : val === 2 ? C.textSecondary : C.accentDeep
    ctx.fill()

    // 等级标签
    ctx.textAlign = 'right'
    ctx.font = '600 14px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = val === 3 ? C.accent : val === 2 ? C.textSecondary : C.accentDeep
    ctx.fillText(LEVEL_LABEL[level], barX + barMaxW, y)
    ctx.textAlign = 'left'

    y += 26
  }

  y += 16

  // 描述正文（跳过第 1 段——和卡片顶部的代码/徽章重复，从第 2 段开始画）
  const paras = (primary.desc || '').split('\n').map((p) => p.trim()).filter(Boolean)
  const bodyParas = paras.length > 1 ? paras.slice(1) : paras
  if (bodyParas.length) {
    y += 10
    ctx.textAlign = 'left'
    ctx.font = '400 20px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = C.textSecondary
    const textX = cardX + 56
    const textMaxW = cardW - 112
    for (const para of bodyParas) {
      const lines = wrapText(ctx, para, textMaxW)
      for (const line of lines) {
        ctx.fillText(line, textX, y)
        y += 32
      }
      y += 12
    }
    y -= 12
  }

  // 底部：带渠道码的直达链接 + 二维码（用户转发图片时，收图人扫码即归入对应渠道）
  const contentBottom = y
  const H = Math.max(contentBottom + 218, 900)
  const chParam = new URLSearchParams(location.search).get('ch')
  const pageUrl = 'https://oliviawyq.github.io/MBTI/' + (chParam ? `?ch=${chParam}` : '')

  // 二维码（生成失败不阻塞，仍保留文字链接）
  try {
    const qrDataUrl = await QRCode.toDataURL(pageUrl, { margin: 0, width: 240 })
    const qrImg = new Image()
    await new Promise((res, rej) => { qrImg.onload = res; qrImg.onerror = rej; qrImg.src = qrDataUrl })
    const qrSize = 96
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(qrImg, (W - qrSize) / 2, H - cardY - 66 - qrSize, qrSize, qrSize)
    ctx.imageSmoothingEnabled = true
  } catch (e) {
    console.warn('QR generate failed', e)
  }

  ctx.textAlign = 'center'
  ctx.font = '400 15px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#c9b8a6'
  ctx.fillText(pageUrl.replace(/^https:\/\//, ''), W / 2, H - cardY - 48)

  // 水印
  ctx.font = '400 18px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('猫BTI · 仅供娱乐', W / 2, H - cardY - 24)

  // 按内容高度裁剪
  const final = document.createElement('canvas')
  final.width = W * dpr
  final.height = H * dpr
  final.getContext('2d').drawImage(canvas, 0, 0, W * dpr, H * dpr, 0, 0, W * dpr, H * dpr)

  // 下载
  const link = document.createElement('a')
  link.download = `猫BTI-${primary.code}.png`
  link.href = final.toDataURL('image/png')
  link.click()

  return final
}

/**
 * 在分享图上绘制雷达图
 */
function drawShareRadar(ctx, cx, cy, maxR, userLevels, dimOrder, dimDefs) {
  const n = dimOrder.length
  const step = (Math.PI * 2) / n
  const start = -Math.PI / 2

  // 背景圆环
  for (let lv = 3; lv >= 1; lv--) {
    const r = (lv / 3) * maxR
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = lv === 3 ? 'rgba(217,108,47,0.06)' : lv === 2 ? 'rgba(217,108,47,0.04)' : 'rgba(217,108,47,0.02)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(217,108,47,0.12)'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  // 轴线 + 标签
  ctx.font = '400 12px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < n; i++) {
    const angle = start + i * step
    const x = cx + Math.cos(angle) * maxR
    const y = cy + Math.sin(angle) * maxR
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(x, y)
    ctx.strokeStyle = 'rgba(217,108,47,0.1)'
    ctx.lineWidth = 0.5
    ctx.stroke()

    const lr = maxR + 24
    const lx = cx + Math.cos(angle) * lr
    const ly = cy + Math.sin(angle) * lr
    const label = (dimDefs[dimOrder[i]]?.name || dimOrder[i]).replace(/^[A-Za-z0-9]+\s*/, '')
    ctx.fillStyle = C.textSecondary
    ctx.fillText(label, lx, ly)
  }

  // 数据多边形
  const values = dimOrder.map((d) => LEVEL_NUM[userLevels[d]] || 2)
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const angle = start + i * step
    const r = (values[i] / 3) * maxR
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(217,108,47,0.2)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(217,108,47,0.6)'
  ctx.lineWidth = 2
  ctx.stroke()

  // 数据点
  for (let i = 0; i < n; i++) {
    const angle = start + i * step
    const r = (values[i] / 3) * maxR
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = C.accent
    ctx.fill()
  }
}

/**
 * 圆角矩形
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * 文字自动换行
 */
function wrapText(ctx, text, maxWidth) {
  if (!text) return []
  const NO_BREAK_BEFORE = '。，！？；：、）》」』”’…'
  const lines = []
  let line = ''
  for (const char of text) {
    const test = line + char
    if (ctx.measureText(test).width > maxWidth && line && !NO_BREAK_BEFORE.includes(char)) {
      lines.push(line)
      line = char
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}
