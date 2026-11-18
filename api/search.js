
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
// カテゴリーキーワード
// =====================================

const CATEGORY_KEYWORDS = {
  学科: [
    "学科", "専門学科", "コース",
    "電子機械", "自動車科", "it自動車",
    "電気科", "情報技術", "土木科",
    "工業化学", "学習内容", "専門科目",
    "実習内容", "何を学ぶ", "何を勉強",
    "比較", "違い"
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
    "アクセス", "本校へのアクセス",
    "交通アクセス", "所在地", "住所",
    "地図", "交通", "最寄り駅",
    "最寄りバス停", "羽犬塚駅",
    "羽犬塚", "駐車場",
    "公共交通機関"
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
// 学科名
// =====================================

const DEPARTMENTS = [
  "電子機械科",
  "IT自動車科",
  "電気科",
  "情報技術科",
  "土木科",
  "工業化学科"
];

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

  // 不明な質問を学校概要に強制分類しない
  return "その他";
}

// =====================================
// 質問意図
// =====================================

function detectIntent(question) {
  const q = normalize(question);

  return {
    departmentComparison:
      /6学科|全学科|各学科|学科.*比較|学科.*特徴|学科.*違い|どの学科/.test(q),

    departmentDetail:
      DEPARTMENTS.some(name =>
        q.includes(normalize(name))
      ),

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
// 不要表現
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
    q = q.replaceAll(
      normalize(phrase),
      " "
    );
  }

  return q.replace(/\s+/g, " ").trim();
}

// =====================================
// 検索プロフィール
// =====================================

function makeQueryProfile(question) {
  const normalized = normalize(question);
  const cleaned = cleanQuestion(question);
  const category = classifyQuestion(question);
  const intent = detectIntent(question);

  const matchedKeywords = [];

  for (const [name, words] of Object.entries(
    CATEGORY_KEYWORDS
  )) {
    for (const word of words) {
      if (normalized.includes(normalize(word))) {
        matchedKeywords.push({
          category: name,
          word: normalize(word)
        });
      }
    }
  }

  const departmentNames = DEPARTMENTS.filter(
    name =>
      normalized.includes(normalize(name))
  );

  // 意味のある検索語を作成
  const grams = new Set();

  for (const size of [2, 3]) {
    for (
      let i = 0;
      i <= cleaned.length - size;
      i++
    ) {
      const gram = cleaned.slice(i, i + size);

      if (
        !["です", "ます", "した", "こと", "から", "まで"].includes(gram)
      ) {
        grams.add(gram);
      }
    }
  }

  for (const item of matchedKeywords) {
    grams.add(item.word);
  }

  return {
    normalized,
    cleaned,
    category,
    intent,
    grams: [...grams],
    departmentNames,
    matchedKeywords
  };
}

// =====================================
// 検索可能な質問か判定
// =====================================

function isMeaningfulQuestion(profile) {
  const {
    cleaned,
    category,
    departmentNames,
    matchedKeywords
  } = profile;

  // 1文字などの曖昧な質問を除外
  if (cleaned.length < 2) {
    return false;
  }

  // カテゴリーが不明で、検索語も短い場合
  if (
    category === "その他" &&
    cleaned.length < 3
  ) {
    return false;
  }

  // カテゴリーも学科名もない短い質問
  if (
    category === "その他" &&
    departmentNames.length === 0 &&
    matchedKeywords.length === 0
  ) {
    return false;
  }

  return true;
}

// =====================================
// 資料準備
// =====================================

function prepareDocuments(documents) {
  return documents.map(doc => ({
    ...doc,

    normalizedTitle: normalize(
      doc.title
    ),

    normalizedCategory: normalize(
      doc.category
    ),

    normalizedContent: normalize(
      doc.content
    ),

    combined: normalize(
      `${doc.title} ${doc.category} ${doc.content}`
    )
  }));
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
// 資料の関連度計算
// =====================================

function scoreDocument(doc, profile) {
  let score = 0;

  const title = doc.normalizedTitle;
  const category = doc.normalizedCategory;
  const content = doc.normalizedContent;
  const combined = doc.combined;

  const intent = profile.intent;

  // -----------------------------------
  // ① カテゴリー一致
  // -----------------------------------

  if (
    profile.category !== "その他" &&
    category === normalize(profile.category)
  ) {
    score += 25;
  }

  // -----------------------------------
  // ② タイトル・本文一致
  // -----------------------------------

  for (const term of profile.grams) {
    if (term.length < 2) continue;

    if (title.includes(term)) {
      score += 10;
    }

    if (category.includes(term)) {
      score += 5;
    }

    const occurrences = countOccurrences(
      content,
      term
    );

    score += Math.min(
      occurrences,
      3
    ) * 2;
  }

  // -----------------------------------
  // ③ 質問全体との一致
  // -----------------------------------

  if (
    profile.cleaned.length >= 3 &&
    title.includes(profile.cleaned)
  ) {
    score += 35;
  }

  if (
    profile.cleaned.length >= 3 &&
    combined.includes(profile.cleaned)
  ) {
    score += 15;
  }

  // -----------------------------------
  // ④ 学科比較
  // -----------------------------------

  if (intent.departmentComparison) {
    if (category === "学科") {
      score += 100;
    }

    if (title.includes("学科紹介")) {
      score += 40;
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
      } else if (combined.includes(normalizedName)) {
        score += 35;
      }
    }
  }

  // -----------------------------------
  // ⑥ 部活動
  // -----------------------------------

  if (profile.category === "部活動") {
    if (category === "部活動") {
      score += 100;
    }

    if (
      title.includes("部活動一覧") ||
      title.includes("部活動")
    ) {
      score += 50;
    }
  }

  // -----------------------------------
  // ⑦ 資格
  // -----------------------------------

  if (
    intent.qualification &&
    category === "資格"
  ) {
    score += 70;
  }

  // -----------------------------------
  // ⑧ 進路
  // -----------------------------------

  if (
    intent.career &&
    category === "進路"
  ) {
    score += 70;
  }

  // -----------------------------------
  // ⑨ 入試
  // -----------------------------------

  if (
    intent.entrance &&
    category === "入試"
  ) {
    score += 70;
  }

  // -----------------------------------
  // ⑩ アクセス
  // -----------------------------------

  if (profile.category === "アクセス") {
    if (category === "アクセス") {
      score += 70;
    }

    if (/所在地|アクセス|交通/.test(title)) {
      score += 30;
    }
  }

  // -----------------------------------
  // ⑪ 学校概要
  // -----------------------------------

  if (profile.category === "学校概要") {
    if (category === "学校概要") {
      score += 50;
    }
  }

  // -----------------------------------
  // ⑫ 新しい資料を優先
  // -----------------------------------

  const date = Date.parse(
    doc.source_date ||
    doc.fetched_at ||
    ""
  );

  if (Number.isFinite(date)) {
    const ageDays =
      (Date.now() - date) / 86400000;

    if (ageDays >= 0 && ageDays <= 365) {
      score += 8;
    } else if (
      ageDays > 365 &&
      ageDays <= 730
    ) {
      score += 3;
    }
  }

  // -----------------------------------
  // ⑬ 空資料を除外
  // -----------------------------------

  if (!content || content.length < 30) {
    score -= 50;
  }

  return score;
}

// =====================================
// 学科比較用の選択
// =====================================

function selectDepartmentDocuments(ranked) {
  const selected = [];
  const used = new Set();

  // 6学科それぞれの資料を優先
  for (const department of DEPARTMENTS) {
    const name = normalize(department);

    const found = ranked.find(item =>
      item.doc.normalizedTitle.includes(name)
    );

    if (found && !used.has(found.doc.url)) {
      selected.push(found);
      used.add(found.doc.url);
    }
  }

  // 残りの関連資料を追加
  for (const item of ranked) {
    if (selected.length >= 8) break;

    if (!used.has(item.doc.url)) {
      selected.push(item);
      used.add(item.doc.url);
    }
  }

  return selected.slice(0, 8);
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

  // -----------------------------------
  // ① 質問分析
  // -----------------------------------

  const profile = makeQueryProfile(question);

  console.log("検索プロフィール:", {
    category: profile.category,
    intent: profile.intent,
    departmentNames: profile.departmentNames,
    cleanedQuestion: profile.cleaned
  });

  // -----------------------------------
  // ② 意味のない質問を除外
  // -----------------------------------

  if (!isMeaningfulQuestion(profile)) {
    console.log(
      "検索をスキップ: 質問の情報量が不足しています"
    );

    return [];
  }

  const supabase = getSupabase();

  const PAGE_SIZE = 500;
  const MAX_DOCUMENTS = 5000;

  let data = [];
  let offset = 0;

  // -----------------------------------
  // ③ Supabaseから資料取得
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

  if (data.length === 0) {
    console.log(
      "学校資料が登録されていません"
    );

    return [];
  }

  // -----------------------------------
  // ④ 空資料除外
  // -----------------------------------

  const documents = prepareDocuments(
    data.filter(doc =>
      typeof doc.content === "string" &&
      doc.content.trim().length >= 30
    )
  );

  // -----------------------------------
  // ⑤ 関連度計算
  // -----------------------------------

  const ranked = documents
    .map(doc => ({
      doc,
      score: scoreDocument(
        doc,
        profile
      )
    }))
    .filter(item =>
      item.score >= 20
    )
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const dateA = Date.parse(
        a.doc.source_date ||
        a.doc.fetched_at ||
        ""
      ) || 0;

      const dateB = Date.parse(
        b.doc.source_date ||
        b.doc.fetched_at ||
        ""
      ) || 0;

      return dateB - dateA;
    });

  // -----------------------------------
  // ⑥ 検索結果の選択
  // -----------------------------------

  let results;

  if (profile.intent.departmentComparison) {
    results = selectDepartmentDocuments(ranked);

  } else {
    results = ranked.slice(0, 8);
  }

  // -----------------------------------
  // ⑦ ログ
  // -----------------------------------

  console.log("学校資料検索結果:", {
    question: question.slice(0, 100),

    category: profile.category,

    totalDocuments: documents.length,

    matchedDocuments: ranked.length,

    selectedDocuments: results.length,

    selectedTitles: results.map(
      item => item.doc.title
    ),

    selectedScores: results.map(
      item => item.score
    )
  });

  // -----------------------------------
  // ⑧ 結果返却
  // -----------------------------------

  return results.map(({ doc }) => ({
    title: doc.title || "タイトル不明",

    category: doc.category || "学校情報",

    content: doc.content,

    source: doc.url || "",

    source_date: doc.source_date || null
  }));
}
