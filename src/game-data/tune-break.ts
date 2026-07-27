interface TuneBreakCharacter {
  skillTreeExtras: {
    tuneBreakSkill: {
      name: string
    }
  }
}

const genericTuneBreakName = /^Tune Break\s*(?::|-)\s*/i

export function baseTuneBreakBoost(character: TuneBreakCharacter) {
  const skillName = character.skillTreeExtras.tuneBreakSkill.name.trim()
  return skillName && !genericTuneBreakName.test(skillName) ? 10 : 0
}
