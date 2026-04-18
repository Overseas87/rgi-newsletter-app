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
  navy:        "#0F2B4C" as string,
  navyLight:   "#1A3D6B" as string,
  gold:        "#B8902C" as string,
  goldLight:   "#D4A93A" as string,
  ink:         "#1A1A2E" as string,
  body:        "#2D3142" as string,
  mid:         "#4A5568" as string,
  muted:       "#718096" as string,
  hairline:    "#E2E8F0" as string,
  rgiTakeBg:   "#FAFAF7" as string,
  rgiTakeBdr:  "#B8902C" as string,
  white:       "#FFFFFF" as string,
  linkBlue:    "#1D4ED8" as string,
};

// ── Layout constants ───────────────────────────────────────────────────────────
const W = 612;          // LETTER width
const H = 792;          // LETTER height
const ML = 62;          // left margin
const MR = 62;          // right margin
const MT = 56;          // top margin (body start, after header)
const MB = 58;          // bottom margin
const CW = W - ML - MR; // content width = 488

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

function vLine(doc: PDFKit.PDFDocument, x: number, y1: number, y2: number, color: string, weight = 2.5) {
  doc.save();
  strokeHex(doc, color).lineWidth(weight)
    .moveTo(x, y1).lineTo(x, y2).stroke();
  doc.restore();
}

function filledRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  doc.save();
  hex(doc, color).rect(x, y, w, h).fill();
  doc.restore();
}

// ── Header ─────────────────────────────────────────────────────────────────────
function drawPageHeader(doc: PDFKit.PDFDocument, articleType: string) {
  const HEADER_H = 78;

  // White background (document is already white; draw a border-bottom instead)
  // RGI wordmark — institution name
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("RICK GOINGS INSTITUTE", ML, 24, { characterSpacing: 0.8, width: CW });
  doc.restore();

  // Subtitle — brief type
  const subtitle = articleType === "daily_brief"
    ? "Daily Strategic Intelligence Brief"
    : "Strategic Intelligence Analysis";

  doc.save();
  hex(doc, C.gold)
    .font("Helvetica")
    .fontSize(9)
    .text(subtitle, ML, 44, { characterSpacing: 0.3, width: CW });
  doc.restore();

  // Gold rule under header
  hRule(doc, HEADER_H - 4, C.gold, 1);

  // Very thin navy hairline just above gold rule
  hRule(doc, HEADER_H - 6, C.navy, 0.3);

  doc.x = ML;
  doc.y = HEADER_H + 14;
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number) {
  const footerY = H - MB + 4;
  hRule(doc, footerY, C.hairline, 0.5);

  // Left: institution + classification
  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(7)
    .text("Rick Goings Institute  ·  Internal Use Only", ML, footerY + 10, {
      characterSpacing: 0.1,
      width: CW / 2,
      align: "left",
    });
  doc.restore();

  // Center: page number
  doc.save();
  hex(doc, C.muted)
    .font("Helvetica")
    .fontSize(7)
    .text(`${pageNum}`, ML, footerY + 10, {
      width: CW,
      align: "center",
    });
  doc.restore();

  // Right: date
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
}

function newPage(doc: PDFKit.PDFDocument, articleType: string): number {
  currentPage++;
  doc.addPage();
  drawPageHeader(doc, articleType);
  drawPageFooter(doc, currentPage);
  doc.x = ML;
  doc.y = 92;
  return currentPage;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number, articleType: string) {
  if (doc.y + needed > H - MB - 20) {
    newPage(doc, articleType);
  }
}

// ── Section label ──────────────────────────────────────────────────────────────
function sectionHeading(doc: PDFKit.PDFDocument, label: string, color: string = C.navy) {
  doc.save();
  hex(doc, color)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(label.toUpperCase(), ML, doc.y, {
      characterSpacing: 1.8,
      width: CW,
    });
  doc.restore();
  doc.moveDown(0.5);
}

