import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Wand2, FileText, Loader2, Globe, Tag, ChevronRight } from "lucide-react";

const TOPIC_GROUPS = [
  { label: "Technology & Innovation", topics: ["AI", "Technology", "Innovation"] },
  { label: "Society & Governance", topics: ["Geopolitics", "Policy", "Governance", "Democracy"] },
  { label: "Business & Economy", topics: ["Finance", "Economy", "Strategy"] },
  { label: "Organizations & People", topics: ["Leadership", "Culture", "Future of Work", "Education"] },
  { label: "Environment & Community", topics: ["Environmental Health", "Sustainability", "Health", "Central Florida"] },
];

type Mode = "daily_brief" | "topic_article";

interface GenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: Mode;
}

export function GenerateModal({ open, onOpenChange, initialMode = "topic_article" }: GenerateModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [editorNotes, setEditorNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const toggleTopic = (topic: string) => {
    const next = new Set(selectedTopics);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    setSelectedTopics(next);
  };

  const selectGroup = (topics: string[]) => {
    const next = new Set(selectedTopics);
    const allSelected = topics.every((t) => next.has(t));
    if (allSelected) topics.forEach((t) => next.delete(t));
    else topics.forEach((t) => next.add(t));
    setSelectedTopics(next);
  };

  const handleGenerateDailyBrief = async () => {
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/digest/daily-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      toast({
        title: "Daily Intelligence Brief generated",
        description: `"${data.headline?.slice(0, 60)}..." is now in Pending Review.`,
      });
      queryClient.invalidateQueries();
      onOpenChange(false);
      navigate("/review");
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTopicArticle = async () => {
    if (selectedTopics.size === 0) {
      toast({ title: "Select at least one topic", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/digest/generate-on-demand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: Array.from(selectedTopics), editorNotes: editorNotes.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      toast({
        title: "Topic article generated",
        description: `"${data.headline?.slice(0, 60)}..." is now in Pending Review.`,
      });
      queryClient.invalidateQueries();
      onOpenChange(false);
      setSelectedTopics(new Set());
      setEditorNotes("");
      navigate("/review");
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectedTopics.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-5 w-5 text-primary" />
            <DialogTitle className="text-xl font-serif">Generate Intelligence</DialogTitle>
          </div>

          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => setMode("daily_brief")}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                mode === "daily_brief"
                  ? "border-primary bg-primary/8 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground"
              }`}
              data-testid="mode-daily-brief"
            >
              <Globe className={`h-5 w-5 mt-0.5 shrink-0 ${mode === "daily_brief" ? "text-primary" : ""}`} />
              <div>
                <p className="font-semibold text-sm leading-tight">Daily Intelligence Brief</p>
                <p className="text-xs mt-1 leading-snug opacity-70">
                  Macro synthesis of everything that matters today
                </p>
              </div>
            </button>

            <button
              onClick={() => setMode("topic_article")}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                mode === "topic_article"
                  ? "border-primary bg-primary/8 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground"
              }`}
              data-testid="mode-topic-article"
            >
              <Tag className={`h-5 w-5 mt-0.5 shrink-0 ${mode === "topic_article" ? "text-primary" : ""}`} />
              <div>
                <p className="font-semibold text-sm leading-tight">Topic Article</p>
                <p className="text-xs mt-1 leading-snug opacity-70">
                  Deep-dive analysis on a specific theme
                </p>
              </div>
            </button>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 pb-6 pt-3">
          {mode === "daily_brief" ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <p className="text-sm font-semibold">What this generates</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The Daily Intelligence Brief synthesizes all of today's high-scoring articles across every topic into one authoritative executive document. It identifies the patterns, tensions, and strategic implications that only emerge when you read them all together.
                </p>
                <div className="space-y-1.5 pt-1 border-t border-border mt-3">
                  {[
                    "Executive summary — 6 bullets, one per major development",
                    "Dominant narrative — the central story connecting today's events",
                    "Thematic deep dives — one analytical paragraph per major theme",
                    "Cross-theme intelligence — patterns visible only at the macro level",
                    "RGI perspective and leadership implications",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <ChevronRight className="h-3 w-3 mt-0.5 text-primary/60 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground leading-relaxed">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Automatically selects today's top articles (score 6.0+) across all sources. Target: 900–1200 words. Result goes to Pending Review.
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
                <Button onClick={handleGenerateDailyBrief} disabled={loading} className="gap-2 min-w-44" data-testid="btn-generate-daily-brief">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</> : <><Globe className="h-4 w-4" />Generate Daily Brief</>}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-4">
                {TOPIC_GROUPS.map((group) => {
                  const groupSelected = group.topics.filter((t) => selectedTopics.has(t)).length;
                  return (
                    <div key={group.label}>
                      <button
                        onClick={() => selectGroup(group.topics)}
                        className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2 hover:text-foreground transition-colors w-full text-left"
                      >
                        {group.label}
                        {groupSelected > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{groupSelected}/{group.topics.length}</Badge>
                        )}
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        {group.topics.map((topic) => (
                          <div
                            key={topic}
                            className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                              selectedTopics.has(topic)
                                ? "border-primary/40 bg-primary/8 text-foreground"
                                : "border-border bg-background hover:border-border/60 hover:bg-card"
                            }`}
                            onClick={() => toggleTopic(topic)}
                            data-testid={`topic-${topic.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <Checkbox checked={selectedTopics.has(topic)} onCheckedChange={() => toggleTopic(topic)} className="shrink-0" />
                            <Label className="text-sm font-medium cursor-pointer leading-none">{topic}</Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedCount > 0 && (
                <div className="flex flex-wrap gap-1.5 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  {Array.from(selectedTopics).map((t) => (
                    <Badge key={t} variant="outline" className="text-xs border-primary/30 text-primary">{t}</Badge>
                  ))}
                </div>
              )}

              <div>
                <Label className="text-sm font-semibold mb-1.5 block">
                  Editorial Direction <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  placeholder="Angle, focus, emphasis, or questions this article should answer..."
                  value={editorNotes}
                  onChange={(e) => setEditorNotes(e.target.value)}
                  className="resize-none text-sm"
                  rows={3}
                  data-testid="input-generate-notes"
                />
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground leading-relaxed">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Selects the highest-scoring articles matching your topics from the last 24 hours and synthesizes them into one focused strategic brief (700–900 words). Result goes to Pending Review.
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
                <Button
                  onClick={handleGenerateTopicArticle}
                  disabled={loading || selectedCount === 0}
                  className="gap-2 min-w-44"
                  data-testid="btn-confirm-generate"
                >
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                  ) : (
                    <><Tag className="h-4 w-4" />Generate{selectedCount > 0 ? ` (${selectedCount})` : ""}</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
