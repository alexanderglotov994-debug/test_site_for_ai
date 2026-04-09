const SPREADSHEET_ID = "1VZ7L_WXefOfzob1yDvgovvsJK_wHdSnPSSx7m2eNoVQ";

const SHEET_NAMES = {
  items: "items",
  sessions: "sessions",
  votes: "votes"
};

const HEADERS = {
  items: [
    "id",
    "active",
    "is_deleted",
    "prompt_text",
    "agent_a_id",
    "agent_b_id",
    "agent_a_system_prompt",
    "agent_b_system_prompt",
    "agent_a_response",
    "agent_b_response",
    "updated_at"
  ],
  sessions: ["session_id", "started_at", "completed_at", "question_count"],
  votes: [
    "vote_id",
    "session_id",
    "item_id",
    "prompt_text",
    "shown_left_agent",
    "shown_right_agent",
    "winner_side",
    "winner_agent_id",
    "loser_agent_id",
    "shown_left_system_prompt",
    "shown_right_system_prompt",
    "winner_system_prompt",
    "loser_system_prompt",
    "created_at"
  ]
};

function doGet(e) {
  return runRequest_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  const body = parseBody_(e);
  return runRequest_(body);
}

function runRequest_(request) {
  try {
    ensureSheets_();

    const action = String(request.action || "").trim();
    if (!action) {
      return jsonResponse_({ ok: false, error: "Action is required" });
    }

    let result;
    switch (action) {
      case "getItems":
        result = getItems_(request);
        break;
      case "upsertItem":
        result = upsertItem_(request);
        break;
      case "deleteItem":
        result = deleteItem_(request);
        break;
      case "importDataset":
        result = importDataset_(request);
        break;
      case "submitSession":
        result = submitSession_(request);
        break;
      case "getResults":
        result = getResults_(request);
        break;
      default:
        result = { ok: false, error: "Unknown action" };
    }

    return jsonResponse_(result);
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message || "Unexpected error" });
  }
}

function getItems_(request) {
  const activeOnly = toBoolean_(request.activeOnly);
  const sheet = getSheet_(SHEET_NAMES.items);
  const rows = getRows_(sheet, HEADERS.items);

  let items = rows.map((row) => ({
    id: String(row.id || ""),
    active: toBoolean_(row.active),
    is_deleted: toBoolean_(row.is_deleted),
    prompt_text: String(row.prompt_text || ""),
    agent_a_id: String(row.agent_a_id || ""),
    agent_b_id: String(row.agent_b_id || ""),
    agent_a_system_prompt: String(row.agent_a_system_prompt || ""),
    agent_b_system_prompt: String(row.agent_b_system_prompt || ""),
    agent_a_response: String(row.agent_a_response || ""),
    agent_b_response: String(row.agent_b_response || ""),
    updated_at: String(row.updated_at || "")
  }));

  items = items.filter((item) => !item.is_deleted);
  if (activeOnly) {
    items = items.filter((item) => item.active);
  }

  items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return { ok: true, items: items };
}

