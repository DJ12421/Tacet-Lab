import { useEffect, useRef } from 'react'
import './echo-waveform.css'

const TAU = Math.PI * 2
const RADIUS = 31
const STEPS = 96
const SPEED_MULTIPLIER = 4
const waves = [
  { offset: 0, amplitude: 1.8, detail: .6, cycles: 2, detailCycles: 5, speed: .00042, phase: .2 },
  { offset: 1.3, amplitude: 2.1, detail: .8, cycles: 3, detailCycles: 7, speed: -.00034, phase: 1.6 },
  { offset: 2.6, amplitude: 2.4, detail: 1, cycles: 2, detailCycles: 6, speed: .00038, phase: 2.9 },
  { offset: 3.9, amplitude: 1.8, detail: .8, cycles: 4, detailCycles: 8, speed: -.00027, phase: 4.1 },
  { offset: 5.2, amplitude: 1.5, detail: .7, cycles: 3, detailCycles: 7, speed: .00023, phase: 5.2 },
] as const
const colors = ['cs-echo-wave-gold-dark', 'cs-echo-wave-gold', 'cs-echo-wave-gold-light', 'cs-echo-wave-gold-mid', 'cs-echo-wave-white']
const widths = [1, 1.2, 1.5, 1.1, 1]
const opacities = [.5, .65, 1, .65, .5]

function wavePath(time: number, wave: typeof waves[number]) {
  let path = ''
  for (let step = 0; step <= STEPS; step++) {
    const position = step / STEPS
    const angle = position * TAU
    const ripple = (1 + Math.sin(position * TAU * wave.cycles + time * wave.speed + wave.phase)) * wave.amplitude / 2
      + (1 + Math.sin(position * TAU * wave.detailCycles - time * wave.speed * .6 + wave.phase)) * wave.detail / 2
    const radius = RADIUS + wave.offset + ripple
    const x = 50 + radius * Math.cos(angle)
    const y = 50 + radius * Math.sin(angle)
    path += `${step ? ' L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
  }
  return `${path} Z`
}

const initialPaths = waves.map((wave) => wavePath(0, wave))

export function SkillCircleWave() {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>('path')
    if (!paths) return
    let frame = 0
    const render = (time: number) => {
      waves.forEach((wave, index) => paths[index]?.setAttribute('d', wavePath(time * SPEED_MULTIPLIER, wave)))
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <svg ref={svgRef} className="cbc-skill-circle-wave" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    {initialPaths.map((path, index) => <path key={colors[index]} d={path} className={colors[index]} strokeWidth={widths[index]} vectorEffect="non-scaling-stroke" strokeLinecap="round" opacity={opacities[index]}/>)}
  </svg>
}
