import { useState, useRef } from "react";
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
  const anchorRef = useRef<HTMLAnchorElement | null>(null);

  const download = async () => {
    if (isDownloading || !url) return;
    setIsDownloading(true);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        let message = "Failed to generate PDF. Please try again.";
        try {
          const errText = await response.text();
          const parsed = JSON.parse(errText);
          if (parsed?.error) message = parsed.error;
        } catch {}
        throw new Error(message);
      }

      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);

      // Reuse or create the anchor element — always attached to document body
      // so browsers treat it as a trusted in-document element.
      let anchor = anchorRef.current;
      if (!anchor) {
        anchor = document.createElement("a");
        anchor.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
        document.body.appendChild(anchor);
        anchorRef.current = anchor;
      }

      anchor.href = objectUrl;
      anchor.download = filename;

      // dispatchEvent with a real MouseEvent is more reliable than .click()
      // in sandboxed/iframe contexts because it flows through the full event pipeline.
      anchor.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );

      // Revoke after a delay so the browser has time to read the blob
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);

      toast({
        title: "PDF downloaded",
        description: filename,
        duration: 3000,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error generating PDF.";
      toast({
        title: "Download failed",
        description: message,
        variant: "destructive",
        duration: 6000,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return { download, isDownloading };
}
