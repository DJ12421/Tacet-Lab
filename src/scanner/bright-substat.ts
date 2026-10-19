export function brightSubstatThreshold(values: Uint8Array, width: number, height: number, block = false) {
  const stride = width + 1
  const integral = new Uint32Array(stride * (height + 1))
  for (let y = 1; y <= height; y += 1) {
    let row = 0
    for (let x = 1; x <= width; x += 1) {
      row += values[(y - 1) * width + x - 1]
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row
    }
  }
  const radius = Math.max(8, Math.round(height * (block ? .08 : .44)))
  const output = new Uint8Array(values.length)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1)
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1)
    const mean = (integral[bottom * stride + right] - integral[top * stride + right]
      - integral[bottom * stride + left] + integral[top * stride + left]) / ((right - left) * (bottom - top))
    output[y * width + x] = values[y * width + x] > mean + 18 ? 0 : 255
  }
  if (block) return output
  const seen = new Uint8Array(output.length)
  const components: { pixels: number[]; left: number; right: number; top: number; bottom: number }[] = []
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] || seen[start]) continue
    const component = { pixels: [start], left: start % width, right: start % width, top: Math.floor(start / width), bottom: Math.floor(start / width) }
    seen[start] = 1
    for (let head = 0; head < component.pixels.length; head += 1) {
      const pixel = component.pixels[head], x = pixel % width, y = Math.floor(pixel / width)
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || output[next]) continue
        seen[next] = 1
        component.pixels.push(next)
        component.left = Math.min(component.left, nx); component.right = Math.max(component.right, nx)
        component.top = Math.min(component.top, ny); component.bottom = Math.max(component.bottom, ny)
      }
    }
    components.push(component)
  }
  const minGlyphHeight = height * .18
  const glyphs = components.filter(({ top, bottom }) => bottom - top + 1 >= minGlyphHeight)
  for (const component of components) {
    if (component.bottom - component.top + 1 >= minGlyphHeight) continue
    // Keep punctuation next to a glyph; isolated starfield specks have no such neighbor.
    const besideGlyph = glyphs.some((glyph) =>
      component.left <= glyph.right + height * .2 && component.right >= glyph.left - height * .2
      && component.top <= glyph.bottom + height * .2 && component.bottom >= glyph.top - height * .2)
    if (!besideGlyph) for (const pixel of component.pixels) output[pixel] = 255
  }
  return output
}
