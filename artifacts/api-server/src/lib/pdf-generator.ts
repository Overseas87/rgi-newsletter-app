import PDFDocument from "pdfkit";
import { type InferSelectModel } from "drizzle-orm";
import { digestArticlesTable, articlesTable } from "@workspace/db";

type DigestArticle = InferSelectModel<typeof digestArticlesTable>;
type Article = InferSelectModel<typeof articlesTable>;

export interface ArticleWithSources extends DigestArticle {
  sourceArticles?: Article[];
}

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  navy:     "#0B1F3B" as string,   // header & section labels
  ink:      "#111111" as string,   // title, bold emphasis
  body:     "#1A1A1A" as string,   // body text — near-black for readability
  mid:      "#555555" as string,   // secondary text
  muted:    "#888888" as string,   // footer, captions
  hairline: "#CCCCCC" as string,   // horizontal rules
  white:    "#FFFFFF" as string,
};

// ── Layout constants ───────────────────────────────────────────────────────────
const W = 612;           // LETTER width  (8.5 in)
const H = 792;           // LETTER height (11 in)
const ML = 72;           // left margin  — exactly 1 inch
const MR = 72;           // right margin — exactly 1 inch
const MT = 56;           // top margin (body start, after header)
const MB = 62;           // bottom margin
const CW = W - ML - MR; // content width = 468 pt

// ── Page state ─────────────────────────────────────────────────────────────────
let currentPage = 0;
let publishDate = "";

// ── Low-level helpers ──────────────────────────────────────────────────────────
function hex(doc: PDFKit.PDFDocument, color: string): PDFKit.PDFDocument {
  return doc.fillColor(color);
}
function strokeHex(doc: PDFKit.PDFDocument, color: string): PDFKit.PDFDocument {
  return doc.strokeColor(color);
}

function hRule(doc: PDFKit.PDFDocument, y: number, color: string, weight = 0.5) {
  doc.save();
  strokeHex(doc, color).lineWidth(weight)
    .moveTo(ML, y).lineTo(W - MR, y).stroke();
  doc.restore();
}

// ── Content page header ────────────────────────────────────────────────────────
function drawPageHeader(doc: PDFKit.PDFDocument) {
  const HEADER_H = 68;

  // Wordmark line — "RGI–Crummer  Strategic Intelligence Analysis"
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("RGI\u2013CRUMMER", ML, 26, { characterSpacing: 1.2, width: CW, continued: true });
  hex(doc, C.mid)
    .font("Helvetica")
    .fontSize(8)
    .text("  \u2022  Strategic Intelligence Analysis", { characterSpacing: 0.2 });
  doc.restore();

  // Thin rule under header
  hRule(doc, HEADER_H, C.hairline, 0.5);

  doc.x = ML;
  doc.y = HEADER_H + 18;
}

// ── Article cover page — premium, no background fills ─────────────────────────
function drawArticleCover(
  doc: PDFKit.PDFDocument,
  headline: string,
  subtitle: string,
) {
  currentPage++;
  doc.addPage();

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // ── Top branding block ────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("RGI\u2013CRUMMER", ML, 46, { characterSpacing: 1.8, width: CW });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font("Helvetica")
    .fontSize(8)
    .text("Strategic Intelligence Analysis", ML, 62, { characterSpacing: 0.4, width: CW });
  doc.restore();

  hRule(doc, 82, C.hairline, 0.5);

  // ── Title — positioned at ~36% down the page ──────────────────────────────
  const titleY = 290;
  doc.font("Helvetica-Bold").fontSize(26);
  const titleH = doc.heightOfString(headline, { width: CW, lineGap: 6 });

  doc.save();
  hex(doc, C.ink)
    .font("Helvetica-Bold")
    .fontSize(26)
    .text(headline, ML, titleY, { width: CW, lineGap: 6, align: "left" });
  doc.restore();

  // ── Subtitle ──────────────────────────────────────────────────────────────
  if (subtitle) {
    const subY = titleY + titleH + 20;
    doc.save();
    hex(doc, C.mid)
      .font("Helvetica-Oblique")
      .fontSize(10.5)
      .text(subtitle, ML, subY, { width: CW, lineGap: 4, align: "left" });
    doc.restore();
  }

  // ── Bottom rule + metadata ────────────────────────────────────────────────
  hRule(doc, 700, C.hairline, 0.5);

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(today, ML, 714, { width: CW, align: "left" });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Prepared for academic use", ML, 714, { width: CW, align: "right" });
  doc.restore();
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number) {
  const footerY = H - MB + 4;

  const page = (doc as unknown as { page: { margins: { bottom: number } } }).page;
  const savedBottom = page.margins.bottom;
  page.margins.bottom = 0;

  hRule(doc, footerY, C.hairline, 0.5);

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(7)
    .text("RGI-Crummer  ·  Confidential", ML, footerY + 10, {
      characterSpacing: 0.1,
      width: CW / 2,
      align: "left",
    });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(7)
    .text(`${pageNum}`, ML, footerY + 10, { width: CW, align: "center" });
  doc.restore();

  if (publishDate) {
    doc.save();
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(publishDate, ML, footerY + 10, {
        width: CW,
        align: "right",
        characterSpacing: 0.1,
      });
    doc.restore();
  }

  page.margins.bottom = savedBottom;
}

