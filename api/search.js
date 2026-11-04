
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

// 日本語の言い換え辞書
const SYNONYMS = {
  学科: [
    "学科", "専門学科", "コース", "専攻",
    "何を学ぶ", "何を学べる", "勉強", "学習内容"
  ],
  部活動: [
    "部活", "部活動", "クラブ", "運動部",
    "文化部", "サッカー", "野球", "大会"
  ],
  学校行事: [
    "行事", "学校行事", "文化祭", "体育祭",
    "イベント", "修学旅行"
  ],
  入試: [
    "入試", "受験", "試験", "出願",
    "募集要項", "入学者選抜"
  ],
  学費: [
    "学費", "授業料", "費用", "お金",
    "納入金", "入学金"
  ],
  進路: [
    "進路", "就職", "進学", "大学",
    "就職先", "資格", "卒業後"
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

// 質問から除去する一般的な表現
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
  "が知りたい",
  "について知る"
];

const GENERIC_NGRAMS = new Set([
  "です", "ます", "した", "して",
  "こと", "から", "まで", "ので",
  "ため", "これ", "それ", "どの",
  "など", "いう", "ある", "いる"
]);

function normalize(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[？?。、！!，,「」『』（）()【】［］・：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuestion(question) {
  let q = normalize(question);

  // 長い表現から先に取り除く
  const phrases = [...STOP_PHRASES]
    .sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    q = q.replaceAll(normalize(phrase), " ");
  }

  return q.replace(/\s+/g, "").trim();
}

// 質問の重要語を抽出
function makeQueryProfile(question) {
  const normalized = normalize(question);
  const cleaned = cleanQuestion(question);

  const concepts = [];

  for (const [category, words] of Object.entries(SYNONYMS)) {
    const matched = words.filter((word) =>
      normalized.includes(normalize(word))
    );

    if (matched.length > 0) {
      concepts.push({
        category,
        words: [...new Set([
          category,
          ...matched
        ].map(normalize))]
      });
    }
  }

  const grams = new Set();

  // 質問を2文字・3文字の単位に分割
  for (const size of [2, 3]) {
    for (let i = 0; i <= cleaned.length - size; i++) {
      const gram = cleaned.slice(i, i + size);

      if (!GENERIC_NGRAMS.has(gram)) {
        grams.add(gram);
      }
    }
  }

  // 質問そのものも検索対象にする
  if (cleaned.length >= 2 && cleaned.length <= 20) {
    grams.add(cleaned);
  }

  return {
    normalized,
    cleaned,
    concepts,
    grams: [...grams]
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

// 資料の検索用データを準備
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

// 資料全体から検索語の重要度を計算
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

// 1つの資料を評価
function scoreDocument(doc, profile, weightedTerms) {
  let score = 0;

  // 質問全体と一致する場合
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

  // 言い換え辞書による評価
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

  // 資料全体での出現頻度を考慮した評価
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

export async function searchSchoolData(question) {
  if (
    typeof question !== "string" ||
    !question.trim()
  ) {
    return [];
  }

  const supabase = getSupabase();

  // 現在のテーブル構成を維持
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

  // 空の資料を除外
  const documents = prepareDocuments(
    data.filter(
      (doc) =>
        typeof doc.content === "string" &&
        doc.content.trim().length > 0
    )
  );

  const profile = makeQueryProfile(question);

  // 質問から作成した検索語を評価
  const candidates = profile.grams
    .map((term) => ({
      term,
      idf: calculateIDF(term, documents)
    }))
    .filter((item) => item.idf > 0)
    .sort((a, b) => b.idf - a.idf)
    .slice(0, 14);

  // 関連度の高い資料を順位付け
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

  // 最大5件に制限
  const results = ranked.slice(0, 5);

  console.log("学校資料検索結果:", {
    totalDocuments: documents.length,
    query: profile.cleaned,
    matchedConcepts: profile.concepts.map(
      (item) => item.category
    ),
    matchedDocuments: ranked.length,
    returnedDocuments: results.length
  });

  return results.map(({ doc }) => ({
    title: doc.title || "タイトル不明",
    category: doc.category || "学校情報",
    content: doc.content,
    source: doc.url || "",
    source_date: doc.source_date || null
  }));
}
