import { useState, useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wand2, X, Check, ChevronRight, Loader2, RotateCcw } from "lucide-react";

interface SelectionRegenerateTa {
  value: string;
  onChange: (val: string) => void;
  articleId: number;
  articleContext: { headline: string; body: string; rgiTake: string };
  field: "body" | "rgiTake" | "executiveSummary" | "keyTakeaways" | "implificationsForLeaders";
  placeholder?: string;
  className?: string;
  minHeight?: string;
  "data-testid"?: string;
}

const NAVY = "#0B1F3B";
const GOLD = "#C9A227";

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function SelectionRegenerateTextarea({
  value,
  onChange,
  articleId,
  articleContext,
  field,
  placeholder,
  className,
  minHeight = "160px",
  "data-testid": testId,
}: SelectionRegenerateTa) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<{ original: string; regenerated: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detectSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    if (selectionStart !== selectionEnd) {
      setSelectionRange({
        start: selectionStart,
        end: selectionEnd,
        text: value.slice(selectionStart, selectionEnd),
      });
    } else {
      setSelectionRange(null);
    }
  }, [value]);

  const handleOpenDialog = () => {
    setPreview(null);
    setError(null);
    setInstructions("");
    setDialogOpen(true);
  };

  const handleClearSelection = () => {
    setSelectionRange(null);
    textareaRef.current?.focus();
  };

  const handleGenerate = async () => {
    if (!selectionRange || !instructions.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/digest/${articleId}/regenerate-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedText: selectionRange.text,
          field,
          instructions: instructions.trim(),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Regeneration failed");
      }
      const data = await resp.json();
      setPreview({ original: selectionRange.text, regenerated: data.regeneratedText });
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = () => {
    if (!preview || !selectionRange) return;
    const newValue =
      value.slice(0, selectionRange.start) +
      preview.regenerated +
      value.slice(selectionRange.end);
    onChange(newValue);
    setDialogOpen(false);
    setPreview(null);
    setSelectionRange(null);
    setInstructions("");
  };

  const handleDiscard = () => {
    setPreview(null);
    setInstructions("");
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      setDialogOpen(false);
      setPreview(null);
      setError(null);
    }
  };

  const wordCount = selectionRange ? countWords(selectionRange.text) : 0;
  const charCount = selectionRange ? selectionRange.text.length : 0;

  return (
    <div className="space-y-0">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onMouseUp={detectSelection}
          onKeyUp={detectSelection}
          onBlur={() => {
            if (!dialogOpen) setTimeout(detectSelection, 100);
          }}
          placeholder={placeholder}
          className={className}
          style={{ minHeight }}
          data-testid={testId}
        />
      </div>

      {selectionRange && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-b-md border border-t-0 text-xs animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ backgroundColor: `${NAVY}08`, borderColor: `${NAVY}20` }}
        >
          <span className="font-medium" style={{ color: NAVY }}>
            {wordCount} {wordCount === 1 ? "word" : "words"} selected
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-400">{charCount} chars</span>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={handleOpenDialog}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: NAVY, color: "white" }}
              data-testid="btn-regenerate-selection"
            >
              <Wand2 className="h-3 w-3" />
              Regenerate Selection
            </button>
            <button
              onClick={handleClearSelection}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold" style={{ color: NAVY }}>
              <Wand2 className="h-4 w-4" style={{ color: GOLD }} />
              Regenerate Selection
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {!preview ? (
              <>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    Selected passage
                  </p>
                  <div
                    className="rounded-lg px-4 py-3 text-sm leading-relaxed text-gray-700 border-l-4 italic"
                    style={{
                      backgroundColor: `${GOLD}0D`,
                      borderLeftColor: GOLD,
                    }}
                  >
                    {selectionRange?.text}
                  </div>
                </div>

                <div>
                  <label
                    className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 block"
                  >
                    Editorial direction
                  </label>
                  <Textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder={`e.g. "make this more concise", "strengthen the analytical conclusion", "adjust tone to be more measured", "add a forward-looking observation"`}
                    className="text-sm resize-none"
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instructions.trim()) {
                        handleGenerate();
                      }
                    }}
                    data-testid="input-regenerate-instructions"
                    autoFocus
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Cmd/Ctrl + Enter to generate</p>
                </div>

                {error && (
                  <div className="rounded-lg px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDialogClose(false)}
                    className="text-gray-500"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerate}
                    disabled={isGenerating || !instructions.trim()}
                    size="sm"
                    className="gap-2"
                    style={{ backgroundColor: NAVY, color: "white" }}
                    data-testid="btn-confirm-regenerate"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                      Original
                    </p>
                    <div className="rounded-lg px-4 py-3 text-sm leading-relaxed text-gray-500 bg-gray-50 border border-gray-200 italic line-through decoration-gray-400 decoration-1">
                      {preview.original}
                    </div>
                  </div>
                  <div>
                    <p
                      className="text-[10px] font-bold uppercase tracking-widest mb-2"
                      style={{ color: GOLD }}
                    >
                      Regenerated
                    </p>
                    <div
                      className="rounded-lg px-4 py-3 text-sm leading-relaxed border-l-4"
                      style={{
                        backgroundColor: `${NAVY}06`,
                        borderLeftColor: NAVY,
                        color: NAVY,
                      }}
                    >
                      {preview.regenerated}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDiscard}
                      className="gap-1.5 text-gray-500 hover:text-gray-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Try again
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDialogClose(false)}
                      className="text-gray-400"
                    >
                      Discard
                    </Button>
                  </div>
                  <Button
                    onClick={handleAccept}
                    size="sm"
                    className="gap-1.5"
                    style={{ backgroundColor: "#059669", color: "white" }}
                    data-testid="btn-accept-regenerated"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept change
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
