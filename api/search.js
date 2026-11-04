
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
// 質問の自動分類
// =====================================

export const CATEGORY_RULES = {
  学科: {
    keywords: [
      "学科", "何科", "機械科", "電子機械",
      "自動車科", "電気科", "情報技術",
      "工業化学", "土木科", "学習内容",
      "授業内容", "実習", "カリキュラム"
    ],
    searchTerms: [
      "学科", "教育課程", "学習内容",
      "実習", "専門科目"
    ]
  },

  資格: {
    keywords: [
      "資格", "検定", "取得", "合格",
      "国家資格", "技能検定", "危険物",
      "電気工事士", "情報技術検定"
    ],
    searchTerms: [
      "資格", "検定", "取得", "合格",
      "国家資格", "技能検定"
    ]
  },

  進路: {
    keywords: [
      "進路", "就職", "就職先", "進学",
      "大学", "専門学校", "求人",
      "内定", "卒業後", "進路実績"
    ],
    searchTerms: [
      "進路", "就職", "進学",
      "卒業後", "就職先", "進路実績"
    ]
  },

  部活動: {
    keywords: [
      "部活", "部活動", "運動部", "文化部",
      "同好会", "野球", "サッカー",
      "吹奏楽", "ラグビー", "剣道",
      "バスケ", "バレーボール", "卓球",
      "弓道", "テニス", "バドミントン"
    ],
    searchTerms: [
      "部活動", "運動部", "文化部",
      "同好会", "活動内容", "大会"
    ]
  },

  入試: {
    keywords: [
      "入試", "受験", "受検", "入学試験",
      "募集要項", "募集人数", "倍率",
      "推薦", "一般入試", "出願",
      "合格発表", "選抜"
    ],
    searchTerms: [
      "入試", "募集要項", "募集人数",
      "入学者選抜", "出願", "受検"
    ]
  },

  学費: {
    keywords: [
      "学費", "授業料", "入学金",
      "費用", "お金", "納入金",
      "教材費", "制服代", "奨学金"
    ],
    searchTerms: [
      "学費", "授業料", "入学金",
      "納入金", "費用", "奨学金"
    ]
  },

  学校行事: {
    keywords: [
      "学校行事", "文化祭", "体育祭",
      "修学旅行", "遠足", "イベント",
      "行事予定", "始業式", "卒業式"
    ],
    searchTerms: [
      "学校行事", "文化祭", "体育祭",
      "修学旅行", "年間行事", "イベント"
    ]
  },

  アクセス: {
    keywords: [
      "アクセス", "所在地", "住所",
      "場所", "行き方", "交通",
      "最寄り駅", "バス", "通学"
    ],
    searchTerms: [
      "アクセス", "所在地", "住所",
      "交通", "通学", "最寄り駅"
    ]
  },

  学校概要: {
    keywords: [
      "学校概要", "学校紹介", "学校の特徴",
      "特色", "校風", "教育方針",
      "校長", "学校について"
    ],
    searchTerms: [
      "学校概要", "学校紹介",
      "教育方針", "特色", "校風"
    ]
  }
};