function upsertItem_(request) {
  const item = request.item || {};

  const promptText = String(item.prompt_text || "").trim();
  const agentAId = String(item.agent_a_id || "").trim();
  const agentBId = String(item.agent_b_id || "").trim();
  const agentAResponse = String(item.agent_a_response || "").trim();
  const agentBResponse = String(item.agent_b_response || "").trim();

  if (!promptText || !agentAId || !agentBId || !agentAResponse || !agentBResponse) {
    throw new Error("Missing required item fields");
  }

  const sheet = getSheet_(SHEET_NAMES.items);
  const now = new Date().toISOString();
  const id = String(item.id || "").trim() || Utilities.getUuid();

  const normalized = {
    id: id,
    active: toBooleanDefault_(item.active, true),
    is_deleted: false,
    prompt_text: promptText,
    agent_a_id: agentAId,
    agent_b_id: agentBId,
    agent_a_system_prompt: String(item.agent_a_system_prompt || "").trim(),
    agent_b_system_prompt: String(item.agent_b_system_prompt || "").trim(),
    agent_a_response: agentAResponse,
    agent_b_response: agentBResponse,
    updated_at: now
  };

  const existingRowIndex = findRowById_(sheet, id, HEADERS.items);
  const rowValues = toSheetRow_(normalized, HEADERS.items);

  if (existingRowIndex > 0) {
    sheet.getRange(existingRowIndex, 1, 1, HEADERS.items.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return { ok: true, item: normalized };
}

function deleteItem_(request) {
  const id = String(request.id || "").trim();
  if (!id) {
    throw new Error("Item id is required");
  }

  const sheet = getSheet_(SHEET_NAMES.items);
  const rowIndex = findRowById_(sheet, id, HEADERS.items);
  if (rowIndex < 1) {
    throw new Error("Item not found");
  }

  const row = getRowObjectByIndex_(sheet, rowIndex, HEADERS.items);
  row.active = false;
  row.is_deleted = true;
  row.updated_at = new Date().toISOString();

  sheet.getRange(rowIndex, 1, 1, HEADERS.items.length).setValues([toSheetRow_(row, HEADERS.items)]);

  return { ok: true };
}

function importDataset_(request) {
  const rows = Array.isArray(request.rows) ? request.rows : [];
  const replaceActive = toBoolean_(request.replaceActive);

  if (!rows.length) {
    throw new Error("rows are required");
  }

  const normalizedRows = rows
    .map((row) => ({
      model: String(row.model || "").trim(),
      prompt: String(row.prompt || "").trim(),
      question: String(row.question || "").trim(),
      answer: String(row.answer || "").trim()
    }))
    .filter((row) => row.model || row.prompt || row.question || row.answer);

  if (!normalizedRows.length) {
    throw new Error("No valid rows found");
  }

  const invalidRow = normalizedRows.find((row) => !row.model || !row.question || !row.answer);
  if (invalidRow) {
    throw new Error("Each row requires model, question and answer");
  }

  const groups = {};
  normalizedRows.forEach((row) => {
    const key = row.question;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(row);
  });

  const now = new Date().toISOString();
  const itemRows = [];
  let skippedGroups = 0;

  Object.keys(groups).forEach((groupKey) => {
    const entries = groups[groupKey];
    if (entries.length < 2) {
      skippedGroups += 1;
      return;
    }

    for (let i = 0; i < entries.length - 1; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i];
        const b = entries[j];

        itemRows.push([
          Utilities.getUuid(),
          true,
          false,
          a.question,
          a.model,
          b.model,
          a.prompt,
          b.prompt,
          a.answer,
          b.answer,
          now
        ]);
      }
    }
  });

  if (!itemRows.length) {
    throw new Error("No A/B items created. Add at least 2 models per question.");
  }

  let deactivatedItems = 0;
  if (replaceActive) {
    deactivatedItems = deactivateAllActiveItems_();
  }

  const itemsSheet = getSheet_(SHEET_NAMES.items);
  const startRow = itemsSheet.getLastRow() + 1;
  itemsSheet.getRange(startRow, 1, itemRows.length, HEADERS.items.length).setValues(itemRows);

  return {
    ok: true,
    summary: {
      sourceRows: normalizedRows.length,
      createdItems: itemRows.length,
      groups: Object.keys(groups).length,
      skippedGroups: skippedGroups,
      deactivatedItems: deactivatedItems
    }
  };
}

function deactivateAllActiveItems_() {
  const sheet = getSheet_(SHEET_NAMES.items);
  const rows = getRows_(sheet, HEADERS.items);
  if (!rows.length) {
    return 0;
  }

  const now = new Date().toISOString();
  let changed = 0;

  rows.forEach((row, index) => {
    const isDeleted = toBoolean_(row.is_deleted);
    const isActive = toBoolean_(row.active);
    if (!isDeleted && isActive) {
      row.active = false;
      row.is_deleted = true;
      row.updated_at = now;
      changed += 1;
    }
    rows[index] = row;
  });

  if (changed > 0) {
    const output = rows.map((row) => toSheetRow_(row, HEADERS.items));
    sheet.getRange(2, 1, output.length, HEADERS.items.length).setValues(output);
  }

  return changed;
}