// ── Body paragraph ─────────────────────────────────────────────────────────────
function para(doc: PDFKit.PDFDocument, text: string, opts: {
  color?: string;
  font?: string;
  size?: number;
  lineGap?: number;
  x?: number;
  width?: number;
} = {}) {
  const {
    color = C.body,
    font = "Helvetica",
    size = 10.5,
    lineGap = 3.5,
    x = ML,
    width = CW,
  } = opts;
  doc.save();
  hex(doc, color).font(font).fontSize(size)
    .text(text, x, doc.y, { width, lineGap, align: "left" });
  doc.restore();
}

// ── Bullet list ────────────────────────────────────────────────────────────────
function bulletList(
  doc: PDFKit.PDFDocument,
  items: string[],
  articleType: string,
  opts: { dotColor?: string; indent?: number; size?: number } = {}
) {
  const {
    dotColor = C.navy,
    indent = 14,
    size = 10.5,
  } = opts;

  const textX = ML + indent;
  const textW = CW - indent;

  items.forEach((item, _i) => {
    ensureSpace(doc, 28, articleType);
    const y = doc.y;

    // Bullet dot
    doc.save();
    hex(doc, dotColor)
      .circle(ML + 5, y + (size * 0.72) / 2 + 1, 2)
      .fill();
    doc.restore();

    // Item text
    doc.save();
    hex(doc, C.body)
      .font("Helvetica")
      .fontSize(size)
      .text(item.trim(), textX, y, { width: textW, lineGap: 3.5, align: "left" });
    doc.restore();

    doc.moveDown(0.5);
  });
}

// ── RGI Take box ───────────────────────────────────────────────────────────────
function rgiTakeBox(doc: PDFKit.PDFDocument, text: string, articleType: string) {
  const PAD_V = 12;
  const PAD_H = 16;
  const BOX_X = ML + 1;
  const BOX_W = CW - 1;
  const TEXT_X = BOX_X + PAD_H + 4;
  const TEXT_W = BOX_W - PAD_H - 8;

  // Measure text height first
  const textHeight = doc.heightOfString(text, { width: TEXT_W, lineGap: 3.5 });
  const boxH = textHeight + PAD_V * 2;

  ensureSpace(doc, boxH + 20, articleType);

  const boxY = doc.y;

  // Background
  filledRect(doc, BOX_X, boxY, BOX_W, boxH, C.rgiTakeBg);

  // Left accent border
  filledRect(doc, BOX_X, boxY, 3, boxH, C.rgiTakeBdr);

  // Top hairline
  doc.save();
  strokeHex(doc, C.gold).lineWidth(0.4)
    .moveTo(BOX_X + 3, boxY)
    .lineTo(BOX_X + BOX_W, boxY)
    .stroke();
  doc.restore();

  // Text
  doc.save();
  hex(doc, C.body)
    .font("Helvetica-Oblique")
    .fontSize(10.5)
    .text(text, TEXT_X, boxY + PAD_V, { width: TEXT_W, lineGap: 3.5 });
  doc.restore();

  doc.y = boxY + boxH;
  doc.moveDown(0.9);
}

