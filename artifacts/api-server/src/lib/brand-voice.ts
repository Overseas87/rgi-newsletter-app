export type BrandComplianceReport = {
  removedPhrases: string[];
  emDashReplaced: boolean;
  sectionsStrengthened: string[];
};

export type BrandCompliantBrief<T> = T & {
  brandCompliance?: BrandComplianceReport;
};

export const RGI_BRAND_VOICE_SYSTEM_PROMPT = `OFFICIAL RGI BRAND VOICE - GOVERNING AUTHORITY

Governing line: Where Leaders Learn Judgment.

RGI helps accomplished leaders improve judgment where conventional business training, technical expertise, and analytic tools are no longer enough. The purpose is not to help readers consume more news. The purpose is to help them think past the headline toward consequence, timing, responsibility, restraint, and decision quality.

RGI uses timely news as evidence, not as the product. The summary belongs because it broadens the reader's lens beyond normal market myopia, but the analytical product is what comes after: second-order consequence, third-order consequence, structural shift, institutional exposure, governance risk, and the judgment serious leaders need before the obvious narrative catches up.

Audience: write for senior leaders, CEOs, board members, institutional leaders, investors, policymakers, and executives who need clarity, consequence, perspective, and judgment.

Voice: serious without being pompous; practical without being shallow; intellectual without being decorative; human without being sentimental; confident without being inflated.

RGI is not motivational writing, generic executive education, a university brochure, consulting-deck language, LinkedIn thought leadership, or AI-generated leadership filler.

Six domains of judgment:
1. Priorities: what deserves attention and what does not.
2. Timing: when to act and when restraint is wiser.
3. People: character, motive, and capability under pressure.
4. Institutions: how power moves, how trust is lost, and how organizations fail.
5. Technology: what to delegate, verify, resist, or retain.
6. Consequence: what decisions will cost, who bears the cost, and whether that is acceptable.

RGI AI thesis: AI makes judgment more valuable, not less. As analysis becomes abundant, judgment becomes scarce. When discussing AI, evaluate what leaders should automate, what they should verify, what they should resist, and where human judgment must remain visible.

Writing requirements:
- Start with the useful answer.
- Use specific claims, consequence, sequence, and proportion.
- Write from knowledge, not posture.
- Match the language to the weight of the event.
- Make every paragraph serve judgment.
- Use source material as evidence, not as the structure.
- The RGI perspective must carry analytical weight throughout the brief, not arrive only at the end.
- Build every brief around one coherent RGI thesis, not a stitched collection of summaries.
- Make STRATEGIC FORESIGHT the center of gravity: what the story produces two moves out, what leaders may miss, and what consequences compound quietly.

Strict anti-AI rules:
- Do not use em dashes.
- Do not use formulaic phrases such as "RGI partially agrees with the dominant narrative."
- Do not use: "This highlights the importance of," "This underscores the need for," "In today's rapidly changing world," "In an increasingly complex landscape," "Organizations must navigate," "Leaders should consider," "It is important to note," "Moreover," "Furthermore," "Notably," or "This development serves as a reminder."
- Do not use: strategic imperative, robust framework, critical importance, pivotal moment, game-changing, transformative, cutting-edge, unlock potential, elevate, reimagine, thought leadership, or disruption.

Editorial test before final output:
Is this accurate, clear, specific, and defensible? Would a serious executive say it? Does it strengthen the idea that RGI is where leaders learn judgment? Does it identify what matters, what can wait, what requires action, what requires restraint, what must be verified, and what consequences must be owned?`;

