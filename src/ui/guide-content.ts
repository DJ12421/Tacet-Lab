import type { AppView } from '../domain/types'

export type GuideId = Exclude<AppView, 'guides' | 'legal' | 'partnerships'> | 'optimizer' | 'theorizer' | 'rotation' | 'overview' | 'forte' | 'backup'
export type GuideCounts = { echoes: number; weapons: number; characters: number; teams: number }
export interface GuideStep {
  title: string
  body: string
  target: string
  image: string
  action?: string
  event?: 'input' | 'change'
  complete?: string
  increase?: string
  count?: keyof GuideCounts
  when?: 'first' | 'returning' | 'no-echoes' | 'has-echoes' | 'few-echoes' | 'no-weapons' | 'has-weapons' | 'no-characters' | 'has-characters' | 'no-teams' | 'has-teams'
}
export interface Guide {
  id: GuideId
  title: string
  summary: string
  outcome: string
  steps: readonly GuideStep[]
}

export const stepsFor = (guide: Guide, counts: GuideCounts, firstVisit: boolean) => guide.steps.filter((step) => {
  switch (step.when) {
    case 'first': return firstVisit
    case 'returning': return !firstVisit
    case 'no-echoes': return counts.echoes === 0
    case 'has-echoes': return counts.echoes > 0
    case 'few-echoes': return counts.echoes > 0 && counts.echoes < 5
    case 'no-weapons': return counts.weapons === 0
    case 'has-weapons': return counts.weapons > 0
    case 'no-characters': return counts.characters === 0
    case 'has-characters': return counts.characters > 0
    case 'no-teams': return counts.teams === 0
    case 'has-teams': return counts.teams > 0
    default: return true
  }
})

// Action selectors are matched against a real click/change. Completion selectors check resulting UI state.
const teamMemberStart: GuideStep[] = [
  { title: 'Create a team workspace', body: 'Create a local team to open its Formation.', target: '.tw-first-team, .tw-gallery-create', action: '.tw-first-team .primary, .tw-gallery-create', complete: '.tw-primary-tabs', image: 'teams.jpg', when: 'no-teams' },
  { title: 'Open a team workspace', body: 'Open a saved team, or select Formation if its workspace is already open.', target: '.tw-gallery-open, .tw-primary-tabs', action: '.tw-gallery-open, .tw-primary-tabs button:first-child', complete: '.tw-primary-tabs', image: 'teams.jpg', when: 'has-teams' },
  { title: 'Add an owned character', body: 'If your roster is empty, open Characters, add one, then return to the team.', target: '.desktop-nav, .mobile-nav, .character-roster-toolbar', action: '.character-choice', count: 'characters', image: 'characters-picker.jpg', when: 'no-characters' },
  { title: 'Select a filled member', body: 'In Formation, assign an owned character to an empty slot if needed. Then select that member tab to open its sections.', target: '.tw-member-columns, .tw-primary-tabs', action: '.tw-primary-tabs button:not(:first-child)', complete: '.tw-subnav', image: 'teams-formation.jpg' }
]

