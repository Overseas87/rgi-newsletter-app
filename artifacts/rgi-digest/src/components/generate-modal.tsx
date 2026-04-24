import { useState, useEffect, useRef } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Wand2, FileText, Loader2, Globe, Tag, ChevronRight,
  Volume2, VolumeX, RefreshCw, Send, CheckCircle, Trash2,
  ArrowLeft, ListChecks, Zap,
} from "lucide-react";
import { VoiceInput } from "@/components/voice-input";

const TOPIC_GROUPS = [
  {
    label: "Technology & Innovation",
    topics: ["Technology & AI", "Innovation & Digital Transformation"],
  },
  {
    label: "Geopolitics & Economics",
    topics: ["Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets"],
  },
  {
    label: "Trade & Resources",
    topics: ["Supply Chains & Global Trade", "Energy & Resources"],
  },
  {
    label: "Business & Leadership",
    topics: ["Business Strategy & Corporations", "Leadership & Organizations", "Future of Work & Society"],
  },
  {
    label: "Policy & Environment",
    topics: ["Policy, Regulation & Governance", "Climate & Environmental Systems"],
  },
];

type Mode = "daily_brief" | "topic_article";
type Stage = "configure" | "select_articles" | "preview";

interface CandidateArticle {
  id: number;
  headline: string;
  sourceName: string;
  relevancyScore: number;
  topicTags: string[];
  viewpoint?: string | null;
  url?: string | null;
}

interface GeneratedArticle {
  id: number;
  headline: string;
  body: string;
  executiveSummary: string[];
  rgiTake: string;
  keyTakeaways: string[];
  implificationsForLeaders: string[];
  whatMostAreMissing: string | null;
  mechanism: string[];
  constraintsAndRisks: string[];
  whatToWatch: string[];
  topicTags: string[];
  discipline: string;
}

interface GenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: Mode;
}

const ALL_TOPICS = TOPIC_GROUPS.flatMap((g) => g.topics);

