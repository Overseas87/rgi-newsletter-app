import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

interface UsePdfDownloadOptions {
  url: string;
  filename: string;
}

interface UsePdfDownloadReturn {
  download: () => Promise<void>;
  open: () => void;
  isDownloading: boolean;
}

function getLocalSaveUrl(url: string): string | null {
  if (!url) return null;
  if (url.includes("/api/digest/pdf/combined")) {
    return url.replace("/api/digest/pdf/combined", "/api/digest/pdf/combined/save-local");
  }
  if (/\/api\/digest\/[^/]+\/pdf(?:$|\?)/.test(url)) {
    const [base, query] = url.split("?");
    return `${base}/save-local${query ? `?${query}` : ""}`;
  }
  return null;
}

export function usePdfDownload({ url, filename }: UsePdfDownloadOptions): UsePdfDownloadReturn {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  const anchorRef = useRef<HTMLAnchorElement | null>(null);

  const open = () => {
    if (!url) return;
    console.info("[PDF download] opening PDF route", { url, filename });
    const opened = window.open(url, "_blank");
    if (!opened) {
      toast({
        title: "PDF popup blocked",
        description: "Your browser blocked the PDF tab. Try allowing popups or opening the PDF route directly.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }
    opened.opener = null;
  };

  const download = async () => {
    if (isDownloading || !url) return;
    setIsDownloading(true);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/pdf",
        },
      });

      console.info("[PDF download] response received", {
        status: response.status,
        ok: response.ok,
        url,
      });

      if (!response.ok) {
        let message = "Failed to generate PDF. Please try again.";
        try {
          const errText = await response.text();
          const parsed = JSON.parse(errText);
          if (parsed?.error) message = parsed.error;
        } catch {}
        throw new Error(message);
      }

      const contentType = response.headers.get("content-type") ?? "";
      console.info("[PDF download] content type", { contentType });
      if (!contentType.toLowerCase().includes("application/pdf")) {
        const preview = await response.text().catch(() => "");
        throw new Error(
          preview
            ? `PDF endpoint returned ${contentType || "an unexpected response"}: ${preview.slice(0, 160)}`
            : `PDF endpoint returned ${contentType || "an unexpected response"} instead of application/pdf.`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      console.info("[PDF download] bytes received", {
        byteLength: arrayBuffer.byteLength,
        filename,
      });
      if (arrayBuffer.byteLength === 0) {
        throw new Error("PDF endpoint returned an empty file.");
      }

      const signature = new TextDecoder()
        .decode(arrayBuffer.slice(0, 5))
        .trim();
      if (signature !== "%PDF-") {
        throw new Error("PDF endpoint returned bytes, but they are not a valid PDF.");
      }

      let localSavePath: string | null = null;
      const localSaveUrl = getLocalSaveUrl(url);
      if (localSaveUrl) {
        try {
          const localResponse = await fetch(localSaveUrl, { method: "POST" });
          const localPayload = await localResponse.json().catch(() => null) as {
            path?: string;
            filename?: string;
            size?: number;
            error?: string;
          } | null;
          if (!localResponse.ok) {
            throw new Error(localPayload?.error || "Local PDF save failed.");
          }
          localSavePath = localPayload?.path ?? null;
          console.info("[PDF download] saved PDF to local Documents folder", {
            localSaveUrl,
            path: localSavePath,
            filename: localPayload?.filename,
            size: localPayload?.size,
          });
        } catch (localErr) {
          console.warn("[PDF download] local Documents save failed", {
            localSaveUrl,
            error: localErr instanceof Error ? localErr.message : String(localErr),
          });
        }
      }

      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      console.info("[PDF download] object URL created", {
        objectUrl,
        blobSize: blob.size,
        filename,
      });

      // Reuse or create the anchor element — always attached to document body
      // so browsers treat it as a trusted in-document element.
      let anchor = anchorRef.current;
      if (!anchor) {
        anchor = document.createElement("a");
        anchor.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
        document.body.appendChild(anchor);
        anchorRef.current = anchor;
      }
      if (!document.body.contains(anchor)) {
        document.body.appendChild(anchor);
      }

      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.target = "_self";
      anchor.rel = "noopener";

      console.info("[PDF download] clicking attached anchor", {
        attached: document.body.contains(anchor),
        filename,
        blobSize: blob.size,
      });
      anchor.click();
      console.info("[PDF download] anchor click executed", { filename });

      // Revoke after a delay so the browser has time to read the blob
      setTimeout(() => {
        console.info("[PDF download] revoking object URL", { filename });
        URL.revokeObjectURL(objectUrl);
      }, 30_000);

      toast({
        title: localSavePath ? "PDF saved to Documents" : "PDF download started",
        description: localSavePath
          ? localSavePath
          : `${filename} (${Math.round(blob.size / 1024)} KB)`,
        duration: localSavePath ? 6000 : 3000,
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
      console.warn("[PDF download] falling back to opening PDF route", {
        url,
        filename,
        error: message,
      });
      open();
    } finally {
      setIsDownloading(false);
    }
  };

  return { download, open, isDownloading };
}