const BRAND_BANNED_REPLACEMENTS: Array<[RegExp, string, string]> = [
  [/\bRGI\s+(?:partially\s+)?agrees(?:\s+with\s+the\s+dominant\s+narrative)?[:.,]?\s*/gi, "", "RGI agrees/partially agrees formula"],
  [/\bRGI\s+disagrees(?:\s+with\s+the\s+dominant\s+narrative)?[:.,]?\s*/gi, "", "RGI disagrees formula"],
  [/\bThis highlights the importance of\b/gi, "This exposes", "This highlights the importance of"],
  [/\bThis underscores the need for\b/gi, "This creates pressure for", "This underscores the need for"],
  [/\bThis development highlights\b/gi, "This development exposes", "This development highlights"],
  [/\bThis development serves as a reminder that\b/gi, "", "This development serves as a reminder"],
  [/\bThis serves as a reminder that\b/gi, "", "This serves as a reminder"],
  [/\bThe core judgment challenge is\b/gi, "The question is", "The core judgment challenge is"],
  [/\bThe core judgment problem is\b/gi, "The question is", "The core judgment problem is"],
  [/\bIn today'?s rapidly changing world,?\s*/gi, "", "In today's rapidly changing world"],
  [/\bIn an increasingly complex landscape,?\s*/gi, "", "In an increasingly complex landscape"],
  [/\bIn an increasingly complex world,?\s*/gi, "", "In an increasingly complex world"],
  [/\bOrganizations must navigate\b/gi, "Organizations must judge", "Organizations must navigate"],
  [/\bLeaders should consider\b/gi, "Leaders should test", "Leaders should consider"],
  [/\bIt is important to note that\s*/gi, "", "It is important to note"],
  [/\bIt is worth noting that\s*/gi, "", "It is worth noting"],
  [/\bMoreover,?\s*/gi, "", "Moreover"],
  [/\bFurthermore,?\s*/gi, "", "Furthermore"],
  [/\bNotably,?\s*/gi, "", "Notably"],
  [/\bstrategic imperative\b/gi, "strategic obligation", "strategic imperative"],
  [/\brobust framework\b/gi, "clear discipline", "robust framework"],
  [/\bcritical importance\b/gi, "importance", "critical importance"],
  [/\bpivotal moment\b/gi, "decision point", "pivotal moment"],
  [/\bgame-changing\b/gi, "material", "game-changing"],
  [/\btransformational\b/gi, "consequential", "transformational"],
  [/\btransformative\b/gi, "consequential", "transformative"],
  [/\bcutting-edge\b/gi, "advanced", "cutting-edge"],
  [/\bunlock potential\b/gi, "develop capability", "unlock potential"],
  [/\belevate\b/gi, "improve", "elevate"],
  [/\breimagine\b/gi, "reconsider", "reimagine"],
  [/\bthought leadership\b/gi, "analysis", "thought leadership"],
  [/\bdisruption\b/gi, "change", "disruption"],
  [/\bdisruptions\b/gi, "interruptions", "disruptions"],
  [/\bdisruptive\b/gi, "destabilizing", "disruptive"],
  [/\becosystem\b/gi, "system", "ecosystem"],
  [/\bworld-class\b/gi, "serious", "world-class"],
  [/\bgroundbreaking\b/gi, "important", "groundbreaking"],
  [/\bfuture-proof\b/gi, "prepare", "future-proof"],
  [/\bsupercharge\b/gi, "strengthen", "supercharge"],
  [/\bunprecedented\b/gi, "rare", "unprecedented"],
  [/\bseamless(?:ly)?\b/gi, "clear", "seamless"],
  [/\bstreamline\b/gi, "simplify", "streamline"],
  [/\bcomplex landscape\b/gi, "decision environment", "complex landscape"],
  [/\bevolving environment\b/gi, "changing conditions", "evolving environment"],
  [/\brapidly changing\b/gi, "changing", "rapidly changing"],
  [/\bcompressed news roundup\b/gi, "brief", "compressed news roundup"],
  [/\bnews roundup\b/gi, "brief", "news roundup"],
  [/\btwo moves out\b/gi, "as the next consequences emerge", "two moves out"],
  [/\bThe core decision problem is\b/gi, "The practical question is", "The core decision problem is"],
  [/\bThe discipline required is\b/gi, "The harder task is", "The discipline required is"],
  [/\bThis shift is not temporary\b/gi, "This change is unlikely to stay temporary", "This shift is not temporary"],
  [/\bThis shift is not a temporary reaction\b/gi, "This change is unlikely to remain a passing reaction", "This shift is not a temporary reaction"],
  [/\bLeaders who rely on legacy assumptions\b/gi, "Executives still planning around older assumptions", "Leaders who rely on legacy assumptions"],
  [/\bstructural realignment\b/gi, "durable shift in incentives", "structural realignment"],
  [/\binstitutional vulnerabilities\b/gi, "weak points in planning and oversight", "institutional vulnerabilities"],
  [/\bstrategic posture\b/gi, "position", "strategic posture"],
  [/\brisk models\b/gi, "planning models", "risk models"],
  [/\binstitutional weakness\b/gi, "weakness in oversight", "institutional weakness"],
  [/\bMoving forward,?\s*/gi, "", "Moving forward"],
  [/\bLet'?s (?:dive in|explore|unpack)\.?\s*/gi, "", "Let's dive in/explore/unpack"],
  [/\bCertainly,?\s*/gi, "", "Certainly"],
  [/\bOf course,?\s*/gi, "", "Of course"],
  [/\bHappy to help\.?\s*/gi, "", "Happy to help"],
];

function stripEmDash(text: string): string {
  return text.replace(/ — /g, ": ").replace(/—/g, ", ");
}

export function applyRgiBrandComplianceToText(value: unknown): { text: string; report: BrandComplianceReport } {
  let text = String(value ?? "");
  const report: BrandComplianceReport = {
    removedPhrases: [],
    emDashReplaced: /—/.test(text),
    sectionsStrengthened: [],
  };

  text = stripEmDash(text);
  for (const [pattern, replacement, label] of BRAND_BANNED_REPLACEMENTS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      report.removedPhrases.push(label);
      text = text.replace(pattern, replacement);
    }
  }

  text = text
    .replace(/\b(?:significant|major)\s+implications\b/gi, "specific consequences")
    .replace(/\bremains to be seen\b/gi, "depends on evidence still unresolved")
    .replace(/\bcould have (?:a )?(?:major|significant) impact\b/gi, "could change the decision environment")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([.?!])\s*([a-z])/g, (_match, end, start) => `${end} ${start.toUpperCase()}`)
    .trim();

  return {
    text,
    report: {
      ...report,
      removedPhrases: [...new Set(report.removedPhrases)],
    },
  };
}

