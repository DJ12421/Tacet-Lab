/// <reference lib="webworker" />
import type { ScanRect } from './types'

type Strategy = 'name' | 'label' | 'text' | 'substat' | 'visual' | 'plain'
interface Request { id: string; bitmap: ImageBitmap; rect: ScanRect; strategy: Strategy }

function percentile(values: Uint8Array, ratio: number) {
  const histogram = new Uint32Array(256)
  for (const value of values) histogram[value] += 1
  const target = Math.max(0, Math.min(values.length - 1, Math.round(values.length * ratio)))
  let count = 0
  for (let value = 0; value < histogram.length; value += 1) { count += histogram[value]; if (count >= target) return value }
  return 255
}

function grayscale(data: Uint8ClampedArray) {
  const values = new Uint8Array(data.length / 4)
  for (let offset = 0, index = 0; offset < data.length; offset += 4, index += 1) {
    values[index] = Math.round(data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722)
  }
  return values
}

function normalize(values: Uint8Array) {
  const low = percentile(values, .04), high = percentile(values, .96), range = Math.max(18, high - low)
  const normalized = new Uint8Array(values.length)
  for (let index = 0; index < values.length; index += 1) normalized[index] = Math.max(0, Math.min(255, Math.round((values[index] - low) / range * 255)))
  return normalized
}

function borderMean(values: Uint8Array, width: number, height: number) {
  const border = Math.max(1, Math.round(Math.min(width, height) * .08))
  let sum = 0, count = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x >= border && x < width - border && y >= border && y < height - border) continue
    sum += values[y * width + x]; count += 1
  }
  return count ? sum / count : 255
}

function ensureLightBackground(values: Uint8Array, width: number, height: number) {
  if (borderMean(values, width, height) >= 128) return values
  const inverted = new Uint8Array(values.length)
  for (let index = 0; index < values.length; index += 1) inverted[index] = 255 - values[index]
  return inverted
}

function integralImage(values: Uint8Array, width: number, height: number) {
  const integral = new Uint32Array((width + 1) * (height + 1))
  for (let y = 1; y <= height; y += 1) {
    let row = 0
    for (let x = 1; x <= width; x += 1) {
      row += values[(y - 1) * width + x - 1]
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row
    }
  }
  return integral
}

function adaptiveThreshold(values: Uint8Array, width: number, height: number, radius: number, bias: number) {
  const integral = integralImage(values, width, height), stride = width + 1, binary = new Uint8Array(values.length)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = Math.max(0, x - radius), right = Math.min(width - 1, x + radius)
    const top = Math.max(0, y - radius), bottom = Math.min(height - 1, y + radius)
    const area = (right - left + 1) * (bottom - top + 1)
    const sum = integral[(bottom + 1) * stride + right + 1] - integral[top * stride + right + 1] - integral[(bottom + 1) * stride + left] + integral[top * stride + left]
    binary[y * width + x] = values[y * width + x] < sum / area - bias ? 0 : 255
  }
  return binary
}

function otsuThreshold(values: Uint8Array) {
  const histogram = new Uint32Array(256)
  for (const value of values) histogram[value] += 1
  let totalWeighted = 0
  for (let value = 0; value < 256; value += 1) totalWeighted += value * histogram[value]
  let backgroundWeight = 0, backgroundWeighted = 0, bestVariance = -1, threshold = 128
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value]; if (!backgroundWeight) continue
    const foregroundWeight = values.length - backgroundWeight; if (!foregroundWeight) break
    backgroundWeighted += value * histogram[value]
    const backgroundMean = backgroundWeighted / backgroundWeight, foregroundMean = (totalWeighted - backgroundWeighted) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) { bestVariance = variance; threshold = value }
  }
  return threshold
}

function globalThreshold(values: Uint8Array) {
  const threshold = otsuThreshold(values), binary = new Uint8Array(values.length)
  for (let index = 0; index < values.length; index += 1) binary[index] = values[index] <= threshold ? 0 : 255
  return binary
}

function inkRatio(values: Uint8Array) {
  let ink = 0
  for (const value of values) if (value === 0) ink += 1
  return values.length ? ink / values.length : 0
}

