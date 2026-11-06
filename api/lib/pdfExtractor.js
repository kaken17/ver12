
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

const workerPath = require.resolve(
  "pdfjs-dist/legacy/build/pdf.worker.mjs"
);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pathToFileURL(workerPath).href;
const SCHOOL_HOST = "yameth.fku.ed.jp";

const MAX_PDF_SIZE = 8 * 1024 * 1024;
const MAX_PAGES = 25;
const TIMEOUT_MS = 10000;
const MIN_TEXT_LENGTH = 50;

// =====================================
// PDF URLの安全確認
// =====================================

function isOfficialPdfUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === SCHOOL_HOST &&
      !url.username &&
      !url.password &&
      /\.pdf$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// =====================================
// PDF本文の整形
// =====================================

function cleanPdfText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================================
// PDF本文の品質確認
// =====================================

function validatePdfText(text) {
  if (!text || text.length < MIN_TEXT_LENGTH) {
    return false;
  }

  const meaningfulCharacters =
    text.match(/[ぁ-んァ-ヶ一-龠a-zA-Z0-9]/g) || [];

  return meaningfulCharacters.length >= 20;
}

// =====================================
// 公式PDF解析
// =====================================

export async function extractOfficialPdf(url) {
  let loadingTask;

  try {
    // ① URL確認
    if (!isOfficialPdfUrl(url)) {
      console.warn("公式PDF以外を拒否:", url);
      return null;
    }

    // ② PDF取得
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/pdf"
      }
    });

    // ③ リダイレクト拒否
    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      console.warn("PDFのリダイレクトを拒否:", url);
      return null;
    }

    if (!response.ok) {
      console.warn("PDF取得失敗:", response.status);
      return null;
    }

    // ④ Content-Type確認
    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("pdf")) {
      console.warn("PDF形式ではありません:", contentType);
      return null;
    }

    // ⑤ サイズ確認
    const contentLength = Number(
      response.headers.get("content-length") || 0
    );

    if (contentLength > MAX_PDF_SIZE) {
      console.warn("PDFサイズ超過:", contentLength);
      return null;
    }

    // ⑥ PDFバッファ取得
    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (
      buffer.length > MAX_PDF_SIZE ||
      buffer.length < 5 ||
      buffer.subarray(0, 5).toString() !== "%PDF-"
    ) {
      console.warn("PDFデータが不正:", url);
      return null;
    }

    // ⑦ PDF.jsで解析
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0
    });

    const document = await loadingTask.promise;

    // ⑧ ページ数制限
    const totalPages = document.numPages;
    const pagesToRead = Math.min(
      totalPages,
      MAX_PAGES
    );

    const pageTexts = [];

    // ⑨ ページごとに本文抽出
    for (let pageNumber = 1;
      pageNumber <= pagesToRead;
      pageNumber++
    ) {
      const page = await document.getPage(pageNumber);

      try {
        const textContent = await page.getTextContent();

        const pageText = textContent.items
          .map(item => item.str || "")
          .join(" ");

        pageTexts.push(pageText);

      } finally {
        page.cleanup();
      }
    }

    // ⑩ 本文整形
    const content = cleanPdfText(
      pageTexts.join("\n")
    );

    // ⑪ 本文品質確認
    if (!validatePdfText(content)) {
      console.warn("PDF本文の品質不足:", {
        url,
        characters: content.length
      });

      return null;
    }

    // ⑫ 解析結果
    const result = {
      content,
      pages: pagesToRead,
      totalPages,
      source: url
    };

    console.log("PDF解析成功:", {
      source: result.source,
      pages: result.pages,
      totalPages: result.totalPages,
      extractedCharacters: result.content.length
    });

    return result;

  } catch (error) {
    console.error("PDF解析エラー:", {
      url,
      message: error.message
    });

    return null;

  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch (error) {
        console.warn(
          "PDFリソース解放エラー:",
          error.message
        );
      }
    }
  }
}
