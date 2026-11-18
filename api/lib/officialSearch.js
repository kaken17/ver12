
import { extractOfficialPdf } from "./pdfExtractor.js";
import { organizeSchoolDocuments } from "./schoolOrganizer.js";

const SCHOOL_URL = "https://yameth.fku.ed.jp/";
const SCHOOL_HOST = "yameth.fku.ed.jp";

const MAX_PAGES = 15;
const MAX_DEPTH = 5;
const MAX_CONTENT_LENGTH = 10000;
const MAX_PDFS = 6;
const TIMEOUT_MS = 8000;

const CATEGORY_TERMS = {
  学科: [
    "学科", "各科紹介", "電子機械",
    "IT自動車", "自動車", "電気科",
    "情報技術", "土木科", "工業化学",
    "学習内容"
  ],
  部活動: [
    "部活動", "部活", "ラグビー",
    "野球", "陸上", "弓道", "相撲",
    "研究部", "eスポーツ"
  ],
  資格: [
    "資格", "検定", "取得",
    "電気工事士", "自動車整備士",
    "ジュニアマイスター"
  ],
  進路: [
    "進路", "就職", "進学",
    "大学", "企業", "卒業後"
  ],
  入試: [
    "入試", "募集要項", "受験",
    "選抜", "募集人数"
  ],
  学費: [
    "学費", "授業料", "入学金",
    "納入金"
  ],
  学校行事: [
    "学校行事", "文化祭", "体育祭",
    "修学旅行", "行事予定"
  ],
  アクセス: [
    "アクセス", "所在地", "住所",
    "交通", "地図", "電話番号"
  ],
  学校概要: [
    "学校概要", "学校紹介", "教育方針",
    "特色", "沿革", "校長"
  ]
};

const CATEGORY_PATTERNS = {
  学科: /学科|各科紹介|電子機械|電気科|土木科|工業化学|情報技術|IT自動車/,
  部活動: /部活動|クラブ|部紹介|ラグビー|野球|陸上|弓道/,
  資格: /資格|検定|電気工事士|ジュニアマイスター/,
  進路: /進路|就職|進学|大学|企業/,
  入試: /入試|募集要項|選抜|受験/,
  学費: /学費|授業料|入学金|納入金/,
  学校行事: /行事|文化祭|体育祭|修学旅行/,
  アクセス: /アクセス|交通|所在地|地図|住所/,
  学校概要: /学校紹介|学校概要|教育方針|沿革/
};

// =====================================
// 検索語の正規化
// =====================================

function normalizeQuestion(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。？！?・!！,，.．「」『』（）()【】\[\]{}]/g, "")
    .trim();
}

// =====================================
// 検索語の妥当性確認
// =====================================

function isMeaningfulQuestion(question) {
  const normalized = normalizeQuestion(question);

  if (!normalized) return false;

  // 1文字だけの検索語は除外
  if (normalized.length < 2) return false;

  // 意味のない入力や一般的な相づちを除外
  const invalidWords = [
    "あ",
    "ああ",
    "え",
    "ええ",
    "うん",
    "はい",
    "いいえ",
    "テスト",
    "test",
    "aaa",
    "123",
    "検索",
    "教えて",
    "こんにちは",
    "よろしく"
  ];

  if (invalidWords.includes(normalized)) {
    return false;
  }

  // 同じ文字の連続だけの入力を除外
  if (/^(.)\1+$/.test(normalized)) {
    return false;
  }

  return true;
}

// =====================================
// 検索語からキーワードを抽出
// =====================================

