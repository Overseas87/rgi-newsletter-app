import PDFDocument from "pdfkit";
import { type InferSelectModel } from "drizzle-orm";
import { digestArticlesTable, articlesTable } from "@workspace/db";

type DigestArticle = InferSelectModel<typeof digestArticlesTable>;
type Article = InferSelectModel<typeof articlesTable>;

export interface ArticleWithSources extends DigestArticle {
  sourceArticles?: Article[];
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const C = {
  navy:        [26, 54, 93]   as [number,number,number],
  gold:        [183, 136, 44] as [number,number,number],
  amber:       [245, 158, 11] as [number,number,number],
  blue:        [59, 130, 246] as [number,number,number],
  textDark:    [31, 41, 55]   as [number,number,number],
  textMid:     [55, 65, 81]   as [number,number,number],
  textLight:   [107, 114, 128] as [number,number,number],
  rule:        [226, 232, 240] as [number,number,number],
  white:       [255, 255, 255] as [number,number,number],
  slateLight:  [148, 163, 184] as [number,number,number],
};

const LETTER_W = 612;
const LETTER_H = 792;
const M = 54;           // margin
const CW = LETTER_W - M * 2;  // content width

// ── Helpers ────────────────────────────────────────────────────────────────────
function rule(doc: PDFKit.PDFDocument, color = C.rule, width = 0.5) {
  doc.save()
    .strokeColor(color)
    .lineWidth(width)
    .moveTo(M, doc.y)
    .lineTo(LETTER_W - M, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.7);
}

function accentLine(doc: PDFKit.PDFDocument, startY: number, endY: number, color: [number,number,number]) {
  doc.save()
    .strokeColor(color)
    .lineWidth(3)
    .moveTo(M, startY)
    .lineTo(M, endY)
    .stroke()
    .restore();
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string, color: [number,number,number]) {
  doc.save()
    .fillColor(color)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(text.toUpperCase(), M, doc.y, { characterSpacing: 1.5, width: CW })
    .restore();
  doc.moveDown(0.45);
}

function bodyText(doc: PDFKit.PDFDocument, text: string, x = M, width = CW) {
  doc.save()
    .fillColor(C.textMid)
    .font("Helvetica")
    .fontSize(10)
    .text(text, x, doc.y, { width, lineGap: 2 })
    .restore();
}

function bullets(
  doc: PDFKit.PDFDocument,
  items: string[],
  dotColor: [number,number,number],
  indent = 12
) {
  const textX = M + indent;
  const textW = CW - indent;
  items.forEach((item) => {
    const y = doc.y;
    doc.save()
      .fillColor(dotColor)
      .circle(M + 4, y + 5, 2.2)
      .fill()
      .restore();
    doc.save()
      .fillColor(C.textMid)
      .font("Helvetica")
      .fontSize(10)
      .text(item, textX, y, { width: textW, lineGap: 2 })
      .restore();
    doc.moveDown(0.4);
  });
}

function needsNewPage(doc: PDFKit.PDFDocument, minRemaining = 100): boolean {
  return doc.y > LETTER_H - M - 50 - minRemaining;
}

function ensurePage(doc: PDFKit.PDFDocument, space = 100) {
  if (needsNewPage(doc, space)) {
    doc.addPage();
    drawFooter(doc);
    doc.x = M;
    doc.y = M;
  }
}

// ── Header / Footer ────────────────────────────────────────────────────────────
function drawHeader(doc: PDFKit.PDFDocument, articleType: string) {
  // Navy bar
  doc.save().fillColor(C.navy).rect(0, 0, LETTER_W, 62).fill().restore();

  // Institution name
  doc.save()
    .fillColor(C.white)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("RICK GOINGS INSTITUTE", M, 14, { characterSpacing: 0.6, width: CW })
    .restore();

  // Subtitle
  const subtitle = articleType === "daily_brief"
    ? "Daily Strategic Intelligence Brief"
    : "Strategic Intelligence Brief";
  doc.save()
    .fillColor(C.slateLight)
    .font("Helvetica")
    .fontSize(8.5)
    .text(subtitle, M, 33, { width: CW })
    .restore();

  // Gold rule under header
  doc.save()
    .fillColor(C.gold)
    .rect(M, 50, CW, 1.5)
    .fill()
    .restore();

  doc.x = M;
  doc.y = 76;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const footerY = LETTER_H - 36;
  doc.save()
    .strokeColor(C.rule)
    .lineWidth(0.5)
    .moveTo(M, footerY)
    .lineTo(LETTER_W - M, footerY)
    .stroke()
    .restore();

  doc.save()
    .fillColor(C.textLight)
    .font("Helvetica")
    .fontSize(7)
    .text(
      "Rick Goings Institute for Leadership & Global Affairs  ·  Rollins College  ·  Strategic Intelligence — Confidential",
      M, footerY + 8,
      { width: CW, align: "center", characterSpacing: 0.1 }
    )
    .restore();
}

// ── Main export ────────────────────────────────────────────────────────────────
export function generateArticlePdf(
  articles: ArticleWithSources[],
  options: { combined?: boolean } = {}
): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: M, bottom: 54, left: M, right: M },
    info: {
      Title: articles.length === 1
        ? articles[0].headline
        : "RGI Strategic Intelligence — Combined Brief",
      Author: "Rick Goings Institute for Leadership & Global Affairs",
      Subject: "Strategic Intelligence Brief",
      Keywords: "RGI, intelligence, strategy, leadership, Rollins College",
      Creator: "RGI Intelligence Platform",
    },
    autoFirstPage: false,
  });

  for (let idx = 0; idx < articles.length; idx++) {
    const article = articles[idx];
    const isStructured =
      Array.isArray(article.whatToWatch) && (article.whatToWatch as string[]).length > 0;
    const keyDevelopments = isStructured
      ? article.body.split("\n").filter(Boolean)
      : null;
    const execSummary = (Array.isArray(article.executiveSummary)
      ? article.executiveSummary
      : []) as string[];
    const keyTakeaways = (Array.isArray(article.keyTakeaways)
      ? article.keyTakeaways
      : []) as string[];
    const whatToWatch = (Array.isArray(article.whatToWatch)
      ? article.whatToWatch
      : []) as string[];

    doc.addPage();
    drawHeader(doc, article.articleType);
    drawFooter(doc);

    // ── Article type + discipline + score ──────────────────────────────────
    const typeLabel = article.articleType === "daily_brief" ? "DAILY BRIEF" : "TOPIC ANALYSIS";
    const discipline = article.discipline ?? "Strategic Intelligence";
    doc.save()
      .fillColor(C.navy)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(typeLabel, M, doc.y, { continued: true, characterSpacing: 1.3 })
      .fillColor(C.textLight)
      .font("Helvetica")
      .text(`  ·  ${discipline}  ·  Score: ${article.relevancyScore?.toFixed(1) ?? "—"}/10`, { characterSpacing: 0 })
      .restore();
    doc.moveDown(0.7);

    // ── Headline ───────────────────────────────────────────────────────────
    doc.save()
      .fillColor(C.navy)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(article.headline, M, doc.y, { width: CW, lineGap: 3 })
      .restore();
    doc.moveDown(0.6);

    // ── Metadata ───────────────────────────────────────────────────────────
    const createdAt = new Date(article.createdAt);
    const dateStr = createdAt.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const timeStr = createdAt.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
    doc.save()
      .fillColor(C.textLight)
      .font("Helvetica")
      .fontSize(8.5)
      .text(`RGI Generated  ·  ${dateStr}  ·  ${timeStr}`, M, doc.y, { width: CW })
      .restore();

    if (article.publishedAt) {
      const pubDate = new Date(article.publishedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
      doc.save()
        .fillColor(C.textLight)
        .font("Helvetica")
        .fontSize(8.5)
        .text(`Approved for publication: ${pubDate}`, M, doc.y, { width: CW })
        .restore();
    }

    // Topic tags
    const tags = (Array.isArray(article.topicTags) ? article.topicTags : []) as string[];
    if (tags.length > 0) {
      doc.moveDown(0.3);
      doc.save()
        .fillColor(C.textLight)
        .font("Helvetica")
        .fontSize(8)
        .text(`Topics: ${tags.join("  ·  ")}`, M, doc.y, { width: CW })
        .restore();
    }

    doc.moveDown(0.7);
    rule(doc, C.gold, 1.5);

    // ── Executive Summary ─────────────────────────────────────────────────
    if (execSummary.length > 0) {
      ensurePage(doc, 80);
      const startY = doc.y;
      sectionLabel(doc, "Executive Summary", C.navy);

      execSummary.forEach((sentence, i) => {
        doc.save()
          .fillColor(C.textDark)
          .font(i === 0 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(10.5)
          .text(sentence, M + 12, doc.y, { width: CW - 12, lineGap: 2 })
          .restore();
        if (i < execSummary.length - 1) doc.moveDown(0.3);
      });

      accentLine(doc, startY, doc.y + 2, C.navy);
      doc.moveDown(0.9);
    }

    // ── Key Developments ──────────────────────────────────────────────────
    ensurePage(doc, 80);
    sectionLabel(doc, isStructured ? "Key Developments" : "Analysis", C.textDark);

    if (isStructured && keyDevelopments) {
      bullets(doc, keyDevelopments, C.navy);
    } else {
      article.body.split("\n\n").filter(Boolean).forEach((para) => {
        bodyText(doc, para.replace(/\*\*/g, "").replace(/\*/g, "").trim());
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(0.5);

    // ── Why It Matters ────────────────────────────────────────────────────
    if (keyTakeaways.length > 0) {
      ensurePage(doc, 80);
      const startY = doc.y;
      sectionLabel(doc, isStructured ? "Why It Matters" : "Key Takeaways", C.amber);
      bullets(doc, keyTakeaways, C.amber);
      accentLine(doc, startY, doc.y + 2, C.amber);
      doc.moveDown(0.9);
    }

    // ── RGI Take ──────────────────────────────────────────────────────────
    if (article.rgiTake) {
      ensurePage(doc, 80);
      const startY = doc.y;
      sectionLabel(doc, "RGI Take", C.navy);
      doc.save()
        .fillColor(C.textMid)
        .font("Helvetica-Oblique")
        .fontSize(10.5)
        .text(article.rgiTake, M + 12, doc.y, { width: CW - 12, lineGap: 2.5 })
        .restore();
      accentLine(doc, startY, doc.y + 4, C.gold);
      doc.moveDown(0.9);
    }

    // ── What to Watch ─────────────────────────────────────────────────────
    if (whatToWatch.length > 0) {
      ensurePage(doc, 80);
      const startY = doc.y;
      sectionLabel(doc, "What to Watch", C.blue);
      bullets(doc, whatToWatch, C.blue);
      accentLine(doc, startY, doc.y + 2, C.blue);
      doc.moveDown(0.9);
    }

    // ── Sources ───────────────────────────────────────────────────────────
    const srcList = article.sourceArticles ?? [];
    if (srcList.length > 0) {
      ensurePage(doc, 60);
      rule(doc, C.rule, 0.5);
      sectionLabel(doc, `Sources & References (${srcList.length})`, C.textLight);

      srcList.forEach((src, i) => {
        ensurePage(doc, 50);
        doc.save()
          .fillColor(C.textDark)
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .text(`${i + 1}.  ${src.headline}`, M, doc.y, { width: CW, lineGap: 1 })
          .restore();

        const meta = [src.sourceName, src.author].filter(Boolean).join("  ·  ");
        if (meta) {
          doc.save()
            .fillColor(C.textLight)
            .font("Helvetica")
            .fontSize(7.5)
            .text(meta, M, doc.y, { width: CW })
            .restore();
        }

        if (src.url) {
          doc.save()
            .fillColor(C.blue)
            .font("Helvetica")
            .fontSize(7.5)
            .text(src.url, M, doc.y, {
              width: CW,
              link: src.url,
              underline: true,
              lineGap: 1,
            })
            .restore();
        }

        doc.moveDown(0.45);
      });
    }
  }

  return doc;
}
