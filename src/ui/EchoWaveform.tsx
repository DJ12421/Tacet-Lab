import { useEffect, useRef, type CSSProperties } from 'react'
import './echo-waveform.css'

const elementColors: Record<string, string> = { Spectro: '#e8cc72', Fusion: '#ee715e', Glacio: '#76cef2', Electro: '#b581ef', Aero: '#62d7ae', Havoc: '#d36adf' }
const WIDTH = 1200
const HEIGHT = 24
const STEP = 10
const TAU = Math.PI * 2

type Wave = {
  center: number
  amplitude: number
  cycles: number
  speed: number
  phase: number
  detailAmplitude: number
  detailCycles: number
  detailSpeed: number
}

const waves: readonly Wave[] = [
  { center: 11.5, amplitude: 5.2, cycles: 1.72, speed: .00042, phase: .2, detailAmplitude: 1.4, detailCycles: 3.15, detailSpeed: -.00024 },
  { center: 11.8, amplitude: 4.3, cycles: 2.08, speed: -.00034, phase: 1.6, detailAmplitude: 1.1, detailCycles: 3.7, detailSpeed: .00019 },
  { center: 11.2, amplitude: 5.4, cycles: 1.86, speed: .00038, phase: 2.9, detailAmplitude: 1.2, detailCycles: 3.35, detailSpeed: -.00021 },
  { center: 11.7, amplitude: 2.2, cycles: 1.45, speed: -.00027, phase: 4.1, detailAmplitude: .7, detailCycles: 3.9, detailSpeed: .00017 },
  { center: 11.9, amplitude: 1.8, cycles: 1.62, speed: .00023, phase: 5.2, detailAmplitude: .65, detailCycles: 3.25, detailSpeed: -.00015 },
]

const waveClasses = ['cs-echo-wave-gold-dark', 'cs-echo-wave-gold', 'cs-echo-wave-gold-light', 'cs-echo-wave-gold-mid', 'cs-echo-wave-white']
const waveWidths = [1, 1.5, 1.75, 1, 1]
const waveOpacities = [.35, .5, .9, .5, .4]

function wavePath(time: number, wave: Wave) {
  let path = ''
  for (let x = 0; x <= WIDTH; x += STEP) {
    const position = x / WIDTH
    const y = wave.center
      + Math.sin(position * TAU * wave.cycles + time * wave.speed + wave.phase) * wave.amplitude
      + Math.sin(position * TAU * wave.detailCycles + time * wave.detailSpeed + wave.phase * .63) * wave.detailAmplitude
    path += `${x ? ' L' : 'M'}${x},${y.toFixed(2)}`
  }
  return path
}

const initialPaths = waves.map((wave) => wavePath(0, wave))

export function EchoWaveform({ element }: { element?: string } = {}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const style = element ? { '--wave-accent': elementColors[element] ?? '#d1aa4c' } as CSSProperties : undefined

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>('path')
    if (!paths?.length) return
    let frame = 0
    const render = (time: number) => {
      const nextPaths = waves.map((wave) => wavePath(time, wave))
      paths[0]?.setAttribute('d', `${nextPaths[2]} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`)
      nextPaths.forEach((path, index) => paths[index + 1]?.setAttribute('d', path))
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <svg ref={svgRef} className="cs-echo-waveform" style={style} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" fill="none" aria-hidden="true">
    <path d={`${initialPaths[2]} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} className="cs-echo-wave-fill"/>
    {initialPaths.map((path, index) => <path key={waveClasses[index]!} d={path} className={`${waveClasses[index]!} cs-echo-wave-path`} strokeWidth={waveWidths[index]!} vectorEffect="non-scaling-stroke" strokeLinecap="round" opacity={waveOpacities[index]!}/>) }
  </svg>
}
