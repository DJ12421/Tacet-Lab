import { calculationCatalogV2 } from '../calculation-v2.generated'

/**
 * Production mechanics boundary. The local review compiler replaces the
 * generated catalog behind this module; runtime consumers never load parser
 * code, candidates, or review-server state.
 */
export const mechanicsCatalog = calculationCatalogV2

export const mechanicsCoverage = calculationCatalogV2.provenance.reviewPolicy === 'section-approved'
  ? calculationCatalogV2.coverage
  : undefined

export const mechanicsUseSectionReviews = calculationCatalogV2.provenance.reviewPolicy === 'section-approved'
