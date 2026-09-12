/**
 * 猫BTI 评分引擎 — 纯函数，无 DOM 依赖
 * 基于 SBTI 引擎改写：四维度二极模型 + 每维独立阈值 + 平票随机
 * 平票随机：等距并列的类型按用户答案哈希播种随机排序，不引入固定字母偏好，
 * 保证"均匀答题 → 均匀分布"，让投放后的类型分布读数能反映真实人群结构
 */

/**
 * 按维度求和：每维度 2 题，分值相加
 * @param {Object} answers  { q1: 2, q3: 1, ... }
 * @param {Array}  questions 题目定义数组（仅计分题有有效 dim）
 * @returns {Object} { IE: 5, ND: 3, ... }
 */
export function calcDimensionScores(answers, questions) {
  const scores = {}
  for (const q of questions) {
    if (answers[q.id] == null) continue
    scores[q.dim] = (scores[q.dim] || 0) + answers[q.id]
  }
  return scores
}

/**
 * 原始分 → L/M/H 等级（支持每维独立阈值，缺省用全局 levelThresholds）
 * @param {Object} scores        { IE: 5, ... }
 * @param {Object} scoringConfig config.scoring
 * @returns {Object} { IE: 'H', ND: 'L', ... }
 */
export function scoresToLevels(scores, scoringConfig) {
  const { levelThresholds, dimThresholds } = scoringConfig
  const levels = {}
  for (const [dim, score] of Object.entries(scores)) {
    const th = (dimThresholds && dimThresholds[dim]) || levelThresholds
    if (score <= th.L[1]) levels[dim] = 'L'
    else if (score >= th.H[0]) levels[dim] = 'H'
    else levels[dim] = 'M'
  }
  return levels
}

/**
 * 等级 → 数值 (L=1, M=2, H=3)
 */
const LEVEL_NUM = { L: 1, M: 2, H: 3 }

/**
 * 解析人格类型的 pattern 字符串
 * "LHHH" → ['L','H','H','H']
 */
export function parsePattern(pattern) {
  return pattern.replace(/-/g, '').split('')
}

/**
 * 由用户等级向量生成确定性种子（同一画像 → 同一随机序列，重测/重渲染结果稳定）
 */
function seedFromLevels(userLevels, dimOrder) {
  const s = dimOrder.map((d) => userLevels[d] || '-').join('')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * mulberry32 伪随机数发生器
 */
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 混合两个种子（等级种子 × 用户答案种子，让平票随机因人而异）
 */
function mixSeed(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ b, 2654435761)
  h ^= h >>> 15
  return h >>> 0
}

/**
 * 计算用户向量与类型 pattern 的曼哈顿距离
 * @param {Object} userLevels  { IE: 'H', ND: 'L', ... }
 * @param {Array}  dimOrder    ['IE','ND','MF','RP']
 * @param {string} pattern     "LHHH"
 * @returns {{ distance: number, exact: number, similarity: number }}
 */
export function matchType(userLevels, dimOrder, pattern) {
  const typeLevels = parsePattern(pattern)
  const maxDistance = dimOrder.length * 2
  let distance = 0
  let exact = 0

  for (let i = 0; i < dimOrder.length; i++) {
    const userVal = LEVEL_NUM[userLevels[dimOrder[i]]] || 2
    const typeVal = LEVEL_NUM[typeLevels[i]] || 2
    const diff = Math.abs(userVal - typeVal)
    distance += diff
    if (diff === 0) exact++
  }

  const similarity = Math.max(0, Math.round((1 - distance / maxDistance) * 100))
  return { distance, exact, similarity }
}

/**
 * 平票随机：等距并列时使用的确定性随机键（无字母偏好，见文件头注释）
 */
function tieRoll(seed, code) {
  let h = seed
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return mulberry32(h >>> 0)()
}

/**
 * 匹配所有类型，排序，应用特殊覆盖
 * @param {Object}  userLevels     { IE: 'H', ... }
 * @param {Array}   dimOrder       维度顺序
 * @param {Array}   standardTypes  标准类型数组
 * @param {Array}   specialTypes   特殊类型数组
 * @param {Object}  options        { isCatPerson: boolean }
 * @param {Object}  scoringConfig  config.scoring（fallbackThreshold；tieBreak 已废弃，平票改随机）
 * @param {Object}  specialCodes   config.specialCodes { hidden, fallback }
 * @returns {{ primary: Object, secondary: Object|null, rankings: Array, mode: string }}
 */
export function determineResult(userLevels, dimOrder, standardTypes, specialTypes, options = {}, scoringConfig = {}, specialCodes = {}) {
  // 平票随机种子：等级向量 × 用户答案（options.userSeed）混合——
  // 同一用户重测稳定，不同用户在相同等级向量下平票结果各异，保证均匀答题→均匀分布
  const seed = options.userSeed != null
    ? mixSeed(seedFromLevels(userLevels, dimOrder), options.userSeed)
    : seedFromLevels(userLevels, dimOrder)
  const rankings = standardTypes.map((type) => ({
    ...type,
    ...matchType(userLevels, dimOrder, type.pattern),
    _roll: tieRoll(seed, type.code),
  }))

  // 排序：距离升序 → 精准命中降序 → 平票随机（无字母偏好，保证均匀答题→均匀分布）
  rankings.sort((a, b) =>
    a.distance - b.distance ||
    b.exact - a.exact ||
    a._roll - b._roll
  )

  const best = rankings[0]
  const hidden = specialTypes.find((t) => t.code === (specialCodes.hidden || 'CAT-H'))
  const stray = specialTypes.find((t) => t.code === (specialCodes.fallback || 'STRAY'))
  const fallbackThreshold = scoringConfig.fallbackThreshold ?? 60

  // 先用基础相似度决定模式（兜底判断不受展示微调影响）
  let primary, secondary, mode
  if (options.isCatPerson && hidden) {
    primary = { ...hidden, exact: best.exact }
    secondary = best
    mode = 'hidden'
  } else if (best.similarity < fallbackThreshold && stray) {
    primary = { ...stray, exact: best.exact }
    secondary = best
    mode = 'fallback'
  } else {
    primary = best
    secondary = rankings[1] || null
    mode = 'normal'
  }

  // 展示用匹配度：基础值 + 精准命中微调，再按名次保证严格递减，打散并列
  //（只影响显示的数字，不回溯排序与兜底判断）
  const maxDistance = dimOrder.length * 2
  let prevSim = 101
  for (const r of rankings) {
    const base = Math.max(1, Math.round((1 - r.distance / maxDistance) * 100 + r.exact * 2))
    r.similarity = Math.max(1, Math.min(prevSim - 1, base, 100))
    prevSim = r.similarity
  }
  if (mode !== 'normal') primary.similarity = best.similarity

  return { primary, secondary, rankings, mode }
}
