
import pdfParse from "pdf-parse";

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

  // 日本語または英数字が含まれているか
  const meaningfulCharacters =
    text.match(/[ぁ-んァ-ヶ一-龠a-zA-Z0-9]/g) || [];

  if (meaningfulCharacters.length < 20) {
    return false;
  }

  return true;
}

// =====================================
// 公式PDF解析
// =====================================

export async function extractOfficialPdf(url) {
  try {

    // ① URL確認
    if (!isOfficialPdfUrl(url)) {
      console.warn("公式PDF以外を拒否:", url);
      return null;
    }

    // ② PDF取得
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/pdf"
      }
    });

    // ③ リダイレクト先確認
    if (!response.ok) {
      console.warn("PDF取得失敗:", response.status);
      return null;
    }

    if (!isOfficialPdfUrl(response.url)) {
      console.warn("PDFのリダイレクト先が不正:", response.url);
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

    // ⑥ バッファ取得
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

    // ⑦ PDF解析
    const parsedPdf = await pdfParse(buffer, {
      max: MAX_PAGES
    });

    // ⑧ 本文整形
    const content = cleanPdfText(
      parsedPdf.text
    );

    // ⑨ 本文品質確認
    if (!validatePdfText(content)) {
      console.warn("PDF本文の品質不足:", {
        url,
        characters: content.length
      });

      return null;
    }

    // ⑩ 解析結果
    const result = {
      content,
      pages: parsedPdf.numpages || 0,
      source: response.url
    };

    console.log("PDF解析成功:", {
      source: result.source,
      pages: result.pages,
      extractedCharacters: result.content.length
    });

    return result;

  } catch (error) {

    console.error("PDF解析エラー:", {
      url,
      message: error.message
    });

    return null;
  }
}
