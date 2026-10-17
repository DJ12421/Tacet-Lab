export function wuwaflexNameThreshold(pixels: Uint8ClampedArray, width: number, height: number) {
  const brightness = (index: number) => pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722
  const sampleHeight = Math.max(2, Math.round(height * .15))
  const background = new Float32Array(width)
  for (let x = 0; x < width; x += 1) {
    const samples = Array.from({ length: sampleHeight }, (_, y) => brightness((y * width + x) * 4)).sort((a, b) => a - b)
    background[x] = samples[Math.floor(samples.length / 2)]
  }
  const smoothed = new Float32Array(width)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let offset = -20; offset <= 20; offset += 1) sum += background[Math.max(0, Math.min(width - 1, x + offset))]
    smoothed[x] = sum / 41
  }
  const binary = new Uint8Array(width * height)
  for (let index = 0; index < binary.length; index += 1) {
    binary[index] = Math.floor(index / width) < height * .75
      && brightness(index * 4) - smoothed[index % width] > 26 ? 0 : 255
  }
  return binary
}
