import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// 八女工業高等学校 公式サイト
const ROOT = "https://yameth.fku.ed.jp/";
const HOST = new URL(ROOT).hostname;

// =============================================
// 八女工業高校 情報収集エンジン
// 完全統合版
// =============================================

const require = createRequire(import.meta.url);

const workerPath = require.resolve(
  "pdfjs-dist/legacy/build/pdf.worker.mjs"
);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pathToFileURL(workerPath).href;

// =============================================
// 基本設定
// =============================================

const USER_AGENT =
  "YameSchoolGuideBot/1.0";

const MAX_RUN_MS = 8500;
const SOURCE_BUDGET_MS = 6000;

const REQUEST_TIMEOUT_MS = 1800;

const MAX_PAGES_PER_SOURCE = 6;
const MAX_PDF_PAGES = 8;

// 1回の実行で確認する子サイトマップ数
const MAX_SITEMAPS = 3;

const MAX_SOURCES_PER_RUN = 2;
// =============================================
// Supabase
// =============================================

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase環境変数が設定されていません"
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

// =============================================
// 時間管理
// =============================================

function remainingTime(deadline) {
  return Math.max(0, deadline - Date.now());
}

function createDeadline(startedAt) {
  return Math.min(
    Date.now() + SOURCE_BUDGET_MS,
    startedAt + MAX_RUN_MS
  );
}

// =============================================
// URL安全確認
// =============================================

function validateURL(value, source) {
  const url = new URL(value, source.base_url);
  const base = new URL(source.base_url);

  url.hash = "";

  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "許可されていないURLです"
    );
  }

  return url;
}

function isPDF(url) {
  return /\.pdf$/i.test(
    new URL(url).pathname
  );
}

function isExcludedFile(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|pptx?|css|js|woff2?)$/i
    .test(new URL(url).pathname);
}

// =============================================
// HTTP取得
// =============================================

async function safeFetch(
  value,
  source,
  accept,
  deadline,
  timeout = REQUEST_TIMEOUT_MS
) {
  const url = validateURL(value, source);

  const remaining = remainingTime(deadline);

  if (remaining < 300) {
    throw new Error(
      "実行時間の上限に達しました"
    );
  }

  const response = await fetch(url.href, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": accept || "*/*"
    },
    redirect: "manual",
    signal: AbortSignal.timeout(
      Math.min(timeout, remaining)
    )
  });

  if (
    response.status >= 300 &&
    response.status < 400
  ) {
    throw new Error(
      "リダイレクトを拒否しました"
    );
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return response;
}

// =============================================
// サイズ制限付き読み込み
// =============================================

async function readLimited(response, maxSize) {
  if (!response.body) {
    throw new Error(
      "レスポンス本文がありません"
    );
  }

  const reader = response.body.getReader();

  const chunks = [];

  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.length;

      if (total > maxSize) {
        await reader.cancel();

        throw new Error(
          "ファイルサイズ上限を超えました"
        );
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

// =============================================
// HTML取得
// =============================================

async function getHTML(url, source, deadline) {
  const response = await safeFetch(
    url,
    source,
    "text/html,application/xhtml+xml",
    deadline
  );

  const type = (
    response.headers.get("content-type") || ""
  ).toLowerCase();

  if (
    !type.includes("text/html") &&
    !type.includes("application/xhtml+xml")
  ) {
    throw new Error(
      "HTML以外のファイルです"
    );
  }

  const buffer = await readLimited(
    response,
    MAX_HTML_SIZE
  );

  return buffer.toString("utf8");
}

// =============================================
// robots.txt
// =============================================

function robotsPatternMatches(pattern, pathname) {
  let escaped = pattern.replace(
    /[.+?^${}()|[\]\\]/g,
    "\\$&"
  );

  escaped = escaped.replace(/\*/g, ".*");

  if (escaped.endsWith("\\$")) {
    escaped = escaped.slice(0, -2) + "$";
  } else {
    escaped += ".*";
  }

  try {
    return new RegExp("^" + escaped).test(pathname);
  } catch {
    return false;
  }
}

