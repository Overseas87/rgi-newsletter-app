import PDFDocument from "pdfkit";
import type { Article, DigestArticle } from "@workspace/db";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ArticleWithSources extends DigestArticle {
  sourceArticles?: Article[];
}

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  navy:     "#102A43" as string,
  blue:     "#1E4E79" as string,
  gold:     "#B58B2B" as string,
  ink:      "#121212" as string,
  body:     "#202020" as string,
  mid:      "#555B63" as string,
  muted:    "#838891" as string,
  hairline: "#D8DCE2" as string,
  editorialBg: "#F5F1E8" as string,
  sectionBg: "#F8FAFC" as string,
  white:    "#FFFFFF" as string,
};

// ── Layout constants ───────────────────────────────────────────────────────────
const W = 612;           // LETTER width  (8.5 in)
const H = 792;           // LETTER height (11 in)
const ML = 36;
const MR = 36;
const MT = 30;
const MB = 34;
const CW = W - ML - MR;
const LOGO_CANDIDATES = [
  path.resolve(process.cwd(), "artifacts/rgi-digest/public/rgi-logo-mark.png"),
  path.resolve(process.cwd(), "artifacts/rgi-digest/public/rgi-logo-new.png"),
  path.resolve(process.cwd(), "../rgi-digest/public/rgi-logo-mark.png"),
  path.resolve(process.cwd(), "../rgi-digest/public/rgi-logo-new.png"),
  path.resolve(__dirname, "../../rgi-digest/public/rgi-logo-mark.png"),
  path.resolve(__dirname, "../../rgi-digest/public/rgi-logo-new.png"),
];

const APTOS_FONT_CANDIDATES = {
  regular: [
    "/Library/Fonts/Aptos.ttf",
    "/Library/Fonts/Microsoft/Aptos.ttf",
    path.resolve(process.env.HOME ?? "", "Library/Fonts/Aptos.ttf"),
  ],
  bold: [
    "/Library/Fonts/Aptos-Bold.ttf",
    "/Library/Fonts/Microsoft/Aptos-Bold.ttf",
    path.resolve(process.env.HOME ?? "", "Library/Fonts/Aptos-Bold.ttf"),
  ],
  italic: [
    "/Library/Fonts/Aptos-Italic.ttf",
    "/Library/Fonts/Microsoft/Aptos-Italic.ttf",
    path.resolve(process.env.HOME ?? "", "Library/Fonts/Aptos-Italic.ttf"),
  ],
};

let PDF_FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
};

function firstExistingFont(candidates: string[]): string | null {
  return candidates.find((candidate) => Boolean(candidate) && existsSync(candidate)) ?? null;
}

function registerPdfFonts(doc: PDFKit.PDFDocument) {
  const regular = firstExistingFont(APTOS_FONT_CANDIDATES.regular);
  if (!regular) {
    PDF_FONTS = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };
    return;
  }

  const bold = firstExistingFont(APTOS_FONT_CANDIDATES.bold);
  const italic = firstExistingFont(APTOS_FONT_CANDIDATES.italic);
  doc.registerFont("Aptos", regular);
  if (bold) doc.registerFont("Aptos-Bold", bold);
  if (italic) doc.registerFont("Aptos-Italic", italic);

  PDF_FONTS = {
    regular: "Aptos",
    bold: bold ? "Aptos-Bold" : "Aptos",
    italic: italic ? "Aptos-Italic" : "Aptos",
  };
}

// ── Page state ─────────────────────────────────────────────────────────────────
let currentPage = 0;
let publishDate = "";

type LayoutProfile = {
  name: "compact" | "standard" | "roomy" | "expanded";
  titleSize: number;
  titleLineGap: number;
  metaSize: number;
  headingSize: number;
  headingSpacing: number;
  bodySize: number;
  bodyLineGap: number;
  bulletSize: number;
  bulletLineGap: number;
  bulletAfter: number;
  sectionRuleBefore: number;
  sectionRuleAfter: number;
  paragraphAfter: number;
  editorialSize: number;
  editorialLineGap: number;
  editorialPadTop: number;
  editorialHeadingGap: number;
  editorialPadBottom: number;
  editorialMinHeight: number;
  editorialExtraHeight: number;
  metadataSize: number;
  metadataLineGap: number;
  metadataTopPad: number;
  sectionExtraGap: number;
};

