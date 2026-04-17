import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

const WORKFLOW_STEPS = [
  {
    num: "01",
    label: "Scrape",
    desc: "The system pulls from 45+ curated sources — major news organizations, think tanks, institutional voices, financial data feeds, and select social channels — on a daily automated schedule.",
    color: "border-blue-200 bg-blue-50 text-blue-700",
    numColor: "text-blue-300",
  },
  {
    num: "02",
    label: "Analyze",
    desc: "Claude AI scores every article 1–10 against RGI's three core disciplines — Strategic Foresight, System Vitality, and Civic Stewardship. Articles scoring below 6.5 are discarded. Each article receives an RGI Take: a two-sentence editorial stance with a forward implication for senior leaders.",
    color: "border-violet-200 bg-violet-50 text-violet-700",
    numColor: "text-violet-300",
  },
  {
    num: "03",
    label: "Generate",
    desc: "Editors use the Intelligence Feed and Today's Topics panels to select source material. The system then synthesizes selected articles into polished Daily Intelligence Briefs or focused Topic Articles — with executive summaries, key takeaways, and an RGI perspective.",
    color: "border-amber-200 bg-amber-50 text-amber-700",
    numColor: "text-amber-300",
  },
  {
    num: "04",
    label: "Review",
    desc: "Every AI-generated piece enters Pending Review before it can be published. Editors read, refine, and either approve or reject. The AI can be re-instructed at this stage to adjust tone, emphasis, or depth.",
    color: "border-orange-200 bg-orange-50 text-orange-700",
    numColor: "text-orange-300",
  },
  {
    num: "05",
    label: "Publish",
    desc: "Approved articles enter the Published archive and can be distributed as a newsletter to subscribed recipients. The full editorial record — sources, scores, drafts, and decisions — is preserved for accountability and institutional memory.",
    color: "border-emerald-200 bg-emerald-50 text-emerald-700",
    numColor: "text-emerald-300",
  },
];

const DISCIPLINES = [
  {
    name: "Strategic Foresight",
    tag: "SF",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    bar: "bg-blue-500",
    desc: "The capacity to anticipate change, read weak signals in the environment, and position organizations advantageously for futures that are not yet visible. Demands that leaders look beyond quarterly cycles to structural shifts — technological, geopolitical, demographic — reshaping the landscape of possibility.",
  },
  {
    name: "System Vitality",
    tag: "SV",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    bar: "bg-amber-500",
    desc: "The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. Examines how institutions maintain momentum, health, and alignment — not just in favorable conditions, but under pressure and through transformation.",
  },
  {
    name: "Civic Stewardship",
    tag: "CS",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    bar: "bg-emerald-500",
    desc: "The responsibility leaders bear to the communities and institutions they serve, beyond profit and narrow organizational interest. Holds that those with power and influence carry an obligation to the broader social fabric — to democracy, equity, and the long-term wellbeing of society.",
  },
];

const ETHICS = [
  {
    title: "Accuracy over speed",
    desc: "Every brief is grounded in verifiable sources. When sources conflict or evidence is thin, the system says so explicitly.",
  },
  {
    title: "Opinion, clearly labeled",
    desc: "The RGI Take section expresses a considered editorial view — marked as interpretation, not neutral fact. Readers are trusted to think for themselves.",
  },
  {
    title: "No sensationalism",
    desc: "Scores reflect genuine strategic relevance, not headline shock. Low-signal content is filtered before it ever reaches an editor's screen.",
  },
  {
    title: "Editorial independence",
    desc: "Analysis follows evidence, not a predetermined conclusion. The platform serves the RGI mission — not any political, commercial, or ideological agenda.",
  },
  {
    title: "Human judgment is final",
    desc: "Every AI-generated piece must pass editorial review before publication. The system is designed to augment editorial judgment, never replace it.",
  },
];