function newPage(doc: PDFKit.PDFDocument): number {
  currentPage++;
  doc.addPage();
  drawPageHeader(doc);
  drawPageFooter(doc, currentPage);
  doc.x = ML;
  doc.y = 90;
  return currentPage;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > H - MB - 36) {
    newPage(doc);
  }
}

// ── Section heading — 13pt bold, consulting-grade weight ──────────────────────
function sectionHeading(doc: PDFKit.PDFDocument, label: string) {
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(label, ML, doc.y, { width: CW });
  doc.restore();
  // ~10pt of space below heading before body text starts
  doc.moveDown(0.6);
}

// ── Body paragraph ─────────────────────────────────────────────────────────────
// lineGap=5 at 10.5pt gives 10.5+5=15.5pt line height → ratio 1.48 (spec: 1.4–1.6)
function para(doc: PDFKit.PDFDocument, text: string, opts: {
  color?: string;
  font?: string;
  size?: number;
  lineGap?: number;
  width?: number;
} = {}) {
  const {
    color = C.body,
    font = "Helvetica",
    size = 10.5,
    lineGap = 5,
    width = CW,
  } = opts;
  doc.save();
  hex(doc, color).font(font).fontSize(size)
    .text(text, ML, doc.y, { width, lineGap, align: "left" });
  doc.restore();
}

// ── Bullet list ────────────────────────────────────────────────────────────────
// 10.5pt body size, lineGap 5 → 1.48× line height (spec: 1.4–1.6)
function bulletList(
  doc: PDFKit.PDFDocument,
  items: string[],
  opts: { size?: number } = {}
) {
  const { size = 10.5 } = opts;
  const LGAP = 5;
  const indent = 16;
  const textX = ML + indent;
  const textW = CW - indent;

  items.forEach((item) => {
    const text = item.trim();
    doc.font("Helvetica").fontSize(size);
    const textH = doc.heightOfString(text, { width: textW, lineGap: LGAP });
    ensureSpace(doc, textH + 56);
    const y = doc.y;

    // Bullet dot — drawn after ensureSpace so it's always on the same page as text
    doc.save();
    hex(doc, C.body)
      .rect(ML + 2, y + size * 0.35, 3.5, 3.5)
      .fill();
    doc.restore();

    doc.save();
    hex(doc, C.body)
      .font("Helvetica")
      .fontSize(size)
      .text(text, textX, y, { width: textW, lineGap: LGAP, align: "left" });
    doc.restore();

    doc.y += 8;
  });
}

// ── RGI Take — clean italic paragraph, no box ──────────────────────────────────
function rgiTakePara(doc: PDFKit.PDFDocument, text: string) {
  const LGAP = 5;
  doc.font("Helvetica-Oblique").fontSize(10.5);
  // Reserve space for 3 lines only — PDFKit auto-pages the rest of the text
  ensureSpace(doc, 50);

  doc.save();
  hex(doc, C.body)
    .font("Helvetica-Oblique")
    .fontSize(10.5)
    .text(text, ML, doc.y, { width: CW, lineGap: LGAP });
  doc.restore();

  // Reset font so subsequent measurements use correct metrics
  doc.font("Helvetica").fontSize(10.5);
}

