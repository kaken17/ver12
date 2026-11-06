
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = "https://yameth.fku.ed.jp/";
const HOST = new URL(ROOT).hostname;

const MAX_PAGES = 12;
const MAX_PDF_SIZE = 10 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 12000;

const USER_AGENT =
  "YameSchoolGuideBot/1.0 (school information collector)";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabaseの環境変数が未設定です");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

// URLの安全確認
function validateUrl(url) {
  const parsed = new URL(url);

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== HOST ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("許可されていないURLです");
  }

  return parsed;
}

// リダイレクトを許可せず、外部への転送を防ぐ
async function safeFetch(url, accept, timeout = 8000) {
  validateUrl(url);

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: accept
    },
    signal: AbortSignal.timeout(timeout),
    redirect: "manual"
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error("リダイレクトを拒否しました");
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response;
}

// HTML取得
async function getText(url) {
  const response = await safeFetch(
    url,
    "text/html,application/xhtml+xml",
    8000
  );

  const type = response.headers.get("content-type") || "";

  if (
    !type.includes("text/html") &&
    !type.includes("application/xhtml+xml")
  ) {
    throw new Error("HTMLではないためスキップしました");
  }

  return await response.text();
}

// PDF取得・サイズ制限付き読み込み
async function getPdfBuffer(url) {
  const response = await safeFetch(
    url,
    "application/pdf",
    15000
  );

  const contentLength = Number(
    response.headers.get("content-length") || 0
  );

  if (contentLength > MAX_PDF_SIZE) {
    throw new Error("PDFが10MBを超えています");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalSize += value.length;

      if (totalSize > MAX_PDF_SIZE) {
        await reader.cancel();
        throw new Error("PDFが10MBを超えています");
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks);

  if (buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("PDFファイルではありません");
  }

  return buffer;
}

// PDF本文抽出
async function getPdfText(url) {
  const buffer = await getPdfBuffer(url);

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  });

  const document = await loadingTask.promise;

  const pages = [];

  try {
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);

      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map(item => item.str || "")
        .join(" ");

      pages.push(pageText);

      page.cleanup();
    }

    const content = pages
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();

    if (!content) {
      throw new Error(
        "PDFから文章を抽出できません。画像形式のPDFの可能性があります"
      );
    }

    return content;

  } finally {
    await document.destroy();
  }
}

// PDF判定
function isPdfUrl(url) {
  return /\.pdf$/i.test(new URL(url).pathname);
}

// robots.txt確認
async function getAllowedPaths() {
  const robotsUrl = new URL("/robots.txt", ROOT).href;

  const response = await safeFetch(
    robotsUrl,
    "text/plain",
    5000
  );

  const text = await response.text();
  const lines = text.split(/\r?\n/);

  const groups = [];
  let agents = [];
  let rules = [];

  function saveGroup() {
    if (agents.length > 0) {
      groups.push({ agents, rules });
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();

    if (!line) continue;

    const colon = line.indexOf(":");

    if (colon < 0) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (rules.length > 0) {
        saveGroup();
        agents = [];
        rules = [];
      }

      agents.push(value.toLowerCase());
    }

    if (
      (key === "allow" || key === "disallow") &&
      value
    ) {
      rules.push({ type: key, path: value });
    }
  }

  saveGroup();

  const matchingGroups = groups.filter((group) =>
    group.agents.includes("yameschoolguidebot")
  );

  const selectedGroups = matchingGroups.length
    ? matchingGroups
    : groups.filter((group) => group.agents.includes("*"));

  const selectedRules = selectedGroups.flatMap(
    (group) => group.rules
  );

  return (url) => {
    const path = new URL(url).pathname;

    const matches = selectedRules
      .filter((rule) => path.startsWith(rule.path))
      .sort((a, b) => b.path.length - a.path.length);

    if (matches.length === 0) return true;

    // 同じ長さならAllowを優先
    return matches[0].type === "allow";
  };
}

