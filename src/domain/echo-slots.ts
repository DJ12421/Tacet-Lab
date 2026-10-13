// Empty strings keep later Echoes in their slots without changing the stored string[] shape.
export function trimEmptyEchoSlots(ids: readonly string[]): string[] {
  const slots = Array.from(ids, (id) => id || '')
  while (slots.length && !slots[slots.length - 1]) slots.pop()
  return slots
}

export function setEchoSlot(ids: readonly string[], slot: number, echoId = ''): string[] {
  const slots = Array.from({ length: Math.max(ids.length, slot + 1) }, (_, index) => ids[index] ?? '')
  if (echoId) {
    const previousSlot = slots.indexOf(echoId)
    if (previousSlot !== -1 && previousSlot !== slot) slots[previousSlot] = slots[slot]
  }
  slots[slot] = echoId
  return trimEmptyEchoSlots(slots)
}

export function clearEchoId(ids: readonly string[], echoId: string): string[] {
  return trimEmptyEchoSlots(ids.map((id) => id === echoId ? '' : id))
}