// ── Sources section ────────────────────────────────────────────────────────────
function sourcesSection(doc: PDFKit.PDFDocument, sources: Article[]) {
  if (sources.length === 0) return;

  ensureSpace(doc, 56);
  hRule(doc, doc.y, C.hairline, 0.5);
  doc.moveDown(1.2);

  sectionHeading(doc, "References");

  sources.forEach((src, i) => {
    ensureSpace(doc, 22);

    let domain = "";
    try { domain = new URL(src.url ?? "").hostname.replace(/^www\./, ""); } catch {}

    const rawHeadline = src.headline ?? "Untitled";
    const shortHeadline = rawHeadline.length > 100
      ? rawHeadline.slice(0, 97) + "\u2026"
      : rawHeadline;

    const lineParts = [
      `${i + 1}.`,
      src.sourceName ?? null,
      shortHeadline,
      domain || null,
    ].filter(Boolean).join("  —  ");

    // 8.5pt references — readable but clearly subordinate to body text
    doc.fillColor(C.mid).font("Helvetica").fontSize(8.5)
      .text(lineParts, ML, doc.y, {
        width: CW,
        lineGap: 3,
        link: src.url ?? undefined,
      });

    doc.moveDown(0.4);
  });
}

// ── Combined report cover page ─────────────────────────────────────────────────
function drawCombinedCover(doc: PDFKit.PDFDocument, articles: ArticleWithSources[]) {
  currentPage++;
  doc.addPage();

  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // ── Top branding block ──────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("RGI\u2013CRUMMER", ML, 46, { characterSpacing: 1.8, width: CW });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font("Helvetica")
    .fontSize(8)
    .text("Strategic Intelligence Analysis", ML, 62, { characterSpacing: 0.4, width: CW });
  doc.restore();

  hRule(doc, 82, C.hairline, 0.5);

  // ── Report label ────────────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.ink)
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Daily Intelligence Digest", ML, 200, { width: CW, lineGap: 5 });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font("Helvetica")
    .fontSize(10.5)
    .text(today, ML, 240, { width: CW, lineGap: 4 });
  doc.restore();

  hRule(doc, 276, C.hairline, 0.5);

  // ── Table of contents ───────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("CONTENTS", ML, 294, { characterSpacing: 1.6, width: CW });
  doc.restore();

  let itemY = 316;
  articles.forEach((a, i) => {
    if (itemY > H - 110) return;

    doc.save();
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(8)
      .text(`${i + 1}`, ML, itemY, { width: 18 });
    doc.restore();

    doc.save();
    hex(doc, C.ink)
      .font("Helvetica")
      .fontSize(9.5)
      .text(a.headline, ML + 18, itemY, { width: CW - 18, lineGap: 2 });
    doc.restore();

    const lineH = doc.heightOfString(a.headline, { width: CW - 18, lineGap: 2 });
    itemY += lineH + 10;
    hRule(doc, itemY, C.hairline, 0.3);
    itemY += 12;
  });

  // ── Bottom metadata ─────────────────────────────────────────────────────────
  hRule(doc, 700, C.hairline, 0.5);

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(today, ML, 714, { width: CW, align: "left" });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Prepared for academic use", ML, 714, { width: CW, align: "right" });
  doc.restore();
}

// ── Strip markdown markers ─────────────────────────────────────────────────────
function cleanText(t: string): string {
  return t.replace(/\*\*/g, "").replace(/\*/g, "").trim();
}

