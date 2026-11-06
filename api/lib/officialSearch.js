
export async function searchOfficialWebsite(
  question,
  category = "学校概要"
) {
  const visited = new Set();

  const queue = [{
    url: SCHOOL_URL,
    title: "八女工業高等学校公式サイト",
    depth: 0
  }];

  const results = [];
  const pdfMap = new Map();

  // ===================================
  // ① 公式サイトを自動巡回
  // ===================================

  while (
    queue.length > 0 &&
    visited.size < MAX_PAGES
  ) {
    const current = queue.shift();
    const safeUrl = normalizeUrl(current.url);

    if (!safeUrl || visited.has(safeUrl)) {
      continue;
    }

    visited.add(safeUrl);

    const page = await fetchPage(safeUrl);

    if (!page) continue;

    if (
      current.depth > 0 &&
      page.text.length >= 50
    ) {
      results.push({
        title: current.title,
        category,
        content: page.text.slice(
          0,
          MAX_CONTENT_LENGTH
        ),
        source: page.url,
        source_date: null,
        origin: "official_website",
        depth: current.depth
      });
    }

    const extracted = extractLinks(
      page.html,
      page.url
    );

    // PDF候補を保存
    for (const pdf of extracted.pdfs) {
      pdfMap.set(pdf.url, pdf);
    }

    if (current.depth >= MAX_DEPTH) {
      continue;
    }

    const candidates = rankLinks(
      extracted.links,
      question,
      category
    );

    for (const link of candidates.slice(0, 8)) {
      if (
        !visited.has(link.url) &&
        !queue.some(item => item.url === link.url)
      ) {
        queue.push({
          url: link.url,
          title: link.title,
          depth: current.depth + 1
        });
      }
    }
  }

  // ===================================
  // ② PDF本文を取得・解析
  // ===================================

  const pdfCandidates = [
    ...pdfMap.values()
  ].slice(0, 6);

  for (const pdf of pdfCandidates) {
    const extractedPdf =
      await extractOfficialPdf(pdf.url);

    if (!extractedPdf) continue;

    results.push({
      title: pdf.title,
      category,
      content: extractedPdf.content,
      source: extractedPdf.source,
      source_date: null,
      origin: "official_pdf",
      depth: 1
    });
  }

  // ===================================
  // ③ HTML・PDFの関連度を評価
  // ===================================

  const rankedResults = results.map(doc => {
    const ranked = rankLinks(
      [{
        title: doc.title,
        url: doc.source
      }],
      question,
      category
    );

    let score = ranked[0]?.score || 0;

    const content = String(doc.content || "")
      .normalize("NFKC")
      .toLowerCase();

    const terms = CATEGORY_TERMS[category] || [];

    for (const term of terms) {
      if (
        content.includes(
          term.normalize("NFKC").toLowerCase()
        )
      ) {
        score += 5;
      }
    }

    if (doc.origin === "official_pdf") {
      score += 10;
    }

    return {
      doc,
      score
    };
  });

  // ===================================
  // ④ 関連度順に整理
  // ===================================

  rankedResults.sort(
    (a, b) => b.score - a.score
  );

  const finalResults = rankedResults
    .filter(item => item.score >= 15)
    .slice(0, 8)
    .map(item => item.doc);

  // ===================================
  // ⑤ 学科・部活動などを整理
  // ===================================

  const organizedResults =
    organizeSchoolDocuments(finalResults);

  console.log("公式サイト検索完了:", {
    category,
    visitedPages: visited.size,
    htmlResults: results.filter(
      item => item.origin === "official_website"
    ).length,
    pdfResults: results.filter(
      item => item.origin === "official_pdf"
    ).length,
    totalResults: organizedResults.length
  });

  return organizedResults;
}

