
const DEPARTMENTS = [
  "電子機械科",
  "IT自動車科",
  "電気科",
  "情報技術科",
  "土木科",
  "工業化学科"
];

const DEPARTMENT_ALIASES = {
  "電子機械科": ["電子機械科", "電子機械"],
  "IT自動車科": ["IT自動車科", "IT自動車"],
  "電気科": ["電気科"],
  "情報技術科": ["情報技術科", "情報技術"],
  "土木科": ["土木科"],
  "工業化学科": ["工業化学科", "工業化学"]
};

const CLUB_TERMS = [
  "ラグビー部",
  "野球部",
  "陸上部",
  "陸上競技部",
  "弓道部",
  "相撲部",
  "剣道部",
  "卓球部",
  "サッカー部",
  "バスケットボール部",
  "バレーボール部",
  "吹奏楽部",
  "電子機械研究部",
  "情報技術研究部",
  "eスポーツ"
];

function normalize(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// =====================================
// 学科判定
// =====================================

function findDepartments(doc) {
  const title = normalize(doc.title);
  const category = normalize(doc.category);
  const content = normalize(doc.content);

  const found = [];

  for (const department of DEPARTMENTS) {
    const aliases = DEPARTMENT_ALIASES[department];

    const titleMatch = aliases.some(alias =>
      title.includes(normalize(alias))
    );

    const categoryMatch =
      category.includes("学科");

    const contentMatches = aliases.filter(alias =>
      content.includes(normalize(alias))
    );

    if (
      titleMatch ||
      (
        categoryMatch &&
        contentMatches.length > 0
      )
    ) {
      found.push(department);
    }
  }

  return found;
}

// =====================================
// 部活動判定
// =====================================

function findClubs(doc) {
  const title = normalize(doc.title);
  const content = normalize(doc.content);

  return CLUB_TERMS.filter(term => {
    const keyword = normalize(term);

    return (
      title.includes(keyword) ||
      content.includes(keyword)
    );
  });
}

// =====================================
// 資料分類
// =====================================

export function organizeSchoolDocuments(documents) {

  if (!Array.isArray(documents)) {
    return [];
  }

  return documents.map(doc => {

    const departments = findDepartments(doc);
    const clubs = findClubs(doc);

    let category =
      doc.category || "学校情報";

    // タイトルに学科名が明記されている場合
    if (departments.length > 0) {
      category = "学科";
    }

    // 部活動資料の判定
    else if (
      clubs.length > 0 ||
      /部活動|部活|クラブ|大会実績/.test(
        `${doc.title || ""} ${doc.category || ""}`
      )
    ) {
      category = "部活動";
    }

    return {
      ...doc,
      category,
      department:
        departments.length === 1
          ? departments[0]
          : null,
      relatedDepartments: departments,
      relatedClubs: clubs
    };
  });
}

// =====================================
// 学科一覧
// =====================================

export function getDepartmentList() {
  return [...DEPARTMENTS];
}
