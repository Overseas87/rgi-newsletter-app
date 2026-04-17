import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Check } from "lucide-react";

const ALL_TOPICS = [
  {
    group: "Technology & Intelligence",
    topics: ["AI & Artificial Intelligence", "Technology & Digital Innovation", "Fintech"],
  },
  {
    group: "Global & Geopolitical",
    topics: ["Geopolitics", "Global Politics", "Wars & Crisis"],
  },
  {
    group: "Economic",
    topics: ["Finance & Markets", "Macroeconomics", "Supply Chains & Trade"],
  },
  {
    group: "Business & Leadership",
    topics: ["Business & Strategy", "Leadership & Organizations", "Future of Work"],
  },
  {
    group: "Policy & Environment",
    topics: ["Policy & Regulation", "Climate & Environmental Health", "Energy & Oil"],
  },
];

const ARTICLE_LENGTHS = [
  { value: "brief", label: "Brief", desc: "Concise — 250–350 words. Best for fast executive consumption." },
  { value: "standard", label: "Standard", desc: "Balanced — 500–700 words. Full analysis with takeaways." },
  { value: "comprehensive", label: "Comprehensive", desc: "In-depth — 900–1200 words. Full editorial treatment." },
];

const STORAGE_KEY_TOPICS = "rgi:preferred_topics";
const STORAGE_KEY_LENGTH = "rgi:article_length";

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const update = useUpdateSettings();
  const queryClient = useQueryClient();

  const [relevancyThreshold, setRelevancyThreshold] = useState("6.5");
  const [scrapeIntervalHours, setScrapeIntervalHours] = useState("24");
  const [scrapeTimeUtc, setScrapeTimeUtc] = useState("11:00");
  const [saved, setSaved] = useState(false);

  const [preferredTopics, setPreferredTopics] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TOPICS);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const [articleLength, setArticleLength] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_LENGTH) ?? "standard";
  });

  useEffect(() => {
    if (settings) {
      setRelevancyThreshold(String(settings.relevancyThreshold ?? 6.5));
      setScrapeIntervalHours(String(settings.scrapeIntervalHours ?? 24));
      setScrapeTimeUtc(settings.scrapeTimeUtc ?? "11:00");
    }
  }, [settings]);

  const toggleTopic = (topic: string) => {
    setPreferredTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      localStorage.setItem(STORAGE_KEY_TOPICS, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleLengthChange = (val: string) => {
    setArticleLength(val);
    localStorage.setItem(STORAGE_KEY_LENGTH, val);
  };

  const handleSave = () => {
    update.mutate(
      {
        data: {
          relevancyThreshold: Number(relevancyThreshold),
          scrapeIntervalHours: Number(scrapeIntervalHours),
          scrapeTimeUtc,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["getSettings"] });
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure scraping behavior, content preferences, and editorial controls.</p>
      </div>

      {/* Scraping Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scraping Controls</CardTitle>
          <CardDescription>Control when content is fetched and which articles enter the system.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label htmlFor="scrapeTimeUtc" className="text-sm font-medium mb-1.5 block">
              Daily Scrape Time (UTC)
            </Label>
            <Input
              id="scrapeTimeUtc"
              type="time"
              value={scrapeTimeUtc}
              onChange={(e) => setScrapeTimeUtc(e.target.value)}
              className="w-36"
              data-testid="input-schedule-time"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Current: {scrapeTimeUtc} UTC &mdash; the system runs a full automated scrape daily at this time. Use "Scrape Now" on the Dashboard for immediate runs.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="scrapeIntervalHours" className="text-sm font-medium mb-1.5 block">
                Minimum Score Threshold
              </Label>
              <Input
                id="relevancyThreshold"
                type="number"
                min="1"
                max="10"
                step="0.5"
                value={relevancyThreshold}
                onChange={(e) => setRelevancyThreshold(e.target.value)}
                data-testid="input-min-score"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Articles scoring below this are discarded at scrape time. Recommended: 6.0–7.0.</p>
            </div>
            <div>
              <Label htmlFor="scrapeIntervalHours" className="text-sm font-medium mb-1.5 block">
                Scrape Interval (hours)
              </Label>
              <Input
                id="scrapeIntervalHours"
                type="number"
                min="6"
                max="168"
                step="1"
                value={scrapeIntervalHours}
                onChange={(e) => setScrapeIntervalHours(e.target.value)}
                data-testid="input-scrape-interval"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Minimum hours between automatic scrapes. Set to 24 for once-daily.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Article Generation Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Article Generation</CardTitle>
          <CardDescription>Set your preferred output length for AI-generated articles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {ARTICLE_LENGTHS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleLengthChange(option.value)}
                className={`w-full flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all ${
                  articleLength === option.value
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:border-border/80"
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                  articleLength === option.value ? "border-primary bg-primary" : "border-muted-foreground/40"
                }`}>
                  {articleLength === option.value && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none mb-1">{option.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{option.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground italic pt-1">This preference is saved in your browser and applied to all new article generation.</p>
        </CardContent>
      </Card>

      {/* Preferred Topics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Focus Topics</CardTitle>
          <CardDescription>
            Flag topics you want to prioritize. These are highlighted in the Intelligence Feed and used as default selections in article generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALL_TOPICS.map((group) => (
            <div key={group.group}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group.group}</p>
              <div className="flex flex-wrap gap-2">
                {group.topics.map((topic) => {
                  const active = preferredTopics.has(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {topic}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {preferredTopics.size > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">{preferredTopics.size} topic{preferredTopics.size !== 1 ? "s" : ""} selected</span>
              <button
                onClick={() => {
                  setPreferredTopics(new Set());
                  localStorage.removeItem(STORAGE_KEY_TOPICS);
                }}
                className="text-xs text-muted-foreground/60 hover:text-destructive underline"
              >
                Clear all
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">Topic and length preferences are saved automatically. Click Save for scraping changes.</p>
        <Button onClick={handleSave} disabled={update.isPending} data-testid="btn-save-settings" className="gap-2">
          {saved ? (
            <><Check className="h-4 w-4" />Saved</>
          ) : (
            <><Save className="h-4 w-4" />{update.isPending ? "Saving..." : "Save Settings"}</>
          )}
        </Button>
      </div>
    </div>
  );
}
