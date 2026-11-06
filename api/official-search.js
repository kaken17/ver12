
const SCHOOL_URL = "https://yameth.fku.ed.jp/";
const SCHOOL_HOST = "yameth.fku.ed.jp";

const MAX_PAGES = 15;
const MAX_DEPTH = 3;
const MAX_CONTENT_LENGTH = 10000;
const TIMEOUT_MS = 8000;

const CATEGORY_TERMS = {
  学科: [
    "学科", "各科紹介", "電子機械", "IT自動車",
    "自動車", "電気科", "情報技術", "土木科",
    "工業化学", "学習内容"
  ],
  部活動: [
    "部活動", "部活", "ラグビー", "野球",
    "陸上", "弓道", "相撲", "研究部",
    "eスポーツ", "工業系大会"
  ],
  資格: [
    "資格", "検定", "取得", "電気工事士",
    "自動車整備士", "ジュニアマイスター"
  ],
  進路: [
    "進路", "就職", "進学", "大学",
    "企業", "卒業後", "進路状況"
  ],
  入試: [
    "入試", "募集要項", "受験", "選抜",
    "募集人数", "入学者"
  ],
  学費: [
    "学費", "授業料", "入学金", "納入金"
  ],
  学校行事: [
    "学校行事", "文化祭", "体育祭",
    "修学旅行", "行事予定"
  ],
  アクセス: [
    "アクセス", "所在地", "住所", "交通"
  ],
  学校概要: [
    "学校概要", "学校紹介", "教育方針",
    "特色", "沿革", "校長", "八工News"
  ]
};

// =====================================
// HTMLからテキストを取得
// =====================================

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-zA-Z0-9#]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// =====================================
// URLを安全な形式に統一
// =====================================

function normalizeUrl(value, base = SCHOOL_URL) {
  try {
    const url = new URL(value, base);

    if (
      url.protocol !== "https:" ||
      url.hostname !== SCHOOL_HOST ||
      url.username ||
      url.password
    ) {
      return null;
    }

    url.hash = "";

    return url.href;
  } catch {
    return null;
  }
}

// =====================================
// リンクを抽出
// =====================================

function extractLinks(html, baseUrl) {
  const links = [];
  const pdfs = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const url = normalizeUrl(match[1], baseUrl);

    if (!url) continue;

    const title = htmlToText(match[2]);

    if (!title || title.length < 2) continue;

    if (/\.pdf(?:$|[?#])/i.test(url)) {
      if (!pdfs.some(item => item.url === url)) {
        pdfs.push({ title, url });
      }
      continue;
    }

    if (
      /\.(jpg|jpeg|png|gif|zip|xlsx?|docx?)$/i.test(url)
    ) {
      continue;
    }

    if (!links.some(item => item.url === url)) {
      links.push({ title, url });
    }
  }

  return { links, pdfs };
}

// =====================================
// 関連度を計算
// =====================================

function rankLinks(links, question, category) {
  const terms = [
    ...(CATEGORY_TERMS[category] || []),
    ...String(question)
      .normalize("NFKC")
      .split(/[\s、。？！?]+/)
      .filter(word => word.length >= 2)
  ];

  return links
    .map(link => {
      const text = (
        link.title + " " + link.url
      ).toLowerCase();

      let score = 0;

      for (const term of terms) {
        if (text.includes(term.toLowerCase())) {
          score += term.length >= 4 ? 10 : 5;
        }
      }

      // 学校情報の主要ページを優先
      if (/学科|各科紹介/.test(link.title)) {
        if (category === "学科") score += 30;
      }

      if (/部活動|工業系大会/.test(link.title)) {
        if (category === "部活動") score += 30;
      }

      if (/進路/.test(link.title)) {
        if (category === "進路") score += 30;
      }

      if (/八工news|ニュース/i.test(link.title)) {
        score += 10;
      }

      return {
        ...link,
        score
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

// =====================================
// ページ取得
// =====================================

async function fetchPage(url) {
  try {
    const safeUrl = normalizeUrl(url);

    if (!safeUrl) return null;

    const response = await fetch(safeUrl, {
      headers: {
        "User-Agent": "ver12-school-information-bot/1.0",
        "Accept": "text/html"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    // リダイレクト先も公式ドメインか確認
    const finalUrl = normalizeUrl(response.url);

    if (!finalUrl || !response.ok) {
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();

    if (html.length > 1500000) {
      return null;
    }

    return {
      html,
      text: htmlToText(html),
      url: finalUrl
    };

  } catch (error) {
    console.error(
      "公式ページ取得エラー:",
      url,
      error.message
    );

    return null;
  }
}

// =====================================
// 公式サイト2〜3階層自動巡回
// =====================================

export async function searchOfficialWebsite(
  question,
  category = "学校概要"
) {
  const visited = new Set();
  const queue = [
    {
      url: SCHOOL_URL,
      title: "八女工業高等学校公式サイト",
      depth: 0
    }
  ];

  const results = [];
  const pdfMap = new Map();

  while (
    queue.length > 0 &&
    visited.size < MAX_PAGES
  ) {
    const current = queue.shift();

    const safeUrl = normalizeUrl(current.url);

    if (!safeUrl || visited.has(safeUrl)) {
      continue;
    }

    visited.add(safeUrl);

    const page = await fetchPage(safeUrl);

    if (!page) continue;

    // トップページ以外を検索結果に追加
    if (current.depth > 0 && page.text.length >= 50) {
      results.push({
        title: current.title,
        category,
        content: page.text.slice(
          0,
          MAX_CONTENT_LENGTH
        ),
        source: page.url,
        source_date: null,
        origin: "official_website",
        depth: current.depth
      });
    }

    // ページ内リンクとPDFリンクを取得
    const extracted = extractLinks(
      page.html,
      page.url
    );

    for (const pdf of extracted.pdfs) {
      pdfMap.set(pdf.url, pdf);
    }

    // 最大階層に到達したら終了
    if (current.depth >= MAX_DEPTH) {
      continue;
    }

    // 未訪問ページを関連度順に並べる
    const candidates = rankLinks(
      extracted.links,
      question,
      category
    );

    // 1ページから最大8リンクを次の候補にする
    for (const link of candidates.slice(0, 8)) {
      if (
        !visited.has(link.url) &&
        !queue.some(item => item.url === link.url)
      ) {
        queue.push({
          url: link.url,
          title: link.title,
          depth: current.depth + 1
        });
      }
    }

    console.log("公式サイト巡回:", {
      title: current.title,
      depth: current.depth,
      foundLinks: extracted.links.length,
      foundPdfs: extracted.pdfs.length,
      visitedPages: visited.size
    });
  }

  // ===================================
  // 最終結果を関連度順に整理
  // ===================================

  const rankedResults = results
    .map(doc => {
      const ranked = rankLinks(
        [{
          title: doc.title,
          url: doc.source
        }],
        question,
        category
      );

      return {
        doc,
        score: ranked[0]?.score || 0
      };
    })
    .sort((a, b) => b.score - a.score);

  const finalResults = rankedResults
    .slice(0, 8)
    .map(item => item.doc);

  console.log("公式サイト検索完了:", {
    category,
    visitedPages: visited.size,
    htmlResults: finalResults.length,
    discoveredPdfs: pdfMap.size,
    resultTitles: finalResults.map(
      item => item.title
    )
  });

  return finalResults;
}
