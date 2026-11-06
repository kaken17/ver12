
import { createClient } from "@supabase/supabase-js";

// =====================================
// Supabase接続
// =====================================

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

// =====================================
// 質問分類
// =====================================

const CATEGORY_KEYWORDS = {
  学科: [
    "学科", "専門学科", "コース",
    "電子機械", "自動車科", "電気科",
    "情報技術", "土木科", "工業化学",
    "何を学ぶ", "何を勉強"
  ],

  部活動: [
    "部活", "部活動", "クラブ",
    "運動部", "文化部", "同好会",
    "野球", "サッカー", "吹奏楽"
  ],

  資格: [
    "資格", "検定", "取得",
    "国家資格", "合格"
  ],

  進路: [
    "進路", "就職", "進学",
    "大学", "就職先", "卒業後"
  ],

  入試: [
    "入試", "受験", "募集要項",
    "出願", "入学者選抜", "試験日"
  ],

  学費: [
    "学費", "授業料", "入学金",
    "費用", "教材費", "お金"
  ],

  学校行事: [
    "学校行事", "文化祭", "体育祭",
    "修学旅行", "イベント"
  ],

  アクセス: [
    "アクセス", "所在地", "住所",
    "行き方", "最寄り駅", "交通"
  ],

  学校概要: [
    "学校概要", "学校紹介", "特徴",
    "特色", "教育方針", "歴史"
  ]
};

export function classifyQuestion(question) {
  const q = normalize(question);

  // より具体的な分類を優先
  const priority = [
    "入試",
    "学費",
    "資格",
    "進路",
    "部活動",
    "学校行事",
    "アクセス",
    "学科",
    "学校概要"
  ];

  for (const category of priority) {
    const matched = CATEGORY_KEYWORDS[category].some(
      word => q.includes(normalize(word))
    );

    if (matched) return category;
  }

  return "学校概要";
}

// =====================================
// 文字列の正規化
// =====================================

