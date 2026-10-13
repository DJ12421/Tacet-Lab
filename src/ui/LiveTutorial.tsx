import { useEffect, useRef, useState } from 'react'
import { guideFor, stepsFor, type GuideCounts, type GuideId } from './guide-content'

function matchesAction(target: EventTarget | null, selector: string) {
  return target instanceof Element && Boolean(target.closest(selector))
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
  const [acted, setActed] = useState(false)
  const [ready, setReady] = useState(false)
  const [completed, setCompleted] = useState(() => new Set<number>())
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]

  useEffect(() => {
    if (!step) return
    let frame = 0
    const update = () => {
      const element = [...document.querySelectorAll<HTMLElement>(step.target)].find((candidate) => candidate.getClientRects().length > 0 && candidate.getBoundingClientRect().height < window.innerHeight * .8)
      if (element) {
        const bounds = element.getBoundingClientRect()
        if (bounds.bottom < 50 || bounds.top > window.innerHeight - 90) element.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTarget(bounds)
      } else setTarget(null)
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; update() })
    }
    update()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true) }
  }, [step])

  useEffect(() => {
    if (!step) return
    visibleAtStepStart.current = step.increase ? document.querySelectorAll(step.increase).length : 0
    setActed(false)
    setReady(completed.has(index))
    const mark = (event: Event) => {
      if (step.event && event.type !== step.event) return
      if (step.action && matchesAction(event.target, step.action)) setActed(true)
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
    if (!step || !acted) return
    const check = () => {
      const result = (!step.complete || Boolean(document.querySelector(step.complete)))
        && (!step.count || counts[step.count] > baseline.current[step.count])
        && (!step.increase || document.querySelectorAll(step.increase).length > visibleAtStepStart.current)
      setReady(result)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
    return () => observer.disconnect()
  }, [step, acted, counts])

  useEffect(() => { if (ready) nextRef.current?.focus() }, [ready])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"], dialog[open]')) { event.stopPropagation(); onClose(false) }
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
  const advance = () => {
    if (!ready) return
    setCompleted((current) => new Set(current).add(index))
    if (index === steps.length - 1) onClose(true)
    else setIndex(index + 1)
  }

  return <>
    {spotlight && <div className="tutorial-spotlight" aria-hidden="true" style={spotlight}/>}
    <aside className={`tutorial-panel${target && target.left > window.innerWidth / 2 ? ' tutorial-panel-left' : ''}`} role="region" aria-label={`${guide.title} live tutorial`}>
      <header><span className="eyebrow">{firstVisit ? 'First visit' : 'Welcome back'} · {index + 1}/{steps.length}</span><button type="button" aria-label="Close tutorial" onClick={() => onClose(false)}>×</button></header>
      <h2 aria-live="polite">{step.title}</h2><p>{step.body}</p>
      <small role="status">{ready ? 'Action checked. Continue when ready.' : target ? 'Use the highlighted area. This step advances after the action is detected.' : 'This control is not visible yet. Open the needed item or workspace, or use the screenshot for reference.'}</small>
      {!target && <a className="tutorial-example" href={`${import.meta.env.BASE_URL}guides/screenshots/${step.image}`} target="_blank" rel="noreferrer">View this step in a screenshot</a>}
      <div className="tutorial-progress" aria-hidden="true">{steps.map((entry, position) => <i className={position < index || completed.has(position) ? 'active' : ''} key={entry.title}/>)}</div>
      <footer><button type="button" className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button><button type="button" className="secondary" onClick={() => onClose(false)}>Exit tutorial</button><button ref={nextRef} type="button" className="primary" disabled={!ready} onClick={advance}>{index === steps.length - 1 ? 'Finish' : 'Next'}</button></footer>
    </aside>
  </>
}
