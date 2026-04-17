import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Check, Newspaper, Twitter, Linkedin, BookOpen, Building2, TrendingUp, Globe } from "lucide-react";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Premier",
  2: "Tier 2 — Standard",
  3: "Tier 3 — Supplemental",
};

const TIER_COLORS: Record<number, string> = {
  1: "bg-primary/10 text-primary border-primary/20",
  2: "bg-secondary text-secondary-foreground",
  3: "bg-muted text-muted-foreground",
};

type SourceType = "rss" | "website" | "twitter" | "linkedin" | "institutional" | "corporate" | "market";

const TYPE_META: Record<SourceType, { label: string; icon: typeof Newspaper; color: string }> = {
  rss: { label: "RSS", icon: Newspaper, color: "bg-muted text-muted-foreground border-border" },
  website: { label: "Web", icon: Globe, color: "bg-muted text-muted-foreground border-border" },
  twitter: { label: "X / Twitter", icon: Twitter, color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  linkedin: { label: "LinkedIn", icon: Linkedin, color: "bg-blue-600/10 text-blue-400 border-blue-600/20" },
  institutional: { label: "Institutional", icon: BookOpen, color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  corporate: { label: "Corporate", icon: Building2, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  market: { label: "Market", icon: TrendingUp, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
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

function SourceRow({ source }: { source: Source }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(source.name);
  const [url, setUrl] = useState(source.url);
  const [tier, setTier] = useState(String(source.tier));

  const update = useUpdateSource();
  const remove = useDeleteSource();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["listSources"] });

  const handleSave = () => {
    update.mutate(
      { id: source.id, data: { name, url, tier: Number(tier) as 1 | 2 | 3 } },
      { onSuccess: () => { setEditing(false); invalidate(); } }
    );
  };

  const handleToggle = (active: boolean) => {
    update.mutate(
      { id: source.id, data: { isActive: active } },
      { onSuccess: invalidate }
    );
  };

  const handleDelete = () => {
    if (!confirm(`Remove source "${source.name}"?`)) return;
    remove.mutate({ id: source.id }, { onSuccess: invalidate });
  };

  return (
    <Card data-testid={`source-row-${source.id}`} className={!source.isActive ? "opacity-50" : ""}>
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
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="font-medium text-sm">{source.name}</span>
                <TypeBadge type={source.type} />
                <Badge variant="outline" className={`text-[10px] ${TIER_COLORS[source.tier]}`}>
                  T{source.tier}
                </Badge>
                {source.authorName && (
                  <span className="text-xs text-muted-foreground">· {source.authorName}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate">{source.url}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Switch
                checked={source.isActive}
                onCheckedChange={handleToggle}
                data-testid={`toggle-source-${source.id}`}
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
          setNewName("");
          setNewUrl("");
          setNewTier("1");
          setNewType("rss");
          setShowAdd(false);
          queryClient.invalidateQueries({ queryKey: ["listSources"] });
        },
      }
    );
  };

  // Group by type for display summary
  const typeCounts = Object.keys(TYPE_META).reduce((acc, t) => {
    acc[t] = sources.filter((s: Source) => s.type === t).length;
    return acc;
  }, {} as Record<string, number>);

  const grouped = [1, 2, 3].map((tier) => ({
    tier,
    sources: sources.filter((s: Source) => s.tier === tier),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Source Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {sources.length} sources configured across {grouped.filter((g) => g.sources.length > 0).length} tiers
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} data-testid="btn-add-source">
          <Plus className="h-4 w-4 mr-2" /> Add Source
        </Button>
      </div>

      {/* Type summary */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts).filter(([, c]) => c > 0).map(([type, count]) => (
          <div key={type} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${TYPE_META[type as SourceType]?.color ?? ""}`}>
            {(() => {
              const Icon = TYPE_META[type as SourceType]?.icon ?? Newspaper;
              return <Icon className="h-3 w-3" />;
            })()}
            <span className="font-medium">{TYPE_META[type as SourceType]?.label}</span>
            <span className="opacity-60">({count})</span>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-sm">New Source</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Publication name"
                  data-testid="input-new-name"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tier</Label>
                <Select value={newTier} onValueChange={setNewTier}>
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
              <Label className="text-xs mb-1 block">Source Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as SourceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                placeholder={newType === "rss" ? "https://example.com/feed.xml" : newType === "twitter" ? "https://nitter.net/username/rss" : "https://example.com/feed"}
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
        <div className="space-y-8">
          {grouped.map(({ tier, sources: tierSources }) => (
            <div key={tier}>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                {TIER_LABELS[tier]}
                <span className="font-normal opacity-60">({tierSources.length})</span>
              </h2>
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