async function getRobotsRules(source, deadline) {
  const robotsURL = new URL(
    "/robots.txt",
    source.base_url
  ).href;

  const url = validateURL(
    robotsURL,
    source
  );

  const remaining = remainingTime(deadline);

  if (remaining < 300) {
    throw new Error(
      "robots.txt確認時間が不足しています"
    );
  }

  let response;

  try {
    response = await fetch(url.href, {
      headers: {
        "User-Agent": USER_AGENT
      },
      redirect: "manual",
      signal: AbortSignal.timeout(
        Math.min(REQUEST_TIMEOUT_MS, remaining)
      )
    });
  } catch {
    throw new Error(
      "robots.txtを取得できません"
    );
  }

  // robots.txtが存在しない場合
  if (response.status === 404) {
    return () => true;
  }

  // 403や5xxなどは安全側で停止
  if (!response.ok) {
    throw new Error(
      `robots.txt HTTP ${response.status}`
    );
  }

  if (
    response.status >= 300 &&
    response.status < 400
  ) {
    throw new Error(
      "robots.txtのリダイレクトを拒否しました"
    );
  }

  const text = (
    await readLimited(response, 100 * 1024)
  ).toString("utf8");

  const groups = [];

  let agents = [];
  let rules = [];

  function saveGroup() {
    if (agents.length > 0) {
      groups.push({
        agents,
        rules
      });
    }
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();

    if (!line || !line.includes(":")) {
      continue;
    }

    const index = line.indexOf(":");

    const key = line
      .slice(0, index)
      .trim()
      .toLowerCase();

    const value = line
      .slice(index + 1)
      .trim();

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
      rules.push({
        type: key,
        path: value
      });
    }
  }

  saveGroup();

  const matching = groups.filter(group =>
    group.agents.includes("yameschoolguidebot")
  );

  const selected = matching.length
    ? matching
    : groups.filter(group =>
        group.agents.includes("*")
      );

  const selectedRules = selected.flatMap(
    group => group.rules
  );

  return value => {
    const pathname = new URL(value).pathname;

    const matches = selectedRules
      .filter(rule =>
        robotsPatternMatches(
          rule.path,
          pathname
        )
      )
      .sort((a, b) => {
        if (b.path.length !== a.path.length) {
          return b.path.length - a.path.length;
        }

        if (a.type === "allow") return -1;
        if (b.type === "allow") return 1;

        return 0;
      });

    return (
      matches.length === 0 ||
      matches[0].type === "allow"
    );
  };
}

// =============================================
// HTML解析
// =============================================

function cleanHTML(html, url, source) {
  const $ = cheerio.load(html);

  $(
    "script,style,noscript,nav,footer,header,iframe,form,svg"
  ).remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url;

  const content =
    $("main").text().trim() ||
    $("article").text().trim() ||
    $("body").text().trim();

  const sourceDate =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="date"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    null;

  return {
    url,
    title: title.slice(0, 300),

    content: content
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_LENGTH),

    category: source.category || "未分類",

    source_date: sourceDate,

    content_type: "html"
  };
}

// =============================================
// PDF取得
// =============================================

async function getPDFBuffer(url, source, deadline) {
  const response = await safeFetch(
    url,
    source,
    "application/pdf",
    deadline,
    2500
  );

  const contentLength = Number(
    response.headers.get("content-length") || 0
  );

  if (contentLength > MAX_PDF_SIZE) {
    throw new Error(
      "PDFが10MBを超えています"
    );
  }

  const buffer = await readLimited(
    response,
    MAX_PDF_SIZE
  );

  if (
    buffer.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new Error(
      "PDFファイルではありません"
    );
  }

  return buffer;
}

// =============================================
// PDF本文抽出
// =============================================