const LAYOUT_PROFILES: Record<LayoutProfile["name"], LayoutProfile> = {
  compact: {
    name: "compact",
    titleSize: 11.4,
    titleLineGap: 1,
    metaSize: 5.9,
    headingSize: 6.65,
    headingSpacing: 0.12,
    bodySize: 7.45,
    bodyLineGap: 0.85,
    bulletSize: 7.25,
    bulletLineGap: 0.75,
    bulletAfter: 1.7,
    sectionRuleBefore: 1.5,
    sectionRuleAfter: 3.5,
    paragraphAfter: 0.04,
    editorialSize: 6.95,
    editorialLineGap: 0.55,
    editorialPadTop: 5,
    editorialHeadingGap: 8,
    editorialPadBottom: 4,
    editorialMinHeight: 38,
    editorialExtraHeight: 0,
    metadataSize: 5.8,
    metadataLineGap: 0.2,
    metadataTopPad: 3.5,
    sectionExtraGap: 0,
  },
  standard: {
    name: "standard",
    titleSize: 12.2,
    titleLineGap: 1.5,
    metaSize: 6.2,
    headingSize: 7.1,
    headingSpacing: 0.18,
    bodySize: 8.05,
    bodyLineGap: 1.75,
    bulletSize: 7.8,
    bulletLineGap: 1.65,
    bulletAfter: 3.1,
    sectionRuleBefore: 3,
    sectionRuleAfter: 5,
    paragraphAfter: 0.12,
    editorialSize: 7.8,
    editorialLineGap: 1.75,
    editorialPadTop: 8,
    editorialHeadingGap: 11,
    editorialPadBottom: 5,
    editorialMinHeight: 58,
    editorialExtraHeight: 0,
    metadataSize: 6.25,
    metadataLineGap: 0.5,
    metadataTopPad: 5,
    sectionExtraGap: 0,
  },
  roomy: {
    name: "roomy",
    titleSize: 13.0,
    titleLineGap: 2,
    metaSize: 6.6,
    headingSize: 7.45,
    headingSpacing: 0.26,
    bodySize: 8.55,
    bodyLineGap: 2.45,
    bulletSize: 8.2,
    bulletLineGap: 2.25,
    bulletAfter: 4.2,
    sectionRuleBefore: 4.5,
    sectionRuleAfter: 7,
    paragraphAfter: 0.2,
    editorialSize: 8.25,
    editorialLineGap: 2.25,
    editorialPadTop: 9,
    editorialHeadingGap: 12.5,
    editorialPadBottom: 8,
    editorialMinHeight: 72,
    editorialExtraHeight: 10,
    metadataSize: 6.45,
    metadataLineGap: 0.75,
    metadataTopPad: 6,
    sectionExtraGap: 0,
  },
  expanded: {
    name: "expanded",
    titleSize: 13.8,
    titleLineGap: 2.5,
    metaSize: 6.9,
    headingSize: 7.8,
    headingSpacing: 0.34,
    bodySize: 8.95,
    bodyLineGap: 3.1,
    bulletSize: 8.55,
    bulletLineGap: 2.85,
    bulletAfter: 5.2,
    sectionRuleBefore: 6,
    sectionRuleAfter: 9,
    paragraphAfter: 0.28,
    editorialSize: 8.55,
    editorialLineGap: 2.8,
    editorialPadTop: 11,
    editorialHeadingGap: 14,
    editorialPadBottom: 10,
    editorialMinHeight: 92,
    editorialExtraHeight: 20,
    metadataSize: 6.6,
    metadataLineGap: 0.9,
    metadataTopPad: 7,
    sectionExtraGap: 0,
  },
};

let currentLayout: LayoutProfile = LAYOUT_PROFILES.standard;

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

