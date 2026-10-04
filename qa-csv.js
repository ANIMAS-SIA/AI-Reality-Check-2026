(function (global) {
  "use strict";

  function delimiterFor(headerLine) {
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (const char of headerLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && Object.hasOwn(counts, char)) counts[char] += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseTable(text, delimiter) {
    const table = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const source = String(text || "").replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell); cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        row.push(cell); table.push(row); row = []; cell = "";
      } else {
        cell += char;
      }
    }
    if (cell || row.length) { row.push(cell); table.push(row); }
    return table.filter((cells) => cells.some((value) => value.trim()));
  }

  function parseAnswerCsv(text) {
    const source = String(text || "").trim();
    if (!source) return { rows: [], errors: ["CSV saturs ir tukšs."] };
    const delimiter = delimiterFor(source.split(/\r?\n/, 1)[0]);
    const table = parseTable(source, delimiter);
    const headers = (table.shift() || []).map((value) => value.trim().toLowerCase().replace(/^\uFEFF/, ""));
    const idIndex = ["question_id", "id", "jautajuma_id", "jautājuma_id"].map((name) => headers.indexOf(name)).find((index) => index >= 0);
    const answerIndex = ["answer", "answer_body", "atbilde"].map((name) => headers.indexOf(name)).find((index) => index >= 0);
    const errors = [];
    if (idIndex === undefined || answerIndex === undefined) {
      return { rows: [], errors: ["Nepieciešamas kolonnas question_id un answer."] };
    }

    const rows = [];
    const seen = new Set();
    table.forEach((cells, index) => {
      const line = index + 2;
      const questionId = (cells[idIndex] || "").trim();
      const answer = (cells[answerIndex] || "").trim();
      if (!questionId && !answer) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(questionId)) {
        errors.push(`${line}. rindā nav derīga question_id.`);
      } else if (!answer) {
        errors.push(`${line}. rindā nav atbildes.`);
      } else if (answer.length > 4000) {
        errors.push(`${line}. rindas atbilde pārsniedz 4000 rakstzīmes.`);
      } else if (seen.has(questionId)) {
        errors.push(`${line}. rindā question_id atkārtojas.`);
      } else {
        seen.add(questionId);
        rows.push({ questionId, answer });
      }
    });
    if (!rows.length && !errors.length) errors.push("CSV nav nevienas importējamas atbildes.");
    if (rows.length > 250) errors.push("Vienā reizē var importēt ne vairāk kā 250 atbildes.");
    return { rows, errors };
  }

  global.ARC_QA_CSV = { parseAnswerCsv };
})(typeof window === "undefined" ? globalThis : window);