function mergeBrandReports(reports: BrandComplianceReport[]): BrandComplianceReport {
  return {
    removedPhrases: [...new Set(reports.flatMap((report) => report.removedPhrases))],
    emDashReplaced: reports.some((report) => report.emDashReplaced),
    sectionsStrengthened: [...new Set(reports.flatMap((report) => report.sectionsStrengthened))],
  };
}

function applyMultilineTextWithReport(value: unknown): { text: string; report: BrandComplianceReport } {
  const reports: BrandComplianceReport[] = [];
  const lines = String(value ?? "")
    .split(/\n+/)
    .map((line) => {
      const cleaned = applyRgiBrandComplianceToText(line);
      reports.push(cleaned.report);
      return cleaned.text;
    })
    .filter((line) => line.length > 0);

  return {
    text: lines.join("\n"),
    report: mergeBrandReports(reports),
  };
}

function applyArrayWithReport(values: string[] | undefined): { items: string[]; reports: BrandComplianceReport[] } {
  const reports: BrandComplianceReport[] = [];
  const items = (values ?? [])
    .map((value) => {
      const cleaned = applyRgiBrandComplianceToText(value);
      reports.push(cleaned.report);
      return cleaned.text;
    })
    .filter((value) => value.length > 0);
  return { items, reports };
}

function strengthenRgiJudgmentIfNeeded(value: string): { text: string; report: BrandComplianceReport } {
  const cleaned = applyRgiBrandComplianceToText(value);
  let text = cleaned.text;
  const report = { ...cleaned.report, sectionsStrengthened: [...cleaned.report.sectionsStrengthened] };
  const hasJudgmentLanguage = /\b(judgment|verify|restraint|consequence|responsibility|trust|legitimacy|accountability|assumption|own)\b/i.test(text);
  if (!hasJudgmentLanguage && text.length > 0) {
    text = `${text} The leadership discipline is to decide what must be verified, what should remain reversible, and which consequences the institution is prepared to own.`;
    report.sectionsStrengthened.push("RGI Judgment");
  }
  return { text: applyRgiBrandComplianceToText(text).text, report };
}

export function applyBrandComplianceToBrief<T extends {
  headline: string;
  body: string;
  executiveSummary: string[];
  rgiTake: string;
  keyTakeaways: string[];
  implificationsForLeaders?: string[];
  whatToWatch?: string[];
  summaryTakeaways?: string[];
}>(brief: T): BrandCompliantBrief<T> {
  const reports: BrandComplianceReport[] = [];
  const headline = applyRgiBrandComplianceToText(brief.headline);
  const body = applyMultilineTextWithReport(brief.body);
  const executiveSummary = applyArrayWithReport(brief.executiveSummary);
  const keyTakeaways = applyArrayWithReport(brief.keyTakeaways);
  const implications = applyArrayWithReport(brief.implificationsForLeaders ?? []);
  const whatToWatch = applyArrayWithReport(brief.whatToWatch ?? []);
  const summaryTakeaways = applyArrayWithReport(brief.summaryTakeaways ?? []);
  const rgiTake = strengthenRgiJudgmentIfNeeded(brief.rgiTake);

  reports.push(
    headline.report,
    body.report,
    rgiTake.report,
    ...executiveSummary.reports,
    ...keyTakeaways.reports,
    ...implications.reports,
    ...whatToWatch.reports,
    ...summaryTakeaways.reports,
  );

  return {
    ...brief,
    headline: headline.text,
    body: body.text,
    executiveSummary: executiveSummary.items,
    rgiTake: rgiTake.text,
    keyTakeaways: keyTakeaways.items,
    implificationsForLeaders: implications.items,
    whatToWatch: whatToWatch.items,
    summaryTakeaways: summaryTakeaways.items,
    brandCompliance: mergeBrandReports(reports),
  };
}
