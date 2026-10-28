
import { createClient } from "@supabase/supabase-js";

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

// よくある質問の言い換え辞書
const SYNONYMS = {
  "学科": [
    "学科", "専門学科", "コース", "専攻",
    "何を学ぶ", "何を学べる", "勉強", "学習内容"
  ],
  "部活動": [
    "部活", "部活動", "クラブ", "運動部",
    "文化部", "サッカー", "野球", "大会"
  ],
  "学校行事": [
    "行事", "学校行事", "文化祭", "体育祭",
    "イベント", "修学旅行"
  ],
  "入試": [
    "入試", "受験", "試験", "出願",
    "募集要項", "入学者選抜"
  ],
  "学費": [
    "学費", "授業料", "費用", "お金",
    "納入金", "入学金"
  ],
  "進路": [
    "進路", "就職", "進学", "大学",
    "就職先", "資格", "卒業後"
  ],
  "学校概要": [
    "学校概要", "学校紹介", "特徴",
    "特色", "どんな学校", "八女工業"
  ],
  "アクセス": [
    "アクセス", "所在地", "住所",
    "場所", "行き方", "交通"
  ]
};

function normalize(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[？?。、！!，,「」『』（）()【】［］]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSearchTerms(question) {
  const q = normalize(question);
  const terms = new Set();

  // 質問そのものも検索語にする
  if (q.length >= 2) terms.add(q);

  // 質問に含まれる言葉の言い換えを追加
  for (const words of Object.values(SYNONYMS)) {
    if (words.some((word) => q.includes(normalize(word)))) {
      for (const word of words) {
        terms.add(normalize(word));
      }
    }
  }

  // 日本語の質問から短い語句も作る
  const compact = q.replace(/\s/g, "");
  for (let size = 2; size <= 6; size++) {
    for (let i = 0; i <= compact.length - size; i++) {
      terms.add(compact.slice(i, i + size));
    }
  }

  // 長すぎる語句や1文字の語句を除く
  return [...terms].filter(
    (term) => term.length >= 2 && term.length <= 80
  );
}

function scoreDocument(doc, question, terms) {
  const title = normalize(doc.title);
  const category = normalize(doc.category);
  const content = normalize(doc.content);
  const combined = `${title} ${category} ${content}`;

  let score = 0;

  // 質問とタイトル・分類が一致した場合は高く評価
  for (const term of terms) {
    if (title.includes(term)) score += term.length >= 4 ? 8 : 4;
    if (category.includes(term)) score += 5;
    if (content.includes(term)) score += term.length >= 4 ? 3 : 1;
  }

  // 質問の主要語がタイトルにある資料を優先
  const q = normalize(question);
  if (q && title.includes(q)) score += 15;

  // 質問に関連する分類を優先
  for (const [categoryName, words] of Object.entries(SYNONYMS)) {
    if (
      words.some((word) => q.includes(normalize(word))) &&
      category.includes(normalize(categoryName))
    ) {
      score += 10;
    }
  }

  return score;
}

export async function searchSchoolData(question) {
  const supabase = getSupabase();

  // 現在のテーブル構成を維持して資料を取得
  const { data, error } = await supabase
    .from("school_documents")
    .select("url, title, category, content, source_date, fetched_at")
    .limit(500);

  if (error) {
    console.error("Supabase検索エラー:", error.message);
    throw new Error("学校資料の検索に失敗しました");
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.warn("school_documents に資料がありません");
    return [];
  }

  const terms = makeSearchTerms(question);

  const ranked = data
    .filter(
      (doc) =>
        typeof doc.content === "string" &&
        doc.content.trim().length > 0
    )
    .map((doc) => ({
      ...doc,
      score: scoreDocument(doc, question, terms)
    }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score);

  // 検索結果が上位に偏らないよう最大5件に制限
  const results = ranked.slice(0, 5);

  console.log("学校資料検索:", {
    totalDocuments: data.length,
    matchedDocuments: ranked.length,
    returnedDocuments: results.length
  });

  // スコアは内部評価用なのでAIには渡さない
  return results.map(({ score, ...doc }) => ({
    title: doc.title || "タイトル不明",
    category: doc.category || "学校情報",
    content: doc.content,
    source: doc.url || "八女工業高校公式サイト",
    source_date: doc.source_date || null
  }));
}