// HTML本文整理
function cleanPage(html, url) {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, nav, footer, header, iframe, form"
  ).remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url;

  const content =
    $("main").text().trim() ||
    $("article").text().trim() ||
    $("body").text().trim();

  return {
    url,
    title: title.slice(0, 300),
    category: "公式サイト",
    content: content
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_LENGTH),
    source_date: null,
    fetched_at: new Date().toISOString()
  };
}

// PDF資料の情報整理
async function cleanPdf(url) {
  const content = await getPdfText(url);

  let filename = new URL(url).pathname.split("/").pop() ||
    "学校資料.pdf";

  try {
    filename = decodeURIComponent(filename);
  } catch {
    // 元のファイル名を使用
  }

  return {
    url,
    title: filename.slice(0, 300),
    category: "公式PDF資料",
    content: content.slice(0, MAX_CONTENT_LENGTH),
    source_date: null,
    fetched_at: new Date().toISOString()
  };
}

// 収集対象外のファイル判定
function isExcludedFile(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|pptx?|xml)$/i
    .test(new URL(url).pathname);
}

// サイトマップ・リンクからURL収集
async function collectUrls(isAllowed) {
  const found = new Set();

  function addUrl(item) {
    try {
      const url = new URL(item, ROOT);

      url.hash = "";

      if (
        url.hostname !== HOST ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        isExcludedFile(url.href) ||
        !isAllowed(url.href)
      ) {
        return;
      }

      found.add(url.href);
    } catch {
      // 不正URLは無視
    }
  }

  const sitemapUrls = [
    new URL("/sitemap.xml", ROOT).href,
    new URL("/sitemap_index.xml", ROOT).href
  ];

  // サイトマップから収集
  for (const sitemap of sitemapUrls) {
    try {
      const response = await safeFetch(
        sitemap,
        "application/xml,text/xml",
        5000
      );

      const xml = await response.text();

      const urls = [
        ...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)
      ].map((match) =>
        match[1]
          .trim()
          .replace(/&amp;/g, "&")
      );

      for (const item of urls) {
        addUrl(item);
      }

      if (found.size > 0) break;
    } catch {
      // 次のサイトマップを確認
    }
  }

  // サイトマップが使えない場合はトップページから収集
  if (found.size === 0) {
    try {
      const html = await getText(ROOT);
      const $ = cheerio.load(html);

      $("a[href]").each((_, element) => {
        addUrl($(element).attr("href"));
      });
    } catch (error) {
      throw new Error(
        `トップページのリンク収集に失敗しました: ${error.message}`
      );
    }
  }

  // トップページも必ず収集対象にする
  addUrl(ROOT);

  return [...found].slice(0, MAX_PAGES);
}

// メイン処理
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "GET only"
    });
  }

  const secret = process.env.CRON_SECRET;

  if (
    !secret ||
    req.headers.authorization !== `Bearer ${secret}`
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    const supabase = getSupabase();

    const isAllowed = await getAllowedPaths();

    const urls = await collectUrls(isAllowed);

    const documents = [];
    const errors = [];

    // HTML・PDFを順番に収集
    for (const url of urls) {
      try {
        let doc;

        if (isPdfUrl(url)) {
          doc = await cleanPdf(url);
        } else {
          const html = await getText(url);
          doc = cleanPage(html, url);
        }

        if (!doc.content || doc.content.length < 80) {
          continue;
        }

        documents.push(doc);

      } catch (error) {
        errors.push({
          url,
          message: String(error.message || error).slice(0, 200)
        });
      }
    }

    // Supabase保存
    if (documents.length > 0) {
      const { error } = await supabase
        .from("school_documents")
        .upsert(documents, {
          onConflict: "url"
        });

      if (error) throw error;
    }

    return res.status(200).json({
      ok: true,
      found: urls.length,
      savedOrUpdated: documents.length,
      htmlCount: documents.filter(
        (doc) => doc.category === "公式サイト"
      ).length,
      pdfCount: documents.filter(
        (doc) => doc.category === "公式PDF資料"
      ).length,
      errors
    });

  } catch (error) {
    console.error("School crawler error:", error);

    return res.status(500).json({
      error: "資料の収集に失敗しました",
      detail: String(error.message || error).slice(0, 300)
    });
  }
}