// ── Sources section ────────────────────────────────────────────────────────────
function sourcesSection(doc: PDFKit.PDFDocument, sources: Article[], articleType: string) {
  if (sources.length === 0) return;

  ensureSpace(doc, 60, articleType);
  hRule(doc, doc.y, C.hairline, 0.5);
  doc.moveDown(0.8);

  sectionHeading(doc, `Sources & References`, C.muted);

  sources.forEach((src, i) => {
    ensureSpace(doc, 48, articleType);

    // Number + headline
    const num = `${i + 1}.`;
    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(num, ML, doc.y, { continued: true, width: 14 });
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(`  ${src.headline ?? "Untitled"}`, { width: CW - 14, lineGap: 2 });
    doc.restore();

    // Publication / author line
    const pubParts = [src.sourceName, src.author].filter(Boolean);
    if (pubParts.length > 0) {
      doc.save();
      hex(doc, C.muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(`   ${pubParts.join("  ·  ")}`, ML, doc.y, { width: CW, lineGap: 1.5 });
      doc.restore();
    }

    // URL — truncated display text, full link behind it
    if (src.url) {
      let displayUrl = src.url;
      try {
        const u = new URL(src.url);
        displayUrl = u.hostname.replace(/^www\./, "") + u.pathname;
        if (displayUrl.length > 80) displayUrl = displayUrl.slice(0, 77) + "…";
      } catch {}

      doc.save();
      hex(doc, C.linkBlue)
        .font("Helvetica")
        .fontSize(7.5)
        .text(`   ${displayUrl}`, ML, doc.y, {
          width: CW,
          lineGap: 1.5,
          link: src.url,
          underline: true,
        });
      doc.restore();
    }

    doc.moveDown(0.6);
  });
}

// ── Combined brief cover page ──────────────────────────────────────────────────
function drawCombinedCover(doc: PDFKit.PDFDocument, articles: ArticleWithSources[]) {
  currentPage++;
  doc.addPage();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Header band (full width, navy)
  filledRect(doc, 0, 0, W, 120, C.navy);

  // Gold accent bar
  filledRect(doc, 0, 120, W, 3, C.gold);

  // Institution name
  doc.save();
  hex(doc, C.white)
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("RICK GOINGS INSTITUTE", ML, 30, { characterSpacing: 1, width: CW });
  doc.restore();

  // Report subtitle
  doc.save();
  hex(doc, C.goldLight)
    .font("Helvetica")
    .fontSize(11)
    .text("Intelligence Brief — Combined Report", ML, 60, { characterSpacing: 0.3, width: CW });
  doc.restore();

  // Date
  doc.save();
  hex(doc, "#A0B4CC")
    .font("Helvetica")
    .fontSize(9)
    .text(today, ML, 85, { characterSpacing: 0.1, width: CW });
  doc.restore();

  // Table of contents
  const tocY = 155;
  doc.save();
  hex(doc, C.navy)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("CONTENTS", ML, tocY, { characterSpacing: 1.8, width: CW });
  doc.restore();

  hRule(doc, tocY + 16, C.hairline, 0.5);

  articles.forEach((a, i) => {
    const itemY = tocY + 26 + i * 38;
    if (itemY > H - 100) return;

    const typeLabel = a.articleType === "daily_brief" ? "Daily Brief" : "Topic Analysis";

    doc.save();
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(7.5)
      .text(`${String(i + 1).padStart(2, "0")}  ·  ${typeLabel}`, ML, itemY, { width: CW });
    doc.restore();

    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(a.headline, ML + 20, itemY + 11, { width: CW - 20, lineGap: 2 });
    doc.restore();

    hRule(doc, itemY + 34, C.hairline, 0.3);
  });

  // Footer
  drawPageFooter(doc, currentPage);
}

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
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
        : `RGI Intelligence Report — ${publishDate}`,
      Author: "Rick Goings Institute",
      Subject: "Strategic Intelligence Brief",
      Keywords: "RGI, intelligence, strategy, leadership",
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

    const execSummary = (Array.isArray(article.executiveSummary) ? article.executiveSummary : []) as string[];
    const keyDevelopments = isStructured ? article.body.split("\n").filter(Boolean) : null;
    const keyTakeaways = (Array.isArray(article.keyTakeaways) ? article.keyTakeaways : []) as string[];
    const whatToWatch = (Array.isArray(article.whatToWatch) ? article.whatToWatch : []) as string[];
    const tags = (Array.isArray(article.topicTags) ? article.topicTags : []) as string[];
    const sources = article.sourceArticles ?? [];

    const articleType = article.articleType;
    newPage(doc, articleType);

    // ── Article classification bar ──────────────────────────────────────────
    const typeLabel = articleType === "daily_brief" ? "DAILY BRIEF" : "TOPIC ANALYSIS";
    const discipline = article.discipline ?? "Strategic Intelligence";

    doc.save();
    hex(doc, C.navy)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(typeLabel, ML, doc.y, { continued: true, characterSpacing: 1.5 });
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(`   ·   ${discipline}`, { characterSpacing: 0.2 });
    doc.restore();

    if (article.relevancyScore != null) {
      doc.save();
      hex(doc, C.muted)
        .font("Helvetica")
        .fontSize(7)
        .text(`Relevance Score: ${article.relevancyScore.toFixed(1)} / 10`, ML, doc.y, {
          width: CW, align: "right",
        });
      doc.restore();
      doc.moveUp();
    }
    doc.moveDown(0.8);

    // ── Headline ────────────────────────────────────────────────────────────
    doc.save();
    hex(doc, C.ink)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(article.headline, ML, doc.y, { width: CW, lineGap: 4 });
    doc.restore();
    doc.moveDown(0.7);

    // ── Thin gold rule under headline ───────────────────────────────────────
    hRule(doc, doc.y, C.gold, 0.8);
    doc.moveDown(0.6);

    // ── Metadata ────────────────────────────────────────────────────────────
    const createdAt = new Date(article.createdAt);
    const metaLine = `Generated  ${fmtDate(createdAt)}  ·  ${fmtTime(createdAt)}`;

    doc.save();
    hex(doc, C.muted)
      .font("Helvetica")
      .fontSize(8)
      .text(metaLine, ML, doc.y, { width: CW, characterSpacing: 0.1 });
    doc.restore();

    if (article.publishedAt) {
      const pubAt = new Date(article.publishedAt);
      doc.save();
      hex(doc, C.muted)
        .font("Helvetica")
        .fontSize(8)
        .text(`Approved for distribution  ${fmtDate(pubAt)}`, ML, doc.y, { width: CW });
      doc.restore();
    }

    if (tags.length > 0) {
      doc.save();
      hex(doc, C.muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(`Topics:  ${tags.join("  ·  ")}`, ML, doc.y, { width: CW, characterSpacing: 0.1 });
      doc.restore();
    }

    doc.moveDown(1.1);

    // ── Executive Summary ───────────────────────────────────────────────────
    if (execSummary.length > 0) {
      ensureSpace(doc, 80, articleType);
      sectionHeading(doc, "Executive Summary");

      execSummary.forEach((sentence, i) => {
        ensureSpace(doc, 32, articleType);
        para(doc, sentence.trim(), {
          font: i === 0 ? "Helvetica-Bold" : "Helvetica",
          size: i === 0 ? 11 : 10.5,
          color: C.ink,
          lineGap: 3.5,
        });
        if (i < execSummary.length - 1) doc.moveDown(0.35);
      });

      doc.moveDown(1.1);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.moveDown(0.8);
    }

    // ── Key Developments ────────────────────────────────────────────────────
    ensureSpace(doc, 60, articleType);
    sectionHeading(doc, isStructured ? "Key Developments" : "Analysis");

    if (isStructured && keyDevelopments) {
      bulletList(doc, keyDevelopments, articleType, { dotColor: C.navy });
    } else {
      article.body.split("\n\n").filter(Boolean).forEach((p) => {
        ensureSpace(doc, 40, articleType);
        para(doc, p.replace(/\*\*/g, "").replace(/\*/g, "").trim());
        doc.moveDown(0.6);
      });
    }

    doc.moveDown(0.4);
    hRule(doc, doc.y, C.hairline, 0.4);
    doc.moveDown(0.8);

    // ── Why It Matters ──────────────────────────────────────────────────────
    if (keyTakeaways.length > 0) {
      ensureSpace(doc, 60, articleType);
      sectionHeading(doc, isStructured ? "Why It Matters" : "Key Takeaways", C.navy);
      bulletList(doc, keyTakeaways, articleType, { dotColor: C.gold });
      doc.moveDown(0.4);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.moveDown(0.8);
    }

    // ── RGI Take ────────────────────────────────────────────────────────────
    if (article.rgiTake) {
      ensureSpace(doc, 80, articleType);
      sectionHeading(doc, "RGI Take", C.gold);
      rgiTakeBox(doc, article.rgiTake, articleType);
      hRule(doc, doc.y, C.hairline, 0.4);
      doc.moveDown(0.8);
    }

    // ── What to Watch ───────────────────────────────────────────────────────
    if (whatToWatch.length > 0) {
      ensureSpace(doc, 60, articleType);
      sectionHeading(doc, "What to Watch Next", C.navy);
      bulletList(doc, whatToWatch, articleType, { dotColor: C.navy });
      doc.moveDown(0.5);
    }

    // ── Sources ─────────────────────────────────────────────────────────────
    sourcesSection(doc, sources, articleType);
  }

  return doc;
}