function dilateBlack(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values)
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x
    if (values[index] === 0 || values[index - 1] === 0 || values[index + 1] === 0 || values[index - width] === 0 || values[index + width] === 0) output[index] = 0
  }
  return output
}

function erodeBlack(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values)
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x
    output[index] = values[index] === 0 && values[index - 1] === 0 && values[index + 1] === 0 && values[index - width] === 0 && values[index + width] === 0 ? 0 : 255
  }
  return output
}

function removeSubstatHighlight(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values)
  const horizontalLimit = Math.max(1, Math.floor(height * .34))
  const horizontalRun = Math.floor(width * .62)
  const clearRadius = Math.max(1, Math.round(Math.min(width, height) * .018))
  const longestBlackRunInRow = (y: number) => {
    let longest = 0, current = 0
    for (let x = 0; x < width; x += 1) { current = values[y * width + x] === 0 ? current + 1 : 0; longest = Math.max(longest, current) }
    return longest
  }
  const clearRow = (center: number) => {
    for (let y = Math.max(0, center - clearRadius); y <= Math.min(height - 1, center + clearRadius); y += 1) output.fill(255, y * width, (y + 1) * width)
  }
  for (let y = 0; y < horizontalLimit; y += 1) if (longestBlackRunInRow(y) >= horizontalRun) clearRow(y)
  for (let y = height - horizontalLimit; y < height; y += 1) if (longestBlackRunInRow(y) >= horizontalRun) clearRow(y)
  return output
}

function trimSubstatFooter(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values)
  const valueStart = Math.floor(width * .7)
  const minimumInk = Math.max(3, Math.round((width - valueStart) * .02))
  const gapAllowance = Math.max(1, Math.round(height * .012))
  let bands = 0, lastInkRow = -1, previousInkRow = -gapAllowance - 1
  for (let y = 0; y < height; y += 1) {
    let ink = 0
    for (let x = valueStart; x < width; x += 1) if (values[y * width + x] === 0) ink += 1
    if (ink < minimumInk) continue
    if (y - previousInkRow > gapAllowance) bands += 1
    previousInkRow = y; lastInkRow = y
  }
  if (bands < 3 || lastInkRow < 0) return output
  const cutoff = Math.min(height, lastInkRow + Math.max(3, Math.round(height * .035)))
  output.fill(255, cutoff * width)
  return output
}

function removeLargeNameArtwork(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values), visited = new Uint8Array(values.length)
  const maximumTextArea = values.length * .025
  for (let start = 0; start < values.length; start += 1) {
    if (values[start] !== 0 || visited[start]) continue
    const stack = [start], component: number[] = []
    visited[start] = 1
    let minX = width, maxX = 0, minY = height, maxY = 0
    while (stack.length) {
      const index = stack.pop()!, x = index % width, y = Math.floor(index / width)
      component.push(index); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      const neighbors = [index - 1, index + 1, index - width, index + width]
      for (const next of neighbors) {
        if (next < 0 || next >= values.length || visited[next] || values[next] !== 0) continue
        const nextX = next % width
        if (Math.abs(nextX - x) > 1) continue
        visited[next] = 1; stack.push(next)
      }
    }
    const componentWidth = maxX - minX + 1, componentHeight = maxY - minY + 1
    const largeArtwork = component.length > maximumTextArea
      && (componentWidth > width * .1 || componentHeight > height * .45)
    const rightEdgeArtwork = minX > width * .5
      && (minY === 0 || maxX === width - 1)
      && componentHeight > height * .15
    const artwork = largeArtwork || rightEdgeArtwork
    if (artwork) for (const index of component) output[index] = 255
  }
  return output
}

