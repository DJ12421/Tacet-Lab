import type { TeamMemberModel } from '../team-workspace-model'

export const ELEMENT_COLORS: Record<string, string> = {
  Aero:'#73d9c6', Electro:'#a98bf5', Fusion:'#ef7662', Glacio:'#78bde8', Havoc:'#c06ddb', Spectro:'#e6c96b'
}

export function teamMemberName(member: Partial<TeamMemberModel> & { slot: number }) {
  return member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`
}
