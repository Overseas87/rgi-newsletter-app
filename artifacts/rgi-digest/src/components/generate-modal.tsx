import { useState, useRef, useCallback } from "react";
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
import {
  Wand2, FileText, Loader2, Globe, Tag, ChevronRight,
  Volume2, VolumeX, RefreshCw, Send, CheckCircle, Trash2,
} from "lucide-react";
import { VoiceInput } from "@/components/voice-input";

const TOPIC_GROUPS = [
  { label: "Technology & Innovation", topics: ["AI", "Technology", "Innovation"] },
  { label: "Society & Governance", topics: ["Geopolitics", "Policy", "Governance", "Democracy"] },
  { label: "Business & Economy", topics: ["Finance", "Economy", "Strategy"] },
  { label: "Organizations & People", topics: ["Leadership", "Culture", "Future of Work", "Education"] },
  { label: "Environment & Community", topics: ["Environmental Health", "Sustainability", "Health", "Central Florida"] },
];

type Mode = "daily_brief" | "topic_article";
type Stage = "configure" | "preview";

interface GeneratedArticle {
  id: number;
  headline: string;
  body: string;
  rgiTake: string;
  keyTakeaways: string[];
  topicTags: string[];
  discipline: string;
}

interface GenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: Mode;
}

export function GenerateModal({ open, onOpenChange, initialMode = "topic_article" }: GenerateModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [stage, setStage] = useState<Stage>("configure");
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [editorNotes, setEditorNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedArticle, setGeneratedArticle] = useState<GeneratedArticle | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [refineHistory, setRefineHistory] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

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

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStage("configure");
      setGeneratedArticle(null);
      setRefineInstruction("");
      setRefineHistory([]);
      setSelectedTopics(new Set());
      setEditorNotes("");
    }, 300);
  };

  const handleGenerateDailyBrief = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/digest/daily-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorNotes: editorNotes.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      setGeneratedArticle({
        id: data.id,
        headline: data.headline,
        body: data.body,
        rgiTake: data.rgiTake,
        keyTakeaways: data.keyTakeaways || [],
        topicTags: data.topicTags || [],
        discipline: data.discipline || "Multiple",
      });
      setStage("preview");
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
      setGeneratedArticle({
        id: data.id,
        headline: data.headline,
        body: data.body,
        rgiTake: data.rgiTake,
        keyTakeaways: data.keyTakeaways || [],
        topicTags: data.topicTags || [],
        discipline: data.discipline || "Multiple",
      });
      setStage("preview");
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!refineInstruction.trim() || !generatedArticle) return;
    setRefining(true);
    const instruction = refineInstruction.trim();
    try {
      const res = await fetch(`${base}/api/digest/${generatedArticle.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Refinement failed" }));
        throw new Error(err.error || "Refinement failed");
      }
      const refined = await res.json();
      setGeneratedArticle((prev) => prev ? {
        ...prev,
        headline: refined.headline,
        body: refined.body,
        rgiTake: refined.rgiTake,
        keyTakeaways: refined.keyTakeaways,
      } : prev);
      setRefineHistory((h) => [...h, instruction]);
      setRefineInstruction("");
      toast({ title: "Article refined", description: "The AI has applied your editorial direction." });
    } catch (e) {
      toast({ title: "Refinement failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setRefining(false);
    }
  };

  const handleSaveAsDraft = () => {
    queryClient.invalidateQueries();
    toast({
      title: "Saved to Pending Review",
      description: `"${generatedArticle?.headline?.slice(0, 60)}..." is ready for your review.`,
    });
    handleClose();
    navigate("/review");
  };

  const handleSpeak = () => {
    if (!generatedArticle) return;
    if (speaking) {
      speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = `${generatedArticle.headline}. ${generatedArticle.body}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.0;
    utterance.lang = "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const selectedCount = selectedTopics.size;

  if (stage === "preview" && generatedArticle) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <DialogTitle className="text-sm font-semibold text-foreground">Article Generated</DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSpeak}
                  className="gap-1.5 text-xs"
                  title={speaking ? "Stop listening" : "Listen to article"}
                >
                  {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  {speaking ? "Stop" : "Listen"}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
            {/* Article Preview */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {generatedArticle.discipline && (
                  <Badge variant="secondary" className="text-[10px]">{generatedArticle.discipline}</Badge>
                )}
                {generatedArticle.topicTags.slice(0, 4).map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
                ))}
              </div>
              <h2 className="text-xl font-serif font-bold leading-snug">{generatedArticle.headline}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6">{generatedArticle.body}</p>
              {generatedArticle.rgiTake && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">RGI Take</p>
                  <p className="text-xs leading-relaxed text-foreground/80 line-clamp-3">{generatedArticle.rgiTake}</p>
                </div>
              )}
              {generatedArticle.keyTakeaways.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Key Takeaways</p>
                  <ul className="space-y-1">
                    {generatedArticle.keyTakeaways.slice(0, 3).map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <ChevronRight className="h-3 w-3 mt-0.5 text-primary/60 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Refine Panel */}
            <div className="border border-border rounded-xl p-4 space-y-3 bg-card">
              <div>
                <p className="text-sm font-semibold mb-0.5">Refine with AI</p>
                <p className="text-xs text-muted-foreground">
                  Type or speak instructions — the AI will rewrite the article accordingly.
                </p>
              </div>

              {refineHistory.length > 0 && (
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {refineHistory.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] bg-muted/50 rounded px-2.5 py-1.5">
                      <span className="text-primary/60 shrink-0 font-bold">{i + 1}.</span>
                      <span className="text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Textarea
                  placeholder="Make this more focused on geopolitics... Shorten the second paragraph... Add more analysis on AI regulation..."
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  className="resize-none text-sm flex-1"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleRefine();
                    }
                  }}
                  disabled={refining}
                />
                <div className="flex flex-col gap-2">
                  <VoiceInput
                    onTranscript={(text) => setRefineInstruction((prev) => prev ? `${prev} ${text}` : text)}
                    disabled={refining}
                  />
                  <Button
                    size="icon"
                    onClick={handleRefine}
                    disabled={refining || !refineInstruction.trim()}
                    title="Apply refinement (Cmd+Enter)"
                  >
                    {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60">Cmd+Enter to refine · Each refinement updates the article in place</p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0 bg-card/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="gap-1.5 text-destructive/70 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Discard
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStage("configure");
                  setGeneratedArticle(null);
                  setRefineHistory([]);
                  setRefineInstruction("");
                }}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Start Over
              </Button>
              <Button size="sm" onClick={handleSaveAsDraft} className="gap-1.5 min-w-36">
                <CheckCircle className="h-3.5 w-3.5" />
                Save as Draft
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
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
                  The Daily Intelligence Brief synthesizes all of today's high-scoring articles across every topic into one authoritative executive document.
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

              {/* Editorial Direction for daily brief */}
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">
                  Editorial Direction <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Angle, focus, emphasis, or questions this brief should address..."
                    value={editorNotes}
                    onChange={(e) => setEditorNotes(e.target.value)}
                    className="resize-none text-sm flex-1"
                    rows={2}
                    data-testid="input-generate-notes"
                  />
                  <VoiceInput
                    onTranscript={(text) => setEditorNotes((prev) => prev ? `${prev} ${text}` : text)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground leading-relaxed">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Automatically selects today's top articles (score 6.0+) across all sources. You can refine the output after generation.
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
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
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Angle, focus, emphasis, or questions this article should answer..."
                    value={editorNotes}
                    onChange={(e) => setEditorNotes(e.target.value)}
                    className="resize-none text-sm flex-1"
                    rows={2}
                    data-testid="input-generate-notes"
                  />
                  <VoiceInput
                    onTranscript={(text) => setEditorNotes((prev) => prev ? `${prev} ${text}` : text)}
                    disabled={loading}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Click the mic to speak your editorial direction</p>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground leading-relaxed">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Selects the highest-scoring articles matching your topics and synthesizes them into a focused brief. You can refine the output after generation.
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
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
