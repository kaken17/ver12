
import { createClient } from "@supabase/supabase-js";

export async function searchSchoolData(question) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabaseの環境変数が未設定です");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const normalized = question.toLowerCase();

  const synonyms = {
    "部活": ["部活動", "クラブ"],
    "授業料": ["学費", "納入金"],
    "入試": ["受験", "試験", "募集要項"],
    "学科": ["学べる", "専門", "コース"],
    "場所": ["住所", "アクセス", "最寄り駅"]
  };

  const terms = new Set(
    normalized
      .split(/[\s、。？！?!　]+/)
      .filter((word) => word.length >= 2)
  );

  for (const [key, values] of Object.entries(synonyms)) {
    if (normalized.includes(key) || values.some((v) => normalized.includes(v))) {
      terms.add(key);
      values.forEach((v) => terms.add(v));
    }
  }

  const { data, error } = await supabase
    .from("school_documents")
    .select("url,title,category,content,fetched_at")
    .limit(500);

  if (error) {
    console.error("Supabase search error:", error);
    throw new Error("学校資料を検索できませんでした");
  }

  const results = (data || []).map((item) => {
    const text =
      `${item.title} ${item.category} ${item.content}`.toLowerCase();

    let score = 0;

    for (const term of terms) {
      if (text.includes(term)) score += term.length >= 4 ? 2 : 1;
    }

    return {
      ...item,
      source: item.url,
      score
    };
  });

  return results
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score, ...item }) => item);
}
