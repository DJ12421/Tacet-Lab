import { guideFor, guides, stepsFor, type Guide, type GuideCounts, type GuideId, type GuideStep } from './guide-content'
import { Icon, PageHeader, Panel } from './primitives'
import { PrivacyLegalView } from './PrivacyLegalView'

function GuideScreenshot({ step }: { step: GuideStep }) {
  const src = `${import.meta.env.BASE_URL}guides/screenshots/${step.image}`
  return <figure className="guide-screenshot">
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${step.title}`}><img className="guide-step-image" src={src} alt={`Tacet Lab example for ${step.title.toLowerCase()}`} loading="lazy"/></a>
    <figcaption>Site screenshot; sample values are illustrative · Select to enlarge</figcaption>
  </figure>
}

function GuideDocument({ guide, steps, firstVisit, onBack, onStart }: { guide: Guide; steps: readonly GuideStep[]; firstVisit: boolean; onBack: () => void; onStart: (id: GuideId) => void }) {
  return <div className="guide-document">
    <button type="button" className="guide-back" onClick={onBack}>← All guides</button>
    <PageHeader eyebrow="Field guide" title={guide.title} description={guide.summary} actions={<button type="button" className="primary" onClick={() => onStart(guide.id)}>Start live tutorial</button>}/>
    <p className="guide-outcome"><strong>{firstVisit ? 'First visit' : 'Returning visit'} · By the end:</strong> {guide.outcome}</p>
    <ol className="guide-steps">
      {steps.map((step, index) => <li key={step.title}>
        <Panel className="guide-step">
          <div className="guide-step-copy"><span className="eyebrow">Step {index + 1} of {steps.length}</span><h2>{step.title}</h2><p>{step.body}</p></div>
          <GuideScreenshot step={step}/>
        </Panel>
      </li>)}
    </ol>
    <div className="guide-end"><strong>Ready to try it on the site?</strong><button type="button" className="primary" onClick={() => onStart(guide.id)}>Start live tutorial</button></div>
  </div>
}

export function GuidesView({ document, counts, isFirstVisit, onSelect, onStart }: { document?: string; counts: GuideCounts; isFirstVisit: (id: GuideId) => boolean; onSelect: (document?: string) => void; onStart: (id: GuideId) => void }) {
  let completed = new Set<GuideId>()
  try { completed = new Set(guides.filter((guide) => window.localStorage.getItem(`tacet-lab-tutorial-${guide.id}`) === 'complete').map((guide) => guide.id)) }
  catch { /* Local storage may be unavailable. */ }
  const guide = guideFor(document)
  if (document === 'privacy') return <div className="guides-page"><button type="button" className="guide-back" onClick={() => onSelect()}>← All guides</button><PrivacyLegalView/></div>
  if (guide) return <GuideDocument guide={guide} steps={stepsFor(guide, counts, isFirstVisit(guide.id))} firstVisit={isFirstVisit(guide.id)} onBack={() => onSelect()} onStart={onStart}/>

  return <div className="guides-page">
    <PageHeader eyebrow="Learn Tacet Lab" title="Guides" description="Short steps with screenshots from every part of the site. Open a guide or practice with a live tutorial."/>
    <section className="guide-feature" aria-labelledby="guide-feature-title"><div><span className="eyebrow">Start here</span><h2 id="guide-feature-title">Your first build, one section at a time</h2><p>Begin with the essentials, then open a guide whenever you reach a new tool.</p></div><button type="button" className="primary" onClick={() => onSelect('dashboard')}>Read Getting started</button></section>
    <div className="guide-grid">{guides.map((item) => <article className="guide-card" key={item.id}>
      <div className="guide-card-visual"><img className="guide-step-image" src={`${import.meta.env.BASE_URL}guides/screenshots/${stepsFor(item, counts, isFirstVisit(item.id))[0].image}`} alt="" loading="lazy"/></div>
      <div className="guide-card-body"><h2>{item.title}</h2>{completed.has(item.id) && <small className="guide-complete">✓ Tutorial completed</small>}<p>{item.summary}</p><div><button type="button" onClick={() => onSelect(item.id)}>Read guide <span aria-hidden="true">→</span></button><button type="button" onClick={() => onStart(item.id)}>Live tutorial</button></div></div>
    </article>)}</div>
    <section className="guide-documents" aria-labelledby="guide-documents-title"><div><span className="eyebrow">Documents</span><h2 id="guide-documents-title">Privacy &amp; Legal</h2><p>How local data, capture permissions, external resources, and project licensing work.</p></div><button type="button" className="secondary" onClick={() => onSelect('privacy')}><Icon name="lock"/>Read document</button></section>
  </div>
}
