
const SCHOOL_URL = "https://yameth.fku.ed.jp/";
const SCHOOL_HOST = "yameth.fku.ed.jp";

const CATEGORY_TERMS = {
  学科: ["学科", "IT自動車", "電子機械", "電気科", "情報技術", "土木科", "工業化学"],
  部活動: ["部活動", "部活", "ラグビー", "野球", "陸上", "弓道", "研究部", "eスポーツ"],
  資格: ["資格", "検定", "電気工事士", "自動車整備士"],
  進路: ["進路", "就職", "進学", "大学", "企業"],
  入試: ["入試", "募集要項", "受験", "選抜"],
  学費: ["学費", "授業料", "納入金"],
  学校行事: ["学校行事", "文化祭", "体育祭", "修学旅行"],
  アクセス: ["アクセス", "所在地", "交通"],
  学校概要: ["学校概要", "学校紹介", "教育方針", "学校長"]
};

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

function extractLinks(html) {
  const links = [];
  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], SCHOOL_URL);
      const title = htmlToText(match[2]);

      if (
        url.hostname !== SCHOOL_HOST ||
        url.protocol !== "https:" ||
        !title ||
        title.length < 2 ||
        /\.(pdf|jpg|jpeg|png|zip|xlsx?|docx?)$/i.test(url.pathname)
      ) {
        continue;
      }

      if (
        !links.some(item => item.url === url.href)
      ) {
        links.push({
          url: url.href,
          title
        });
      }
    } catch {
      // 不正なURLは除外
    }
  }

  return links;
}

function rankLinks(links, question, category) {
  const terms = [
    ...(CATEGORY_TERMS[category] || []),
    ...question
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

      return {
        ...link,
        score
      };
    })
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ver12-school-information-bot/1.0",
        "Accept": "text/html"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return null;

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();

    if (html.length > 1500000) {
      return null;
    }

    return htmlToText(html).slice(0, 12000);

  } catch (error) {
    console.error("公式サイト取得エラー:", url, error.message);
    return null;
  }
}

// =====================================
// 公式サイト自動検索
// =====================================

export async function searchOfficialWebsite(
  question,
  category = "学校概要"
) {
  try {
    // ① 公式トップページ取得
    const response = await fetch(SCHOOL_URL, {
      headers: {
        "User-Agent": "ver12-school-information-bot/1.0"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return [];

    const html = await response.text();

    // ② 公式サイト内のリンク取得
    const links = extractLinks(html);

    // ③ 質問に関連するページを選択
    const ranked = rankLinks(
      links,
      question,
      category
    );

    // ④ 関連度の高い5ページまで取得
    const selected = ranked.slice(0, 5);

    const pages = await Promise.all(
      selected.map(async link => {
        const content = await fetchPage(link.url);

        if (!content || content.length < 50) {
          return null;
        }

        return {
          title: link.title,
          category,
          content,
          source: link.url,
          source_date: null,
          origin: "official_website"
        };
      })
    );

    const results = pages.filter(Boolean);

    console.log("公式サイト検索:", {
      category,
      discoveredLinks: links.length,
      selectedPages: results.length
    });

    return results;

  } catch (error) {
    console.error(
      "公式サイト検索エラー:",
      error.message
    );

    // Web検索に失敗してもSupabase検索は継続できる
    return [];
  }
}
