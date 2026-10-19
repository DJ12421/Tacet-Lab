export function echoNameThreshold(pixels: Uint8ClampedArray, width: number, height: number) {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let samples = 0
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width * .36; x += 2) {
    const offset = (y * width + x) * 4
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    if (Math.max(red, green, blue) < 165 || Math.max(red, green, blue) - Math.min(red, green, blue) > 115) continue
    histograms[0][red]++; histograms[1][green]++; histograms[2][blue]++; samples++
  }
  if (samples < width * height * .001) return undefined
  const reference = histograms.map((histogram) => {
    let count = 0
    for (let value = 0; value < 256; value++) { count += histogram[value]; if (count >= samples / 2) return value }
    return 255
  })
  const binary = new Uint8Array(width * height)
  for (let index = 0; index < binary.length; index++) {
    const offset = index * 4
    binary[index] = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= 150
      && Math.abs(pixels[offset] - reference[0]) <= 45
      && Math.abs(pixels[offset + 1] - reference[1]) <= 45
      && Math.abs(pixels[offset + 2] - reference[2]) <= 45 ? 0 : 255
  }
  return binary
}