function getQuestionTerms(question, category) {
  const normalized = normalizeQuestion(question);

  if (!normalized) return [];

  const terms = new Set();

  // 空白などで分割できる検索語を取得
  const splitTerms = String(question || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s、。？！?・!！,，]+/)
    .filter(term => term.length >= 2);

  for (const term of splitTerms) {
    terms.add(term);
  }

  // カテゴリーのキーワードのうち、
  // 実際に質問に含まれているものだけ追加
  const categoryTerms = CATEGORY_TERMS[category] || [];

  for (const term of categoryTerms) {
    const normalizedTerm = normalizeQuestion(term);

    if (
      normalizedTerm.length >= 2 &&
      normalized.includes(normalizedTerm)
    ) {
      terms.add(normalizedTerm);
    }
  }

  // 日本語の複合語にも対応
  // 例：電気科について → 電気科
  const allTerms = Object.values(CATEGORY_TERMS).flat();

  for (const term of allTerms) {
    const normalizedTerm = normalizeQuestion(term);

    if (
      normalizedTerm.length >= 2 &&
      normalized.includes(normalizedTerm)
    ) {
      terms.add(normalizedTerm);
    }
  }

  return [...terms];
}

// =====================================
// URLの安全確認
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
// HTMLをテキストに変換
// =====================================

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html) {
  return decodeHtml(
    String(html || "")
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
// HTMLリンクとPDFリンクを抽出
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
      pdfs.push({ title, url });
      continue;
    }

    if (/\.(jpg|jpeg|png|gif|zip|xlsx?|docx?)$/i.test(url)) {
      continue;
    }

    links.push({ title, url });
  }

  return {
    links: [
      ...new Map(links.map(item => [item.url, item])).values()
    ],
    pdfs: [
      ...new Map(pdfs.map(item => [item.url, item])).values()
    ]
  };
}

// =====================================
// 関連度判定
// =====================================

function rankLinks(links, question, category) {
  if (!isMeaningfulQuestion(question)) {
    return [];
  }

  const questionTerms = getQuestionTerms(question, category);

  if (questionTerms.length === 0) {
    return [];
  }

  const normalizedQuestion = normalizeQuestion(question);

  const categoryTerms = CATEGORY_TERMS[category] || [];

  // 質問にカテゴリー関連語が含まれる場合のみ
  // カテゴリー判定を有効にする
  const hasCategorySignal = categoryTerms.some(term =>
    normalizedQuestion.includes(normalizeQuestion(term))
  );

  return links
    .map(link => {
      const title = normalizeQuestion(link.title);
      const url = normalizeQuestion(link.url);

      let score = 0;

      for (const term of questionTerms) {
        const keyword = normalizeQuestion(term);

        if (!keyword) continue;

        if (title.includes(keyword)) {
          score += keyword.length >= 4 ? 30 : 20;
        }

        if (url.includes(keyword)) {
          score += 10;
        }
      }

      // 質問自体にカテゴリーの手がかりがある場合のみ加点
      if (
        hasCategorySignal &&
        CATEGORY_PATTERNS[category]?.test(link.title || "")
      ) {
        score += 15;
      }

      if (/八工news|ニュース/i.test(link.title || "")) {
        score += 3;
      }

      return { ...link, score };
    })
    .filter(item => item.score >= 15)
    .sort((a, b) => b.score - a.score);
}

// =====================================
// 本文の関連度判定
// =====================================

function scoreDocument(doc, question, category) {
  const questionTerms = getQuestionTerms(question, category);

  const title = normalizeQuestion(doc.title);
  const content = normalizeQuestion(doc.content);
  const source = normalizeQuestion(doc.source);

  let score = 0;

  for (const term of questionTerms) {
    const keyword = normalizeQuestion(term);

    if (!keyword) continue;

    if (title.includes(keyword)) {
      score += keyword.length >= 4 ? 30 : 20;
    }

    if (content.includes(keyword)) {
      score += 8;
    }

    if (source.includes(keyword)) {
      score += 5;
    }
  }

  // カテゴリー名だけで無関係な資料を採用しない
  if (
    CATEGORY_PATTERNS[category]?.test(doc.title || "") &&
    questionTerms.length > 0
  ) {
    score += 5;
  }

  if (doc.origin === "official_pdf") {
    score += 3;
  }

  return score;
}