// ── Main export ────────────────────────────────────────────────────────────────
export function generateArticlePdf(
  articles: ArticleWithSources[],
  options: { combined?: boolean } = {}
): PDFKit.PDFDocument {
  currentPage = 0;
  publishDate = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MT, bottom: MB, left: ML, right: MR },
    info: {
      Title: articles.length === 1
        ? articles[0].headline
        : `RGI-Crummer Intelligence Analysis — ${publishDate}`,
      Author: "RGI-Crummer",
      Subject: "Strategic Intelligence Analysis",
      Keywords: "RGI, Crummer, intelligence, strategy, leadership",
      Creator: "RGI Intelligence Platform",
    },
    autoFirstPage: false,
  });

  if (options.combined && articles.length > 1) {
    drawCombinedCover(doc, articles);
  }

  for (const article of articles) {
    const isStructured =
      Array.isArray(article.whatToWatch) && (article.whatToWatch as string[]).length > 0;

    const execSummary  = (Array.isArray(article.executiveSummary) ? article.executiveSummary : []) as string[];
    const keyTakeaways = (Array.isArray(article.keyTakeaways)    ? article.keyTakeaways    : []) as string[];
    const whatToWatch  = (Array.isArray(article.whatToWatch)     ? article.whatToWatch     : []) as string[];
    const sources      = article.sourceArticles ?? [];

    // ── Cover page — single-article PDFs only ─────────────────────────────────
    if (!options.combined) {
      const subtitle = execSummary.length > 0 ? cleanText(execSummary[0]) : "";
      drawArticleCover(doc, cleanText(article.headline), subtitle);
    }

    newPage(doc);

    // Helper: reserve space for a 13pt heading (~16pt tall) + minimum body content
    function sectionGuard(neededAfterHeading = 48) {
      ensureSpace(doc, 24 + neededAfterHeading);
    }

    // ── Headline — 22pt bold, prominent ───────────────────────────────────────
    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(article.headline, ML, doc.y, { width: CW, lineGap: 5 });
    doc.restore();
    // ~14pt gap between headline and rule
    doc.moveDown(0.7);

    hRule(doc, doc.y, C.hairline, 0.5);

    // ~22pt gap between rule and first section (spec: 20–30pt)
    doc.y += 22;

    // ── Executive Analysis ────────────────────────────────────────────────────
    if (execSummary.length > 0) {
      sectionGuard(36);
      sectionHeading(doc, "Executive Analysis");

      execSummary.forEach((sentence, i) => {
        const text = cleanText(sentence);
        const size = 10.5;
        const font = i === 0 ? "Helvetica-Bold" : "Helvetica";
        doc.font(font).fontSize(size);
        const textH = doc.heightOfString(text, { width: CW, lineGap: 5 });
        ensureSpace(doc, textH + 4);
        para(doc, text, { font, size, color: C.ink, lineGap: 5 });
        // ~9pt paragraph spacing (spec: 8–12pt)
        if (i < execSummary.length - 1) doc.moveDown(0.6);
      });

      // ~24pt between sections
      doc.moveDown(1.1);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.y += 22;
    }

    // ── Analysis ──────────────────────────────────────────────────────────────
    // Key developments + why it matters + what to watch — unified section
    const bodyPoints = article.body.split("\n").filter(Boolean).map(cleanText);

    sectionGuard(120);
    sectionHeading(doc, "Analysis");

    if (isStructured) {
      if (bodyPoints.length > 0) {
        bulletList(doc, bodyPoints);
      }
      if (keyTakeaways.length > 0) {
        doc.moveDown(0.6);
        bulletList(doc, keyTakeaways.map(cleanText));
      }
      if (whatToWatch.length > 0) {
        doc.moveDown(0.6);
        bulletList(doc, whatToWatch.map(cleanText));
      }
    } else {
      bodyPoints.forEach((p) => {
        doc.font("Helvetica").fontSize(10.5);
        const textH = doc.heightOfString(p, { width: CW, lineGap: 5 });
        ensureSpace(doc, textH + 6);
        para(doc, p, { size: 10.5, lineGap: 5 });
        // ~9pt paragraph spacing
        doc.moveDown(0.6);
      });
    }

    // ~24pt between sections
    doc.moveDown(1.1);
    hRule(doc, doc.y, C.hairline, 0.4);
    doc.y += 22;

    // ── RGI Take ──────────────────────────────────────────────────────────────
    if (article.rgiTake) {
      sectionGuard(80);
      sectionHeading(doc, "RGI Take");
      rgiTakePara(doc, cleanText(article.rgiTake));
      doc.moveDown(1.1);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.y += 22;
    }

    // ── References ────────────────────────────────────────────────────────────
    sourcesSection(doc, sources);
  }

  return doc;
}