async function extractPDF(url, source, deadline) {
  const buffer = await getPDFBuffer(
    url,
    source,
    deadline
  );

  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  });

  const document = await task.promise;

  const pages = [];

  try {
    const limit = Math.min(
      document.numPages,
      MAX_PDF_PAGES
    );

    for (let i = 1; i <= limit; i++) {
      if (remainingTime(deadline) < 500) {
        break;
      }

      const page = await document.getPage(i);

      const text = await page.getTextContent();

      pages.push(
        text.items
          .map(item => item.str || "")
          .join(" ")
      );

      page.cleanup();
    }

    const content = pages
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();

    if (!content) {
      throw new Error(
        "PDF本文を抽出できません。画像PDFの可能性があります"
      );
    }

    return content.slice(
      0,
      MAX_CONTENT_LENGTH
    );

  } finally {
    await document.destroy();
  }
}

// =============================================
// PDF情報整理
// =============================================

async function cleanPDF(url, source, deadline) {
  const content = await extractPDF(
    url,
    source,
    deadline
  );

  let filename =
    new URL(url).pathname.split("/").pop() ||
    "学校資料.pdf";

  try {
    filename = decodeURIComponent(filename);
  } catch {
    // 元の名前を使用
  }

  return {
    url,
    title: filename.slice(0, 300),
    content,
    category: source.category || "未分類",
    source_date: null,
    content_type: "pdf"
  };
}

// =============================================
// RSS・Atom解析
// =============================================

function parseFeed(xml, source) {
  const $ = cheerio.load(xml, {
    xmlMode: true
  });

  const entries = [];

  $("item,entry").each((_, element) => {
    const node = $(element);

    const title = node
      .find("title")
      .first()
      .text()
      .trim();

    const linkNode = node
      .find("link")
      .first();

    const alternate = node
      .find('link[rel="alternate"]')
      .first();

    const link =
      alternate.attr("href") ||
      linkNode.attr("href") ||
      linkNode.text().trim();

    const content = node
      .find("description,summary,content")
      .first()
      .text()
      .trim();

    const date = node
      .find("pubDate,published,updated")
      .first()
      .text()
      .trim();

    if (!title || !link) {
      return;
    }

    try {
      const url = validateURL(
        link,
        source
      ).href;

      entries.push({
        url,
        title: title.slice(0, 300),
        content: content.slice(
          0,
          MAX_CONTENT_LENGTH
        ),
        category: source.category || "未分類",
        source_date: date || null,
        content_type: "feed"
      });

    } catch {
      // 許可されていないリンクは除外
    }
  });

  return entries.slice(0, MAX_FEED_ENTRIES);
}

// =============================================
// RSS・Atom自動発見
// =============================================

function discoverFeeds(html, source, allowed) {
  const $ = cheerio.load(html);

  const feeds = new Set();

  $('link[rel="alternate"][href]').each(
    (_, element) => {
      const node = $(element);

      const type = (
        node.attr("type") || ""
      ).toLowerCase();

      if (
        !type.includes("rss") &&
        !type.includes("atom") &&
        !type.includes("xml")
      ) {
        return;
      }

      try {
        const url = validateURL(
          node.attr("href"),
          source
        ).href;

        if (allowed(url)) {
          feeds.add(url);
        }

      } catch {
        // 不正URLを除外
      }
    }
  );

  return [...feeds];
}

// =============================================
// サイトマップ解析
// =============================================

function extractSitemapLocations(xml) {
  return [
    ...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)
  ].map(match =>
    match[1]
      .trim()
      .replace(/&amp;/g, "&")
  );
}

