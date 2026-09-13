import { shuffle, insertAtRandom, insertAfter } from './utils.js'

/**
 * 答题控制器（猫BTI 改写版）
 * 泛化了原 SBTI 的酒鬼门：支持任意触发式追问（followUps）与彩蛋门（gate）
 */
export function createQuiz(questions, config, onComplete) {
  const gate = config.flow?.gate
  const followUps = config.flow?.followUps || []

  const gateQuestion = gate ? questions.special.find((q) => q.id === gate.questionId) : null
  const followUpMap = {}
  for (const fu of followUps) {
    followUpMap[fu.questionId] = followUpMap[fu.questionId] || []
    followUpMap[fu.questionId].push(fu)
  }

  let queue = []
  let current = 0
  let answers = {}
  let flags = {}
  let baseCount = 0

  const els = {
    fill: document.getElementById('progress-fill'),
    text: document.getElementById('progress-text'),
    qText: document.getElementById('question-text'),
    options: document.getElementById('options'),
  }

  function totalCount() {
    return queue.length
  }

  function updateProgress() {
    const completed = queue.slice(0, current).filter(q => q.kind !== 'price_followup').length
    const extra = queue[current]?.kind === 'price_followup'
    els.fill.style.width = `${completed / baseCount * 100}%`
    els.text.textContent = extra ? '猫猫悄悄追问一句 · 不影响猫格' : `已探索 ${completed} 个场景 · 猫格拼图中`
  }

  function renderQuestion() {
    const q = queue[current]
    els.qText.textContent = q.text

    els.options.innerHTML = ''
    q.options.forEach((opt) => {
      const btn = document.createElement('button')
      btn.className = 'btn btn-option'
      btn.textContent = opt.label
      btn.addEventListener('click', () => selectOption(q, opt))
      els.options.appendChild(btn)
    })

    updateProgress()
    els.qText.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }

  function selectOption(question, option) {
    if (queue[current] !== question) return
    answers[question.id] = option.value

    // 触发式追问（如价格题的 Gabor-Granger 追问）
    const fus = followUpMap[question.id]
    if (fus) {
      for (const fu of fus) {
        if (option.value === fu.triggerValue) {
          const followQ = questions.special.find((q) => q.id === fu.followId)
          if (followQ) queue = insertAfter(queue, question.id, followQ)
        }
      }
    }

    // 彩蛋门
    if (gate && question.id === gate.questionId && option.value === gate.triggerValue) {
      flags[gate.flag || 'hidden'] = true
    }

    current++
    if (current >= totalCount()) {
      onComplete(answers, flags)
    } else {
      renderQuestion()
    }
  }

  function start() {
    current = 0
    answers = {}
    flags = {}
    queue = gateQuestion ? insertAtRandom(shuffle(questions.main), gateQuestion) : shuffle(questions.main)
    baseCount = queue.length
    renderQuestion()
  }

  return { start, renderQuestion }
}
