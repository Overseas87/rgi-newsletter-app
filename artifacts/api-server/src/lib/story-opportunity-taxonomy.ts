export const STORY_MATCHING_TAXONOMY_VERSION = "rgi-story-topics-v1";

export type TaxonomyTopic = {
  slug: string;
  label: string;
  aliases: readonly string[];
  parents: readonly string[];
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const topic = (
  slug: string,
  label: string,
  aliases: readonly string[] = [],
  parents: readonly string[] = [],
): TaxonomyTopic => ({ slug, label, aliases, parents });

/**
 * A deliberately bounded taxonomy. It covers the canonical article tags emitted
 * by the current scorer, the three RGI disciplines, and a few approved profile
 * aliases/regions needed by the first deterministic matching workflow.
 */
export const STORY_MATCHING_TAXONOMY: readonly TaxonomyTopic[] = [
  topic("geopolitics-global-power", "Geopolitics & Global Power", [
    "geopolitics",
    "global power",
  ]),
  topic(
    "wars-conflict-security",
    "Wars, Conflict & Security",
    ["conflict", "international security"],
    ["geopolitics-global-power"],
  ),
  topic(
    "defense-military",
    "Defense & Military",
    ["defence", "military"],
    ["geopolitics-global-power"],
  ),
  topic("policy-regulation-governance", "Policy, Regulation & Governance", [
    "public policy",
    "regulation",
  ]),
  topic(
    "industrial-policy",
    "Industrial Policy",
    [],
    ["policy-regulation-governance"],
  ),
  topic("economics-macroeconomics", "Economics & Macroeconomics", [
    "economics",
    "macroeconomics",
  ]),
  topic(
    "currency-monetary-policy",
    "Currency & Monetary Policy",
    ["monetary policy", "central banking"],
    ["economics-macroeconomics"],
  ),
  topic(
    "trade-tariffs",
    "Trade & Tariffs",
    ["tariffs", "trade policy"],
    ["economics-macroeconomics"],
  ),
  topic("finance-markets", "Finance & Markets", [
    "financial markets",
    "capital markets",
  ]),
  topic(
    "banking-credit",
    "Banking & Credit",
    ["banking", "credit"],
    ["finance-markets"],
  ),
  topic("business-strategy-corporations", "Business Strategy & Corporations", [
    "business strategy",
    "corporate strategy",
    "strategy",
  ]),
  topic(
    "leadership-organizations",
    "Leadership & Organizations",
    [
      "leadership",
      "management",
      "organizational leadership",
      "organisational leadership",
    ],
    ["business-strategy-corporations"],
  ),
  topic(
    "corporate-governance",
    "Corporate Governance",
    ["board governance", "governance"],
    ["business-strategy-corporations"],
  ),
  topic(
    "operations-manufacturing",
    "Operations & Manufacturing",
    ["operations", "manufacturing"],
    ["business-strategy-corporations"],
  ),
  topic(
    "venture-startups",
    "Venture & Startups",
    ["venture capital", "startups", "entrepreneurship"],
    ["business-strategy-corporations"],
  ),
  topic("supply-chains-global-trade", "Supply Chains & Global Trade", [
    "supply chains",
    "global trade",
    "logistics",
  ]),
  topic("energy-resources", "Energy & Resources", [
    "energy",
    "natural resources",
  ]),
  topic("oil-gas", "Oil & Gas", ["petroleum"], ["energy-resources"]),
  topic(
    "commodities",
    "Commodities",
    ["commodity markets"],
    ["energy-resources"],
  ),
  topic("climate-environmental-systems", "Climate & Environmental Systems", [
    "climate",
    "sustainability",
    "environment",
  ]),
  topic("technology-ai", "Technology & AI", [
    "technology",
    "artificial intelligence",
    "ai",
    "generative ai",
    "genai",
  ]),
  topic(
    "cybersecurity",
    "Cybersecurity",
    ["cyber security"],
    ["technology-ai"],
  ),
  topic(
    "innovation-digital-transformation",
    "Innovation & Digital Transformation",
    ["innovation", "digital transformation"],
    ["technology-ai"],
  ),
  topic(
    "robotics-automation",
    "Robotics & Automation",
    ["robotics", "automation"],
    ["technology-ai"],
  ),
  topic("future-work-society", "Future of Work & Society", [
    "future of work",
    "workplace transformation",
  ]),
  topic(
    "labor-markets",
    "Labor Markets",
    ["labour markets", "workforce", "employment"],
    ["future-work-society"],
  ),
  topic("public-health", "Public Health", ["health systems"]),
  topic("education", "Education", [
    "higher education",
    "universities",
    "business education",
  ]),
  topic("real-estate", "Real Estate", ["property markets"]),
  topic("agriculture-food-systems", "Agriculture & Food Systems", [
    "agriculture",
    "food systems",
  ]),
  topic("mobility-infrastructure", "Mobility & Infrastructure", [
    "infrastructure",
    "transportation",
  ]),
  topic("strategic-foresight", "Strategic Foresight", ["foresight"]),
  topic("system-vitality", "System Vitality"),
  topic("civic-stewardship", "Civic Stewardship"),
  topic("multiple", "Multiple"),
  topic("north-america", "North America", [
    "united states",
    "usa",
    "us",
    "canada",
  ]),
  topic("latin-america", "Latin America", ["south america"]),
  topic("europe", "Europe", ["european union", "eu"]),
  topic("middle-east", "Middle East", ["mena"]),
  topic("africa", "Africa"),
  topic("asia-pacific", "Asia-Pacific", ["asia pacific", "apac", "asia"]),
  topic("global", "Global", ["worldwide", "international"]),
] as const;

const bySlug = new Map(
  STORY_MATCHING_TAXONOMY.map((entry) => [entry.slug, entry]),
);
const aliases = new Map<string, string>();
for (const entry of STORY_MATCHING_TAXONOMY) {
  aliases.set(slugify(entry.label), entry.slug);
  for (const alias of entry.aliases) aliases.set(slugify(alias), entry.slug);
}

export type ResolvedTaxonomyTerm = {
  original: string;
  normalized: string;
  canonicalSlug: string | null;
  displayLabel: string;
  resolution: "canonical" | "alias" | "unknown";
};

export function normalizeTaxonomyTerm(value: string): string {
  return slugify(value);
}

export function resolveTaxonomyTerm(value: string): ResolvedTaxonomyTerm {
  const normalized = slugify(value);
  const direct = bySlug.get(normalized);
  if (direct) {
    return {
      original: value,
      normalized,
      canonicalSlug: direct.slug,
      displayLabel: direct.label,
      resolution: "canonical",
    };
  }
  const canonicalSlug = aliases.get(normalized) ?? null;
  const canonical = canonicalSlug ? bySlug.get(canonicalSlug) : undefined;
  if (canonical) {
    return {
      original: value,
      normalized,
      canonicalSlug,
      displayLabel: canonical.label,
      resolution: "alias",
    };
  }
  return {
    original: value,
    normalized,
    canonicalSlug: null,
    displayLabel: value.trim() || normalized,
    resolution: "unknown",
  };
}

export function taxonomyTopicsRelated(
  leftSlug: string,
  rightSlug: string,
): boolean {
  if (leftSlug === rightSlug) return false;
  const left = bySlug.get(leftSlug);
  const right = bySlug.get(rightSlug);
  return Boolean(
    left?.parents.includes(rightSlug) || right?.parents.includes(leftSlug),
  );
}

export function taxonomyLabel(slug: string): string {
  return bySlug.get(slug)?.label ?? slug;
}
