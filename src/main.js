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
    const result = determineResult(
      levels,
      dimensions.order,
      types.standard,
      types.special,
      { isCatPerson: !!flags.catperson },
      config.scoring,
      config.specialCodes
    )

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

init()