function submitSession_(request) {
  const session = request.session || {};
  const votes = Array.isArray(request.votes) ? request.votes : [];

  if (!votes.length) {
    throw new Error("Votes are required");
  }

  const sessionId = String(session.sessionId || "").trim() || Utilities.getUuid();
  const startedAt = String(session.startedAt || "").trim() || new Date().toISOString();
  const completedAt = String(session.completedAt || "").trim() || new Date().toISOString();
  const questionCount = Number(session.questionCount || votes.length);

  const sessionsSheet = getSheet_(SHEET_NAMES.sessions);
  sessionsSheet.appendRow([sessionId, startedAt, completedAt, questionCount]);

  const votesSheet = getSheet_(SHEET_NAMES.votes);
  const now = new Date().toISOString();
  const rows = votes.map((vote) => {
    const createdAt = String(vote.createdAt || "").trim() || now;

    return [
      Utilities.getUuid(),
      sessionId,
      String(vote.itemId || ""),
      String(vote.promptText || ""),
      String(vote.shownLeftAgent || ""),
      String(vote.shownRightAgent || ""),
      String(vote.winnerSide || ""),
      String(vote.winnerAgentId || ""),
      String(vote.loserAgentId || ""),
      String(vote.shownLeftSystemPrompt || ""),
      String(vote.shownRightSystemPrompt || ""),
      String(vote.winnerSystemPrompt || ""),
      String(vote.loserSystemPrompt || ""),
      createdAt
    ];
  });

  if (rows.length > 0) {
    const startRow = votesSheet.getLastRow() + 1;
    votesSheet.getRange(startRow, 1, rows.length, HEADERS.votes.length).setValues(rows);
  }

  return { ok: true, sessionId: sessionId, votesSaved: rows.length };
}

function getResults_(request) {
  const from = parseDateStart_(request.from);
  const to = parseDateEnd_(request.to);

  const sessionsSheet = getSheet_(SHEET_NAMES.sessions);
  const votesSheet = getSheet_(SHEET_NAMES.votes);

  const sessions = getRows_(sessionsSheet, HEADERS.sessions).filter((row) => {
    const value = parseDateAny_(row.completed_at);
    return isInRange_(value, from, to);
  });

  const votes = getRows_(votesSheet, HEADERS.votes).filter((row) => {
    const value = parseDateAny_(row.created_at);
    return isInRange_(value, from, to);
  });

  const uniqueSessionIds = {};
  sessions.forEach((session) => {
    uniqueSessionIds[String(session.session_id || "")] = true;
  });
  votes.forEach((vote) => {
    const sessionId = String(vote.session_id || "");
    if (sessionId) {
      uniqueSessionIds[sessionId] = true;
    }
  });

  const agentMap = {};
  const systemPromptMap = {};
  const promptMap = {};

  votes.forEach((vote) => {
    const winnerAgent = String(vote.winner_agent_id || "").trim();
    const loserAgent = String(vote.loser_agent_id || "").trim();
    const winnerSystemPrompt = String(vote.winner_system_prompt || "").trim();
    const loserSystemPrompt = String(vote.loser_system_prompt || "").trim();
    const itemId = String(vote.item_id || "").trim();
    const promptText = String(vote.prompt_text || "").trim();
    const promptKey = `${itemId}__${promptText}`;

    addWinLoss_(agentMap, winnerAgent, loserAgent);
    addWinLoss_(systemPromptMap, winnerSystemPrompt, loserSystemPrompt);

    if (!promptMap[promptKey]) {
      promptMap[promptKey] = {
        itemId: itemId,
        prompt: promptText,
        totalVotes: 0,
        winsByAgent: {}
      };
    }

    promptMap[promptKey].totalVotes += 1;
    if (winnerAgent) {
      if (!promptMap[promptKey].winsByAgent[winnerAgent]) {
        promptMap[promptKey].winsByAgent[winnerAgent] = 0;
      }
      promptMap[promptKey].winsByAgent[winnerAgent] += 1;
    }
  });

  const agentStats = toStatsArray_(agentMap, "agentId");
  const systemPromptStats = toStatsArray_(systemPromptMap, "systemPrompt");

  const promptStats = Object.keys(promptMap)
    .map((key) => {
      const entry = promptMap[key];
      let leadingAgent = "";
      let leadingWins = 0;

      Object.keys(entry.winsByAgent).forEach((agentId) => {
        const wins = entry.winsByAgent[agentId];
        if (wins > leadingWins) {
          leadingWins = wins;
          leadingAgent = agentId;
        }
      });

      return {
        itemId: entry.itemId,
        prompt: entry.prompt,
        totalVotes: entry.totalVotes,
        leadingAgent: leadingAgent,
        leadingWins: leadingWins
      };
    })
    .sort((a, b) => b.totalVotes - a.totalVotes);

  return {
    ok: true,
    summary: {
      sessions: Object.keys(uniqueSessionIds).filter((id) => id).length,
      votes: votes.length
    },
    agentStats: agentStats,
    systemPromptStats: systemPromptStats,
    promptStats: promptStats
  };
}

