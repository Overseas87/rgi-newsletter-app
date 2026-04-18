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
  navy:     "#0F2B4C" as string,
  ink:      "#1A1A2E" as string,
  body:     "#2D3142" as string,
  mid:      "#4A5568" as string,
  muted:    "#718096" as string,
  hairline: "#D1D5DB" as string,
  white:    "#FFFFFF" as string,
};

// ── Layout constants ───────────────────────────────────────────────────────────
const W = 612;           // LETTER width
const H = 792;           // LETTER height
const ML = 72;           // left margin  (wider for consulting-doc feel)
const MR = 72;           // right margin
const MT = 56;           // top margin (body start, after header)
const MB = 58;           // bottom margin
const CW = W - ML - MR; // content width = 468

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

// ── Header ─────────────────────────────────────────────────────────────────────
function drawPageHeader(doc: PDFKit.PDFDocument) {
  const HEADER_H = 72;

  // Institution wordmark
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("RGI-CRUMMER", ML, 22, { characterSpacing: 1.2, width: CW });
  doc.restore();

  // Document type
  doc.save();
  hex(doc, C.mid)
    .font("Helvetica")
    .fontSize(8.5)
    .text("Strategic Intelligence Analysis", ML, 40, { characterSpacing: 0.2, width: CW });
  doc.restore();

  // Single thin rule under header
  hRule(doc, HEADER_H, C.hairline, 0.5);

  doc.x = ML;
  doc.y = HEADER_H + 18;
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
  if (doc.y + needed > H - MB - 20) {
    newPage(doc);
  }
}

// ── Section label ──────────────────────────────────────────────────────────────
function sectionHeading(doc: PDFKit.PDFDocument, label: string) {
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(label.toUpperCase(), ML, doc.y, {
      characterSpacing: 1.8,
      width: CW,
    });
  doc.restore();
  doc.moveDown(0.55);
}

// ── Body paragraph ─────────────────────────────────────────────────────────────
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
    lineGap = 4,
    width = CW,
  } = opts;
  doc.save();
  hex(doc, color).font(font).fontSize(size)
    .text(text, ML, doc.y, { width, lineGap, align: "left" });
  doc.restore();
}

// ── Bullet list ────────────────────────────────────────────────────────────────
function bulletList(
  doc: PDFKit.PDFDocument,
  items: string[],
  opts: { size?: number } = {}
) {
  const { size = 10 } = opts;
  const indent = 14;
  const textX = ML + indent;
  const textW = CW - indent;

  items.forEach((item) => {
    const text = item.trim();
    doc.font("Helvetica").fontSize(size);
    const textH = doc.heightOfString(text, { width: textW, lineGap: 3.5 });
    ensureSpace(textH + 10);
    const y = doc.y;

    // Bullet dot — small filled circle
    doc.save();
    hex(doc, C.navy)
      .circle(ML + 4, y + (size * 0.72) / 2 + 1, 1.8)
      .fill();
    doc.restore();

    doc.save();
    hex(doc, C.body)
      .font("Helvetica")
      .fontSize(size)
      .text(text, textX, y, { width: textW, lineGap: 3.5, align: "left" });
    doc.restore();

    doc.moveDown(0.45);
  });
}

// ── RGI Take — clean italic paragraph, no box ──────────────────────────────────
function rgiTakePara(doc: PDFKit.PDFDocument, text: string) {
  doc.font("Helvetica-Oblique").fontSize(10.5);
  const textH = doc.heightOfString(text, { width: CW, lineGap: 4 });
  ensureSpace(textH + 8);

  doc.save();
  hex(doc, C.ink)
    .font("Helvetica-Oblique")
    .fontSize(10.5)
    .text(text, ML, doc.y, { width: CW, lineGap: 4 });
  doc.restore();

  // Reset font so subsequent measurements use correct metrics
  doc.font("Helvetica").fontSize(10);
}

// ── Sources section ────────────────────────────────────────────────────────────
function sourcesSection(doc: PDFKit.PDFDocument, sources: Article[]) {
  if (sources.length === 0) return;

  ensureSpace(48);
  hRule(doc, doc.y, C.hairline, 0.5);
  doc.moveDown(0.8);

  sectionHeading(doc, "References");

  sources.forEach((src, i) => {
    ensureSpace(20);

    let domain = "";
    try { domain = new URL(src.url ?? "").hostname.replace(/^www\./, ""); } catch {}

    const rawHeadline = src.headline ?? "Untitled";
    const shortHeadline = rawHeadline.length > 95
      ? rawHeadline.slice(0, 92) + "\u2026"
      : rawHeadline;

    const lineParts = [
      `${i + 1}.`,
      src.sourceName ?? null,
      shortHeadline,
      domain || null,
    ].filter(Boolean).join("  —  ");

    doc.fillColor(C.mid).font("Helvetica").fontSize(7.5)
      .text(lineParts, ML, doc.y, {
        width: CW,
        lineGap: 2,
        link: src.url ?? undefined,
      });

    doc.moveDown(0.35);
  });
}

