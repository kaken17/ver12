
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const ROOT = "https://yameth.fku.ed.jp/";
const HOST = new URL(ROOT).hostname;
const MAX_PAGES = 12;

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

async function getText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "YameSchoolGuideBot/1.0 (school information collector)",
      "Accept": "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(8000),
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const finalUrl = new URL(response.url);

  if (finalUrl.hostname !== HOST) {
    throw new Error("別ドメインへのリダイレクトを拒否しました");
  }

  const type = response.headers.get("content-type") || "";

  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
    throw new Error("HTMLではないためスキップしました");
  }

  return await response.text();
}

async function getAllowedPaths() {
  const robotsUrl = new URL("/robots.txt", ROOT);
  const response = await fetch(robotsUrl, {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error("robots.txtを確認できません。収集を中止します");
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/);
  let applies = false;
  let disallow = [];

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === "yameschoolguidebot";
    } else if (key === "disallow" && applies && value) {
      disallow.push(value);
    }
  }

  return (url) => {
    const path = new URL(url).pathname;
    return !disallow.some((rule) => path.startsWith(rule));
  };
}

function cleanPage(html, url) {
  const $ = cheerio.load(html);

  $("script, style, noscript, nav, footer, header, iframe, form").remove();

  const title = $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url;

  const content = $("main").text().trim() ||
    $("article").text().trim() ||
    $("body").text().trim();

  return {
    url,
    title: title.slice(0, 300),
    content: content.replace(/\s+/g, " ").slice(0, 12000),
    source_date: null,
    fetched_at: new Date().toISOString()
  category: "公式サイト",
   return {
      url,
      title: title.slice(0, 300),
      category: "公式サイト",
      content: content.replace(/\s+/g, " ").slice(0, 12000),
      source_date: null,
      fetched_at: new Date().toISOString()
    };
  }; 
}

async function collectUrls(isAllowed) {
  const found = new Set([ROOT]);
  const sitemapUrls = [
    new URL("/sitemap.xml", ROOT).href,
    new URL("/sitemap_index.xml", ROOT).href
  ];

  for (const sitemap of sitemapUrls) {
    try {
      const response = await fetch(sitemap, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) continue;

      const xml = await response.text();
      const urls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)]
        .map((match) => match[1].trim());

      for (const item of urls) {
        try {
          const url = new URL(item);

          if (
            url.hostname === HOST &&
            url.protocol === "https:" &&
            isAllowed(url.href) &&
            !/\.(pdf|jpg|jpeg|png|gif|zip|mp4|docx?)$/i.test(url.pathname)
          ) {
            found.add(url.href);
          }
        } catch {}
      }

      if (found.size > 1) break;
    } catch {}
  }

  // サイトマップがない場合はトップページのリンクから探す
  if (found.size === 1) {
    try {
      const html = await getText(ROOT);
      const $ = cheerio.load(html);

      $("a[href]").each((_, element) => {
        try {
          const url = new URL($(element).attr("href"), ROOT);
          url.hash = "";

          if (
            url.hostname === HOST &&
            url.protocol === "https:" &&
            isAllowed(url.href) &&
            !/\.(pdf|jpg|jpeg|png|gif|zip|mp4|docx?)$/i.test(url.pathname)
          ) {
            found.add(url.href);
          }
        } catch {}
      });
    } catch {}
  }

  return [...found].slice(0, MAX_PAGES);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const secret = process.env.CRON_SECRET;

  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();
    const isAllowed = await getAllowedPaths();
    const urls = await collectUrls(isAllowed);

    const documents = [];
    const errors = [];

    for (const url of urls) {
      try {
        const html = await getText(url);
        const doc = cleanPage(html, url);

        if (doc.content.length < 80) continue;

        documents.push(doc);
      } catch (error) {
        errors.push({
          url,
          message: String(error.message || error).slice(0, 200)
        });
      }
    }

    if (documents.length > 0) {
      const { error } = await supabase
        .from("school_documents")
        .upsert(documents, { onConflict: "url" });

      if (error) throw error;
    }

    return res.status(200).json({
      ok: true,
      found: urls.length,
      savedOrUpdated: documents.length,
      errors
    });
  } catch (error) {
    console.error("School crawler error:", error);

    return res.status(500).json({
      error: "資料の収集に失敗しました"
    });
  }
}
