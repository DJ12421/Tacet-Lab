import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { guideFor, stepsFor, type GuideCounts, type GuideId } from './guide-content'

const dialogSelector = '[aria-modal="true"], dialog[open], .modal-backdrop, .weapon-config-backdrop, .roll-quality-backdrop, .catalog-picker-backdrop'

function matchesAction(target: EventTarget | null, selector: string) {
  return target instanceof Element && Boolean(target.closest(selector))
}

function visible(element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  return element.getClientRects().length > 0 && bounds.width > 0 && bounds.height > 0
}

export function LiveTutorial({ id, counts, firstVisit, onClose }: { id: GuideId; counts: GuideCounts; firstVisit: boolean; onClose: (completed: boolean) => void }) {
  const guide = guideFor(id)
  const [steps] = useState(() => guide ? stepsFor(guide, counts, firstVisit) : [])
  const baseline = useRef(counts)
  const visibleAtStepStart = useRef(0)
  const [index, setIndex] = useState(() => {
    if (id === 'characters' && document.querySelector('.cs-page')) return Math.max(0, steps.findIndex((entry) => entry.title === 'Open level choices'))
    if (id === 'weapons' && document.querySelector('.weapon-config-modal')) return Math.max(0, steps.findIndex((entry) => entry.title === 'Set level and rank'))
    if (['overview', 'forte', 'optimizer', 'theorizer', 'rotation'].includes(id) && document.querySelector('.tw-subnav')) return Math.max(0, steps.findIndex((entry) => !['Create a team workspace', 'Open a team workspace', 'Add an owned character', 'Select a filled member'].includes(entry.title)))
    return 0
  })
  const [target, setTarget] = useState<DOMRect | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [actedStep, setActedStep] = useState(-1)
  const [readyStep, setReadyStep] = useState(-1)
  const [completed, setCompleted] = useState(() => new Set<number>())
  const step = steps[index]
  const ready = readyStep === index || completed.has(index)

  useEffect(() => {
    if (!step) return
    let frame = 0
    const update = () => {
      const modal = [...document.querySelectorAll<HTMLElement>(dialogSelector)].filter(visible).at(-1)
      const inFront = (candidate: HTMLElement) => visible(candidate) && !candidate.matches(':disabled') && (!modal || modal.contains(candidate)) && candidate.getBoundingClientRect().height < window.innerHeight * .8
      const actions = step.action ? [...document.querySelectorAll<HTMLElement>(step.action)] : []
      const action = actions.find(inFront)
      const targets = [...document.querySelectorAll<HTMLElement>(step.target)]
      const targetInModal = modal && targets.find((candidate) => visible(candidate) && modal.contains(candidate))
      const modalAction = modal && actions.some((candidate) => visible(candidate) && modal.contains(candidate))
      const waitingForDialog = Boolean(modal && !action && !modalAction && (actions.some(visible) || !targetInModal))
      const destination = waitingForDialog ? undefined : action ?? targets.find(inFront) ?? targetInModal
      const element = destination ?? modal?.querySelector<HTMLElement>('button.close, button[aria-label^="Close"]') ?? modal
      if (element) {
        const bounds = element.getBoundingClientRect()
        if (!waitingForDialog && (bounds.bottom < 50 || bounds.top > window.innerHeight - 90)) element.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTarget((current) => current?.x === bounds.x && current?.y === bounds.y && current.width === bounds.width && current.height === bounds.height ? current : bounds)
      } else setTarget(null)
      setBlocked(waitingForDialog)
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; update() })
    }
    update()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true) }
  }, [step])

  useEffect(() => {
    if (!step) return
    visibleAtStepStart.current = step.increase ? document.querySelectorAll(step.increase).length : 0
    const mark = (event: Event) => {
      if (step.event && event.type !== step.event) return
      if (step.action && matchesAction(event.target, step.action)) setActedStep(index)
    }
    document.addEventListener('click', mark, true)
    document.addEventListener('change', mark, true)
    document.addEventListener('input', mark, true)
    return () => {
      document.removeEventListener('click', mark, true)
      document.removeEventListener('change', mark, true)
      document.removeEventListener('input', mark, true)
    }
  }, [step, index])

  useEffect(() => {
    if (!step) return
    const check = () => {
      const stateAlreadyReached = Boolean(step.complete && !step.count && !step.increase && document.querySelector(step.complete))
      const result = (actedStep === index || stateAlreadyReached)
        && (!step.complete || Boolean(document.querySelector(step.complete)))
        && (!step.count || counts[step.count] > baseline.current[step.count])
        && (!step.increase || document.querySelectorAll(step.increase).length > visibleAtStepStart.current)
      setReadyStep(result ? index : -1)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
    return () => observer.disconnect()
  }, [step, actedStep, index, counts])

  useEffect(() => {
    if (!ready || completed.has(index)) return
    const timer = window.setTimeout(() => {
      setCompleted((current) => new Set(current).add(index))
      if (index === steps.length - 1) onClose(true)
      else setIndex(index + 1)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [ready, index, completed, onClose, steps.length])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector(dialogSelector)) { event.stopPropagation(); onClose(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  if (!guide || !step) return null
  const left = Math.max(4, (target?.left ?? 0) - 5)
  const top = Math.max(4, (target?.top ?? 0) - 5)
  const spotlight = target && {
    left, top,
    width: Math.max(0, Math.min(window.innerWidth - left - 4, target.width + 10)),
    height: Math.max(0, Math.min(window.innerHeight - top - 4, target.height + 10))
  }
  const panelAtTop = target && target.bottom > (window.innerWidth <= 600 ? window.innerHeight / 2 : window.innerHeight - 330)
  const advance = () => {
    if (!ready) return
    setCompleted((current) => new Set(current).add(index))
    if (index === steps.length - 1) onClose(true)
    else setIndex(index + 1)
  }

  return createPortal(<div className="tutorial-layer">
    {spotlight && <div className="tutorial-spotlight" data-step={index + 1} aria-hidden="true" style={spotlight}/>}
    <aside className={`tutorial-panel${target && target.left > window.innerWidth / 2 ? ' tutorial-panel-left' : ''}${panelAtTop ? ' tutorial-panel-top' : ''}`} role="region" aria-label={`${guide.title} live tutorial`}>
      <header><span className="eyebrow">{firstVisit ? 'First visit' : 'Welcome back'} · {index + 1}/{steps.length}</span><button type="button" aria-label="Close tutorial" onClick={() => onClose(false)}>×</button></header>
      <h2 aria-live="polite">{step.title}</h2><p>{step.body}</p>
      <small role="status">{ready ? 'Done. Moving to the next step…' : blocked ? 'Close the highlighted dialog to reveal the next control.' : target ? 'Use the highlighted control. The guide moves on when your action is checked.' : 'Open the needed item or workspace. The highlight will follow the next control.'}</small>
      {!target && <a className="tutorial-example" href={`${import.meta.env.BASE_URL}guides/screenshots/${step.image}`} target="_blank" rel="noreferrer">View this step in a screenshot</a>}
      <div className="tutorial-progress" aria-hidden="true">{steps.map((entry, position) => <i className={position < index || completed.has(position) ? 'active' : ''} key={entry.title}/>)}</div>
      <footer><button type="button" className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button><button type="button" className="secondary" onClick={() => onClose(false)}>Exit tutorial</button><button type="button" className="primary" disabled={!ready} onClick={advance}>{index === steps.length - 1 ? 'Finish' : 'Next'}</button></footer>
    </aside>
  </div>, document.body)
}
