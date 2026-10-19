export type IconColor = readonly [number, number, number]

export function iconColor(pixels: Uint8ClampedArray, minimumBrightness = 80, minimumChroma = 35): IconColor | undefined {
  const sums = [0, 0, 0]
  let count = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    if (pixels[offset + 3] <= 80 || Math.max(red, green, blue) <= minimumBrightness || Math.max(red, green, blue) - Math.min(red, green, blue) <= minimumChroma) continue
    sums[0] += red; sums[1] += green; sums[2] += blue; count += 1
  }
  return count ? [Math.round(sums[0] / count), Math.round(sums[1] / count), Math.round(sums[2] / count)] : undefined
}

export function iconColorDistance(left: IconColor, right: IconColor) {
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / 765
}

export function scoreIconSignature(captured: number[], template: number[], capturedColor?: IconColor, templateColor?: IconColor) {
  return 1 - template.reduce((sum, value, index) => sum + Math.abs(value - captured[index]), 0) / (captured.length * 4)
    - (capturedColor && templateColor ? .3 * iconColorDistance(capturedColor, templateColor) : 0)
}