function normalize(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[？?。、！!，,「」『』（）()【】［］・：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================================
// 不要な言葉を除去
// =====================================

const STOP_PHRASES = [
  "福岡県立八女工業高等学校",
  "八女工業高等学校",
  "八女工業高校",
  "八女工業",
  "について教えてください",
  "について教えて",
  "について知りたい",
  "について",
  "教えてください",
  "教えて",
  "知りたいです",
  "知りたい",
  "ありますか",
  "でしょうか",
  "ですか",
  "ますか",
  "どのような",
  "どんな",
  "ください",
  "お願いします",
  "とは何ですか",
  "とは",
  "を教えて",
  "が知りたい"
];

function cleanQuestion(question) {
  let q = normalize(question);

  const phrases = [...STOP_PHRASES].sort(
    (a, b) => b.length - a.length
  );

  for (const phrase of phrases) {
    q = q.replaceAll(normalize(phrase), " ");
  }

  return q.replace(/\s+/g, " ").trim();
}

// =====================================
// 資料を検索用に整理
// =====================================

function prepareDocuments(documents) {
  return documents.map(doc => ({
    ...doc,
    normalizedTitle: normalize(doc.title),
    normalizedCategory: normalize(doc.category),
    normalizedContent: normalize(doc.content),
    combined: normalize(
      `${doc.title} ${doc.category} ${doc.content}`
    )
  }));
}

// =====================================
// カテゴリー別の検索対象
// =====================================

const CATEGORY_PATTERNS = {
  学科: /学科|電子機械|自動車|電気科|情報技術|土木科|工業化学|教育課程|専門科目/,

  部活動: /部活動|運動部|文化部|同好会|野球|サッカー|吹奏楽|バスケット/,

  資格: /資格|検定|取得|合格|国家資格/,

  進路: /進路|就職|進学|大学|卒業後|内定/,

  入試: /入試|受験|募集要項|出願|選抜|募集人数/,

  学費: /学費|授業料|入学金|教材費|納入金/,

  学校行事: /学校行事|文化祭|体育祭|修学旅行|イベント/,

  アクセス: /アクセス|所在地|住所|交通|最寄り駅/,

  学校概要: /学校概要|学校紹介|教育方針|特色|沿革|校長挨拶/
};

// =====================================
// 検索語の作成
// =====================================

function makeQueryProfile(question) {
  const normalized = normalize(question);
  const cleaned = cleanQuestion(question);
  const category = classifyQuestion(question);

  const keywords = CATEGORY_KEYWORDS[category] || [];

  const matchedKeywords = keywords.filter(word =>
    normalized.includes(normalize(word))
  );

  const grams = new Set();

  // 質問の文字列から2〜3文字の検索語を作成
  for (const size of [2, 3]) {
    for (let i = 0; i <= cleaned.length - size; i++) {
      const gram = cleaned.slice(i, i + size);

      if (
        gram.length >= 2 &&
        !["です", "ます", "した", "こと", "から", "まで"].includes(gram)
      ) {
        grams.add(gram);
      }
    }
  }

  // カテゴリーの検索語を追加
  for (const word of matchedKeywords) {
    grams.add(normalize(word));
  }

  return {
    normalized,
    cleaned,
    category,
    grams: [...grams]
  };
}

// =====================================
// 出現回数
// =====================================

function countOccurrences(text, term) {
  if (!term) return 0;

  let count = 0;
  let position = 0;

  while (true) {
    position = text.indexOf(term, position);

    if (position === -1) break;

    count++;
    position += term.length;

    if (count >= 5) break;
  }

  return count;
}

// =====================================
// 資料の関連度を計算
// =====================================


function scoreDocument(doc, profile) {
  let score = 0;

  const title = doc.normalizedTitle;
  const category = doc.normalizedCategory;
  const content = doc.normalizedContent;

  // 質問の重要語を優先
  const terms = profile.grams.filter(
    term => term.length >= 2
  );

  for (const term of terms) {
    if (title.includes(term)) score += 12;
    if (category.includes(term)) score += 8;
    if (content.includes(term)) score += 2;
  }

  // カテゴリー一致
  const pattern = CATEGORY_PATTERNS[profile.category];

  if (pattern?.test(title)) score += 25;
  if (pattern?.test(category)) score += 20;
  if (pattern?.test(content)) score += 5;

  // 質問全体との一致
  if (
    profile.cleaned.length >= 3 &&
    title.includes(profile.cleaned)
  ) {
    score += 30;
  }

  // 年度が新しい資料を優先
  const date = Date.parse(
    doc.source_date || doc.fetched_at || ""
  );

  if (Number.isFinite(date)) {
    const ageDays =
      (Date.now() - date) / 86400000;

    if (ageDays >= 0 && ageDays <= 365) {
      score += 8;
    } else if (ageDays > 365 && ageDays <= 730) {
      score += 4;
    }
  }

  return score;
}

// =====================================
// 学校資料検索
// =====================================

export async function searchSchoolData(question) {
  if (
    typeof question !== "string" ||
    !question.trim()
  ) {
    return [];
  }

  const supabase = getSupabase();

  
const PAGE_SIZE = 500;
const MAX_DOCUMENTS = 5000;

let data = [];
let offset = 0;


while (offset < MAX_DOCUMENTS) {
  const { data: page, error } = await supabase
    .from("school_documents")
    .select(
      "url, title, category, content, source_date, fetched_at"
    )
    .order("fetched_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    console.error(
      "Supabase検索エラー:",
      error.message
    );
    throw new Error("学校資料の検索に失敗しました");
  }

  if (!page || page.length === 0) break;

  data.push(...page);

  if (page.length < PAGE_SIZE) break;

  offset += PAGE_SIZE;
}

if (!Array.isArray(data) || data.length === 0) {
  return [];
}

// 空資料を除外
const documents = prepareDocuments(
  data.filter(doc =>
    typeof doc.content === "string" &&
    doc.content.trim().length > 0
  )
);

const profile = makeQueryProfile(question);

const ranked = documents
  .map(doc => ({
    doc,
    score: scoreDocument(doc, profile)
  }))
  .filter(item => item.score >= 5)
  .sort((a, b) => b.score - a.score);

// 最大8件
const results = ranked.slice(0, 8);

return results.map(({ doc }) => ({
  title: doc.title || "タイトル不明",
  category: doc.category || "学校情報",
  content: doc.content,
  source: doc.url || "",
  source_date: doc.source_date || null
}));
