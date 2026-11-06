
const DEPARTMENTS = [
    "電子機械科",
    "IT自動車科",
    "電気科",
    "情報技術科",
    "土木科",
    "工業化学科"
  ];
  
  const DEPARTMENT_ALIASES = {
    "電子機械科": ["電子機械", "機械科"],
    "IT自動車科": ["IT自動車", "自動車科"],
    "電気科": ["電気科"],
    "情報技術科": ["情報技術", "情報科"],
    "土木科": ["土木科", "土木"],
    "工業化学科": ["工業化学", "化学科"]
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
  
  function findDepartment(doc) {
    const text = normalize(
      `${doc.title || ""} ${doc.category || ""} ${doc.content || ""}`
    );
  
    for (const department of DEPARTMENTS) {
      const aliases =
        DEPARTMENT_ALIASES[department];
  
      if (
        aliases.some(alias =>
          text.includes(normalize(alias))
        )
      ) {
        return department;
      }
    }
  
    return null;
  }
  
  function findClubs(doc) {
    const text = normalize(
      `${doc.title || ""} ${doc.content || ""}`
    );
  
    return CLUB_TERMS.filter(term =>
      text.includes(normalize(term))
    );
  }
  
  export function organizeSchoolDocuments(documents) {
    return documents.map(doc => {
      const department = findDepartment(doc);
      const clubs = findClubs(doc);
  
      let category =
        doc.category || "学校情報";
  
      if (department) {
        category = "学科";
      } else if (
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
        department,
        relatedClubs: clubs
      };
    });
  }
  
  export function getDepartmentList() {
    return [...DEPARTMENTS];
  }
  