async function collectSitemapURLs(
  source,
  allowed,
  deadline
) {
  const found = new Set();

  const base = new URL(source.base_url);

  const sitemapCandidates = [
    new URL("/sitemap.xml", base).href,
    new URL("/sitemap_index.xml", base).href
  ];

  let checkedSitemaps = 0;

  for (const sitemap of sitemapCandidates) {
    if (remainingTime(deadline) < 700) {
      break;
    }

    try {
      const response = await safeFetch(
        sitemap,
        source,
        "application/xml,text/xml",
        deadline
      );

      const xml = (
        await readLimited(response, MAX_HTML_SIZE)
      ).toString("utf8");

      const locations = extractSitemapLocations(xml);

      for (const location of locations) {
        if (
          checkedSitemaps >= MAX_SITEMAPS ||
          remainingTime(deadline) < 700
        ) {
          break;
        }

        // サイトマップの中に別のサイトマップがある場合
        if (/\.xml(?:\?|$)/i.test(location)) {
          try {
            const childURL = validateURL(
              location,
              source
            ).href;

            if (
              !allowed(childURL) ||
              childURL === sitemap
            ) {
              continue;
            }

            checkedSitemaps++;

            const childResponse = await safeFetch(
              childURL,
              source,
              "application/xml,text/xml",
              deadline
            );

            const childXML = (
              await readLimited(
                childResponse,
                MAX_HTML_SIZE
              )
            ).toString("utf8");

            for (const childLocation of extractSitemapLocations(childXML)) {
              try {
                const url = validateURL(
                  childLocation,
                  source
                ).href;

                if (
                  allowed(url) &&
                  !isExcludedFile(url)
                ) {
                  found.add(url);
                }
              } catch {
                // 無効URLを除外
              }
            }

          } catch {
            // 個別サイトマップの失敗はスキップ
          }

          continue;
        }

        try {
          const url = validateURL(
            location,
            source
          ).href;

          if (
            allowed(url) &&
            !isExcludedFile(url)
          ) {
            found.add(url);
          }

        } catch {
          // 無効URLを除外
        }
      }

      if (found.size > 0) {
        break;
      }

    } catch {
      // 次のサイトマップを確認
    }
  }

  return [...found];
}

// =============================================
// URL収集（サイトマップ優先）
// =============================================

async function collectURLs(
  source,
  allowed,
  deadline
) {
  const found = new Set();
  const feeds = new Set();

  const baseURL = new URL(
    source.base_url
  ).href;

  // ① 最初にサイトマップからURLを収集
  try {
    console.log("[CRAWL] Sitemap collection started", {
      source: source.name,
      remaining_ms: remainingTime(deadline)
    });

    const sitemapURLs = await collectSitemapURLs(
      source,
      allowed,
      deadline
    );

    for (const url of sitemapURLs) {
      found.add(url);
    }

    console.log("[CRAWL] Sitemap collection finished", {
      source: source.name,
      url_count: found.size,
      remaining_ms: remainingTime(deadline)
    });

  } catch (error) {
    console.error(
      "[CRAWL] Sitemap collection error:",
      error.message
    );
  }

  // ② 時間に余裕がある場合だけトップページを調査
  if (remainingTime(deadline) > 1800) {
    try {
      if (allowed(baseURL)) {
        const html = await getHTML(
          baseURL,
          source,
          deadline
        );

        const $ = cheerio.load(html);

        for (const feed of discoverFeeds(
          html,
          source,
          allowed
        )) {
          feeds.add(feed);
        }

        $("a[href]").each((_, element) => {
          try {
            const url = validateURL(
              $(element).attr("href"),
              source
            ).href;

            if (
              !isExcludedFile(url) &&
              allowed(url)
            ) {
              found.add(url);
            }
          } catch {
            // 無効URLを除外
          }
        });
      }

    } catch (error) {
      console.error(
        "[CRAWL] Homepage collection error:",
        error.message
      );
    }
  }

  // ③ トップページも候補に加える
  if (allowed(baseURL)) {
    found.add(baseURL);
  }

  const urls = [...found].slice(
    0,
    Math.min(
      Number(source.max_pages) || 4,
      MAX_PAGES_PER_SOURCE
    )
  );

  console.log("[CRAWL] URL collection completed", {
    source: source.name,
    collected_count: found.size,
    selected_count: urls.length,
    remaining_ms: remainingTime(deadline)
  });

  return {
    urls,
    feeds: [...feeds]
  };
}
// =============================================
// カテゴリー分類
// =============================================

