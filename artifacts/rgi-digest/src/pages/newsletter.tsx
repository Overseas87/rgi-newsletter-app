import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, Users, FileText, Trash2, Copy } from "lucide-react";
import { format } from "date-fns";

const ALL_TOPICS = [
  "AI", "Technology", "Innovation",
  "Geopolitics", "Policy", "Governance", "Democracy",
  "Finance", "Economy", "Strategy",
  "Leadership", "Culture", "Future of Work", "Education",
  "Environmental Health", "Sustainability", "Health", "Central Florida",
];

const TOPIC_GROUPS = [
  { label: "Technology & Innovation", topics: ["AI", "Technology", "Innovation"] },
  { label: "Society & Governance", topics: ["Geopolitics", "Policy", "Governance", "Democracy"] },
  { label: "Business & Economy", topics: ["Finance", "Economy", "Strategy"] },
  { label: "Organizations & People", topics: ["Leadership", "Culture", "Future of Work", "Education"] },
  { label: "Environment & Community", topics: ["Environmental Health", "Sustainability", "Health", "Central Florida"] },
];

interface Digest {
  id: number;
  weekOf: string;
  headline: string;
  body: string;
  topicTags: string[];
  subscriberCount: number;
  generatedAt: string;
}

interface Subscriber {
  id: number;
  email: string;
  name?: string;
  topics: string[];
  subscribedAt: string;
}

const base = () => (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function Newsletter() {
  const { toast } = useToast();

  const [digestTopics, setDigestTopics] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [latestDigest, setLatestDigest] = useState<Digest | null>(null);

  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);
  const [showSubscribers, setShowSubscribers] = useState(false);

  const toggleTopic = (topic: string) => {
    const next = new Set(digestTopics);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    setDigestTopics(next);
  };

  const handleGenerateDigest = async () => {
    setGenerating(true);
    try {
      const weekOf = new Date().toISOString().slice(0, 10);
      const res = await fetch(`${base()}/api/newsletter/generate-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topics: digestTopics.size > 0 ? Array.from(digestTopics) : ALL_TOPICS,
          weekOf,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const digest = await res.json();
      setLatestDigest(digest);
      toast({ title: "Weekly digest generated", description: "Ready to review and distribute." });
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleLoadSubscribers = async () => {
    setLoadingSubscribers(true);
    try {
      const res = await fetch(`${base()}/api/newsletter/subscribers`);
      const data = await res.json();
      setSubscribers(data);
      setShowSubscribers(true);
    } catch {
      toast({ title: "Failed to load subscribers", variant: "destructive" });
    } finally {
      setLoadingSubscribers(false);
    }
  };

  const handleUnsubscribe = async (id: number) => {
    await fetch(`${base()}/api/newsletter/unsubscribe/${id}`, { method: "DELETE" });
    setSubscribers((s) => s.filter((x) => x.id !== id));
    toast({ title: "Removed from distribution list" });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold">Weekly Digest</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Generate and manage the weekly RGI intelligence digest for internal distribution.
        </p>
      </div>

      {/* Generate Digest */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold font-serif">Generate Weekly Digest</h2>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          AI synthesizes this week's published RGI articles into a curated digest. Select topics to filter, or generate across all topics.
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Filter by topics <span className="font-normal normal-case">(optional — leave blank for all)</span>
          </p>
          <div className="space-y-3">
            {TOPIC_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{group.label}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.topics.map((topic) => (
                    <div
                      key={topic}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                        digestTopics.has(topic)
                          ? "border-primary/40 bg-primary/8 text-primary"
                          : "border-border hover:border-border/60 hover:bg-card text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => toggleTopic(topic)}
                    >
                      <Checkbox
                        checked={digestTopics.has(topic)}
                        onCheckedChange={() => toggleTopic(topic)}
                        className="shrink-0"
                      />
                      <span className="text-xs font-medium">{topic}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {digestTopics.size > 0 && (
          <div className="flex flex-wrap gap-1 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
            {Array.from(digestTopics).map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
            ))}
          </div>
        )}

        <Button
          onClick={handleGenerateDigest}
          disabled={generating}
          className="w-full gap-2"
        >
          {generating ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Generating Digest…</>
          ) : (
            <><Wand2 className="h-4 w-4" />Generate Weekly Digest</>
          )}
        </Button>
      </div>

      {/* Generated Digest Display */}
      {latestDigest && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold truncate">Generated Digest</span>
              <span className="text-xs text-muted-foreground shrink-0">Week of {latestDigest.weekOf}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-wrap gap-1">
                {latestDigest.topicTags.slice(0, 3).map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
                ))}
                {latestDigest.topicTags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{latestDigest.topicTags.length - 3}</span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(`${latestDigest.headline}\n\n${latestDigest.body}`);
                  toast({ title: "Copied to clipboard" });
                }}
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <h3 className="text-xl font-serif font-bold">{latestDigest.headline}</h3>
            <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{latestDigest.body}</div>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Generated {format(new Date(latestDigest.generatedAt), "MMM d, yyyy 'at' h:mm a")}
              {latestDigest.subscriberCount > 0 && ` · ${latestDigest.subscriberCount} recipients`}
            </p>
          </div>
        </div>
      )}

      {/* Distribution List */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Distribution List</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLoadSubscribers} disabled={loadingSubscribers} className="text-xs h-7">
            {loadingSubscribers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "View Recipients"}
          </Button>
        </div>

        {showSubscribers && subscribers.length > 0 && (
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {subscribers.map((s) => (
              <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.name || s.email}</p>
                  {s.name && <p className="text-xs text-muted-foreground truncate">{s.email}</p>}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {s.topics.slice(0, 4).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[9px] h-4 px-1">{t}</Badge>
                    ))}
                    {s.topics.length > 4 && <span className="text-[10px] text-muted-foreground">+{s.topics.length - 4}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleUnsubscribe(s.id)}
                  title="Remove from list"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {showSubscribers && subscribers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No recipients in the distribution list yet.</p>
        )}

        {!showSubscribers && (
          <p className="text-xs text-muted-foreground px-5 py-4">
            Click "View Recipients" to load the current distribution list.
          </p>
        )}
      </div>
    </div>
  );
}