// =====================================
// 公式ページ取得
// =====================================

async function fetchPage(url) {
  try {
    const safeUrl = normalizeUrl(url);

    if (!safeUrl) return null;

    const response = await fetch(safeUrl, {
      headers: {
        "User-Agent": "school-information-bot/1.0",
        "Accept": "text/html"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    const finalUrl = normalizeUrl(response.url);

    if (!response.ok || !finalUrl) {
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("text/html")) {
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
// メイン検索関数
// =====================================

export async function searchOfficialWebsite(
  question,
  category = "その他"
) {
  // ① 検索語チェック
  // 無効な質問なら公式サイトにアクセスしない
  if (!isMeaningfulQuestion(question)) {
    console.log("公式サイト検索をスキップ:", {
      question,
      reason: "検索語が短い、または無効"
    });

    return [];
  }

  const questionTerms = getQuestionTerms(question, category);

  if (questionTerms.length === 0) {
    console.log("公式サイト検索をスキップ:", {
      question,
      category,
      reason: "検索キーワードを抽出できない"
    });

    return [];
  }

  const visited = new Set();

  const queue = [{
    url: SCHOOL_URL,
    title: "八女工業高等学校公式サイト",
    depth: 0
  }];

  const results = [];
  const pdfMap = new Map();

  // ② HTML巡回

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

    if (
      current.depth > 0 &&
      page.text.length >= 50
    ) {
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

    const extracted = extractLinks(
      page.html,
      page.url
    );

    for (const pdf of extracted.pdfs) {
      pdfMap.set(pdf.url, pdf);
    }

    if (current.depth >= MAX_DEPTH) {
      continue;
    }

    const candidates = rankLinks(
      extracted.links,
      question,
      category
    );

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
  }

  // ③ PDF解析
  // 関連性の高いPDFだけを解析する

  const rankedPdfs = rankLinks(
    [...pdfMap.values()],
    question,
    category
  );

  const pdfCandidates = rankedPdfs.slice(0, MAX_PDFS);

  for (const pdf of pdfCandidates) {
    try {
      const extractedPdf =
        await extractOfficialPdf(pdf.url);

      if (
        !extractedPdf ||
        !extractedPdf.content ||
        extractedPdf.content.trim().length < 50
      ) {
        continue;
      }

      results.push({
        title: pdf.title,
        category,
        content: extractedPdf.content.slice(
          0,
          MAX_CONTENT_LENGTH
        ),
        source: extractedPdf.source || pdf.url,
        source_date: null,
        origin: "official_pdf",
        depth: 1
      });
    } catch (error) {
      console.error(
        "公式PDF解析エラー:",
        pdf.url,
        error.message
      );
    }
  }

  // ④ 本文も含めて関連度評価

  const rankedResults = results.map(doc => ({
    doc,
    score: scoreDocument(doc, question, category)
  }));

  rankedResults.sort(
    (a, b) => b.score - a.score
  );

  // ⑤ 関連度の低い資料を除外

  const finalResults = rankedResults
    .filter(item =>
      item.doc.content &&
      item.doc.content.trim().length >= 50 &&
      item.score >= 15
    )
    .slice(0, 8)
    .map(item => item.doc);

  // ⑥ 学校資料の分類

  const organizedResults =
    finalResults.length > 0
      ? organizeSchoolDocuments(finalResults)
      : [];

  // ⑦ ログ

  console.log("公式サイト検索完了:", {
    question,
    category,
    questionTerms,
    visitedPages: visited.size,
    discoveredPdfs: pdfMap.size,
    selectedPdfs: pdfCandidates.length,
    htmlResults: results.filter(
      item => item.origin === "official_website"
    ).length,
    pdfResults: results.filter(
      item => item.origin === "official_pdf"
    ).length,
    rankedResults: rankedResults.length,
    selectedResults: finalResults.length,
    totalResults: organizedResults.length
  });

  return organizedResults;
}