export const guides: readonly Guide[] = [
  {
    id: 'dashboard', title: 'Getting started', summary: 'Choose a starting point, personalize Home, and move from inventory to a team.', outcome: 'Know the path from a first Echo to a team.',
    steps: [
      { title: 'Switch the Home hero', body: 'Point to or tap the hero portrait, choose Change home character, then select a character. This only changes the Home artwork.', target: '.home-hero-character-control', action: '.home-hero-character-menu [role="option"]', image: 'home-hero-picker.jpg' },
      { title: 'Start the build path', body: 'Choose a step on Home: add Echoes and weapons, build a character, then plan a team. Browse the Archive first if you need to check a catalog entry.', target: '.home-steps', action: '.home-steps .home-step', image: 'home-path.jpg', when: 'first' },
      { title: 'Resume your build', body: 'Choose the next step in the Home path. Your inventory and builds stay on this device so you can resume where you left off.', target: '.home-steps', action: '.home-steps .home-step', image: 'home-path.jpg', when: 'returning' }
    ]
  },
  {
    id: 'archive', title: 'Explore the Archive', summary: 'Find game reference entries and inspect their details.', outcome: 'Find and understand an Archive entry without adding it to inventory.',
    steps: [
      { title: 'Pick a category', body: 'Start with Characters, Weapons, Sonatas, or Echoes. These are catalog entries; owned copies appear in your inventory.', target: '.archive-section-tabs', action: '.archive-section-tabs button', image: 'archive.jpg', when: 'first' },
      { title: 'Switch categories', body: 'Choose a category to continue researching. Each category has its own search and filters.', target: '.archive-section-tabs', action: '.archive-section-tabs button', image: 'archive.jpg', when: 'returning' },
      { title: 'Narrow the results', body: 'Search by name or use the category filters and sort controls to find the entry you want.', target: '.archive-controls', action: '.archive-controls input, .archive-controls button, .archive-controls select', image: 'archive-filters.jpg' },
      { title: 'Inspect an entry', body: 'Open a character, weapon, or Echo card to read its details. Sonata effects are shown on their cards.', target: '.archive-entry-card, .archive-sonata-card', action: '.archive-entry-card, .archive-sonata-card', image: 'archive-detail.jpg' }
    ]
  },
  {
    id: 'scanner', title: 'Scan and review Echoes', summary: 'Capture or enter Echoes, review every candidate, then save approved copies.', outcome: 'Add a checked Echo to your local collection.',
    steps: [
      { title: 'Match the screen layout', body: 'Choose Inventory, Build cards, or Character menu to match the source you will capture.', target: '.scanner-source-picker', action: '.scanner-source-picker button', image: 'scanner.jpg', when: 'first' },
      { title: 'Confirm the source layout', body: 'Check that the selected layout matches your current source before capturing more Echoes.', target: '.scanner-source-picker', action: '.scanner-source-picker button', image: 'scanner.jpg', when: 'returning' },
      { title: 'Find calibration if needed', body: 'Calibration is hidden by default. Open Advanced scanner settings to find Calibrate. Use it only if fields are read incorrectly; otherwise leave the calibration profile alone.', target: '.scanner-advanced', action: '.scanner-advanced summary', complete: '.scanner-advanced[open]', image: 'scanner-advanced.jpg' },
      { title: 'Choose a capture method', body: 'Use Scan game window on supported desktop browsers, or import images/video. Manual entry works when capture is unavailable. Screen sharing requires your browser approval.', target: '.scanner-start-actions', action: '.scanner-start-actions button, .scanner-start-actions input', image: 'scanner-methods.jpg' },
      { title: 'Review before saving', body: 'After capture, open a scanned card. Correct uncertain fields and inspect duplicates before approving a candidate. Nothing enters your collection automatically.', target: '.scanned-echo-grid', action: '.scanned-echo-grid .echo-card, .scanned-echo-grid .scan-error-card, .scanned-echo-grid .scanned-loadout-card', complete: '.scan-review-popout', image: 'scanner-ready.jpg' },
      { title: 'Save the reviewed Echo', body: 'Resolve the highlighted name and Sonata if needed, then approve the candidate. The collection count must increase before this tutorial is complete.', target: '.scan-review-popout button[aria-label^="Name Unknown Echo"], .scan-review-popout .sonata-picker-trigger, .scan-review-popout, .scanned-echo-actions', action: '.scan-review-popout .review-actions .primary, .scanned-echo-actions .primary', count: 'echoes', image: 'scanner-ready.jpg' }
    ]
  },
  {
    id: 'echoes', title: 'Manage your Echoes', summary: 'A first-Echo path or an owned-collection path, selected from your local inventory.', outcome: 'Find, inspect, and protect an Echo.',
    steps: [
      { title: 'Add your first Echo', body: 'Choose Add Echo. Scanner opens; use manual entry or capture, review the candidate, and save it before returning to Echoes.', target: '.echo-empty-welcome button', action: '.echo-empty-welcome button', image: 'echoes.jpg', when: 'no-echoes' },
      { title: 'Save the new Echo', body: 'Resolve the highlighted name and Sonata if needed, then approve the candidate. Return to Echoes to inspect the new card.', target: '.scan-review-popout button[aria-label^="Name Unknown Echo"], .scan-review-popout .sonata-picker-trigger, .scan-review-popout, .scanned-echo-actions', action: '.scan-review-popout .review-actions .primary, .scanned-echo-actions .primary', count: 'echoes', image: 'scanner-ready.jpg', when: 'no-echoes' },
      { title: 'Inspect your first Echo', body: 'Return to Echoes from the main navigation and open the saved card. Check its stats, Sonata, level, and equipment before using it in a build.', target: '.echo-grid, .desktop-nav, .mobile-nav', action: '.echo-grid > *', complete: '.echo-editor-backdrop', image: 'echoes-detail.jpg', when: 'no-echoes' },
      { title: 'Find an owned Echo', body: 'Search, filter by cost or Sonata, or sort the collection to narrow the cards.', target: '.echo-inventory-toolbar, .echo-grid', action: '.echo-inventory-toolbar input, .echo-filter-toggle, .echo-sort-trigger', image: 'echoes-owned.jpg', when: 'has-echoes' },
      { title: 'Inspect the card', body: 'Open a saved Echo to check its main stat, substats, Sonata, level, and equipment. Edit incorrect values in its detail window.', target: '.echo-grid', action: '.echo-grid > *', complete: '.echo-editor-backdrop', image: 'echoes-detail.jpg', when: 'has-echoes' },
      { title: 'Understand Roll Grade', body: 'Close the detail, then open the Roll Grade explanation on a card. The grade describes roll quality and is not a character-specific build score.', target: '.echo-roll-info', action: '.echo-roll-info', image: 'echo-roll-guide.jpg', when: 'has-echoes' },
      { title: 'Protect a useful piece', body: 'Close the explanation, then lock an Echo you want to keep. Locked pieces cannot be accidentally discarded or deleted. You can unlock them later.', target: '.echo-lock-action', action: '.echo-lock-action', image: 'echoes-detail.jpg', when: 'has-echoes' }
    ]
  },
  {
    id: 'weapons', title: 'Manage your Weapons', summary: 'Add an owned weapon, set its progress, and make it available to a character.', outcome: 'Have an accurate weapon ready for a loadout.',
    steps: [
      { title: 'Add your first weapon', body: 'Choose Choose weapon in the empty collection, then pick the exact catalog entry you own.', target: '.wv-empty .primary', action: '.wv-empty .primary', complete: '.weapon-catalog-picker, .catalog-picker', image: 'weapons-picker.jpg', when: 'no-weapons' },
      { title: 'Find an existing weapon', body: 'Use the collection search or filters to find the copy you want to inspect. Add weapon remains available for another copy.', target: '.wv-toolbar', action: '.wv-toolbar input, .wv-toolbar .filter-chips button', image: 'weapons-owned.jpg', when: 'has-weapons' },
      { title: 'Select the owned copy', body: 'Search the picker and choose your weapon. Wait for the owned collection to update.', target: '.weapon-catalog-picker, .catalog-picker', action: '.catalog-choice', count: 'weapons', image: 'weapons-picker.jpg', when: 'no-weapons' },
      { title: 'Open the owned weapon', body: 'Open the owned weapon card to inspect its level, rank, stats, and passive.', target: '.wv-card-main', action: '.wv-card-main', complete: '.weapon-config-modal', image: 'weapons-detail.jpg' },
      { title: 'Set level and rank', body: 'Adjust the level or rank slider to match the copy you own in game. The displayed stats update with your choice.', target: '.weapon-level-control', action: '.weapon-level-control input', event: 'change', image: 'weapons-detail.jpg' },
      { title: 'Choose a compatible character', body: 'Open Equipped by and choose a compatible owned character, if one is available. Only compatible weapon types are offered.', target: '.weapon-equip-select', action: '.weapon-equip-select .character-equip-trigger', complete: '.weapon-equip-select .character-equip-menu', image: 'weapons-detail.jpg' }
    ]
  },
  {
    id: 'characters', title: 'Build a Character', summary: 'Add a character and work through every part of the character card.', outcome: 'Create a usable equipped build.',
    steps: [
      { title: 'Add a character', body: 'Choose Add character above the roster. Search the picker for a character you own.', target: '.character-roster-toolbar .primary', action: '.character-roster-toolbar .primary', complete: '.character-catalog-picker', image: 'characters-picker.jpg', when: 'no-characters' },
      { title: 'Open an existing character', body: 'Select a roster card to resume its equipped build. Add character remains available when you need another one.', target: '.character-candy-card', action: '.character-candy-card', complete: '.cs-page', image: 'characters-owned.jpg', when: 'has-characters' },
      { title: 'Choose the catalog entry', body: 'Select the character in the picker. The new owned card appears in your roster.', target: '.character-catalog-picker', action: '.character-choice', count: 'characters', image: 'characters-picker.jpg', when: 'no-characters' },
      { title: 'Open the character card', body: 'Select the roster card. Its portrait, level, sequence, skills, weapon, and five Echo slots summarize the equipped build.', target: '.character-candy-card', action: '.character-candy-card', complete: '.cs-page', image: 'characters-owned.jpg', when: 'no-characters' },
      { title: 'Open level choices', body: 'Select the identity panel or its level badge. Choose the level shown in game from the popover; the card recalculates its base stats.', target: '.cbc-identity', action: '.cbc-identity', complete: '.cbc-level-popover', image: 'characters-owned.jpg' },
      { title: 'Set sequence', body: 'Use the sequence stars across the top of the card to match unlocked sequence nodes. Select a star again to lower the sequence.', target: '.cbc-sequences', action: '.cbc-sequences button', image: 'characters-owned.jpg' },
      { title: 'Open skills and bonuses', body: 'Select a skill icon to open its level choices. The smaller nodes above it toggle unlocked skill bonuses and inherent skills.', target: '.cbc-skills', action: '.cbc-main-skill', complete: '.cbc-skill-level-popover', image: 'characters-owned.jpg' },
      { title: 'Inspect stat priorities', body: 'Open the statistics panel to review current attributes and set which Echo substats matter most to this character.', target: '.cbc-stats', action: '.cbc-stats', complete: '.cs-weight-editor', image: 'characters-loadout.jpg' },
      { title: 'Inspect the weapon slot', body: 'Close the priority editor and select the weapon panel. Choose an owned compatible weapon, or add one from the picker if needed.', target: '.cbc-weapon', action: '.cbc-weapon', complete: '.cs-weapon-picker', image: 'characters-loadout.jpg' },
      { title: 'Inspect Echo slots', body: 'Close the weapon picker and select an Echo slot. Choose from owned Echoes while keeping total cost within the limit; the first slot is the main Echo.', target: '.cbc-echo-row', action: '.cbc-echo-row', complete: '.cs-echo-picker', image: 'characters-loadout.jpg' },
      { title: 'Review the active build', body: 'Close the Echo picker, then inspect the resulting stats and build selector. Equipped is active; a saved build is a separate reusable alternative.', target: '.cbc-stats, .cs-loadout-source', action: '.cs-loadout-source select, .cbc-stats', image: 'characters-loadout.jpg' }
    ]
  },
  {
    id: 'teams', title: 'Plan a Team', summary: 'Visit Formation and every member tab, then understand the shared scenario and results.', outcome: 'Navigate a complete team workspace.',
    steps: [
      { title: 'Create a team', body: 'Choose Create team in the gallery. Teams are saved locally; you can rename or revisit them later.', target: '.tw-gallery-create, .tw-first-team', action: '.tw-gallery-create, .tw-first-team .primary', count: 'teams', image: 'teams.jpg', when: 'no-teams' },
      { title: 'Open a team', body: 'Open a saved team card, or select Formation if you are already inside its workspace.', target: '.tw-gallery-open, .tw-primary-tabs', action: '.tw-gallery-open, .tw-primary-tabs button:first-child', complete: '.tw-primary-tabs', image: 'teams.jpg', when: 'has-teams' },
      { title: 'Add a character first', body: 'A member tab needs an owned character. Open Characters from the main navigation, add one, then return to this team.', target: '.desktop-nav, .mobile-nav, .character-roster-toolbar', action: '.character-choice', count: 'characters', image: 'characters-picker.jpg', when: 'no-characters' },
      { title: 'Set the Formation', body: 'Choose an owned character for an empty slot, or open an existing member’s build row. Formation shows loadouts, contributions, and team effects.', target: '.tw-member-columns', action: '.character-choice, .tw-member-build-row', complete: '.tw-member-build-row', image: 'teams-formation.jpg' },
      { title: 'Review the scenario', body: 'Expand Combat scenario to set enemy level, resistance, timing, and relevant status stacks. These settings affect comparisons.', target: '.tw-environment-details', action: '.tw-environment-details summary', complete: '.tw-environment-details[open]', image: 'teams-formation.jpg' },
      { title: 'Open a member', body: 'Choose a character tab above the workspace. The member subnavigation appears when that slot has a character.', target: '.tw-primary-tabs', action: '.tw-primary-tabs button:not(:first-child)', complete: '.tw-subnav', image: 'teams-member.jpg' },
      { title: 'Explore Overview', body: 'Overview shows the active loadout, stats, weapon, Echoes, effects, and conditions used in the estimate.', target: '.tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(1)', image: 'teams-member.jpg' },
      { title: 'Explore Forte', body: 'Forte lists skills and sequences, attack rows, and calculation details. Choose an attack row to inspect its number.', target: '.tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(2)', image: 'teams-forte.jpg' },
      { title: 'Explore Optimizer', body: 'Optimizer searches owned Echo combinations for this member. Set the pool and objective before generating results.', target: '.tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(3)', image: 'optimizer.jpg' },
      { title: 'Explore Theorizer', body: 'Theorizer estimates one hypothetical equipment change against the current build; it does not alter inventory.', target: '.tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(4)', image: 'theorizer.jpg' },
      { title: 'Explore Rotation', body: 'Rotation places member attacks on a shared timeline. Use the result mode buttons to compare Average, Non-crit, and Critical estimates.', target: '.tw-primary-tabs', action: '.tw-primary-tabs [role="tab"]:nth-child(5)', image: 'rotation.jpg' }
    ]
  },
  {
    id: 'overview', title: 'Understand Overview', summary: 'Read a Team member’s loadout, stats, effects, and damage conditions.', outcome: 'Know which inputs are behind the member estimate.',
    steps: [
      ...teamMemberStart,
      { title: 'Open a member Overview', body: 'Open a team, choose a filled member slot, and select Overview.', target: '.tw-primary-tabs, .tw-subnav', action: '.tw-primary-tabs button:nth-child(n+2):nth-child(-n+4), .tw-subnav [role="tab"]:nth-child(1)', image: 'teams-member.jpg' },
      { title: 'Check equipped gear', body: 'Read the weapon and Echo slots, then open an Echo slot to see which owned pieces can be equipped. Missing or over-cost gear changes the estimate.', target: '.tw-overview-equipment', action: '.tw-echo-slot-add, .tw-overview-echo-actions button:last-child', image: 'teams-member.jpg' },
      { title: 'Inspect stats and effects', body: 'Select a resolved stat to see its sources. Check conditional effects only when they apply in your scenario.', target: '.tw-sheet-stats, .tw-v2-effect-list', action: '.tw-sheet-stats .calculated-value, .tw-condition-toggle', image: 'teams-member.jpg' },
      { title: 'Compare result modes', body: 'Switch Average, Non-crit, or Critical in the shared team navigation. The selected mode also affects Forte and Rotation.', target: '.tw-nav-result-modes', action: '.tw-nav-result-modes button', image: 'teams-forte.jpg' }
    ]
  },
  {
    id: 'forte', title: 'Understand Forte', summary: 'Trace attacks, skill levels, sequences, and damage details for a Team member.', outcome: 'Explain where a displayed attack value comes from.',
    steps: [
      ...teamMemberStart,
      { title: 'Open Forte', body: 'Open a filled Team member and select Forte.', target: '.tw-primary-tabs, .tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(2)', image: 'teams-forte.jpg' },
      { title: 'Read the sections', body: 'Normal Attack, Skill, Forte Circuit, Liberation, and Intro are grouped with their in-game descriptions and calculated attacks. Expand a description to read it.', target: '.tw-forte-heading, .tw-skill-card', action: '.tw-forte-workspace .tw-description-trigger, .tw-forte-heading button', image: 'teams-forte.jpg' },
      { title: 'Inspect a damage value', body: 'Choose a calculated number to see its breakdown. Use the result mode buttons to compare average, non-crit, and critical values.', target: '.tw-forte-workspace .calculated-value', action: '.tw-forte-workspace .calculated-value', complete: '.calculation-backdrop', image: 'teams-forte.jpg' },
      { title: 'Check skill levels', body: 'Close the breakdown and open a skill-level menu to check the level used for these values. Review any visible effect conditions too. Bundled game values remain estimates pending in-game verification.', target: '.tw-skill-card select, .tw-forte-workspace .tw-condition-toggle', action: '.tw-skill-card select, .tw-forte-workspace .tw-condition-toggle', image: 'teams-forte.jpg' }
    ]
  },
  {
    id: 'optimizer', title: 'Search Echo builds', summary: 'Rank owned Echo combinations for a Team member.', outcome: 'Decide whether to equip, save, or theorycraft a result.',
    steps: [
      ...teamMemberStart,
      { title: 'Open Optimizer', body: 'Open a team with a filled member and choose Optimizer on the member subnavigation.', target: '.tw-primary-tabs, .tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(3)', image: 'optimizer.jpg' },
      { title: 'Add Echoes to search', body: 'Your inventory has no Echoes yet. Open the scanner to add reviewed Echoes, then return to this guide when you have a search pool.', target: '.optimizer-empty', action: '.optimizer-empty button', image: 'optimizer-filters.jpg', when: 'no-echoes' },
      { title: 'Allow a partial build', body: 'With fewer than five Echoes, enable partial builds so the search can use the pieces you own.', target: '.optimizer-source-card', action: '.optimizer-source-card input[type="checkbox"]:last-of-type', event: 'change', image: 'optimizer-filters.jpg', when: 'few-echoes' },
      { title: 'Choose the search pool', body: 'Adjust an inventory filter for owned Echoes. Keep the eligible count above zero; then check the damage objective below.', target: '.optimizer-filter-column', action: '.optimizer-level-filter input[aria-label="Minimum Echo level"], .optimizer-level-filter input[aria-label="Maximum Echo level"], .optimizer-toggle-row button', image: 'optimizer-filters.jpg', when: 'has-echoes' },
      { title: 'Check the main Echo rule', body: 'Open Main Echo policy. If the character has no equipped main Echo, choose Optimize the main Echo too so the search can select one from inventory.', target: '.optimizer-source-card', action: '.optimizer-source-card select:has(option[value="selected"])', image: 'optimizer-filters.jpg', when: 'has-echoes' },
      { title: 'Generate results', body: 'Choose the damage objective in the run bar, then Generate builds. A capped search may stop before every combination is explored.', target: '.optimizer-run-bar', action: '.optimizer-run-bar .primary', complete: '.optimizer-results-heading', image: 'optimizer-results.jpg', when: 'has-echoes' },
      { title: 'Inspect a result', body: 'Open a ranked build to review its Echoes, stats, and damage difference against the current loadout.', target: '.optimizer-build-result', action: '.optimizer-result-toggle', complete: '.optimizer-result-details', image: 'optimizer-result-detail.jpg', when: 'has-echoes' },
      { title: 'Keep or compare the build', body: 'Equip changes the active loadout; Save build stores a reusable copy; Theorycraft creates a separate hypothetical copy. Choose the option you want.', target: '.optimizer-result-actions', action: '.optimizer-result-actions button', image: 'optimizer-result-detail.jpg', when: 'has-echoes' }
    ]
  },
  {
    id: 'theorizer', title: 'Compare a hypothetical change', summary: 'Use four Theorizer modes without altering the active loadout.', outcome: 'Understand a one-axis hypothetical comparison.',
    steps: [
      ...teamMemberStart,
      { title: 'Open Theorizer', body: 'Open a team, choose a filled member, then select Theorizer. Its baseline is that member’s current build.', target: '.tw-primary-tabs, .tw-subnav', action: '.tw-subnav [role="tab"]:nth-child(4)', image: 'theorizer.jpg' },
      { title: 'Check the comparison assumptions', body: 'Rank for chooses the attack or team rotation to compare. Open Buff settings to confirm which weapon and equipment effects apply, then close that dialog.', target: '.tw-theorizer-toolbar, .equipment-buff-trigger', action: '.equipment-buff-trigger', complete: '.equipment-buff-backdrop', image: 'theorizer.jpg' },
      { title: 'Compare Main Stats', body: 'Main Stats explores one main-stat choice using a hypothetical Echo. Choose a candidate and read its gain or loss against the baseline.', target: '.tw-theorizer-modes', action: '.tw-theorizer-modes button:nth-child(1)', image: 'theorizer.jpg' },
      { title: 'Inspect Sub Stats', body: 'Sub Stats ranks the estimated impact of one mid-value roll. This mode is read-only; it does not create an Echo or save a build.', target: '.tw-theorizer-modes', action: '.tw-theorizer-modes button:nth-child(2)', image: 'theorizer-substats.jpg' },
      { title: 'Compare Sonata Sets', body: 'Sonata Sets models a set change while respecting the one-equipment-axis rule. Check eligibility warnings and compare the projected result.', target: '.tw-theorizer-modes', action: '.tw-theorizer-modes button:nth-child(3)', image: 'theorizer-compare.jpg' },
      { title: 'Compare Weapons', body: 'Weapons models one weapon change. Select an eligible option, then compare the damage and stat differences.', target: '.tw-theorizer-modes', action: '.tw-theorizer-modes button:nth-child(4)', image: 'theorizer-weapons.jpg' },
      { title: 'Read the comparison', body: 'Select a ranked candidate and inspect the baseline, damage difference, stat changes, and warnings. Hypothetical choices remain separate from inventory and Equipped.', target: '.tw-theorizer-list', action: '.tw-theorizer-list button', complete: '.tw-theorizer-compare-modal', image: 'theorizer-compare.jpg' }
    ]
  },
  {
    id: 'rotation', title: 'Build a Rotation', summary: 'Place actions in time, edit their mechanics, and interpret the team result.', outcome: 'Author a usable action sequence.',
    steps: [
      ...teamMemberStart,
      { title: 'Open Rotation', body: 'Open a team with at least one filled member and choose Rotation.', target: '.tw-primary-tabs', action: '.tw-primary-tabs [role="tab"]:nth-child(5)', image: 'rotation.jpg' },
      { title: 'Set the time window', body: 'Enter the sequence length in seconds. DPS is rotation damage divided by this window, so use the interval you intend to model.', target: '.tw-rotation-window', action: '.tw-rotation-window input', event: 'input', image: 'rotation.jpg' },
      { title: 'Add an action', body: 'Choose member, attack, and timestamp in the composer, then add it.', target: '.tw-rotation-composer', action: '.tw-rotation-composer button', increase: '.tw-rotation-card', image: 'rotation-action.jpg' },
      { title: 'Edit play order and timing', body: 'Double-click a Play order action to find its timeline clip. Open Edit action and mechanics on the card to change attack, timestamp, duration, or repeat count; drag clips to move or trim them.', target: '.tw-rotation-action-editor', action: '.tw-rotation-action-editor summary', complete: '.tw-rotation-action-editor[open]', image: 'rotation-editor.jpg' },
      { title: 'Review mechanics', body: 'Inspect the effects and damage split in the open editor. Close it when finished; only model effects that actually occur in the sequence.', target: '.tw-rotation-mechanics, .tw-action-breakdown', action: '.tw-rotation-action-editor summary', image: 'rotation-editor.jpg' },
      { title: 'Read the result', body: 'Rotation analysis shows total damage, DPS, and each contribution. Open the calculated rotation total to trace its number.', target: '.tw-rotation-kpis', action: '.tw-rotation-kpis .calculated-value', complete: '.calculation-backdrop', image: 'rotation-action.jpg' }
    ]
  },
  {
    id: 'backup', title: 'Import and export data', summary: 'Make a local backup and review changes before restoring one.', outcome: 'Know how to safeguard and restore local account data.',
    steps: [
      { title: 'Open Export', body: 'Choose Export in the top bar. The dialog lists the collections included in the versioned JSON backup.', target: '.topbar button[aria-label="Export data"]', action: '.topbar button[aria-label="Export data"]', complete: '.export-data-modal', image: 'export-backup.jpg' },
      { title: 'Download the backup', body: 'Review the counts and download the JSON file to a location you control. Optimizer filters and past search results are excluded.', target: '.export-data-modal', action: '.export-data-modal .primary', image: 'export-backup.jpg' },
      { title: 'Open Import', body: 'Choose Import in the top bar, then Choose backup. A Tacet Lab or supported external account JSON file is read locally.', target: '.topbar button[aria-label="Import data"]', action: '.topbar button[aria-label="Import data"]', complete: '.import-data-modal', image: 'import-backup.jpg' },
      { title: 'Review before applying', body: 'Choose the backup you just downloaded, then inspect the preview of new and updated records. Apply changes only when the preview matches your intent; a backup of the same account may have no changes to apply.', target: '.import-file-row, .import-preview', action: '.import-file-row input[type="file"]', event: 'change', complete: '.import-preview', image: 'import-backup.jpg' }
    ]
  }
]

export const guideFor = (id: string | undefined) => guides.find((guide) => guide.id === id)