function removeSmallLabelNoise(values: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(values), visited = new Uint8Array(values.length)
  const minimumGlyphSize = height * .18
  const components: Array<{ pixels: number[]; minX: number; maxX: number; minY: number; maxY: number }> = []
  for (let start = 0; start < values.length; start += 1) {
    if (values[start] !== 0 || visited[start]) continue
    const stack = [start], component: number[] = []
    visited[start] = 1
    let minX = width, maxX = 0, minY = height, maxY = 0
    while (stack.length) {
      const index = stack.pop()!, x = index % width, y = Math.floor(index / width)
      component.push(index); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= values.length || visited[next] || values[next] !== 0) continue
        if (Math.abs(next % width - x) > 1) continue
        visited[next] = 1; stack.push(next)
      }
    }
    components.push({ pixels: component, minX, maxX, minY, maxY })
  }
  for (const component of components) {
    const componentWidth = component.maxX - component.minX + 1, componentHeight = component.maxY - component.minY + 1
    if (componentWidth >= minimumGlyphSize || componentHeight >= minimumGlyphSize) continue
    const centerX = (component.minX + component.maxX) / 2
    const isLetterDot = components.some((stem) => stem !== component
      && stem.maxY - stem.minY + 1 >= minimumGlyphSize
      && component.maxY < stem.minY
      && stem.minY - component.maxY <= height * .18
      && centerX >= stem.minX - height * .03
      && centerX <= stem.maxX + height * .03)
    if (!isLetterDot) for (const index of component.pixels) output[index] = 255
  }
  return output
}

function renderBinary(context: OffscreenCanvasRenderingContext2D, values: Uint8Array, width: number, height: number) {
  const image = context.createImageData(width, height)
  for (let index = 0, offset = 0; index < values.length; index += 1, offset += 4) {
    image.data[offset] = values[index]; image.data[offset + 1] = values[index]; image.data[offset + 2] = values[index]; image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  context.fillStyle = '#fff'
  const border = Math.max(2, Math.round(Math.min(width, height) * .025))
  context.fillRect(0, 0, width, border); context.fillRect(0, height - border, width, border)
  context.fillRect(0, 0, border, height); context.fillRect(width - border, 0, border, height)
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, bitmap, rect, strategy } = event.data
  try {
    const paddingX = 0, paddingY = 0
    const expanded: ScanRect = {
      x: Math.max(0, rect.x - rect.width * paddingX), y: Math.max(0, rect.y - rect.height * paddingY),
      width: Math.min(1, rect.width * (1 + paddingX * 2)), height: Math.min(1, rect.height * (1 + paddingY * 2))
    }
    expanded.width = Math.min(expanded.width, 1 - expanded.x); expanded.height = Math.min(expanded.height, 1 - expanded.y)
    const sourceX = Math.max(0, Math.round(expanded.x * bitmap.width)), sourceY = Math.max(0, Math.round(expanded.y * bitmap.height))
    const sourceWidth = Math.max(1, Math.min(bitmap.width - sourceX, Math.round(expanded.width * bitmap.width)))
    const sourceHeight = Math.max(1, Math.min(bitmap.height - sourceY, Math.round(expanded.height * bitmap.height)))
    const scale = strategy === 'name' || strategy === 'label' || strategy === 'text' || strategy === 'substat' ? 3 : 1
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sourceWidth * scale)), Math.max(1, Math.round(sourceHeight * scale)))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Offscreen preprocessing canvas is unavailable.')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    if (strategy !== 'visual' && strategy !== 'plain') {
      const source = context.getImageData(0, 0, canvas.width, canvas.height)
      const normalized = ensureLightBackground(normalize(grayscale(source.data)), canvas.width, canvas.height)
      let binary = globalThreshold(normalized)
      if (strategy === 'name') binary = removeLargeNameArtwork(binary, canvas.width, canvas.height)
      if (strategy === 'label') binary = removeSmallLabelNoise(binary, canvas.width, canvas.height)
      if (strategy === 'substat') {
        binary = removeSubstatHighlight(binary, canvas.width, canvas.height)
        binary = trimSubstatFooter(binary, canvas.width, canvas.height)
      }
      renderBinary(context, binary, canvas.width, canvas.height)
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' }), bytes = await blob.arrayBuffer()
    bitmap.close()
    self.postMessage({ id, ok: true, bytes, width: canvas.width, height: canvas.height, strategy }, [bytes])
  } catch (error) {
    bitmap.close()
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Preprocessing failed.' })
  }
}

export {}
