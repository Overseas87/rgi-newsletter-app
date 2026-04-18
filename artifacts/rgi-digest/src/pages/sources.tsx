import { useState, useEffect } from "react";
import {
  useListSources,
  useCreateSource,
  useUpdateSource,
  useDeleteSource,
  Source,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { Plus, Pencil, Trash2, X, Check, Newspaper, Twitter, Linkedin, BookOpen, Building2, TrendingUp, Globe, Info, Loader2, Scale } from "lucide-react";

// Credibility score computation
// Tier sets the base range, type applies a modifier.
// The 0–100 score determines article authenticity weighting in composite scoring.
// credibility1to10 gives the discrete 1–10 score shown in the UI.
function computeCredibility(source: Source): { score: number; credibility: number; explanation: string; shortLabel: string } {
  const tierBase: Record<number, number> = { 1: 88, 2: 68, 3: 48 };
  const typeBonus: Record<string, number> = {
    institutional: 8,
    market: 4,
    rss: 0,
    website: 0,
    corporate: -6,
    linkedin: -8,
    twitter: -10,
  };
  const authorityAdjust = source.authorityLevel != null
    ? (3 - source.authorityLevel) * 4
    : 0;

  const raw = (tierBase[source.tier] ?? 68) + (typeBonus[source.type] ?? 0) + authorityAdjust;
  const score = Math.max(10, Math.min(100, Math.round(raw)));
  // Map 0–100 to 1–10 (rounded)
  const credibility = Math.max(1, Math.min(10, Math.round(score / 10)));

  const tierLabel = source.tier === 1 ? "Premier source (Tier 1)" : source.tier === 2 ? "Standard source (Tier 2)" : "Supplemental source (Tier 3)";
  const typeLabel: Record<string, string> = {
    institutional: "institutional credibility bonus applied",
    market: "financial data credibility bonus applied",
    corporate: "slight discount applied (corporate PR risk)",
    linkedin: "social platform discount applied",
    twitter: "social platform discount applied",
    rss: "",
    website: "",
  };

  const shortLabel =
    source.type === "institutional" ? "Primary institutional source" :
    source.type === "market" ? "Major financial data source" :
    source.type === "corporate" ? "Corporate communications" :
    source.type === "linkedin" ? "Social professional network" :
    source.type === "twitter" ? "Social media source" :
    source.tier === 1 ? "Major editorial publication" :
    source.tier === 2 ? "Established publication" :
    "Supplemental intelligence source";

  const parts = [
    tierLabel,
    typeLabel[source.type] || null,
    source.authorityLevel != null && source.authorityLevel <= 2 ? "high editorial authority" : null,
    source.authorityLevel != null && source.authorityLevel >= 4 ? "lower institutional authority" : null,
  ].filter(Boolean);

  return { score, credibility, explanation: parts.join(". ") + ".", shortLabel };
}

function weightLabel(weight: number): { text: string; color: string } {
  if (weight >= 1.8) return { text: "Premier ×" + weight.toFixed(1), color: "text-violet-700 bg-violet-50 border-violet-200" };
  if (weight >= 1.4) return { text: "Elevated ×" + weight.toFixed(1), color: "text-blue-700 bg-blue-50 border-blue-200" };
  if (weight >= 0.9) return { text: "Standard ×" + weight.toFixed(1), color: "text-slate-600 bg-slate-50 border-slate-200" };
  return { text: "Reduced ×" + weight.toFixed(1), color: "text-amber-700 bg-amber-50 border-amber-200" };
}

function CredibilityBadge({ credibility, score }: { credibility: number; score: number }) {
  const color =
    credibility >= 9 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    credibility >= 7 ? "text-blue-700 bg-blue-50 border-blue-200" :
    credibility >= 5 ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-slate-600 bg-slate-50 border-slate-200";
  const bar =
    score >= 80 ? "bg-emerald-500" :
    score >= 65 ? "bg-blue-500" :
    score >= 50 ? "bg-amber-400" :
    "bg-slate-400";

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${color}`}
        title={`Credibility ${credibility}/10 (raw score ${score}/100)`}>
        {credibility}/10
      </span>
    </div>
  );
}

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Premier Sources",
  2: "Tier 2 — Standard Sources",
  3: "Tier 3 — Supplemental Sources",
};

const TIER_DESCRIPTIONS: Record<number, string> = {
  1: "Highest editorial authority. Major newspapers, global financial press, and primary institutional voices. These sources carry the most weight in composite scoring.",
  2: "Established publications with consistent editorial standards. Industry press, regional business journals, and reputable think tanks.",
  3: "Supplemental intelligence. Corporate communications, social channels, and niche sources that provide signals but are treated with greater skepticism.",
};

type SourceType = "rss" | "website" | "twitter" | "linkedin" | "institutional" | "corporate" | "market";

const TYPE_META: Record<SourceType, { label: string; icon: typeof Newspaper; color: string }> = {
  rss: { label: "RSS", icon: Newspaper, color: "bg-muted text-muted-foreground border-border" },
  website: { label: "Web", icon: Globe, color: "bg-muted text-muted-foreground border-border" },
  twitter: { label: "X / Twitter", icon: Twitter, color: "bg-sky-50 text-sky-700 border-sky-200" },
  linkedin: { label: "LinkedIn", icon: Linkedin, color: "bg-blue-50 text-blue-700 border-blue-200" },
  institutional: { label: "Institutional", icon: BookOpen, color: "bg-violet-50 text-violet-700 border-violet-200" },
  corporate: { label: "Corporate", icon: Building2, color: "bg-orange-50 text-orange-700 border-orange-200" },
  market: { label: "Market", icon: TrendingUp, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

function TypeBadge({ type }: { type: string }) {
  const meta = TYPE_META[type as SourceType] ?? TYPE_META.rss;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${meta.color}`}>
      <meta.icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

// Weight preset steps shown in the slider labels
const WEIGHT_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function SourceRow({ source }: { source: Source }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(source.name);
  const [url, setUrl] = useState(source.url);
  const [tier, setTier] = useState(String(source.tier));
  const [editWeight, setEditWeight] = useState(source.weight ?? 1.0);

  // Optimistic active state — updated immediately on toggle, reverted on failure
  const [isActive, setIsActive] = useState(source.isActive);
  const [togglePending, setTogglePending] = useState(false);

  // Keep local state in sync if the parent re-fetches (e.g. page load, external update)
  useEffect(() => {
    if (!togglePending) setIsActive(source.isActive);
  }, [source.isActive, togglePending]);

  useEffect(() => {
    setEditWeight(source.weight ?? 1.0);
  }, [source.weight]);

  const update = useUpdateSource();
  const remove = useDeleteSource();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["listSources"] });

  const { score, credibility, explanation, shortLabel } = computeCredibility(source);
  const sourceWeight = source.weight ?? 1.0;
  const wLabel = weightLabel(sourceWeight);

  const handleSave = () => {
    update.mutate(
      { id: source.id, data: { name, url, tier: Number(tier) as 1 | 2 | 3, weight: editWeight } },
      {
        onSuccess: () => { setEditing(false); invalidate(); },
        onError: () => {
          toast({ title: "Save failed", description: "Could not save changes. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleToggle = (next: boolean) => {
    setIsActive(next);
    setTogglePending(true);
    update.mutate(
      { id: source.id, data: { isActive: next } },
      {
        onSuccess: () => { setTogglePending(false); invalidate(); },
        onError: () => {
          setIsActive(!next);
          setTogglePending(false);
          toast({
            title: "Toggle failed",
            description: `Could not ${next ? "activate" : "deactivate"} "${source.name}". Please try again.`,
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleDelete = () => {
    if (!confirm(`Remove source "${source.name}"?`)) return;
    remove.mutate(
      { id: source.id },
      {
        onSuccess: invalidate,
        onError: () => {
          toast({ title: "Delete failed", description: "Could not remove source. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Card
      data-testid={`source-row-${source.id}`}
      className={`transition-opacity duration-150 ${!isActive ? "opacity-50" : ""}`}
    >
      <CardContent className="p-4">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-source-name" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — Premier</SelectItem>
                    <SelectItem value="2">Tier 2 — Standard</SelectItem>
                    <SelectItem value="3">Tier 3 — Supplemental</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Feed URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" data-testid="input-source-url" />
            </div>
            {/* Weight editor */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Scale className="h-3 w-3 text-muted-foreground" />
                  <Label className="text-xs font-semibold">Source Weight</Label>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${weightLabel(editWeight).color}`}>
                  {weightLabel(editWeight).text}
                </span>
              </div>
              <Slider
                min={0}
                max={WEIGHT_STEPS.length - 1}
                step={1}
                value={[WEIGHT_STEPS.indexOf(editWeight) >= 0 ? WEIGHT_STEPS.indexOf(editWeight) : 2]}
                onValueChange={([idx]) => setEditWeight(WEIGHT_STEPS[idx])}
                className="w-full"
                data-testid="slider-source-weight"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground/70 font-medium">
                <span>×0.5 Reduced</span>
                <span>×1.0 Standard</span>
                <span>×2.0 Premier</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Weight multiplies this source's authority contribution to article scoring. ×2.0 can add up to +1 point to articles from this source.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={update.isPending} data-testid="btn-save-source">
                <Check className="h-3 w-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="btn-cancel-edit">
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="font-medium text-sm">{source.name}</span>
                  <TypeBadge type={source.type} />
                  {/* Active / Inactive status badge */}
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition-colors ${
                      togglePending
                        ? "text-gray-500 bg-gray-50 border-gray-200"
                        : isActive
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : "text-slate-500 bg-slate-50 border-slate-200"
                    }`}
                  >
                    {togglePending ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : null}
                    {togglePending ? "Updating…" : isActive ? "Active" : "Inactive"}
                  </span>
                  {source.authorName && (
                    <span className="text-xs text-muted-foreground">· {source.authorName}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">{source.url}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {/* Weight badge — only shown when non-default */}
                {Math.abs(sourceWeight - 1.0) > 0.05 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${wLabel.color}`}
                    title={`Source weight: ${sourceWeight.toFixed(2)}`}>
                    {wLabel.text}
                  </span>
                )}
                <CredibilityBadge credibility={credibility} score={score} />
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="text-muted-foreground/50 hover:text-muted-foreground"
                  title="Why this score?"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
                <Switch
                  checked={isActive}
                  onCheckedChange={handleToggle}
                  disabled={togglePending}
                  data-testid={`toggle-source-${source.id}`}
                  aria-label={isActive ? "Deactivate source" : "Activate source"}
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(true)} data-testid="btn-edit-source">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  data-testid="btn-delete-source"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {expanded && (
              <div className="mt-2 px-3 py-2.5 rounded-md bg-muted/40 border border-border space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Credibility Rating</p>
                    <p className="text-xs font-semibold text-foreground">{shortLabel}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{explanation}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-2xl font-bold tabular-nums text-foreground">{credibility}</span>
                    <span className="text-xs text-muted-foreground">/10</span>
                  </div>
                </div>
                {Math.abs(sourceWeight - 1.0) > 0.05 && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Source Weight</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Weight ×{sourceWeight.toFixed(2)} — {sourceWeight > 1.0
                        ? `Authority contribution boosted by ${Math.round((sourceWeight - 1) * 100)}%. Articles from this source earn up to ${Math.min(1, (sourceWeight - 1) * 2).toFixed(1)} additional scoring point(s).`
                        : `Authority contribution reduced to ${Math.round(sourceWeight * 100)}% of standard. Articles from this source receive a corresponding score reduction.`
                      }
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "rss", label: "RSS / News Feed" },
  { value: "website", label: "Website" },
  { value: "twitter", label: "X / Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "institutional", label: "Institutional (Think Tank / Academic)" },
  { value: "corporate", label: "Corporate (Company Blog / Press)" },
  { value: "market", label: "Market (Financial / Economic)" },
];

export default function Sources() {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTier, setNewTier] = useState("1");
  const [newType, setNewType] = useState<SourceType>("rss");

  const { data: sources = [], isLoading } = useListSources();
  const createSource = useCreateSource();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    if (!newName || !newUrl) return;
    createSource.mutate(
      { data: { name: newName, url: newUrl, type: newType, tier: Number(newTier) as 1 | 2 | 3 } },
      {
        onSuccess: () => {
          setNewName(""); setNewUrl(""); setNewTier("1"); setNewType("rss");
          setShowAdd(false);
          queryClient.invalidateQueries({ queryKey: ["listSources"] });
        },
      }
    );
  };

  const typeCounts = Object.keys(TYPE_META).reduce((acc, t) => {
    acc[t] = sources.filter((s: Source) => s.type === t).length;
    return acc;
  }, {} as Record<string, number>);

  const grouped = [1, 2, 3].map((tier) => ({
    tier,
    sources: sources.filter((s: Source) => s.tier === tier),
  }));

  const avgByTier = [1, 2, 3].reduce((acc, tier) => {
    const t = sources.filter((s: Source) => s.tier === tier);
    acc[tier] = t.length > 0
      ? Math.round(t.reduce((s, src) => s + computeCredibility(src as Source).credibility, 0) / t.length * 10) / 10
      : 0;
    return acc;
  }, {} as Record<number, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Sources</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {sources.filter((s: Source) => s.isActive).length} active sources across {grouped.filter((g) => g.sources.length > 0).length} tiers
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} data-testid="btn-add-source">
          <Plus className="h-4 w-4 mr-2" /> Add Source
        </Button>
      </div>

      {/* Credibility and weight legend */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground mb-1">How Credibility and Source Weight Work</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each source has a <strong className="text-foreground/80">credibility rating (1–10)</strong> derived from its tier, type, and editorial authority. This rating influences an article's Source Authority scoring component. You can amplify or reduce a source's influence using the <strong className="text-foreground/80">source weight</strong> (×0.5 to ×2.0) in the edit panel — weight scales the authority contribution, so trusted sources can be elevated above their default tier.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "9–10", desc: "Premier", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
            { label: "7–8", desc: "Standard", color: "text-blue-700 bg-blue-50 border-blue-200" },
            { label: "5–6", desc: "Supplemental", color: "text-amber-700 bg-amber-50 border-amber-200" },
            { label: "1–4", desc: "Low weight", color: "text-slate-600 bg-slate-50 border-slate-200" },
          ].map((item) => (
            <div key={item.label} className={`rounded-md border px-2.5 py-2 ${item.color}`}>
              <p className="text-[10px] font-bold tabular-nums">{item.label}</p>
              <p className="text-[10px] opacity-70">{item.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Click the <Info className="h-2.5 w-2.5 inline" /> icon on any source to see its credibility rationale. Click <Pencil className="h-2.5 w-2.5 inline" /> to adjust source weight.</p>
      </div>

      {/* Type summary */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts).filter(([, c]) => c > 0).map(([type, count]) => (
          <div key={type} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${TYPE_META[type as SourceType]?.color ?? ""}`}>
            {(() => { const Icon = TYPE_META[type as SourceType]?.icon ?? Newspaper; return <Icon className="h-3 w-3" />; })()}
            <span className="font-medium">{TYPE_META[type as SourceType]?.label}</span>
            <span className="opacity-60">({count})</span>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-sm">Add New Source</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Publication name" data-testid="input-new-name" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tier</Label>
                <Select value={newTier} onValueChange={setNewTier}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — Premier</SelectItem>
                    <SelectItem value="2">Tier 2 — Standard</SelectItem>
                    <SelectItem value="3">Tier 3 — Supplemental</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Source Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as SourceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Feed URL</Label>
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder={newType === "rss" ? "https://example.com/feed.xml" : "https://example.com"}
                className="font-mono text-xs"
                data-testid="input-new-url"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={createSource.isPending || !newName || !newUrl} data-testid="btn-create-source">
                {createSource.isPending ? "Adding..." : "Add Source"}
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)} data-testid="btn-cancel-add">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ tier, sources: tierSources }) => (
            <div key={tier}>
              <div className="flex items-end justify-between mb-1">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  {TIER_LABELS[tier]}
                  <span className="font-normal opacity-60">({tierSources.length})</span>
                </h2>
                {tierSources.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    Avg credibility: <span className="font-semibold tabular-nums">{avgByTier[tier]}</span>/10
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{TIER_DESCRIPTIONS[tier]}</p>
              {tierSources.length === 0 ? (
                <p className="text-xs text-muted-foreground italic pl-1">No sources in this tier.</p>
              ) : (
                <div className="space-y-2">
                  {tierSources.map((source: Source) => (
                    <SourceRow key={source.id} source={source} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
