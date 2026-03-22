const HIGH_IMPACT_ENTITY_TYPES = new Set(['military', 'rebel', 'terrorist', 'paramilitary', 'militant']);

// Accepts both codebase categories (Seismic, Weather, etc.) and NER categories (disaster, conflict, etc.)
const CATEGORY_WEIGHTS = {
  Conflict: 90, Seismic: 85, Weather: 80, Humanitarian: 75, Civil: 65,
  Health: 60, Political: 50, Economic: 45, Infrastructure: 40, Climate: 35,
  conflict: 90, disaster: 85, humanitarian: 75, political: 50, economic: 45,
  General: 30, general: 30
};

export function computeCompositeSeverity(ctx) {
  const keywordScore = (ctx.keywordSeverity || 0) * 0.3;

  const corroboration = Math.min(100,
    Math.log2(Math.max(1, ctx.articleCount)) * (ctx.diversityScore || 0) * 25
  ) * 0.3;

  const highImpactCount = (ctx.entities?.organizations || [])
    .filter(o => HIGH_IMPACT_ENTITY_TYPES.has(o.type)).length;
  const entityScore = Math.min(100, highImpactCount * 40) * 0.2;

  const categoryWeight = CATEGORY_WEIGHTS[ctx.category] || CATEGORY_WEIGHTS.General;
  const typeScore = categoryWeight * 0.2;

  // Phase 4 velocity signal
  if (ctx.velocitySignal != null) {
    const velocityScore = Math.min(100, ctx.velocitySignal) * 0.2;
    const adjustedCorroboration = corroboration * (20 / 30);
    const adjustedType = typeScore * (10 / 20);
    return Math.round(Math.min(100, Math.max(0,
      keywordScore + adjustedCorroboration + entityScore + adjustedType + velocityScore
    )));
  }

  return Math.round(Math.min(100, Math.max(0,
    keywordScore + corroboration + entityScore + typeScore
  )));
}