// 文章の正規化
function normalize(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[？?。、！!，,「」『』（）()【】［］・：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 質問を自動分類
export function classifyQuestion(question) {
  const q = normalize(question);

  let bestCategory = "学校概要";
  let bestScore = 0;

  for (const [category, rule] of Object.entries(CATEGORY_RULES)) {
    let score = 0;

    for (const keyword of rule.keywords) {
      const word = normalize(keyword);

      if (word && q.includes(word)) {
        score += word.length >= 4 ? 3 : 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// =====================================
// 日本語検索用の言い換え辞書
// =====================================

const SYNONYMS = {
  学科: [
    "学科", "専門学科", "コース", "専攻",
    "何を学ぶ", "何を学べる", "勉強",
    "学習内容", "授業内容", "実習"
  ],

  部活動: [
    "部活", "部活動", "クラブ", "運動部",
    "文化部", "サッカー", "野球", "大会"
  ],

  学校行事: [
    "行事", "学校行事", "文化祭",
    "体育祭", "イベント", "修学旅行"
  ],

  入試: [
    "入試", "受験", "受検", "試験",
    "出願", "募集要項", "入学者選抜"
  ],

  学費: [
    "学費", "授業料", "費用", "お金",
    "納入金", "入学金"
  ],

  進路: [
    "進路", "就職", "進学", "大学",
    "就職先", "資格", "卒業後"
  ],

  資格: [
    "資格", "検定", "国家資格",
    "技能検定", "電気工事士", "危険物"
  ],

  学校概要: [
    "学校概要", "学校紹介", "特徴",
    "特色", "どんな学校", "八女工業"
  ],

  アクセス: [
    "アクセス", "所在地", "住所",
    "場所", "行き方", "交通"
  ]
};

const STOP_PHRASES = [
  "について教えてください",
  "について教えて",
  "について知りたい",
  "について",
  "教えてください",
  "教えて",
  "知りたいです",
  "知りたい",
  "ありますか",
  "ありますでしょうか",
  "でしょうか",
  "ですか",
  "ますか",
  "とは何ですか",
  "とは",
  "どのような",
  "どんな",
  "ください",
  "お願いします",
  "についての",
  "教えてほしい",
  "を教えて",
  "が知りたい"
];

const GENERIC_NGRAMS = new Set([
  "です", "ます", "した", "して",
  "こと", "から", "まで", "ので",
  "ため", "これ", "それ", "どの",
  "など", "いう", "ある", "いる"
]);

// =====================================
// 検索用データの作成
// =====================================

function cleanQuestion(question) {
  let q = normalize(question);

  const phrases = [...STOP_PHRASES]
    .sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    q = q.replaceAll(normalize(phrase), " ");
  }

  return q.replace(/\s+/g, "").trim();
}

function makeQueryProfile(question, category) {
  const normalized = normalize(question);
  const cleaned = cleanQuestion(question);

  const concepts = [];

  for (const [name, words] of Object.entries(SYNONYMS)) {
    const matched = words.filter((word) =>
      normalized.includes(normalize(word))
    );

    if (matched.length > 0) {
      concepts.push({
        category: name,
        words: [...new Set([
          name,
          ...matched
        ].map(normalize))]
      });
    }
  }

  const grams = new Set();

  for (const size of [2, 3]) {
    for (let i = 0; i <= cleaned.length - size; i++) {
      const gram = cleaned.slice(i, i + size);

      if (!GENERIC_NGRAMS.has(gram)) {
        grams.add(gram);
      }
    }
  }

  if (cleaned.length >= 2 && cleaned.length <= 30) {
    grams.add(cleaned);
  }

  return {
    normalized,
    cleaned,
    concepts,
    grams: [...grams],
    category,
    categoryTerms:
      CATEGORY_RULES[category]?.searchTerms || []
  };
}

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

function prepareDocuments(documents) {
  return documents.map((doc) => ({
    ...doc,
    normalizedTitle: normalize(doc.title),
    normalizedCategory: normalize(doc.category),
    normalizedContent: normalize(doc.content),
    combined: normalize(
      `${doc.title} ${doc.category} ${doc.content}`
    )
  }));
}

function calculateIDF(term, documents) {
  const total = documents.length;

  const documentFrequency = documents.filter((doc) =>
    doc.combined.includes(term)
  ).length;

  if (documentFrequency === 0) return 0;

  return Math.log(
    1 + (total - documentFrequency + 0.5) /
    (documentFrequency + 0.5)
  );
}

// =====================================
// 資料の関連度を評価
// =====================================

function scoreDocument(doc, profile, weightedTerms) {
  let score = 0;

  // 質問そのものとの一致
  if (
    profile.cleaned.length >= 3 &&
    doc.normalizedTitle.includes(profile.cleaned)
  ) {
    score += 18;
  }

  if (
    profile.cleaned.length >= 3 &&
    doc.normalizedContent.includes(profile.cleaned)
  ) {
    score += 6;
  }

  // 自動分類に応じた順位調整
  for (const term of profile.categoryTerms) {
    const word = normalize(term);

    if (!word) continue;

    if (doc.normalizedTitle.includes(word)) {
      score += 18;
    } else if (doc.normalizedCategory.includes(word)) {
      score += 10;
    } else if (doc.normalizedContent.includes(word)) {
      score += 3;
    }
  }

  // 言い換え辞書
  for (const concept of profile.concepts) {
    const titleMatch = concept.words.some((word) =>
      doc.normalizedTitle.includes(word)
    );

    const contentMatch = concept.words.some((word) =>
      doc.normalizedContent.includes(word)
    );

    if (titleMatch) score += 12;
    if (contentMatch) score += 5;
  }

  // IDFによる重要語評価
  for (const item of weightedTerms) {
    const { term, idf } = item;

    const titleCount = countOccurrences(
      doc.normalizedTitle,
      term
    );

    const contentCount = countOccurrences(
      doc.normalizedContent,
      term
    );

    if (titleCount > 0) {
      score += idf * 5;
    }

    if (contentCount > 0) {
      score += idf * (
        1 + Math.log(contentCount)
      ) * 1.5;
    }
  }

  return score;
}

// =====================================
// 学校資料の検索本体
// =====================================

export async function searchSchoolData(question) {
  if (
    typeof question !== "string" ||
    !question.trim()
  ) {
    return [];
  }

  const category = classifyQuestion(question);

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("school_documents")
    .select(
      "url, title, category, content, source_date, fetched_at"
    )
    .limit(500);

  if (error) {
    console.error("Supabase検索エラー:", error.message);
    throw new Error("学校資料の検索に失敗しました");
  }

  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  const documents = prepareDocuments(
    data.filter(
      (doc) =>
        typeof doc.content === "string" &&
        doc.content.trim().length > 0
    )
  );

  const profile = makeQueryProfile(question, category);

  const candidates = profile.grams
    .map((term) => ({
      term,
      idf: calculateIDF(term, documents)
    }))
    .filter((item) => item.idf > 0)
    .sort((a, b) => b.idf - a.idf)
    .slice(0, 14);

  const ranked = documents
    .map((doc) => ({
      doc,
      score: scoreDocument(
        doc,
        profile,
        candidates
      )
    }))
    .filter((item) => item.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  // 最大5件
  const results = ranked.slice(0, 5);

  console.log("学校資料検索結果:", {
    category,
    totalDocuments: documents.length,
    query: profile.cleaned,
    matchedDocuments: ranked.length,
    returnedDocuments: results.length
  });

  return results.map(({ doc, score }) => ({
    title: doc.title || "タイトル不明",
    category: doc.category || "学校情報",
    content: doc.content,
    source: doc.url || "",
    source_date: doc.source_date || null,
    score
  }));
}