export default function About() {
  return (
    <div className="space-y-12 max-w-3xl">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">About This System</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Purpose, workflow, and editorial standards of the RGI Strategic Intelligence System.
        </p>
      </div>

      {/* Purpose */}
      <Card className="border-primary/20 bg-primary/[0.02]">
        <CardContent className="pt-6 space-y-4 text-sm text-foreground/85 leading-relaxed">
          <p className="text-base font-serif leading-relaxed">
            The RGI Strategic Intelligence System is an internal editorial platform built for the Rick Goings Institute at Rollins College. Its purpose is singular: identify what matters in the global information environment, interpret it through an RGI lens, and produce high-quality content for leadership and decision-making.
          </p>
          <p>
            The system is not a media aggregator. It is a controlled editorial workflow — designed to filter out noise, surface genuine strategic signals, and synthesize them into authoritative intelligence that senior leaders can act on. Every article that appears here has passed automated scoring, editorial selection, and human review.
          </p>
          <p>
            Content generated by this platform serves RGI's mission of developing leaders who think with clarity, act with integrity, and serve with purpose.
          </p>
        </CardContent>
      </Card>

      {/* Workflow */}
      <div>
        <h2 className="text-xl font-serif tracking-tight text-foreground mb-2">How the System Works</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Five sequential stages from raw information to published intelligence.
        </p>
        <div className="space-y-3">
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.num} className="relative">
              <div className={`rounded-xl border p-5 ${step.color}`}>
                <div className="flex items-start gap-4">
                  <div className="shrink-0 text-right">
                    <span className={`text-3xl font-bold tabular-nums leading-none ${step.numColor}`}>{step.num}</span>
                    <p className="text-xs font-bold uppercase tracking-widest mt-1 opacity-70">{step.label}</p>
                  </div>
                  <div className="flex-1 pt-0.5">
                    <p className="text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div className="flex justify-center my-1">
                  <ArrowRight className="h-4 w-4 text-muted-foreground/30 rotate-90" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Three Disciplines */}
      <div>
        <h2 className="text-xl font-serif tracking-tight text-foreground mb-2">The Three Analytical Disciplines</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Every article, score, and editorial decision is filtered through RGI's three core disciplines. They are not categories — they are lenses. Any significant development in the world can be read through one or more of them.
        </p>
        <div className="space-y-4">
          {DISCIPLINES.map((d) => (
            <div key={d.name} className={`rounded-xl border p-5 ${d.color}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${d.color} uppercase tracking-widest`}>{d.tag}</span>
                <p className="text-sm font-bold">{d.name}</p>
              </div>
              <p className="text-sm leading-relaxed opacity-90">{d.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scoring */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Relevancy Scoring</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-foreground/85 leading-relaxed">
          <p>
            Every source article is scored 1–10 by Claude AI against RGI's strategic lens. The score reflects significance for senior leaders at the intersection of business, policy, and society — not general newsworthiness or audience appeal.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { range: "9.0 – 10.0", label: "Landmark signal", color: "text-amber-700 bg-amber-50 border-amber-200" },
              { range: "7.5 – 8.9", label: "High strategic relevance", color: "text-blue-700 bg-blue-50 border-blue-200" },
              { range: "6.5 – 7.4", label: "Moderate relevance", color: "text-slate-600 bg-slate-50 border-slate-200" },
              { range: "< 6.5", label: "Filtered — not shown", color: "text-muted-foreground bg-muted border-border" },
            ].map((item) => (
              <div key={item.range} className={`rounded-lg border px-3 py-2.5 ${item.color}`}>
                <p className="text-xs font-bold tabular-nums">{item.range}</p>
                <p className="text-xs mt-0.5 opacity-80">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground italic">
            The composite relevancy score weights raw AI relevance (65%) against a source credibility score (35%), so high-relevance content from low-credibility sources does not surface above verified journalism and institutional sources.
          </p>
        </CardContent>
      </Card>

      {/* Ethics */}
      <div>
        <h2 className="text-xl font-serif tracking-tight text-foreground mb-4">Editorial Standards</h2>
        <div className="space-y-3">
          {ETHICS.map((item) => (
            <div key={item.title} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-5">
        <p className="text-sm text-foreground/80 leading-relaxed">
          <span className="font-semibold">Internal use only.</span> This platform is an operational tool of the Rick Goings Institute at Rollins College. All AI-generated content passes editorial review before publication. The system does not make editorial decisions — editors do. Artificial intelligence handles volume; human judgment handles quality.
        </p>
      </div>
    </div>
  );
}
