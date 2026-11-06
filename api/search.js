
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
// 質問カテゴリー
// =====================================

const CATEGORY_KEYWORDS = {
  学科: [
    "学科", "専門学科", "コース",
    "電子機械", "自動車科", "it自動車",
    "電気科", "情報技術", "土木科",
    "工業化学", "学習内容", "専門科目",
    "実習内容", "何を学ぶ", "何を勉強",
    "特徴", "違い", "比較"
  ],

  部活動: [
    "部活", "部活動", "クラブ",
    "運動部", "文化部", "同好会",
    "野球", "サッカー", "ラグビー",
    "弓道", "陸上", "剣道", "卓球",
    "吹奏楽", "研究部", "eスポーツ"
  ],

  資格: [
    "資格", "検定", "取得",
    "国家資格", "合格", "電気工事士",
    "自動車整備士", "itパスポート"
  ],

  進路: [
    "進路", "就職", "進学",
    "大学", "就職先", "卒業後",
    "企業", "求人", "内定"
  ],

  入試: [
    "入試", "受験", "募集要項",
    "出願", "入学者選抜", "試験日",
    "募集人数", "倍率"
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
    "特色", "教育方針", "歴史",
    "学校生活", "校長"
  ]
};

// =====================================
// 正規化
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
// 質問分類
// =====================================

export function classifyQuestion(question) {
  const q = normalize(question);

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
    const words = CATEGORY_KEYWORDS[category];

    if (
      words.some(word =>
        q.includes(normalize(word))
      )
    ) {
      return category;
    }
  }

  return "学校概要";
}

// =====================================
// 質問の意図を判定
// =====================================

function detectIntent(question) {
  const q = normalize(question);

  return {
    departmentComparison:
      /6学科|全学科|各学科|学科.*比較|学科.*特徴|学科.*違い|どの学科/.test(q),

    departmentDetail:
      /電子機械科|it自動車科|自動車科|電気科|情報技術科|土木科|工業化学科/.test(q),

    clubList:
      /部活動一覧|部活一覧|部活動.*教えて|部活.*教えて|どんな部活|何部/.test(q),

    qualification:
      /資格|検定|取得/.test(q),

    career:
      /進路|就職|進学|大学|企業/.test(q),

    entrance:
      /入試|受験|募集要項|出願|選抜/.test(q)
  };
}

// =====================================
// 学科名
// =====================================

const DEPARTMENTS = [
  "電子機械科",
  "it自動車科",
  "自動車科",
  "電気科",
  "情報技術科",
  "土木科",
  "工業化学科"
];

// =====================================
// 不要な表現を除去
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
// 検索用資料の準備
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
// 検索プロフィール
// =====================================

function makeQueryProfile(question) {
  const normalized = normalize(question);
  const cleaned = cleanQuestion(question);
  const category = classifyQuestion(question);
  const intent = detectIntent(question);

  const keywords = CATEGORY_KEYWORDS[category] || [];

  const matchedKeywords = keywords.filter(word =>
    normalized.includes(normalize(word))
  );

  const grams = new Set();

  // 2〜3文字の検索語
  for (const size of [2, 3]) {
    for (let i = 0; i <= cleaned.length - size; i++) {
      const gram = cleaned.slice(i, i + size);

      if (
        !["です", "ます", "した", "こと", "から", "まで"].includes(gram)
      ) {
        grams.add(gram);
      }
    }
  }

  for (const word of matchedKeywords) {
    grams.add(normalize(word));
  }

  // 質問に含まれる学科名を取得
  const departmentNames = DEPARTMENTS.filter(name =>
    normalized.includes(normalize(name))
  );

  return {
    normalized,
    cleaned,
    category,
    intent,
    grams: [...grams],
    departmentNames
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

  const intent = profile.intent;

  // -----------------------------------
  // ① カテゴリー一致を最優先
  // -----------------------------------

  if (category === normalize(profile.category)) {
    score += 100;
  }

  // -----------------------------------
  // ② タイトル一致
  // -----------------------------------

  for (const term of profile.grams) {
    if (term.length < 2) continue;

    if (title.includes(term)) {
      score += 12;
    }

    if (category.includes(term)) {
      score += 8;
    }

    const occurrences = countOccurrences(
      content,
      term
    );

    score += Math.min(occurrences, 3) * 2;
  }

  // -----------------------------------
  // ③ 質問全体との一致
  // -----------------------------------

  if (
    profile.cleaned.length >= 3 &&
    title.includes(profile.cleaned)
  ) {
    score += 40;
  }

  // -----------------------------------
  // ④ 学科比較
  // -----------------------------------

  if (intent.departmentComparison) {
    if (category === "学科") {
      score += 200;
    }

    if (title.includes("学科紹介")) {
      score += 30;
    }

    if (
      DEPARTMENTS.some(name =>
        title.includes(normalize(name))
      )
    ) {
      score += 20;
    }
  }

  // -----------------------------------
  // ⑤ 特定学科
  // -----------------------------------

  if (intent.departmentDetail) {
    for (const name of profile.departmentNames) {
      const normalizedName = normalize(name);

      if (title.includes(normalizedName)) {
        score += 150;
      }

      if (content.includes(normalizedName)) {
        score += 40;
      }
    }
  }

  // -----------------------------------
  // ⑥ 部活動
  // -----------------------------------

  if (profile.category === "部活動") {
    if (category === "部活動") {
      score += 200;
    }

    if (
      title.includes("部活動一覧") ||
      title.includes("部活動")
    ) {
      score += 50;
    }
  }

  // -----------------------------------
  // ⑦ 資格・進路・入試
  // -----------------------------------

  if (intent.qualification && category === "資格") {
    score += 100;
  }

  if (intent.career && category === "進路") {
    score += 100;
  }

  if (intent.entrance && category === "入試") {
    score += 100;
  }

  // -----------------------------------
  // ⑧ 年度の新しさ
  // -----------------------------------

  const date = Date.parse(
    doc.source_date || doc.fetched_at || ""
  );

  if (Number.isFinite(date)) {
    const ageDays =
      (Date.now() - date) / 86400000;

    if (ageDays >= 0 && ageDays <= 365) {
      score += 15;
    } else if (ageDays > 365 && ageDays <= 730) {
      score += 7;
    }
  }

  // -----------------------------------
  // ⑨ 空資料・短すぎる資料を抑制
  // -----------------------------------

  if (!content || content.length < 30) {
    score -= 30;
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

  // -----------------------------------
  // Supabaseから資料取得
  // -----------------------------------

  while (offset < MAX_DOCUMENTS) {
    const { data: page, error } = await supabase
      .from("school_documents")
      .select(
        "url, title, category, content, source_date, fetched_at"
      )
      .order("fetched_at", {
        ascending: false,
        nullsFirst: false
      })
      .range(
        offset,
        offset + PAGE_SIZE - 1
      );

    if (error) {
      console.error(
        "Supabase検索エラー:",
        error.message
      );

      throw new Error(
        "学校資料の検索に失敗しました"
      );
    }

    if (!page || page.length === 0) {
      break;
    }

    data.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log("学校資料が登録されていません");
    return [];
  }

  // -----------------------------------
  // 空資料を除外
  // -----------------------------------

  const documents = prepareDocuments(
    data.filter(doc =>
      typeof doc.content === "string" &&
      doc.content.trim().length > 0
    )
  );

  // -----------------------------------
  // 質問分析
  // -----------------------------------

  const profile = makeQueryProfile(question);

  console.log("検索プロフィール:", {
    category: profile.category,
    intent: profile.intent,
