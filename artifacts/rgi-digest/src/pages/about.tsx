import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DISCIPLINES = [
  {
    name: "Strategic Foresight",
    color: "text-blue-400 border-blue-500/30 bg-blue-500/5",
    bar: "bg-blue-500",
    desc: "The capacity to anticipate change, read signals in the environment, and position organizations advantageously for futures that are not yet visible. Strategic Foresight demands leaders look beyond quarterly cycles to the structural shifts — technological, geopolitical, demographic — reshaping the landscape of possibility.",
  },
  {
    name: "System Vitality",
    color: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    bar: "bg-amber-500",
    desc: "The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. System Vitality examines how institutions maintain momentum, health, and alignment — not just in favorable conditions, but under pressure and through transformation.",
  },
  {
    name: "Civic Stewardship",
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    bar: "bg-emerald-500",
    desc: "The responsibility leaders bear to the communities and institutions they serve, beyond profit and narrow organizational interest. Civic Stewardship holds that those with power and influence carry an obligation to the broader social fabric — to democracy, to equity, and to the long-term wellbeing of society.",
  },
];

const ETHICS = [
  {
    title: "Accuracy over speed",
    desc: "Every brief is grounded in verifiable sources. We do not speculate beyond what the evidence supports. When sources conflict, we say so.",
  },
  {
    title: "Opinion, clearly labeled",
    desc: "The RGI Take section expresses a considered editorial view. It is marked as interpretation, not neutral fact. Readers are trusted to think for themselves.",
  },
  {
    title: "No sensationalism",
    desc: "RGI does not traffic in alarm or hype. Scores reflect genuine strategic relevance, not headline shock. Low-signal content is filtered out, not amplified.",
  },
  {
    title: "Diversity of sources",
    desc: "Intelligence is drawn from traditional journalism, institutional announcements, social signals, and primary statements. Source type is always disclosed.",
  },
  {
    title: "Editorial independence",
    desc: "The platform serves the RGI mission — not any political, commercial, or ideological agenda. Analysis follows the evidence, not a predetermined conclusion.",
  },
];

export default function About() {
  return (
    <div className="space-y-10 max-w-3xl">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">About This Platform</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The RGI Strategic Intelligence System — purpose, method, and guiding principles.
        </p>
      </div>

      {/* Mission */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Our Mission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-foreground/85 leading-relaxed">
          <p>
            The Rick Goings Institute at Rollins College exists to develop leaders who think with clarity, act with integrity, and serve with purpose. This intelligence platform is an extension of that mission — a tool for staying ahead of the forces reshaping business, society, and governance.
          </p>
          <p>
            The RGI Strategic Intelligence System aggregates signals from across the global information environment — news, institutional reports, social media, corporate announcements, and primary statements from consequential voices — and filters them through the RGI analytical lens. The result is a curated, daily intelligence brief designed for the time-constrained leader who needs insight, not information overload.
          </p>
          <p>
            Every article generated here reflects a deliberate editorial choice: what matters now, why it matters for leaders, and what it demands of organizations operating at the intersection of business, policy, and society.
          </p>
        </CardContent>
      </Card>

      {/* Three Disciplines */}
      <div>
        <h2 className="text-xl font-serif tracking-tight text-foreground mb-4">The Three Disciplines</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Every article, score, and editorial decision on this platform is shaped by RGI's three core disciplines. These are not categories — they are lenses. Any significant development can be read through one or more of them.
        </p>
        <div className="space-y-4">
          {DISCIPLINES.map((d) => (
            <div key={d.name} className={`rounded-xl border p-5 ${d.color}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-1 h-6 rounded-full ${d.bar}`} />
                <p className="text-sm font-bold uppercase tracking-wider">{d.name}</p>
              </div>
              <p className="text-sm leading-relaxed text-foreground/80">{d.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How Scoring Works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">How Articles Are Scored</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-foreground/85 leading-relaxed">
          <p>
            Every source article is scored from 1 to 10 based on its strategic relevance to RGI's mission. The score reflects significance for senior leaders at the intersection of business, policy, and society — not general newsworthiness.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[
              { range: "9.0 – 10.0", label: "Landmark signal", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
              { range: "7.5 – 8.9", label: "High strategic relevance", color: "text-primary bg-primary/10 border-primary/30" },
              { range: "6.0 – 7.4", label: "Moderate relevance", color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
              { range: "< 6.0", label: "Low signal — filtered out", color: "text-muted-foreground bg-muted border-border" },
            ].map((item) => (
              <div key={item.range} className={`rounded-lg border px-3 py-2.5 ${item.color}`}>
                <p className="text-xs font-bold tabular-nums">{item.range}</p>
                <p className="text-xs mt-0.5 opacity-80">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground italic mt-1">
            Entertainment, lifestyle, local news, and content unrelated to leadership, governance, strategy, or major societal change is automatically excluded regardless of score.
          </p>
        </CardContent>
      </Card>

      {/* Code of Ethics */}
      <div>
        <h2 className="text-xl font-serif tracking-tight text-foreground mb-4">Editorial Code of Ethics</h2>
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

      {/* Platform Note */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-5">
          <p className="text-sm text-foreground/80 leading-relaxed italic">
            This platform is an internal tool of the Rick Goings Institute at Rollins College. Content generated here is intended for editorial review before publication. All AI-generated analysis is reviewed and approved by an RGI editor before it is published. The platform is not a substitute for human editorial judgment — it is designed to augment it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
