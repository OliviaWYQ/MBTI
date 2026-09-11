/**
 * 猫BTI 评分引擎 — 纯函数，无 DOM 依赖
 * 基于 SBTI 引擎改写：四维度二极模型 + 每维独立阈值 + 平票偏好
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
 * 平票偏好得分：用户为 M(平票) 的维度上，pattern 字母与 tieBreak 匹配的数量
 */
function tieBreakScore(type, userLevels, dimOrder, tieBreak) {
  if (!tieBreak) return 0
  const typeLevels = parsePattern(type.pattern)
  let score = 0
  for (let i = 0; i < dimOrder.length; i++) {
    const dim = dimOrder[i]
    if (userLevels[dim] === 'M' && typeLevels[i] === tieBreak[dim]) score++
  }
  return score
}

/**
 * 匹配所有类型，排序，应用特殊覆盖
 * @param {Object}  userLevels     { IE: 'H', ... }
 * @param {Array}   dimOrder       维度顺序
 * @param {Array}   standardTypes  标准类型数组
 * @param {Array}   specialTypes   特殊类型数组
 * @param {Object}  options        { isCatPerson: boolean }
 * @param {Object}  scoringConfig  config.scoring（tieBreak / fallbackThreshold）
 * @param {Object}  specialCodes   config.specialCodes { hidden, fallback }
 * @returns {{ primary: Object, secondary: Object|null, rankings: Array, mode: string }}
 */
export function determineResult(userLevels, dimOrder, standardTypes, specialTypes, options = {}, scoringConfig = {}, specialCodes = {}) {
  const tieBreak = scoringConfig.tieBreak
  const rankings = standardTypes.map((type) => ({
    ...type,
    ...matchType(userLevels, dimOrder, type.pattern),
    _tie: tieBreakScore(type, userLevels, dimOrder, tieBreak),
  }))

  // 排序：距离升序 → 平票偏好降序 → 精准命中降序 → 相似度降序
  rankings.sort((a, b) =>
    a.distance - b.distance ||
    b._tie - a._tie ||
    b.exact - a.exact ||
    b.similarity - a.similarity
  )

  const best = rankings[0]
  const hidden = specialTypes.find((t) => t.code === (specialCodes.hidden || 'CAT-H'))
  const stray = specialTypes.find((t) => t.code === (specialCodes.fallback || 'STRAY'))
  const fallbackThreshold = scoringConfig.fallbackThreshold ?? 60

  // 隐藏人格覆盖（彩蛋门触发）
  if (options.isCatPerson && hidden) {
    return {
      primary: { ...hidden, similarity: best.similarity, exact: best.exact },
      secondary: best,
      rankings,
      mode: 'hidden',
    }
  }

  // 流浪猫兜底
  if (best.similarity < fallbackThreshold && stray) {
    return {
      primary: { ...stray, similarity: best.similarity, exact: best.exact },
      secondary: best,
      rankings,
      mode: 'fallback',
    }
  }

  return {
    primary: best,
    secondary: rankings[1] || null,
    rankings,
    mode: 'normal',
  }
}
