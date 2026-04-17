import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const update = useUpdateSettings();
  const queryClient = useQueryClient();

  const [relevancyThreshold, setRelevancyThreshold] = useState("7.0");
  const [scrapeIntervalHours, setScrapeIntervalHours] = useState("24");
  const [scrapeTimeUtc, setScrapeTimeUtc] = useState("11:00");

  useEffect(() => {
    if (settings) {
      setRelevancyThreshold(String(settings.relevancyThreshold ?? 7.0));
      setScrapeIntervalHours(String(settings.scrapeIntervalHours ?? 24));
      setScrapeTimeUtc(settings.scrapeTimeUtc ?? "11:00");
    }
  }, [settings]);

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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure scraping behavior and editorial preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scraping Configuration</CardTitle>
          <CardDescription>Control how and when content is fetched and scored.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="relevancyThreshold" className="text-sm mb-1.5 block">
                Minimum Relevancy Score (1-10)
              </Label>
              <Input
                id="relevancyThreshold"
                type="number"
                min="1"
                max="10"
                step="0.1"
                value={relevancyThreshold}
                onChange={(e) => setRelevancyThreshold(e.target.value)}
                data-testid="input-min-score"
              />
              <p className="text-xs text-muted-foreground mt-1">Articles below this score are not shown.</p>
            </div>
            <div>
              <Label htmlFor="scrapeIntervalHours" className="text-sm mb-1.5 block">
                Scrape Interval (hours)
              </Label>
              <Input
                id="scrapeIntervalHours"
                type="number"
                min="1"
                max="168"
                value={scrapeIntervalHours}
                onChange={(e) => setScrapeIntervalHours(e.target.value)}
                data-testid="input-scrape-interval"
              />
              <p className="text-xs text-muted-foreground mt-1">How often to run automatic scrapes.</p>
            </div>
          </div>
          <div>
            <Label htmlFor="scrapeTimeUtc" className="text-sm mb-1.5 block">
              Daily Scrape Time (UTC)
            </Label>
            <Input
              id="scrapeTimeUtc"
              type="time"
              value={scrapeTimeUtc}
              onChange={(e) => setScrapeTimeUtc(e.target.value)}
              className="w-40"
              data-testid="input-schedule-time"
            />
            <p className="text-xs text-muted-foreground mt-1">
              11:00 UTC = 6:00 AM EST. The system runs a full scrape automatically at this time each day.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">RGI Disciplines</CardTitle>
          <CardDescription>The three core disciplines used to score article alignment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                name: "Strategic Foresight",
                desc: "The capacity to anticipate change, read signals in the environment, and position organizations advantageously for futures that are not yet visible.",
              },
              {
                name: "System Vitality",
                desc: "The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal.",
              },
              {
                name: "Civic Stewardship",
                desc: "The responsibility leaders bear to the communities and institutions they serve, beyond profit and narrow organizational interest.",
              },
            ].map((d) => (
              <div key={d.name} className="border rounded-md p-3">
                <p className="text-sm font-semibold">{d.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{d.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 italic">
            These disciplines are fixed and used in all AI scoring and writing prompts.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending} data-testid="btn-save-settings">
          <Save className="h-4 w-4 mr-2" />
          {update.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