function classify(title, content, fallback) {
  const text = `${title} ${content}`;

  const rules = [
    [
      "進路・就職",
      /進路|就職|採用|求人|進学|大学|専門学校/
    ],
    [
      "資格・検定",
      /資格|検定|国家試験|技能講習/
    ],
    [
      "工業・技術",
      /機械|電気|建築|土木|製造|ロボット|情報技術/
    ],
    [
      "部活動・大会",
      /部活動|大会|競技|コンクール/
    ],
    [
      "教育行政",
      /教育委員会|文部科学省|教育課程/
    ],
    [
      "地域・企業",
      /八女市|筑後|企業|産業|地域イベント/
    ]
  ];

  const tags = rules
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);

  return {
    category: tags[0] || fallback || "未分類",
    tags
  };
}

// =============================================
// 重要度判定
// =============================================

function calculateImportance(
  source,
  title,
  content
) {
  const text = `${title} ${content}`;

  let score = Number(source.priority) || 50;

  if (
    /重要|緊急|募集開始|締切|変更|中止/.test(text)
  ) {
    score += 10;
  }

  if (
    /進路|就職|資格|試験|入試/.test(text)
  ) {
    score += 10;
  }

  return Math.min(
    Math.max(score, 0),
    100
  );
}

// =============================================
// SHA-256
// =============================================

function makeHash(title, content) {
  return crypto
    .createHash("sha256")
    .update(`${title}\n${content}`)
    .digest("hex");
}

// =============================================
// Supabase保存
// =============================================

async function saveDocument(
  db,
  source,
  item
) {
  const content = (
    item.content || ""
  ).trim();

  if (content.length < MIN_CONTENT_LENGTH) {
    return "skipped";
  }

  const hash = makeHash(
    item.title,
    content
  );

  const now = new Date().toISOString();

  const { data: old, error: lookupError } =
    await db
      .from("school_documents")
      .select("id,title,content,content_hash")
      .eq("url", item.url)
      .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  // 既存データの内容を比較
  if (old) {
    const oldHash = old.content_hash ||
      makeHash(
        old.title || "",
        old.content || ""
      );

    // 内容が同じ場合は更新せず確認時刻だけ更新
    if (oldHash === hash) {
      const { error } = await db
        .from("school_documents")
        .update({
          content_hash: hash,
          last_seen_at: now,
          source_id: source.id
        })
        .eq("id", old.id);

      if (error) throw error;

      return "skipped";
    }

    // 更新前の本文を履歴に保存
    const { error: historyError } = await db
      .from("document_versions")
      .insert({
        document_id: old.id,
        document_url: item.url,
        title: old.title || "",
        content: old.content || "",
        content_hash: oldHash
      });

    if (historyError) {
      throw historyError;
    }
  }

  const labels = classify(
    item.title,
    content,
    source.category
  );

  const row = {
    url: item.url,

    title: item.title,

    content,

    category: labels.category,

    source_date: item.source_date || null,

    fetched_at: now,

    source_id: source.id,

    content_hash: hash,

    last_seen_at: now,

    updated_at: now,

    importance: calculateImportance(
      source,
      item.title,
      content
    ),

    tags: labels.tags,

    content_type: item.content_type || "html"
  };

  const { error } = await db
    .from("school_documents")
    .upsert(row, {
      onConflict: "url"
    });

  if (error) {
    throw error;
  }

  return old ? "updated" : "new";
}

// =============================================
// RSS・Atom収集
// =============================================

async function crawlFeed(
  feedURL,
  source,
  allowed,
  db,
  stats,
  deadline
) {
  if (!allowed(feedURL)) {
    throw new Error(
      "robots.txtでRSS取得が禁止されています"
    );
  }

  const response = await safeFetch(
    feedURL,
    source,
    "application/rss+xml,application/atom+xml,application/xml,text/xml",
    deadline
  );

  const xml = (
    await readLimited(
      response,
      MAX_HTML_SIZE
    )
  ).toString("utf8");

  const entries = parseFeed(
    xml,
    source
  );

  for (const item of entries) {
    if (remainingTime(deadline) < 400) {
      break;
    }

    stats.found++;

    try {
      const result = await saveDocument(
        db,
        source,
        item
      );

      stats[result]++;

    } catch (error) {
      stats.errors++;

      console.error(
        "RSS保存エラー:",
        error.message
      );
    }
  }
}

