import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface UsePdfDownloadOptions {
  url: string;
  filename: string;
}

interface UsePdfDownloadReturn {
  download: () => Promise<void>;
  isDownloading: boolean;
}

export function usePdfDownload({ url, filename }: UsePdfDownloadOptions): UsePdfDownloadReturn {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const download = async () => {
    if (isDownloading) return;
    setIsDownloading(true);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        let message = "Failed to generate PDF. Please try again.";
        try {
          const err = await response.json();
          if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      toast({
        title: "PDF downloaded",
        description: filename,
        duration: 3000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error generating PDF.";
      toast({
        title: "Download failed",
        description: message,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return { download, isDownloading };
}
