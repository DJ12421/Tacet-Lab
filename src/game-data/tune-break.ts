interface TuneBreakCharacter {
  skillTreeExtras: {
    tuneBreakSkill: {
      name: string
    }
  }
}

export const tuneBreakLevelBases: Readonly<Record<number, number>> = {
  1: 2.215, 20: 5.932, 40: 29.357, 50: 60.934, 60: 130.868, 70: 249.715, 80: 437.085, 90: 716.22
}

const genericTuneBreakName = /^Tune Break\s*(?::|-)\s*/i

export function baseTuneBreakBoost(character: TuneBreakCharacter) {
  const skillName = character.skillTreeExtras.tuneBreakSkill.name.trim()
  return skillName && !genericTuneBreakName.test(skillName) ? 10 : 0
}