// =============================================
// HTML・PDF巡回
// =============================================

async function crawlPages(
  source,
  allowed,
  db,
  stats,
  deadline,
  urls
) {
  for (const url of urls) {
    if (remainingTime(deadline) < 500) {
      break;
    }

    stats.found++;

    try {
      let item;

      if (isPDF(url)) {
        item = await cleanPDF(
          url,
          source,
          deadline
        );
      } else {
        const html = await getHTML(
          url,
          source,
          deadline
        );

        item = cleanHTML(
          html,
          url,
          source
        );
      }

      const result = await saveDocument(
        db,
        source,
        item
      );

      stats[result]++;

    } catch (error) {
      stats.errors++;

      console.error(
        "ページ収集エラー:",
        url,
        error.message
      );
    }
  }
}

// =============================================
// 統計
// =============================================

function emptyStats() {
  return {
    found: 0,
    new: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };
}

// =============================================
// 情報源ごとの収集
// =============================================

async function processSource(
  db,
  source,
  startedAt
) {
  const stats = emptyStats();

  const sourceStartedAt = Date.now();

  const deadline = createDeadline(
    startedAt
  );

  const { data: log, error: logError } =
    await db
      .from("crawl_logs")
      .insert({
        source_id: source.id,
        source_name: source.name,
        status: "running"
      })
      .select("id")
      .single();

  if (logError) {
    throw logError;
  }

  try {
    // robots.txt確認
    const allowed = await getRobotsRules(
      source,
      deadline
    );

    const type = (
      source.source_type || "html"
    ).toLowerCase();

    if (
      type === "rss" ||
      type === "atom"
    ) {
      await crawlFeed(
        source.feed_url,
        source,
        allowed,
        db,
        stats,
        deadline
      );

    } else {
      const collected = await collectURLs(
        source,
        allowed,
        deadline
      );

      // RSS・Atom
      const feedURLs = new Set(
        collected.feeds
      );

      if (source.feed_url) {
        try {
          const url = validateURL(
            source.feed_url,
            source
          ).href;

          feedURLs.add(url);
        } catch {
          console.error(
            "不正なfeed_url:",
            source.name
          );
        }
      }

      for (const feedURL of feedURLs) {
        if (remainingTime(deadline) < 600) {
          break;
        }

        try {
          await crawlFeed(
            feedURL,
            source,
            allowed,
            db,
            stats,
            deadline
          );
        } catch (error) {
          stats.errors++;

          console.error(
            "Feed取得エラー:",
            feedURL,
            error.message
          );
        }
      }

      // HTML・PDF
      await crawlPages(
        source,
        allowed,
        db,
        stats,
        deadline,
        collected.urls
      );
    }

    const now = new Date().toISOString();

    const hasErrors = stats.errors > 0;

    const { error: sourceError } = await db
      .from("sources")
      .update({
        last_crawled_at: now,
        last_success_at: now,
        last_error: hasErrors
          ? `${stats.errors}件の収集エラー`
          : null,
        updated_at: now
      })
      .eq("id", source.id);

    if (sourceError) {
      throw sourceError;
    }

    const { error: logUpdateError } = await db
      .from("crawl_logs")
      .update({
        status: hasErrors
          ? "partial"
          : "completed",

        found_count: stats.found,

        new_count: stats.new,

        updated_count: stats.updated,

        skipped_count: stats.skipped,

        error_count: stats.errors,

        finished_at: now
      })
      .eq("id", log.id);

    if (logUpdateError) {
      throw logUpdateError;
    }

    return {
      source: source.name,
      status: hasErrors
        ? "partial"
        : "completed",
      ...stats,
      elapsed_ms: Date.now() - sourceStartedAt
    };

  } catch (error) {
    const message = String(
      error.message || error
    ).slice(0, 300);

    const now = new Date().toISOString();

    await db
      .from("sources")
      .update({
        last_crawled_at: now,
        last_error: message,
        updated_at: now
      })
      .eq("id", source.id);

    await db
      .from("crawl_logs")
      .update({
        status: "failed",
        error_message: message,
        error_count: stats.errors + 1,
        finished_at: now
      })
      .eq("id", log.id);

    return {
      source: source.name,
      status: "failed",
      error: message,
      ...stats,
      elapsed_ms: Date.now() - sourceStartedAt
    };
  }
}

