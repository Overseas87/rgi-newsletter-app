import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Wand2, Users, FileText, ChevronRight, Trash2 } from "lucide-react";
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

  // Subscribe form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [subscribing, setSubscribing] = useState(false);

  // Digest generation
  const [digestTopics, setDigestTopics] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [latestDigest, setLatestDigest] = useState<Digest | null>(null);

  // Subscribers management
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);
  const [showSubscribers, setShowSubscribers] = useState(false);

  const toggleTopic = (set: Set<string>, setter: (s: Set<string>) => void, topic: string) => {
    const next = new Set(set);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    setter(next);
  };

  const handleSubscribe = async () => {
    if (!email || !email.includes("@")) {
      toast({ title: "Valid email required", variant: "destructive" });
      return;
    }
    if (selectedTopics.size === 0) {
      toast({ title: "Select at least one topic", variant: "destructive" });
      return;
    }
    setSubscribing(true);
    try {
      const res = await fetch(`${base()}/api/newsletter/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, topics: Array.from(selectedTopics) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const { updated } = await res.json();
      toast({
        title: updated ? "Subscription updated" : "Subscribed successfully",
        description: `You will receive digests for: ${Array.from(selectedTopics).join(", ")}`,
      });
      setEmail("");
      setName("");
      setSelectedTopics(new Set());
    } catch (e) {
      toast({ title: "Subscription failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setSubscribing(false);
    }
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
      toast({ title: "Weekly digest generated", description: "Digest is ready to review and send." });
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
    toast({ title: "Unsubscribed" });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold">Newsletter System</h1>
        <p className="text-muted-foreground mt-1">Manage subscriptions and generate weekly intelligence digests tailored to each reader's topic interests.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Subscribe Form */}
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold font-serif flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Subscribe to Intelligence Digest
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Receive a curated weekly brief of the most important developments in your chosen topics.</p>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Email address</Label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">Topics of interest</Label>
            <p className="text-xs text-muted-foreground mb-3">Select all areas you want to receive intelligence on.</p>
            <div className="space-y-3">
              {TOPIC_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{group.label}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.topics.map((topic) => (
                      <div
                        key={topic}
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                          selectedTopics.has(topic)
                            ? "border-primary/40 bg-primary/8"
                            : "border-border hover:border-border/60 hover:bg-card"
                        }`}
                        onClick={() => toggleTopic(selectedTopics, setSelectedTopics, topic)}
                      >
                        <Checkbox checked={selectedTopics.has(topic)} onCheckedChange={() => toggleTopic(selectedTopics, setSelectedTopics, topic)} className="shrink-0" />
                        <span className="text-xs font-medium">{topic}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedTopics.size > 0 && (
            <div className="flex flex-wrap gap-1 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              {Array.from(selectedTopics).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
              ))}
            </div>
          )}

          <Button
            onClick={handleSubscribe}
            disabled={subscribing || !email || selectedTopics.size === 0}
            className="w-full gap-2"
          >
            {subscribing ? <><Loader2 className="h-4 w-4 animate-spin" />Subscribing…</> : <><Mail className="h-4 w-4" />Subscribe</>}
          </Button>
        </div>

        {/* Generate Digest */}
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold font-serif flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              Generate Weekly Digest
            </h2>
            <p className="text-sm text-muted-foreground mt-1">AI synthesizes this week's published RGI articles into a curated digest. Leave topics blank for an all-topics digest.</p>
          </div>

          <div>
            <Label className="text-sm font-semibold mb-2 block">Filter by topics <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
              {ALL_TOPICS.map((topic) => (
                <div
                  key={topic}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                    digestTopics.has(topic)
                      ? "border-primary/40 bg-primary/8"
                      : "border-border hover:border-border/60 hover:bg-card"
                  }`}
                  onClick={() => toggleTopic(digestTopics, setDigestTopics, topic)}
                >
                  <Checkbox checked={digestTopics.has(topic)} onCheckedChange={() => toggleTopic(digestTopics, setDigestTopics, topic)} className="shrink-0" />
                  <span className="text-xs font-medium">{topic}</span>
                </div>
              ))}
            </div>
          </div>

          <Button
            onClick={handleGenerateDigest}
            disabled={generating}
            className="w-full gap-2"
            variant="outline"
          >
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating Digest…</> : <><Wand2 className="h-4 w-4" />Generate Weekly Digest</>}
          </Button>

          {/* Subscriber Count */}
          <div className="border border-border rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Active Subscribers</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLoadSubscribers} disabled={loadingSubscribers}>
              {loadingSubscribers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "View List"}
            </Button>
          </div>

          {showSubscribers && subscribers.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{subscribers.length} Active Subscribers</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-border">
                {subscribers.map((s) => (
                  <div key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.name || s.email}</p>
                      {s.name && <p className="text-xs text-muted-foreground truncate">{s.email}</p>}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.topics.slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[9px] h-4 px-1">{t}</Badge>
                        ))}
                        {s.topics.length > 3 && <span className="text-[10px] text-muted-foreground">+{s.topics.length - 3}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleUnsubscribe(s.id)}
                      title="Unsubscribe"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showSubscribers && subscribers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No active subscribers yet.</p>
          )}
        </div>
      </div>

      {/* Generated Digest Display */}
      {latestDigest && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Generated Digest</span>
              <span className="text-xs text-muted-foreground">
                Week of {latestDigest.weekOf} · {latestDigest.subscriberCount} subscribers
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {latestDigest.topicTags.slice(0, 4).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
              ))}
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <h3 className="text-xl font-serif font-bold">{latestDigest.headline}</h3>
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{latestDigest.body}</div>
            <div className="pt-3 border-t border-border flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Generated {format(new Date(latestDigest.generatedAt), "MMM d, yyyy 'at' h:mm a")}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(`${latestDigest.headline}\n\n${latestDigest.body}`);
                  toast({ title: "Copied to clipboard" });
                }}
              >
                Copy Text
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