// ── Combined report cover page ─────────────────────────────────────────────────
function drawCombinedCover(doc: PDFKit.PDFDocument, articles: ArticleWithSources[]) {
  currentPage++;
  doc.addPage();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Navy header band
  doc.save();
  hex(doc, C.navy).rect(0, 0, W, 110).fill();
  doc.restore();

  // Institution name
  doc.save();
  hex(doc, C.white)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("RGI-CRUMMER", ML, 28, { characterSpacing: 1.2, width: CW });
  doc.restore();

  doc.save();
  hex(doc, "#A0B4CC")
    .font("Helvetica")
    .fontSize(10)
    .text("Strategic Intelligence Analysis — Combined Report", ML, 55, { characterSpacing: 0.2, width: CW });
  doc.restore();

  doc.save();
  hex(doc, "#7A94B0")
    .font("Helvetica")
    .fontSize(8.5)
    .text(today, ML, 78, { characterSpacing: 0.1, width: CW });
  doc.restore();

  // Table of contents
  const tocY = 148;
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("CONTENTS", ML, tocY, { characterSpacing: 1.8, width: CW });
  doc.restore();

  hRule(doc, tocY + 17, C.hairline, 0.5);

  articles.forEach((a, i) => {
    const itemY = tocY + 28 + i * 38;
    if (itemY > H - 100) return;

    doc.save();
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(`${String(i + 1).padStart(2, "0")}`, ML, itemY, { width: CW });
    doc.restore();

    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(a.headline, ML + 20, itemY + 10, { width: CW - 20, lineGap: 2 });
    doc.restore();

    hRule(doc, itemY + 34, C.hairline, 0.3);
  });

  drawPageFooter(doc, currentPage);
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

    newPage(doc);

    // Helper: reserve space for a heading + minimum first line
    function sectionGuard(neededAfterHeading = 40) {
      ensureSpace(20 + neededAfterHeading);
    }

    // ── Headline ──────────────────────────────────────────────────────────────
    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(19)
      .text(article.headline, ML, doc.y, { width: CW, lineGap: 3.5 });
    doc.restore();
    doc.moveDown(0.55);

    hRule(doc, doc.y, C.hairline, 0.5);
    doc.moveDown(0.9);

    // ── Executive Analysis ────────────────────────────────────────────────────
    if (execSummary.length > 0) {
      sectionGuard(30);
      sectionHeading(doc, "Executive Analysis");

      execSummary.forEach((sentence, i) => {
        const text = cleanText(sentence);
        const size = i === 0 ? 10.5 : 10;
        doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(size);
        const textH = doc.heightOfString(text, { width: CW, lineGap: 4 });
        ensureSpace(textH + 4);
        para(doc, text, {
          font: i === 0 ? "Helvetica-Bold" : "Helvetica",
          size,
          color: C.ink,
          lineGap: 4,
        });
        if (i < execSummary.length - 1) doc.moveDown(0.3);
      });

      doc.moveDown(0.9);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.moveDown(0.8);
    }

    // ── Analysis ──────────────────────────────────────────────────────────────
    // Encompasses key developments, why it matters, and what to watch —
    // all presented as one unified analytical section.
    const bodyPoints = article.body.split("\n").filter(Boolean).map(cleanText);

    sectionGuard(40);
    sectionHeading(doc, "Analysis");

    if (isStructured) {
      if (bodyPoints.length > 0) {
        bulletList(doc, bodyPoints);
      }
      if (keyTakeaways.length > 0) {
        doc.moveDown(0.5);
        bulletList(doc, keyTakeaways.map(cleanText));
      }
      if (whatToWatch.length > 0) {
        doc.moveDown(0.5);
        bulletList(doc, whatToWatch.map(cleanText));
      }
    } else {
      bodyPoints.forEach((p) => {
        doc.font("Helvetica").fontSize(10);
        const textH = doc.heightOfString(p, { width: CW, lineGap: 4 });
        ensureSpace(textH + 6);
        para(doc, p, { size: 10, lineGap: 4 });
        doc.moveDown(0.55);
      });
    }

    doc.moveDown(0.5);
    hRule(doc, doc.y, C.hairline, 0.4);
    doc.moveDown(0.8);

    // ── RGI Take ──────────────────────────────────────────────────────────────
    if (article.rgiTake) {
      sectionGuard(60);
      sectionHeading(doc, "RGI Take");
      rgiTakePara(doc, cleanText(article.rgiTake));
      doc.moveDown(0.9);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.moveDown(0.8);
    }

    // ── References ────────────────────────────────────────────────────────────
    sourcesSection(doc, sources);
  }

  return doc;
}