export function GenerateModal({ open, onOpenChange, initialMode = "topic_article" }: GenerateModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [stage, setStage] = useState<Stage>("configure");
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [excludedTopics, setExcludedTopics] = useState<Set<string>>(new Set());
  const [editorNotes, setEditorNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [generatedArticle, setGeneratedArticle] = useState<GeneratedArticle | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [refineHistory, setRefineHistory] = useState<string[]>([]);

  // Track whether modal is still open when a background fetch completes
  const modalOpenRef = useRef(open);
  useEffect(() => { modalOpenRef.current = open; }, [open]);

  // Article selection state
  const [candidates, setCandidates] = useState<CandidateArticle[]>([]);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<number>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const LOADING_STAGES = [
    "Selecting top articles...",
    "Analyzing intelligence signals...",
    "Building narrative thread...",
    "Writing brief...",
    "Almost done...",
  ];

  const startProgressAnimation = () => {
    setLoadingStage(0);
    const t1 = setTimeout(() => setLoadingStage(1), 2000);
    const t2 = setTimeout(() => setLoadingStage(2), 7000);
    const t3 = setTimeout(() => setLoadingStage(3), 14000);
    const t4 = setTimeout(() => setLoadingStage(4), 22000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  };

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

  const toggleExcludedTopic = (topic: string) => {
    const next = new Set(excludedTopics);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    setExcludedTopics(next);
  };

  const excludeGroup = (topics: string[]) => {
    const next = new Set(excludedTopics);
    const allExcluded = topics.every((t) => next.has(t));
    if (allExcluded) topics.forEach((t) => next.delete(t));
    else topics.forEach((t) => next.add(t));
    setExcludedTopics(next);
  };

  const resetState = () => {
    setStage("configure");
    setGeneratedArticle(null);
    setFromCache(false);
    setRefineInstruction("");
    setRefineHistory([]);
    setSelectedTopics(new Set());
    setExcludedTopics(new Set());
    setEditorNotes("");
    setCandidates([]);
    setSelectedArticleIds(new Set());
    setLoading(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    // If generation is in flight, let it continue in the background.
    // The fetch handler checks modalOpenRef and will show a toast on completion.
    if (!loading) {
      setTimeout(resetState, 300);
    }
  };

  // Fetch candidate articles matching selected topics
  const fetchCandidates = async () => {
    if (selectedTopics.size === 0) {
      toast({ title: "Select at least one topic", variant: "destructive" });
      return;
    }
    setLoadingCandidates(true);
    try {
      const res = await fetch(`${base}/api/articles?minScore=6.5&limit=200`);
      if (!res.ok) throw new Error("Failed to fetch articles");
      const data: CandidateArticle[] = await res.json();
      const topics = Array.from(selectedTopics);
      const matching = data
        .filter((a) => a.topicTags?.some((t) => topics.includes(t)))
        .sort((a, b) => b.relevancyScore - a.relevancyScore)
        .slice(0, 40);
      setCandidates(matching);
      setSelectedArticleIds(new Set(matching.map((a) => a.id)));
      setStage("select_articles");
    } catch {
      toast({ title: "Failed to load articles", description: "Could not retrieve matching articles. Try again.", variant: "destructive" });
    } finally {
      setLoadingCandidates(false);
    }
  };

  const toggleArticle = (id: number) => {
    setSelectedArticleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedArticleIds.size === candidates.length) {
      setSelectedArticleIds(new Set());
    } else {
      setSelectedArticleIds(new Set(candidates.map((a) => a.id)));
    }
  };

  const handleGenerateDailyBrief = async () => {
    setLoading(true);
    const stopAnimation = startProgressAnimation();
    toast({
      title: "Generating daily brief",
      description: "You can close this window — we'll notify you when it's ready.",
    });
    try {
      const res = await fetch(`${base}/api/digest/daily-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editorNotes: editorNotes.trim() || null,
          excludedTopics: excludedTopics.size > 0 ? Array.from(excludedTopics) : [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      if (modalOpenRef.current) {
        setFromCache(!!data.fromCache);
        setGeneratedArticle({
          id: data.id,
          headline: data.headline,
          body: data.body,
          executiveSummary: data.executiveSummary || [],
          rgiTake: data.rgiTake,
          keyTakeaways: data.keyTakeaways || [],
          implificationsForLeaders: data.implificationsForLeaders || [],
          whatMostAreMissing: data.whatMostAreMissing ?? null,
          mechanism: data.mechanism || [],
          constraintsAndRisks: data.constraintsAndRisks || [],
          whatToWatch: data.whatToWatch || [],
          topicTags: data.topicTags || [],
          discipline: data.discipline || "Multiple",
        });
        setStage("preview");
      } else {
        // Modal was closed — show background completion toast
        queryClient.invalidateQueries();
        toast({
          title: "Daily brief ready",
          description: `"${(data.headline || "Brief").slice(0, 70)}…" has been added to Pending Review.`,
        });
        setTimeout(resetState, 100);
      }
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
      if (modalOpenRef.current) setLoading(false);
      else setTimeout(resetState, 100);
      return;
    } finally {
      stopAnimation();
      if (modalOpenRef.current) setLoading(false);
    }
  };

  const handleGenerateFromSelection = async () => {
    const ids = Array.from(selectedArticleIds);
    if (ids.length === 0) {
      toast({ title: "Select at least one article", variant: "destructive" });
      return;
    }
    setLoading(true);
    const stopAnimation = startProgressAnimation();
    toast({
      title: "Generating brief",
      description: "You can close this window — we'll notify you when it's ready.",
    });
    try {
      const res = await fetch(`${base}/api/digest/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleIds: ids,
          editorNotes: editorNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const data = await res.json();
      if (modalOpenRef.current) {
        setFromCache(!!data.fromCache);
        setGeneratedArticle({
          id: data.id,
          headline: data.headline,
          body: data.body,
          executiveSummary: data.executiveSummary || [],
          rgiTake: data.rgiTake,
          keyTakeaways: data.keyTakeaways || [],
          implificationsForLeaders: data.implificationsForLeaders || [],
          whatMostAreMissing: data.whatMostAreMissing ?? null,
          mechanism: data.mechanism || [],
          constraintsAndRisks: data.constraintsAndRisks || [],
          whatToWatch: data.whatToWatch || [],
          topicTags: data.topicTags || [],
          discipline: data.discipline || "Multiple",
        });
        setStage("preview");
      } else {
        // Modal was closed — show background completion toast
        queryClient.invalidateQueries();
        toast({
          title: "Brief ready",
          description: `"${(data.headline || "Brief").slice(0, 70)}…" has been added to Pending Review.`,
        });
        setTimeout(resetState, 100);
      }
    } catch (e) {
      toast({ title: "Generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
      if (modalOpenRef.current) setLoading(false);
      else setTimeout(resetState, 100);
      return;
    } finally {
      stopAnimation();
      if (modalOpenRef.current) setLoading(false);
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
        executiveSummary: refined.executiveSummary || prev.executiveSummary,
        rgiTake: refined.rgiTake,
        keyTakeaways: refined.keyTakeaways,
        implificationsForLeaders: refined.implificationsForLeaders || prev.implificationsForLeaders,
        whatMostAreMissing: refined.whatMostAreMissing ?? prev.whatMostAreMissing,
        mechanism: refined.mechanism || prev.mechanism,
        constraintsAndRisks: refined.constraintsAndRisks || prev.constraintsAndRisks,
        whatToWatch: refined.whatToWatch || prev.whatToWatch,
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

  // ── Stage: Article selection ─────────────────────────────────────────────
  if (stage === "select_articles") {
    const allSelected = selectedArticleIds.size === candidates.length;
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <DialogTitle className="text-sm font-semibold">Select Source Articles</DialogTitle>
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {Array.from(selectedTopics).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
              ))}
            </div>
          </DialogHeader>

          {/* Selection controls */}
          <div className="px-6 py-2.5 border-b border-border/60 bg-muted/20 flex items-center justify-between shrink-0">
            <p className="text-xs text-muted-foreground">
              {candidates.length === 0
                ? "No articles found for selected topics in the current window."
                : `${candidates.length} article${candidates.length !== 1 ? "s" : ""} match your topics. ${selectedArticleIds.size} selected.`}
            </p>
            {candidates.length > 0 && (
              <button
                onClick={handleSelectAll}
                className="text-xs text-primary hover:underline font-medium"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
            {candidates.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <p className="text-sm font-medium">No matching articles found</p>
                <p className="text-xs mt-1">Try running a scrape first, or select different topics.</p>
              </div>
            ) : (
              candidates.map((article) => {
                const isSelected = selectedArticleIds.has(article.id);
                const topScore = article.relevancyScore >= 8.5;
                return (
                  <div
                    key={article.id}
                    onClick={() => toggleArticle(article.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-card hover:border-border/60"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleArticle(article.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium leading-snug ${isSelected ? "text-foreground" : "text-foreground/80"}`}>
                          {article.headline}
                        </p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          topScore
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-muted text-muted-foreground border border-border"
                        }`}>
                          {article.relevancyScore?.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-medium">{article.sourceName}</span>
                        {article.topicTags?.slice(0, 3).map((t) => (
                          <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            selectedTopics.has(t)
                              ? "bg-primary/8 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground border-border"
                          }`}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0 bg-card/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStage("configure")}
              className="gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Topics
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={handleGenerateFromSelection}
                disabled={loading || selectedArticleIds.size === 0}
                className="gap-2 min-w-56"
                data-testid="btn-generate-from-selection"
              >
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" />{LOADING_STAGES[loadingStage]}</>
                  : <><Wand2 className="h-4 w-4" />Generate from {selectedArticleIds.size} Article{selectedArticleIds.size !== 1 ? "s" : ""}</>
                }
              </Button>
              {loading && (
                <p className="text-[10px] text-muted-foreground">
                  You can close this dialog — brief will notify when ready
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Stage: Preview / Refine ──────────────────────────────────────────────
  if (stage === "preview" && generatedArticle) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <DialogTitle className="text-sm font-semibold text-foreground">Article Generated</DialogTitle>
                {fromCache && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    <Zap className="h-2.5 w-2.5" />
                    Returned from cache
                  </span>
                )}
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
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {generatedArticle.discipline && (
                  <Badge variant="secondary" className="text-[10px]">{generatedArticle.discipline}</Badge>
                )}
                {generatedArticle.topicTags.slice(0, 4).map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] border-primary/30 text-primary">{t}</Badge>
                ))}
              </div>
              <h2 className="text-xl font-serif font-bold leading-snug">{generatedArticle.headline}</h2>

              {/* Executive Summary */}
              {generatedArticle.executiveSummary.length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Executive Summary</p>
                  <div className="space-y-1">
                    {generatedArticle.executiveSummary.map((s, i) => (
                      <p key={i} className="text-xs text-foreground/80 leading-relaxed">{s}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Key Developments */}
              {(() => {
                const isStructured = generatedArticle.whatToWatch.length > 0;
                const keyDevelopments = isStructured ? generatedArticle.body.split("\n").filter(Boolean) : null;
                return isStructured && keyDevelopments && keyDevelopments.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Key Developments</p>
                    <ul className="space-y-1.5">
                      {keyDevelopments.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                          <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-foreground/30" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">{generatedArticle.body}</p>
                );
              })()}

              {/* Why It Matters */}
              {generatedArticle.keyTakeaways.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                    {generatedArticle.whatToWatch.length > 0 ? "Why It Matters" : "Key Takeaways"}
                  </p>
                  <ul className="space-y-1">
                    {generatedArticle.keyTakeaways.slice(0, 3).map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Implications for Decision-Makers */}
              {generatedArticle.implificationsForLeaders.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">Implications for Decision-Makers</p>
                  <ul className="space-y-1">
                    {generatedArticle.implificationsForLeaders.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-violet-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* RGI Editorial */}
              {generatedArticle.rgiTake && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">RGI Editorial</p>
                  <p className="text-xs leading-relaxed text-foreground/80">{generatedArticle.rgiTake}</p>
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

  // ── Stage: Configure ─────────────────────────────────────────────────────
  const selectedCount = selectedTopics.size;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-5 w-5 text-primary" />
            <DialogTitle className="text-xl font-serif">Generate Intelligence</DialogTitle>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => setMode("daily_brief")}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                mode === "daily_brief"
                  ? "border-primary bg-primary/5 text-foreground"
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
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground"
              }`}
              data-testid="mode-topic-article"
            >
              <Tag className={`h-5 w-5 mt-0.5 shrink-0 ${mode === "topic_article" ? "text-primary" : ""}`} />
              <div>
                <p className="font-semibold text-sm leading-tight">Topic Article</p>
                <p className="text-xs mt-1 leading-snug opacity-70">
                  Deep-dive on a theme — you choose the source articles
                </p>
              </div>
            </button>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 pb-6 pt-3">
          {mode === "daily_brief" ? (
            <div className="space-y-5">
              {/* Topic scope — all included by default, user can exclude */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Topic Scope</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All topics are included by default. Uncheck any you want to exclude from this brief.
                    </p>
                  </div>
                  {excludedTopics.size > 0 && (
                    <button
                      onClick={() => setExcludedTopics(new Set())}
                      className="text-xs text-primary hover:underline font-medium shrink-0"
                    >
                      Restore all
                    </button>
                  )}
                </div>

                {TOPIC_GROUPS.map((group) => {
                  const groupExcluded = group.topics.filter((t) => excludedTopics.has(t)).length;
                  return (
                    <div key={group.label}>
                      <button
                        onClick={() => excludeGroup(group.topics)}
                        className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2 hover:text-foreground transition-colors w-full text-left"
                      >
                        {group.label}
                        {groupExcluded > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-muted text-muted-foreground">
                            {groupExcluded} excluded
                          </Badge>
                        )}
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        {group.topics.map((topic) => {
                          const isExcluded = excludedTopics.has(topic);
                          return (
                            <div
                              key={topic}
                              className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                                isExcluded
                                  ? "border-border bg-muted/30 opacity-50"
                                  : "border-primary/30 bg-primary/5 text-foreground"
                              }`}
                              onClick={() => toggleExcludedTopic(topic)}
                              data-testid={`daily-topic-${topic.replace(/\s+/g, "-").toLowerCase()}`}
                            >
                              <Checkbox
                                checked={!isExcluded}
                                onCheckedChange={() => toggleExcludedTopic(topic)}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0"
                              />
                              <Label className={`text-sm font-medium cursor-pointer leading-none ${isExcluded ? "line-through opacity-60" : ""}`}>
                                {topic}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Excluded topics summary */}
              {excludedTopics.size > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 space-y-1">
                  <p className="font-semibold">
                    {excludedTopics.size} topic{excludedTopics.size !== 1 ? "s" : ""} excluded — brief will focus on {ALL_TOPICS.length - excludedTopics.size} of {ALL_TOPICS.length} topics
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(excludedTopics).map((t) => (
                      <span key={t} className="line-through opacity-70">{t}</span>
                    ))}
                  </div>
                </div>
              )}

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
                Automatically selects today's top articles (score 6.0+) across all included topics. You can refine the output after generation.
              </div>

              {loading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    {LOADING_STAGES.map((s, i) => (
                      <span key={s} className={i === loadingStage ? "text-primary font-medium" : i < loadingStage ? "text-primary/50" : ""}>{i + 1}</span>
                    ))}
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-[2000ms] ease-in-out"
                      style={{ width: `${((loadingStage + 1) / LOADING_STAGES.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
                <Button onClick={handleGenerateDailyBrief} disabled={loading} className="gap-2 min-w-52" data-testid="btn-generate-daily-brief">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{LOADING_STAGES[loadingStage]}</> : <><Globe className="h-4 w-4" />Generate Daily Brief</>}
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
                                ? "border-primary/40 bg-primary/5 text-foreground"
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
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 leading-relaxed">
                <ListChecks className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                After selecting topics, you will review all matching articles and choose exactly which ones to include before generation.
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" onClick={handleClose} disabled={loadingCandidates}>Cancel</Button>
                <Button
                  onClick={fetchCandidates}
                  disabled={selectedCount === 0 || loadingCandidates}
                  className="gap-2 min-w-52"
                  data-testid="btn-review-articles"
                >
                  {loadingCandidates
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Loading articles…</>
                    : <><ListChecks className="h-4 w-4" />Review Matching Articles</>
                  }
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
