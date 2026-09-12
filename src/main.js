import { calcDimensionScores, scoresToLevels, determineResult } from './engine.js'
import { createQuiz } from './quiz.js'
import { renderResult } from './result.js'
import './style.css'

async function loadJSON(path) {
  const res = await fetch(path)
  return res.json()
}

/** 渠道码：URL ?ch=a / ?ch=b，默认 direct */
function getChannel() {
  const ch = new URLSearchParams(location.search).get('ch')
  return ch || 'direct'
}

/** 本地记录（无后端 v1：存 localStorage，正式投放需接表单服务） */
function persistRecord(record) {
  try {
    const key = 'maobi_records'
    const list = JSON.parse(localStorage.getItem(key) || '[]')
    list.push(record)
    localStorage.setItem(key, JSON.stringify(list))
  } catch (e) {
    console.warn('record persist failed', e)
  }
}

async function init() {
  const [questions, dimensions, types, config] = await Promise.all([
    loadJSON(new URL('../data/questions.json', import.meta.url).href),
    loadJSON(new URL('../data/dimensions.json', import.meta.url).href),
    loadJSON(new URL('../data/types.json', import.meta.url).href),
    loadJSON(new URL('../data/config.json', import.meta.url).href),
  ])

  const pages = {
    intro: document.getElementById('page-intro'),
    quiz: document.getElementById('page-quiz'),
    result: document.getElementById('page-result'),
  }

  function showPage(name) {
    Object.values(pages).forEach((p) => p.classList.remove('active'))
    pages[name].classList.add('active')
    window.scrollTo(0, 0)
  }

  function onQuizComplete(answers, flags) {
    const scores = calcDimensionScores(answers, questions.main)
    const levels = scoresToLevels(scores, config.scoring)
    // 彩蛋门双条件：选门值 + 作息维度为夜猫子（ND=H），均匀答题触发率 ~8.3%
    const gateCfg = (config.flow && config.flow.gate) || {}
    const req = gateCfg.requiresLevel
    const levelOK = !req || levels[req.dim] === req.level
    const result = determineResult(
      levels,
      dimensions.order,
      types.standard,
      types.special,
      { isCatPerson: !!flags.catperson && levelOK, userSeed: hashAnswers(answers) },
      config.scoring,
      config.specialCodes
    )
    result.priceIntent = priceIntentOf(answers, questions)

    persistRecord({
      ts: new Date().toISOString(),
      ch: getChannel(),
      answers,
      code: result.primary.code,
      mode: result.mode,
      levels,
    })

    renderResult(result, levels, dimensions.order, dimensions.definitions, config)
    showPage('result')
  }

  const quiz = createQuiz(questions, config, onQuizComplete)

  document.getElementById('btn-start').addEventListener('click', () => {
    quiz.start()
    showPage('quiz')
  })

  document.getElementById('btn-restart').addEventListener('click', () => {
    quiz.start()
    showPage('quiz')
  })
}

/**
 * 意向价格摘要：Q7 预算档位 + Gabor-Granger 追问答案，随领养证登记一起提交
 */
function priceIntentOf(answers, questions) {
  const q7 = questions.main.find((q) => q.id === 'q7')
  const opt = q7 && q7.options.find((o) => o.value === answers.q7)
  if (!opt) return null
  const yn = (v) => (v == null ? '' : v === 1 ? '愿意' : '不愿意')
  return {
    budget: opt.label.replace(/^.+?：/, ''),
    upgrade_1499: yn(answers.q7f1),
    upgrade_2499: yn(answers.q7f2),
  }
}

/**
 * 答案哈希（FNV-1a）：作为平票随机的用户种子，同一套答案结果稳定
 */
function hashAnswers(answers) {
  let h = 2166136261
  for (const k of Object.keys(answers).sort()) {
    const s = `${k}:${answers[k]}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}

init()