function toStatsArray_(sourceMap, keyName) {
  return Object.keys(sourceMap)
    .map((key) => {
      const entry = sourceMap[key];
      const total = entry.wins + entry.losses;
      const winRate = total > 0 ? Math.round((entry.wins / total) * 1000) / 10 : 0;
      const out = {
        wins: entry.wins,
        losses: entry.losses,
        winRate: winRate
      };
      out[keyName] = key || "(пусто)";
      return out;
    })
    .sort((a, b) => {
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      return a.losses - b.losses;
    });
}

function addWinLoss_(targetMap, winnerKey, loserKey) {
  if (winnerKey) {
    if (!targetMap[winnerKey]) {
      targetMap[winnerKey] = { wins: 0, losses: 0 };
    }
    targetMap[winnerKey].wins += 1;
  }

  if (loserKey) {
    if (!targetMap[loserKey]) {
      targetMap[loserKey] = { wins: 0, losses: 0 };
    }
    targetMap[loserKey].losses += 1;
  }
}

function ensureSheets_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "PUT_YOUR_SPREADSHEET_ID") {
    throw new Error("Set SPREADSHEET_ID in Apps Script");
  }

  ensureSheet_(SHEET_NAMES.items, HEADERS.items);
  ensureSheet_(SHEET_NAMES.sessions, HEADERS.sessions);
  ensureSheet_(SHEET_NAMES.votes, HEADERS.votes);
}

function ensureSheet_(name, headers) {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const currentLastColumn = sheet.getLastColumn();
  const expectedHeaders = headers;

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(currentLastColumn, expectedHeaders.length)).getValues()[0];
  const normalizedCurrent = currentHeaders.slice(0, expectedHeaders.length).map((value) => String(value || ""));

  if (normalizedCurrent.join("|") !== expectedHeaders.join("|")) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error(`Sheet not found: ${name}`);
  }
  return sheet;
}

function getRows_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map((row) => {
    const mapped = {};
    headers.forEach((header, index) => {
      mapped[header] = row[index];
    });
    return mapped;
  });
}

function findRowById_(sheet, id, headers) {
  const rows = getRows_(sheet, headers);
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i].id || "") === id) {
      return i + 2;
    }
  }
  return -1;
}

function getRowObjectByIndex_(sheet, rowIndex, headers) {
  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const out = {};
  headers.forEach((header, index) => {
    out[header] = row[index];
  });
  return out;
}

function toSheetRow_(object, headers) {
  return headers.map((header) => {
    const value = object[header];
    if (typeof value === "boolean") {
      return value;
    }
    return value === undefined || value === null ? "" : value;
  });
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function parseDateAny_(value) {
  if (!value) {
    return null;
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? null : value;
  }

  const date = new Date(String(value));
  return isNaN(date.getTime()) ? null : date;
}

function parseDateStart_(value) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return isNaN(date.getTime()) ? null : date;
}

function parseDateEnd_(value) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999`);
  return isNaN(date.getTime()) ? null : date;
}

function isInRange_(date, from, to) {
  if (!date) {
    return false;
  }
  if (from && date < from) {
    return false;
  }
  if (to && date > to) {
    return false;
  }
  return true;
}

function toBoolean_(value) {
  const normalized = String(value).toLowerCase().trim();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function toBooleanDefault_(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return toBoolean_(value);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