function logoPath(): string | null {
  return LOGO_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

function drawRgiLogo(doc: PDFKit.PDFDocument, x: number, y: number, size = 30) {
  const logo = logoPath();
  if (logo) {
    try {
      doc.image(logo, x, y, { width: size, height: size });
      return;
    } catch {
      // Draw a restrained mark below if PDFKit cannot decode the asset.
    }
  }
  doc.save();
  strokeHex(doc, C.navy).lineWidth(1.2).circle(x + size / 2, y + size / 2, size / 2).stroke();
  hex(doc, C.navy).font(PDF_FONTS.bold).fontSize(size * 0.32).text("RGI", x, y + size * 0.36, {
    width: size,
    align: "center",
  });
  doc.restore();
}

// ── Content page header ────────────────────────────────────────────────────────
function drawPageHeader(doc: PDFKit.PDFDocument) {
  const HEADER_H = 58;

  drawRgiLogo(doc, ML, 18, 26);
  doc.save();
  hex(doc, C.navy)
    .font(PDF_FONTS.bold)
    .fontSize(9.2)
    .text("Rick Goings Institute", ML + 34, 20, { characterSpacing: 0.2, width: CW - 150 });
  hex(doc, C.mid)
    .font(PDF_FONTS.regular)
    .fontSize(7.2)
    .text("Strategic Intelligence Brief", ML + 34, 34, { characterSpacing: 0.25, width: CW - 150 });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(7)
    .text(publishDate, W - MR - 120, 25, { width: 120, align: "right", characterSpacing: 0.1 });
  hex(doc, C.gold).rect(W - MR - 58, 40, 58, 1.5).fill();
  doc.restore();

  hRule(doc, HEADER_H, C.hairline, 0.45);

  doc.x = ML;
  doc.y = HEADER_H + 7;
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
    .font(PDF_FONTS.bold)
    .fontSize(9)
    .text("RICK GOINGS INSTITUTE", ML, 46, { characterSpacing: 1.0, width: CW });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text("Strategic Intelligence Analysis", ML, 62, { characterSpacing: 0.4, width: CW });
  doc.restore();

  hRule(doc, 82, C.hairline, 0.5);

  // ── Title — positioned at ~36% down the page ──────────────────────────────
  const titleY = 290;
  doc.font(PDF_FONTS.bold).fontSize(26);
  const titleH = doc.heightOfString(headline, { width: CW, lineGap: 6 });

  doc.save();
  hex(doc, C.ink)
    .font(PDF_FONTS.bold)
    .fontSize(26)
    .text(headline, ML, titleY, { width: CW, lineGap: 6, align: "left" });
  doc.restore();

  // ── Subtitle ──────────────────────────────────────────────────────────────
  if (subtitle) {
    const subY = titleY + titleH + 20;
    doc.save();
    hex(doc, C.mid)
      .font(PDF_FONTS.italic)
      .fontSize(10.5)
      .text(subtitle, ML, subY, { width: CW, lineGap: 4, align: "left" });
    doc.restore();
  }

  // ── Bottom rule + metadata ────────────────────────────────────────────────
  hRule(doc, 700, C.hairline, 0.5);

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text(today, ML, 714, { width: CW, align: "left" });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text("Prepared for academic use", ML, 714, { width: CW, align: "right" });
  doc.restore();
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number) {
  const footerY = H - MB + 6;

  const page = (doc as unknown as { page: { margins: { bottom: number } } }).page;
  const savedBottom = page.margins.bottom;
  page.margins.bottom = 0;

  hRule(doc, footerY, C.hairline, 0.5);

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(6.4)
    .text("Rick Goings Institute · Where Leaders Learn Judgment", ML, footerY + 10, {
      characterSpacing: 0.1,
      width: CW * 0.7,
      align: "left",
    });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(6.4)
    .text(`${pageNum}`, ML, footerY + 10, { width: CW, align: "center" });
  doc.restore();

  if (publishDate) {
    doc.save();
    hex(doc, C.muted)
      .font(PDF_FONTS.regular)
      .fontSize(6.4)
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
  doc.y = 66;
  return currentPage;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > H - MB - 18) {
    newPage(doc);
  }
}

// ── Section heading — compact executive publication style ─────────────────────
function sectionHeading(doc: PDFKit.PDFDocument, label: string) {
  doc.save();
  hex(doc, C.blue)
    .font(PDF_FONTS.bold)
    .fontSize(currentLayout.headingSize)
    .text(label.toUpperCase(), ML, doc.y, { width: CW, characterSpacing: 1.0 });
  doc.restore();
  doc.moveDown(currentLayout.headingSpacing);
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
    font = PDF_FONTS.regular,
    size = currentLayout.bodySize,
    lineGap = currentLayout.bodyLineGap,
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
  const { size = currentLayout.bulletSize } = opts;
  const LGAP = currentLayout.bulletLineGap;
  const indent = 12;
  const textX = ML + indent;
  const textW = CW - indent;

  items.forEach((item) => {
    const text = item.trim();
    doc.font(PDF_FONTS.regular).fontSize(size);
    const textH = doc.heightOfString(text, { width: textW, lineGap: LGAP });
    ensureSpace(doc, textH + 7);
    const y = doc.y;

    // Bullet dot — drawn after ensureSpace so it's always on the same page as text
    doc.save();
    hex(doc, C.gold)
      .circle(ML + 3, y + size * 0.48, 1.8)
      .fill();
    doc.restore();

    doc.save();
    hex(doc, C.body)
      .font(PDF_FONTS.regular)
      .fontSize(size)
      .text(text, textX, y, { width: textW, lineGap: LGAP, align: "left" });
    doc.restore();

    doc.y += currentLayout.bulletAfter;
  });
}

// ── Compact metadata strip ─────────────────────────────────────────────────────
function compactSourceNames(sources: Article[]): string[] {
  const names = sources.map((src) => {
    const explicit = String(src.sourceName ?? "").trim();
    if (explicit) return explicit;
    try {
      return new URL(src.url ?? "").hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }).filter(Boolean);
  return [...new Set(names)].slice(0, 7);
}

function supportMetadataStrip(doc: PDFKit.PDFDocument, topicTags: string[], sources: Article[]) {
  const sourceNames = compactSourceNames(sources);
  if (topicTags.length === 0 && sourceNames.length === 0) return;

  const labelW = 48;
  const textX = ML + labelW;
  const textW = CW - labelW;
  const topicsText = topicTags.slice(0, 5).join("  |  ");
  const sourcesText = sourceNames.join("  •  ");
  const rows = [
    topicsText ? { label: "TOPICS", text: topicsText } : null,
    sourcesText ? { label: "SOURCES", text: sourcesText } : null,
  ].filter(Boolean) as Array<{ label: string; text: string }>;

  const rowHeights = rows.map((row) => {
    doc.font(PDF_FONTS.regular).fontSize(currentLayout.metadataSize);
    return Math.max(7, doc.heightOfString(row.text, { width: textW, lineGap: currentLayout.metadataLineGap }));
  });
  const stripH = currentLayout.metadataTopPad + 3 + rowHeights.reduce((sum, height) => sum + height, 0) + rows.length * 2.4;
  const bottomLimit = H - MB - 18;

  doc.y = Math.max(doc.y, bottomLimit - stripH);

  hRule(doc, doc.y, C.hairline, 0.35);
  doc.y += currentLayout.metadataTopPad;

  rows.forEach((row, index) => {
    const y = doc.y;
    doc.save();
    hex(doc, C.gold)
      .font(PDF_FONTS.bold)
      .fontSize(5.8)
      .text(row.label, ML, y + 0.4, { width: labelW - 8, characterSpacing: 0.65 });
    hex(doc, C.muted)
      .font(PDF_FONTS.regular)
      .fontSize(currentLayout.metadataSize)
      .text(row.text, textX, y, { width: textW, lineGap: currentLayout.metadataLineGap });
    doc.restore();
    doc.y = y + rowHeights[index] + 2.4;
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
    .font(PDF_FONTS.bold)
    .fontSize(9)
    .text("RICK GOINGS INSTITUTE", ML, 46, { characterSpacing: 1.0, width: CW });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text("Strategic Intelligence Analysis", ML, 62, { characterSpacing: 0.4, width: CW });
  doc.restore();

  hRule(doc, 82, C.hairline, 0.5);

  // ── Report label ────────────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.ink)
    .font(PDF_FONTS.bold)
    .fontSize(22)
    .text("Daily Intelligence Digest", ML, 200, { width: CW, lineGap: 5 });
  doc.restore();

  doc.save();
  hex(doc, C.mid)
    .font(PDF_FONTS.regular)
    .fontSize(10.5)
    .text(today, ML, 240, { width: CW, lineGap: 4 });
  doc.restore();

  hRule(doc, 276, C.hairline, 0.5);

  // ── Table of contents ───────────────────────────────────────────────────────
  doc.save();
  hex(doc, C.navy)
    .font(PDF_FONTS.bold)
    .fontSize(7.5)
    .text("CONTENTS", ML, 294, { characterSpacing: 1.6, width: CW });
  doc.restore();

  let itemY = 316;
  articles.forEach((a, i) => {
    if (itemY > H - 110) return;

    doc.save();
    hex(doc, C.muted)
      .font(PDF_FONTS.regular)
      .fontSize(8)
      .text(`${i + 1}`, ML, itemY, { width: 18 });
    doc.restore();

    doc.save();
    hex(doc, C.ink)
      .font(PDF_FONTS.regular)
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
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text(today, ML, 714, { width: CW, align: "left" });
  doc.restore();

  doc.save();
  hex(doc, C.muted)
    .font(PDF_FONTS.regular)
    .fontSize(8)
    .text("Prepared for academic use", ML, 714, { width: CW, align: "right" });
  doc.restore();
}

// ── Strip markdown markers ─────────────────────────────────────────────────────
function cleanText(t: string): string {
  return t.replace(/\*\*/g, "").replace(/\*/g, "").trim();
}

function visibleLines(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}

function visibleTextBlocks(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\n{2,}/)
    .map(cleanText)
    .filter(Boolean);
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => cleanText(String(item))).filter(Boolean) : [];
}

function articleParagraphs(article: ArticleWithSources): string[] {
  const execSummary = arr(article.executiveSummary);
  const keyTakeaways = arr(article.keyTakeaways);
  const implificationsForLeaders = arr((article as unknown as Record<string, unknown>).implificationsForLeaders);
  const proseBlocks = visibleTextBlocks(article.body);
  const analysisParagraphs = [
    ...keyTakeaways,
    ...implificationsForLeaders,
    ...(article.rgiTake ? [cleanText(article.rgiTake)] : []),
  ].filter(Boolean);

  const fallbackBody = analysisParagraphs.length > 0
    ? []
    : proseBlocks.filter((paragraph) => !execSummary.includes(paragraph));

  return [...execSummary, ...fallbackBody, ...analysisParagraphs]
    .map(cleanText)
    .filter(Boolean);
}

type PlainArticleLayout = {
  left: number;
  top: number;
  bottom: number;
  logoSize: number;
  titleSize: number;
  titleLineGap: number;
  bodySize: number;
  bodyLineGap: number;
  paragraphGap: number;
};

const PLAIN_ARTICLE_LAYOUTS: PlainArticleLayout[] = [
  { left: 72, top: 58, bottom: 72, logoSize: 34, titleSize: 16, titleLineGap: 2, bodySize: 11, bodyLineGap: 4, paragraphGap: 10 },
  { left: 62, top: 50, bottom: 56, logoSize: 30, titleSize: 14, titleLineGap: 1.6, bodySize: 10, bodyLineGap: 3, paragraphGap: 7 },
  { left: 54, top: 44, bottom: 48, logoSize: 28, titleSize: 13, titleLineGap: 1.2, bodySize: 9.2, bodyLineGap: 2.2, paragraphGap: 5 },
  { left: 48, top: 40, bottom: 42, logoSize: 26, titleSize: 12.2, titleLineGap: 1, bodySize: 8.6, bodyLineGap: 1.5, paragraphGap: 3.5 },
];

function addPlainArticlePage(doc: PDFKit.PDFDocument, layout: PlainArticleLayout) {
  currentPage++;
  doc.addPage();
  doc.x = layout.left;
  doc.y = layout.top;
}

function plainArticleTitleHeight(doc: PDFKit.PDFDocument, headline: string, layout: PlainArticleLayout): number {
  const titleWidth = W - layout.left * 2 - layout.logoSize - 18;
  doc.font(PDF_FONTS.bold).fontSize(layout.titleSize);
  return doc.heightOfString(cleanText(headline), { width: titleWidth, lineGap: layout.titleLineGap });
}

function plainArticleHeader(doc: PDFKit.PDFDocument, headline: string, layout: PlainArticleLayout) {
  const titleWidth = W - layout.left * 2 - layout.logoSize - 18;

  drawRgiLogo(doc, W - layout.left - layout.logoSize, layout.top - 4, layout.logoSize);
  doc.save();
  hex(doc, C.ink)
    .font(PDF_FONTS.bold)
    .fontSize(layout.titleSize)
    .text(cleanText(headline), layout.left, layout.top, {
      width: titleWidth,
      lineGap: layout.titleLineGap,
    });
  doc.restore();
  doc.y = layout.top + Math.max(plainArticleTitleHeight(doc, headline, layout), layout.logoSize) + 20;
}

function plainArticleBodyHeight(doc: PDFKit.PDFDocument, paragraphs: string[], layout: PlainArticleLayout): number {
  const width = W - layout.left * 2;
  return paragraphs.reduce((sum, text) => {
    const clean = cleanText(text);
    if (!clean) return sum;
    doc.font(PDF_FONTS.regular).fontSize(layout.bodySize);
    return sum + doc.heightOfString(clean, { width, lineGap: layout.bodyLineGap }) + layout.paragraphGap;
  }, 0);
}

function trimWords(value: string, maxWords: number): string {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleanText(value);
  return `${words.slice(0, maxWords).join(" ")}.`;
}

function compressParagraphsForOnePage(paragraphs: string[]): string[] {
  const summary = paragraphs[0] ? trimWords(paragraphs[0], 70) : "";
  const analysis = paragraphs.slice(1);
  const final = analysis.length > 1 ? analysis[analysis.length - 1] : "";
  const middle = final ? analysis.slice(0, -1) : analysis;
  return [
    summary,
    ...middle.slice(0, 3).map((paragraph) => trimWords(paragraph, 78)),
    ...(final ? [trimWords(final, 60)] : []),
  ].filter(Boolean);
}

function choosePlainArticleLayout(
  doc: PDFKit.PDFDocument,
  headline: string,
  initialParagraphs: string[]
): { layout: PlainArticleLayout; paragraphs: string[] } {
  let paragraphs = initialParagraphs;
  for (const layout of PLAIN_ARTICLE_LAYOUTS) {
    const startY = layout.top + Math.max(plainArticleTitleHeight(doc, headline, layout), layout.logoSize) + 20;
    const available = H - layout.bottom - startY;
    if (plainArticleBodyHeight(doc, paragraphs, layout) <= available) {
      return { layout, paragraphs };
    }
  }

  paragraphs = compressParagraphsForOnePage(initialParagraphs);
  for (const layout of PLAIN_ARTICLE_LAYOUTS) {
    const startY = layout.top + Math.max(plainArticleTitleHeight(doc, headline, layout), layout.logoSize) + 20;
    const available = H - layout.bottom - startY;
    if (plainArticleBodyHeight(doc, paragraphs, layout) <= available) {
      return { layout, paragraphs };
    }
  }

  return {
    layout: PLAIN_ARTICLE_LAYOUTS[PLAIN_ARTICLE_LAYOUTS.length - 1],
    paragraphs: paragraphs.slice(0, 4).map((paragraph, index) => trimWords(paragraph, index === 0 ? 55 : 60)),
  };
}

function plainArticleParagraph(doc: PDFKit.PDFDocument, text: string, layout: PlainArticleLayout) {
  const bottom = H - layout.bottom;
  const width = W - layout.left * 2;
  const clean = cleanText(text);
  if (!clean) return;

  doc.font(PDF_FONTS.regular).fontSize(layout.bodySize);
  let printable = clean;
  let height = doc.heightOfString(printable, { width, lineGap: layout.bodyLineGap });
  if (doc.y + height > bottom) {
    const remaining = Math.max(0, bottom - doc.y);
    const ratio = Math.max(0.2, remaining / Math.max(height, 1));
    printable = trimWords(printable, Math.max(28, Math.floor(printable.split(/\s+/).length * ratio) - 4));
    height = doc.heightOfString(printable, { width, lineGap: layout.bodyLineGap });
    if (doc.y + height > bottom) return;
  }

  doc.save();
  hex(doc, C.body)
    .font(PDF_FONTS.regular)
    .fontSize(layout.bodySize)
    .text(printable, layout.left, doc.y, {
      width,
      lineGap: layout.bodyLineGap,
      align: "left",
    });
  doc.restore();
  doc.y += layout.paragraphGap;
}

function renderPlainArticle(doc: PDFKit.PDFDocument, article: ArticleWithSources) {
  const fit = choosePlainArticleLayout(doc, article.headline, articleParagraphs(article));
  addPlainArticlePage(doc, fit.layout);
  plainArticleHeader(doc, article.headline, fit.layout);
  for (const paragraph of fit.paragraphs) {
    plainArticleParagraph(doc, paragraph, fit.layout);
  }
}

function uiCardSection(
  doc: PDFKit.PDFDocument,
  heading: string,
  opts: {
    items?: string[];
    paragraphs?: string[];
    border?: string;
    label?: string;
    italic?: boolean;
    editorial?: boolean;
  }
) {
  const items = opts.items ?? [];
  const paragraphs = opts.paragraphs ?? [];
  if (items.length === 0 && paragraphs.length === 0) return;

  sectionGuardForCard(doc, opts.editorial ? currentLayout.editorialMinHeight : 36);
  if (opts.editorial) {
    let startY = doc.y;
    const bodyWidth = CW - 24;
    let remaining = H - MB - 30 - startY;
    let editorialSize = currentLayout.editorialSize;
    let editorialLineGap = currentLayout.editorialLineGap;
    let paragraphHeight = paragraphs.reduce((sum, text) => {
      const clean = cleanText(text);
      doc.font(PDF_FONTS.italic).fontSize(editorialSize);
      return sum + doc.heightOfString(clean, { width: bodyWidth, lineGap: editorialLineGap }) + 2;
    }, 0);
    let boxH = Math.max(
      currentLayout.editorialMinHeight,
      paragraphHeight + currentLayout.editorialPadTop + currentLayout.editorialHeadingGap + currentLayout.editorialPadBottom + currentLayout.editorialExtraHeight
    );

    if (boxH > remaining && remaining > 42) {
      editorialSize = 7.15;
      editorialLineGap = 1.15;
      paragraphHeight = paragraphs.reduce((sum, text) => {
        const clean = cleanText(text);
        doc.font(PDF_FONTS.italic).fontSize(editorialSize);
        return sum + doc.heightOfString(clean, { width: bodyWidth, lineGap: editorialLineGap }) + 2;
      }, 0);
      boxH = Math.max(48, paragraphHeight + 22);
    }

    if (doc.y + boxH + 4 > H - MB - 24) {
      newPage(doc);
      startY = doc.y;
      remaining = H - MB - 30 - startY;
      if (boxH > remaining) {
        editorialSize = 6.9;
        editorialLineGap = 0.9;
        paragraphHeight = paragraphs.reduce((sum, text) => {
          const clean = cleanText(text);
          doc.font(PDF_FONTS.italic).fontSize(editorialSize);
          return sum + doc.heightOfString(clean, { width: bodyWidth, lineGap: editorialLineGap }) + 1.5;
        }, 0);
        boxH = Math.max(42, paragraphHeight + 20);
      }
    }

    doc.save();
    hex(doc, C.editorialBg).roundedRect(ML - 4, startY - 3, CW + 8, boxH, 3).fill();
    hex(doc, C.gold).rect(ML - 4, startY - 3, 3, boxH).fill();
    doc.restore();

    doc.y = startY + currentLayout.editorialPadTop;
    doc.save();
    hex(doc, C.navy)
      .font(PDF_FONTS.bold)
      .fontSize(currentLayout.headingSize)
      .text(heading.toUpperCase(), ML + 10, doc.y, { width: bodyWidth, characterSpacing: 0.95 });
    doc.restore();
    doc.y += currentLayout.editorialHeadingGap;

    for (const text of paragraphs) {
      const clean = cleanText(text);
      doc.save();
      hex(doc, C.body)
        .font(PDF_FONTS.italic)
        .fontSize(editorialSize)
        .text(clean, ML + 10, doc.y, { width: bodyWidth, lineGap: editorialLineGap });
      doc.restore();
      doc.moveDown(currentLayout.paragraphAfter);
    }
    doc.y = Math.max(doc.y + currentLayout.editorialPadBottom, startY + boxH + currentLayout.sectionRuleAfter);
    return;
  }

  const startY = doc.y;
  sectionHeading(doc, heading);
  if (items.length > 0) bulletList(doc, items, { size: currentLayout.bulletSize });
  for (const text of paragraphs) {
    const clean = cleanText(text);
    doc.font(opts.italic ? PDF_FONTS.italic : PDF_FONTS.regular).fontSize(currentLayout.bodySize);
    ensureSpace(doc, doc.heightOfString(clean, { width: CW, lineGap: currentLayout.bodyLineGap }) + 5);
    para(doc, clean, { font: opts.italic ? PDF_FONTS.italic : PDF_FONTS.regular });
    doc.moveDown(currentLayout.paragraphAfter);
  }
  if (doc.y > startY) {
    doc.y += currentLayout.sectionRuleBefore;
    hRule(doc, doc.y, C.hairline, 0.3);
    doc.y += currentLayout.sectionRuleAfter + currentLayout.sectionExtraGap;
  }
}

function sectionGuardForCard(doc: PDFKit.PDFDocument, needed = 58) {
  ensureSpace(doc, needed);
}

type PdfArticleContent = {
  headline: string;
  articleType: string | null | undefined;
  execSummary: string[];
  keyDevelopments: string[];
  proseBlocks: string[];
  strategicAssessment: string[];
  implicationsForLeaders: string[];
  rgiTake: string | null | undefined;
  topicTags: string[];
  sources: Article[];
  isStructured: boolean;
};

function sectionTextHeight(doc: PDFKit.PDFDocument, text: string, profile: LayoutProfile, width = CW): number {
  doc.font(PDF_FONTS.regular).fontSize(profile.bodySize);
  return doc.heightOfString(cleanText(text), { width, lineGap: profile.bodyLineGap });
}

function bulletTextHeight(doc: PDFKit.PDFDocument, text: string, profile: LayoutProfile): number {
  doc.font(PDF_FONTS.regular).fontSize(profile.bulletSize);
  return doc.heightOfString(cleanText(text), { width: CW - 12, lineGap: profile.bulletLineGap }) + profile.bulletAfter;
}

function estimateSectionHeight(
  doc: PDFKit.PDFDocument,
  profile: LayoutProfile,
  opts: { paragraphs?: string[]; items?: string[]; editorial?: boolean }
): number {
  const paragraphs = opts.paragraphs ?? [];
  const items = opts.items ?? [];
  if (paragraphs.length === 0 && items.length === 0) return 0;

  if (opts.editorial) {
    const bodyWidth = CW - 24;
    const paragraphHeight = paragraphs.reduce((sum, text) => {
      doc.font(PDF_FONTS.italic).fontSize(profile.editorialSize);
      return sum + doc.heightOfString(cleanText(text), { width: bodyWidth, lineGap: profile.editorialLineGap }) + 2;
    }, 0);
    return Math.max(
      profile.editorialMinHeight,
      paragraphHeight + profile.editorialPadTop + profile.editorialHeadingGap + profile.editorialPadBottom + profile.editorialExtraHeight
    ) + profile.sectionRuleAfter;
  }

  const headingH = profile.headingSize + 3;
  const bulletH = items.reduce((sum, item) => sum + bulletTextHeight(doc, item, profile), 0);
  const paragraphH = paragraphs.reduce((sum, text) => {
    return sum + sectionTextHeight(doc, text, profile) + profile.paragraphAfter * profile.bodySize;
  }, 0);
  return headingH + bulletH + paragraphH + profile.sectionRuleBefore + profile.sectionRuleAfter + profile.sectionExtraGap;
}

function estimateMetadataHeight(doc: PDFKit.PDFDocument, profile: LayoutProfile, topicTags: string[], sources: Article[]): number {
  const sourceNames = compactSourceNames(sources);
  const rows = [
    topicTags.length > 0 ? topicTags.slice(0, 5).join("  |  ") : "",
    sourceNames.length > 0 ? sourceNames.join("  •  ") : "",
  ].filter(Boolean);
  if (rows.length === 0) return 0;

  const textW = CW - 48;
  const rowH = rows.reduce((sum, text) => {
    doc.font(PDF_FONTS.regular).fontSize(profile.metadataSize);
    return sum + Math.max(7, doc.heightOfString(text, { width: textW, lineGap: profile.metadataLineGap }));
  }, 0);
  return profile.metadataTopPad + 3 + rowH + rows.length * 2.4;
}

function estimateArticleHeight(doc: PDFKit.PDFDocument, content: PdfArticleContent, profile: LayoutProfile): number {
  doc.font(PDF_FONTS.bold).fontSize(profile.titleSize);
  const titleH = doc.heightOfString(content.headline, { width: CW, lineGap: profile.titleLineGap });
  let height = titleH + 18;

  height += estimateSectionHeight(doc, profile, { paragraphs: content.execSummary });
  if (content.isStructured && content.keyDevelopments.length > 0) {
    height += estimateSectionHeight(doc, profile, { items: content.keyDevelopments });
  } else if (content.proseBlocks.length > 0) {
    height += estimateSectionHeight(doc, profile, { paragraphs: content.proseBlocks });
  }
  height += estimateSectionHeight(doc, profile, { paragraphs: content.strategicAssessment });
  if (content.isStructured) {
    height += estimateSectionHeight(doc, profile, { items: content.implicationsForLeaders });
  }
  if (content.rgiTake) {
    height += estimateSectionHeight(doc, profile, { paragraphs: [content.rgiTake], editorial: true });
  }
  height += estimateMetadataHeight(doc, profile, content.topicTags, content.sources);
  return height;
}

function chooseAdaptiveLayout(doc: PDFKit.PDFDocument, content: PdfArticleContent): LayoutProfile {
  const available = H - MB - 18 - 66;
  const standardHeight = estimateArticleHeight(doc, content, LAYOUT_PROFILES.standard);
  const standardRatio = standardHeight / available;
  const baseName: LayoutProfile["name"] =
    standardRatio < 0.68 ? "expanded" :
    standardRatio < 0.82 ? "roomy" :
    standardRatio > 0.98 ? "compact" :
    "standard";

  let profile: LayoutProfile = { ...LAYOUT_PROFILES[baseName] };
  let estimated = estimateArticleHeight(doc, content, profile);

  if (estimated > available * 0.99 && profile.name !== "compact") {
    profile = { ...LAYOUT_PROFILES.compact };
    estimated = estimateArticleHeight(doc, content, profile);
  }

  const target = available * 0.92;
  const remaining = target - estimated;
  if (remaining > 22) {
    profile = {
      ...profile,
      sectionExtraGap: Math.min(14, remaining * 0.09),
      editorialExtraHeight: profile.editorialExtraHeight + Math.min(34, remaining * 0.28),
    };
  }

  return profile;
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
        : `RGI Intelligence Analysis — ${publishDate}`,
      Author: "Rick Goings Institute",
      Subject: "Strategic Intelligence Analysis",
      Keywords: "RGI, intelligence, strategy, leadership",
      Creator: "RGI Intelligence Platform",
    },
    autoFirstPage: false,
  });
  registerPdfFonts(doc);

  for (const article of articles) {
    renderPlainArticle(doc, article);
  }

  return doc;
}