// =============================================
// メインAPI
// =============================================

export default async function handler(req, res) {
  const startedAt = Date.now();

  // ① APIにアクセスがあった時点で必ず記録
  console.log("[CRAWL] handler started", {
    method: req.method,
    time: new Date().toISOString(),
    hasCronSecret: Boolean(process.env.CRON_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseKey: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  });

  // ② HTTPメソッド確認
  if (req.method !== "GET") {
    console.error("[CRAWL] Invalid method:", req.method);

    return res.status(405).json({
      success: false,
      error: "Method Not Allowed"
    });
  }

  // ③ Cron認証
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization;

  if (!secret) {
    console.error("[CRAWL] CRON_SECRET is missing");

    return res.status(500).json({
      success: false,
      error: "CRON_SECRET is not configured"
    });
  }

  if (authorization !== `Bearer ${secret}`) {
    console.error("[CRAWL] Authorization failed", {
      hasAuthorization: Boolean(authorization)
    });

    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  console.log("[CRAWL] Authorization successful");

  try {
    // ④ Supabase接続
    console.log("[CRAWL] Connecting to Supabase");

    const db = getSupabase();

    // ⑤ 有効な情報源を取得
    const { data: sources, error } = await db
      .from("sources")
      .select("*")
      .eq("enabled", true)
     .order("priority", {
  ascending: false
})
.order("last_crawled_at", {
  ascending: true,
  nullsFirst: true
});

    if (error) {
      console.error("[CRAWL] Source query failed:", error);

      throw error;
    }

    console.log("[CRAWL] Sources loaded", {
      count: sources?.length || 0,
      names: (sources || []).map(source => source.name)
    });

    // ⑥ 情報源を巡回
    const results = [];
    const deferred = [];

    let processed = 0;

    for (const source of sources || []) {
      if (
        processed >= MAX_SOURCES_PER_RUN ||
        Date.now() - startedAt >= MAX_RUN_MS
      ) {
        deferred.push(source.name);
        continue;
      }

      processed++;

      console.log("[CRAWL] Processing source", {
        name: source.name,
        id: source.id
      });

      try {
        const result = await processSource(
          db,
          source,
          startedAt
        );

        results.push(result);

        console.log("[CRAWL] Source finished", result);

      } catch (error) {
        console.error("[CRAWL] Source failed", {
          name: source.name,
          message: error?.message
        });

        results.push({
          source: source.name,
          status: "failed",
          error: String(
            error?.message || error
          ).slice(0, 300)
        });
      }
    }

    // ⑦ 集計
    const totals = results.reduce(
      (total, result) => {
        total.found += result.found || 0;
        total.new += result.new || 0;
        total.updated += result.updated || 0;
        total.skipped += result.skipped || 0;
        total.errors += result.errors || 0;

        return total;
      },
      {
        found: 0,
        new: 0,
        updated: 0,
        skipped: 0,
        errors: 0
      }
    );

    const elapsedMs = Date.now() - startedAt;

    console.log("[CRAWL] Completed", {
      sourceCount: sources?.length || 0,
      processedCount: results.length,
      deferredSources: deferred,
      totals,
      elapsedMs
    });

    // ⑧ 正常終了
    return res.status(200).json({
      success: true,
      source_count: sources?.length || 0,
      processed_count: results.length,
      deferred_sources: deferred,
      elapsed_ms: elapsedMs,
      totals,
      results
    });

  } catch (error) {
    console.error("[CRAWL] Fatal error", {
      message: error?.message,
      stack: error?.stack
    });

    return res.status(500).json({
      success: false,
      error: String(
        error?.message || error
      ).slice(0, 300)
    });
  }
}
