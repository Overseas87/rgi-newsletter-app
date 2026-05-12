import type { Article } from "@workspace/db";

type SignalCluster = {
  topic: string;
  articleCount: number;
  sourceCount: number;
  avgRelevancyScore: number;
  strategicImpactScore: number;
  momentumScore: number;
  convergenceScore: number;
  institutionalRiskScore: number;
  contradictionSignal: boolean;
  signalStrength: number;
  narrative: string;
};

function tags(article: Article): string[] {
  return Array.isArray(article.topicTags) ? article.topicTags : [];
}

function text(article: Article): string {
  return `${article.headline} ${article.teaserSummary ?? ""} ${article.content ?? ""}`.toLowerCase();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function institutionalRisk(articles: Article[]): number {
  const riskPatterns = [
    /governance|regulat|court|congress|ministry|central bank|election|policy|sanction/,
    /credibility|trust|legitimacy|oversight|compliance|board|institution/,
    /supply chain|capital|labor|security|military|tariff|inflation|rates/,
  ];
  const hits = articles.reduce((sum, article) => sum + (hasAny(text(article), riskPatterns) ? 1 : 0), 0);
  return Math.min(10, Math.round((4 + (hits / Math.max(1, articles.length)) * 6) * 10) / 10);
}

function contradiction(articles: Article[]): boolean {
  const combined = articles.map(text).join(" ");
  const optimism = /(rally|growth|deal|recovery|approval|breakthrough|easing|record high|optimism)/.test(combined);
  const caution = /(risk|warning|threat|sanction|failure|uncertainty|crisis|reject|lawsuit|blocked)/.test(combined);
  return optimism && caution;
}

function narrativeFor(topic: string, cluster: Article[], sourceCount: number, contradictionSignal: boolean): string {
  const top = cluster.slice().sort((a, b) => Number(b.relevancyScore ?? 0) - Number(a.relevancyScore ?? 0))[0];
  const frame = topic.toLowerCase();
  const base = `${topic} is showing ${sourceCount > 1 ? "cross-source convergence" : "a concentrated source signal"} across ${cluster.length} article${cluster.length === 1 ? "" : "s"}`;
  if (/geopolitic|war|defense|security/i.test(frame)) {
    return `${base}; the operational question is whether institutions are pricing political risk faster than diplomatic or military realities are changing.`;
  }
  if (/finance|market|econom|currency|bank/i.test(frame)) {
    return `${base}; the strategic issue is whether capital allocation is moving ahead of policy clarity and real-economy confirmation.`;
  }
  if (/ai|technology|cyber|digital/i.test(frame)) {
    return `${base}; the deeper signal is a governance and execution test, not simply a capability story.`;
  }
  if (/policy|governance|regulation/i.test(frame)) {
    return `${base}; the institutional meaning is that legitimacy, compliance, and strategic freedom are tightening at the same time.`;
  }
  return `${base}; leaders should treat it as a decision signal rather than an isolated story${contradictionSignal ? ", especially because the source set contains unresolved tension" : ""}. ${top?.headline ? `Lead signal: ${top.headline}` : ""}`.trim();
}

export function buildSignalClusters(articles: Article[], limit = 12): SignalCluster[] {
  const buckets = new Map<string, Article[]>();
  for (const article of articles) {
    if (Number(article.relevancyScore ?? 0) < 5.5) continue;
    const primary = tags(article)[0] ?? "Strategic Signals";
    if (!buckets.has(primary)) buckets.set(primary, []);
    buckets.get(primary)!.push(article);
  }

  return [...buckets.entries()]
    .map(([topic, cluster]) => {
      const scores = cluster.map((article) => Number(article.relevancyScore ?? 0)).filter(Number.isFinite);
      const avg = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
      const sources = new Set(cluster.map((article) => article.sourceName || article.sourceUrl || article.url));
      const recent = cluster.filter((article) => Date.now() - new Date(article.scrapedAt).getTime() < 36 * 60 * 60 * 1000).length;
      const convergenceScore = Math.min(10, 3 + sources.size * 1.3 + Math.log(cluster.length + 1) * 1.2);
      const momentumScore = Math.min(10, 3 + recent * 0.9 + cluster.filter((article) => article.isEmergingSignal).length * 1.2);
      const institutionalRiskScore = institutionalRisk(cluster);
      const contradictionSignal = contradiction(cluster);
      const strategicImpactScore = Math.min(10, avg * 0.7 + convergenceScore * 0.2 + institutionalRiskScore * 0.1);
      const signalStrength = strategicImpactScore * 0.45 + momentumScore * 0.25 + convergenceScore * 0.2 + institutionalRiskScore * 0.1;

      return {
        topic,
        articleCount: cluster.length,
        sourceCount: sources.size,
        avgRelevancyScore: Math.round(avg * 10) / 10,
        strategicImpactScore: Math.round(strategicImpactScore * 10) / 10,
        momentumScore: Math.round(momentumScore * 10) / 10,
        convergenceScore: Math.round(convergenceScore * 10) / 10,
        institutionalRiskScore,
        contradictionSignal,
        signalStrength: Math.round(signalStrength * 10) / 10,
        narrative: narrativeFor(topic, cluster, sources.size, contradictionSignal),
      };
    })
    .sort((a, b) => b.signalStrength - a.signalStrength)
    .slice(0, limit);
}
