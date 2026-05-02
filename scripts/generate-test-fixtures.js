#!/usr/bin/env node
/**
 * generate-test-fixtures.js — bootstrap upload-test fixtures.
 *
 * Reads the calibrated Alexandra Chen persona text from
 * requirements/_shared/fixtures/dummy-session.json and emits real PDF / DOCX /
 * TXT files plus a set of error-path fixtures into:
 *
 *   requirements/_shared/fixtures/files/
 *
 * This script is idempotent — re-runs overwrite. Output files are committed
 * (small, deterministic, useful for offline test runs and CI). Run from the
 * project root:
 *
 *   node scripts/generate-test-fixtures.js
 */
const fs = require("fs");
const path = require("path");
const { jsPDF } = require("jspdf");
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require("docx");

const ROOT = path.resolve(__dirname, "..");
const SESSION_PATH = path.join(
  ROOT,
  "requirements",
  "_shared",
  "fixtures",
  "dummy-session.json",
);
const OUT_DIR = path.join(ROOT, "requirements", "_shared", "fixtures", "files");

fs.mkdirSync(OUT_DIR, { recursive: true });

const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
const RESUME_TEXT = session.resumeRaw;
if (!RESUME_TEXT || typeof RESUME_TEXT !== "string") {
  throw new Error("dummy-session.json missing resumeRaw text");
}

function writePdf(filename, text, opts = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const usable = pageWidth - margin * 2;
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text, usable);
  let y = margin;
  const lineHeight = 14;
  const pageHeight = doc.internal.pageSize.getHeight() - margin;
  for (const line of lines) {
    if (y + lineHeight > pageHeight) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
  // Force-pad to N pages if requested
  if (opts.minPages && opts.minPages > 1) {
    while (doc.getNumberOfPages() < opts.minPages) {
      doc.addPage();
      doc.text(`Page filler ${doc.getNumberOfPages()}`, margin, margin);
    }
  }
  const out = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(path.join(OUT_DIR, filename), out);
  return out.length;
}

async function writeDocx(filename, text) {
  // Split on blank lines into paragraphs; retain section heads as Heading2.
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const children = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0];
    const isAllCaps =
      first === first.toUpperCase() && first.length > 3 && /[A-Z]/.test(first);
    if (isAllCaps && lines.length > 1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: first })],
        }),
      );
      for (const rest of lines.slice(1)) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: rest })] }),
        );
      }
    } else {
      for (const line of lines) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: line })] }),
        );
      }
    }
  }
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, filename), buffer);
  return buffer.length;
}

function writeTxt(filename, text) {
  fs.writeFileSync(path.join(OUT_DIR, filename), text, "utf8");
  return Buffer.byteLength(text, "utf8");
}

function writeRaw(filename, bytes) {
  fs.writeFileSync(path.join(OUT_DIR, filename), bytes);
  return bytes.length;
}

// 1x1 transparent PNG (89 bytes) — minimal valid PNG for MIME tests.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

async function main() {
  const report = [];

  // — Happy path fixtures —
  report.push([
    "alexandra-chen-resume.pdf",
    writePdf("alexandra-chen-resume.pdf", RESUME_TEXT),
  ]);
  report.push([
    "alexandra-chen-resume.docx",
    await writeDocx("alexandra-chen-resume.docx", RESUME_TEXT),
  ]);
  report.push([
    "alexandra-chen-resume.txt",
    writeTxt("alexandra-chen-resume.txt", RESUME_TEXT),
  ]);

  // — Error-path fixtures —
  // corrupt.pdf: PDF magic + truncated body. Parser should fail cleanly.
  report.push([
    "corrupt.pdf",
    writeRaw(
      "corrupt.pdf",
      Buffer.concat([
        Buffer.from("%PDF-1.4\n", "ascii"),
        Buffer.from("garbage-not-a-real-pdf-stream", "ascii"),
      ]),
    ),
  ]);

  // empty.pdf: 0 bytes. Edge case for size validation.
  report.push(["empty.pdf", writeRaw("empty.pdf", Buffer.alloc(0))]);

  // wrong-type.png: real PNG bytes with .png extension. Tests MIME validation.
  report.push([
    "wrong-type.png",
    writeRaw("wrong-type.png", Buffer.from(TINY_PNG_BASE64, "base64")),
  ]);

  // multi-page.pdf: real PDF, ~50 pages. Stress for parser timeout.
  report.push([
    "multi-page.pdf",
    writePdf("multi-page.pdf", RESUME_TEXT, { minPages: 50 }),
  ]);

  // oversized.pdf: real PDF padded with binary noise to exceed 10MB.
  // Tests upload size limit. Build by writing a real PDF then appending
  // junk bytes (the PDF will still be parseable up to the EOF marker).
  const basePdfPath = path.join(OUT_DIR, "alexandra-chen-resume.pdf");
  const basePdf = fs.readFileSync(basePdfPath);
  const TARGET_BYTES = 10 * 1024 * 1024 + 1024; // ~10MB + 1KB
  const padBytes = Math.max(0, TARGET_BYTES - basePdf.length);
  const padding = Buffer.alloc(padBytes, 0x00);
  report.push([
    "oversized.pdf",
    writeRaw("oversized.pdf", Buffer.concat([basePdf, padding])),
  ]);

  // — Report —
  process.stdout.write("Generated fixtures:\n");
  for (const [name, bytes] of report) {
    const kb = (bytes / 1024).toFixed(1);
    process.stdout.write(`  ${name.padEnd(32)} ${kb} KB\n`);
  }
  process.stdout.write(`\nOutput dir: ${path.relative(ROOT, OUT_DIR)}\n`);
}

main().catch((e) => {
  process.stderr.write(`generate-test-fixtures failed: ${e.message}\n`);
  process.exit(1);
});
