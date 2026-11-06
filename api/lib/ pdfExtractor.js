
import pdfParse from "pdf-parse";

const SCHOOL_HOST = "yameth.fku.ed.jp";
const MAX_PDF_SIZE = 8 * 1024 * 1024;
const MAX_PAGES = 25;
const TIMEOUT_MS = 10000;

export async function extractOfficialPdf(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== SCHOOL_HOST
    ) {
      return null;
    }

    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/pdf"
      }
    });

    const finalUrl = new URL(response.url);

    if (
      !response.ok ||
      finalUrl.protocol !== "https:" ||
      finalUrl.hostname !== SCHOOL_HOST
    ) {
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("pdf")) {
      return null;
    }

    const contentLength = Number(
      response.headers.get("content-length") || 0
    );

    if (contentLength > MAX_PDF_SIZE) {
      return null;
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (
      buffer.length > MAX_PDF_SIZE ||
      buffer.length < 5 ||
      buffer.subarray(0, 5).toString() !== "%PDF-"
    ) {
      return null;
    }

    const parsedPdf = await pdfParse(buffer, {
      max: MAX_PAGES
    });

    const content = String(
      parsedPdf.text || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    if (content.length < 50) {
      console.log("PDF本文が不足:", url);

      return null;
    }

    return {
      content,
      pages: parsedPdf.numpages || 0,
      source: finalUrl.href
    };

  } catch (error) {
    console.error(
      "PDF解析エラー:",
      url,
      error.message
    );

    return null;
  }
}
