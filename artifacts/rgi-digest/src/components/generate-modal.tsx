import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Wand2, FileText, Loader2 } from "lucide-react";

const ALL_TOPICS = [
  "AI", "Leadership", "Geopolitics", "Finance", "Environmental Health",
  "Central Florida", "Strategy", "Culture", "Technology", "Policy",
  "Education", "Economy", "Innovation", "Governance", "Health",
  "Democracy", "Future of Work", "Sustainability",
];

const TOPIC_GROUPS = [
  { label: "Technology & Innovation", topics: ["AI", "Technology", "Innovation"] },
  { label: "Society & Governance", topics: ["Geopolitics", "Policy", "Governance", "Democracy"] },
  { label: "Business & Economy", topics: ["Finance", "Economy", "Strategy"] },
  { label: "Organizations & People", topics: ["Leadership", "Culture", "Future of Work", "Education"] },
  { label: "Environment & Community", topics: ["Environmental Health", "Sustainability", "Health", "Central Florida"] },
];

interface GenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateModal({ open, onOpenChange }: GenerateModalProps) {
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
    if (allSelected) {
      topics.forEach((t) => next.delete(t));
    } else {
      topics.forEach((t) => next.add(t));
    }
    setSelectedTopics(next);
  };

  const handleGenerate = async () => {
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
        body: JSON.stringify({
          topics: Array.from(selectedTopics),
          editorNotes: editorNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }

      const data = await res.json();
      toast({
        title: "Brief generated",
        description: `"${data.headline?.slice(0, 60)}..." is now in Pending Review.`,
      });

      queryClient.invalidateQueries();
      onOpenChange(false);
      setSelectedTopics(new Set());
      setEditorNotes("");
      navigate("/review");
    } catch (e) {
      toast({
        title: "Generation failed",
        description: String(e instanceof Error ? e.message : e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectedTopics.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Wand2 className="h-5 w-5 text-primary" />
            <DialogTitle className="text-xl font-serif">Generate Intelligence Brief</DialogTitle>
          </div>
          <DialogDescription>
            Select topics to synthesize into a strategic brief from today's intelligence feed. The AI will gather relevant articles across your selected themes and produce one coherent analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Topic Selection by Group */}
          <div className="space-y-4">
            {TOPIC_GROUPS.map((group) => {
              const groupSelected = group.topics.filter((t) => selectedTopics.has(t)).length;
              const allGroupSelected = groupSelected === group.topics.length;
              return (
                <div key={group.label}>
                  <button
                    onClick={() => selectGroup(group.topics)}
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2 hover:text-foreground transition-colors w-full text-left"
                  >
                    {group.label}
                    {groupSelected > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                        {groupSelected}/{group.topics.length}
                      </Badge>
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
                        <Checkbox
                          checked={selectedTopics.has(topic)}
                          onCheckedChange={() => toggleTopic(topic)}
                          className="shrink-0"
                        />
                        <Label className="text-sm font-medium cursor-pointer leading-none">
                          {topic}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected summary */}
          {selectedCount > 0 && (
            <div className="flex flex-wrap gap-1.5 p-3 rounded-lg bg-primary/5 border border-primary/20">
              {Array.from(selectedTopics).map((t) => (
                <Badge key={t} variant="outline" className="text-xs border-primary/30 text-primary">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {/* Editor Notes */}
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">
              Editorial Direction <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              placeholder="Angle, focus, emphasis or specific questions this brief should answer..."
              value={editorNotes}
              onChange={(e) => setEditorNotes(e.target.value)}
              className="resize-none text-sm"
              rows={3}
              data-testid="input-generate-notes"
            />
          </div>

          {/* Generation info */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              The system will pull the highest-scoring articles from the last 24 hours that match your selected topics, then synthesize them into one strategic brief (700-900 words). The result goes to Pending Review.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={loading || selectedCount === 0}
              className="gap-2 min-w-32"
              data-testid="btn-confirm-generate"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate{selectedCount > 0 ? ` (${selectedCount} topic${selectedCount !== 1 ? "s" : ""})` : ""}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
