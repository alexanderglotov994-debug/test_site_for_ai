(function () {
  const config = window.APP_CONFIG || {};
  const apiBaseUrl = (config.API_BASE_URL || "").trim();

  const tabButtons = document.querySelectorAll(".btn-tab");
  const tabPanes = document.querySelectorAll(".tab-pane");

  const form = document.getElementById("item-form");
  const itemsTableBody = document.getElementById("items-table-body");

  const fields = {
    id: document.getElementById("item-id"),
    prompt: document.getElementById("prompt-text"),
    agentAId: document.getElementById("agent-a-id"),
    agentBId: document.getElementById("agent-b-id"),
    agentASystem: document.getElementById("agent-a-system"),
    agentBSystem: document.getElementById("agent-b-system"),
    agentAResponse: document.getElementById("agent-a-response"),
    agentBResponse: document.getElementById("agent-b-response"),
    active: document.getElementById("item-active")
  };

  const newItemBtn = document.getElementById("new-item-btn");
  const datasetFileInput = document.getElementById("dataset-file");
  const datasetTextInput = document.getElementById("dataset-text");
  const replaceActiveItemsInput = document.getElementById("replace-active-items");
  const importDatasetBtn = document.getElementById("import-dataset-btn");

  const dateFromInput = document.getElementById("date-from");
  const dateToInput = document.getElementById("date-to");
  const loadResultsBtn = document.getElementById("load-results-btn");

  const sessionsCountEl = document.getElementById("sessions-count");
  const votesCountEl = document.getElementById("votes-count");
  const agentsStatsBody = document.getElementById("agents-stats-body");
  const systemStatsBody = document.getElementById("system-stats-body");
  const promptStatsBody = document.getElementById("prompt-stats-body");

  let itemsCache = [];

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^a-zа-я0-9]+/g, "");
  }

  function detectDelimiter(text) {
    const firstLine = String(text || "")
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) || "";

    const counts = [
      { delimiter: "\t", count: (firstLine.match(/\t/g) || []).length },
      { delimiter: ";", count: (firstLine.match(/;/g) || []).length },
      { delimiter: ",", count: (firstLine.match(/,/g) || []).length }
    ];

    counts.sort((a, b) => b.count - a.count);
    return counts[0].count > 0 ? counts[0].delimiter : ",";
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    const pushField = () => {
      row.push(field);
      field = "";
    };

    const pushRow = () => {
      pushField();
      if (row.some((cell) => String(cell || "").trim() !== "")) {
        rows.push(row);
      }
      row = [];
    };

    const value = String(text || "");
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      const next = value[i + 1];

      if (char === "\"") {
        if (inQuotes && next === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === delimiter) {
        pushField();
        continue;
      }

      if (!inQuotes && (char === "\n" || char === "\r")) {
        if (char === "\r" && next === "\n") {
          i += 1;
        }
        pushRow();
        continue;
      }

      field += char;
    }

    if (field.length > 0 || row.length > 0) {
      pushRow();
    }

    return rows;
  }

  function parseDatasetTable(rawText) {
    const text = String(rawText || "").trim();
    if (!text) {
      throw new Error("Таблица пустая.");
    }

    const delimiter = detectDelimiter(text);
    const rows = parseDelimited(text, delimiter);
    if (rows.length < 2) {
      throw new Error("Нужны заголовок и минимум одна строка данных.");
    }

    const header = rows[0].map((cell) => normalizeHeader(cell));
    const indexByField = {
      model: -1,
      prompt: -1,
      question: -1,
      answer: -1
    };

    header.forEach((name, index) => {
      if (["модель", "model", "agent"].includes(name)) {
        indexByField.model = index;
      }
      if (["промт", "промпт", "prompt", "systemprompt", "system"].includes(name)) {
        indexByField.prompt = index;
      }
      if (["вопрос", "question", "userprompt", "prompttext"].includes(name)) {
        indexByField.question = index;
      }
      if (["ответмодели", "ответ", "response", "answer", "modelresponse"].includes(name)) {
        indexByField.answer = index;
      }
    });

    if (
      indexByField.model < 0 ||
      indexByField.prompt < 0 ||
      indexByField.question < 0 ||
      indexByField.answer < 0
    ) {
      throw new Error("Не найдены обязательные колонки: Модель, Промт, Вопрос, Ответ модели.");
    }

    const parsedRows = rows
      .slice(1)
      .map((row, rowOffset) => ({
        rowNumber: rowOffset + 2,
        model: String(row[indexByField.model] || "").trim(),
        prompt: String(row[indexByField.prompt] || "").trim(),
        question: String(row[indexByField.question] || "").trim(),
        answer: String(row[indexByField.answer] || "").trim()
      }))
      .filter((entry) => entry.model || entry.prompt || entry.question || entry.answer);

    const invalidRows = parsedRows.filter((entry) => !entry.model || !entry.question || !entry.answer);
    if (invalidRows.length > 0) {
      const first = invalidRows[0];
      throw new Error(`Строка ${first.rowNumber}: заполните Модель, Вопрос и Ответ модели.`);
    }

    return parsedRows;
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function truncate(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
  }

  async function apiGet(action, params) {
    const url = new URL(apiBaseUrl);
    url.searchParams.set("action", action);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async function apiPost(payload) {
    const response = await fetch(apiBaseUrl, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function switchTab(targetTabId) {
    tabPanes.forEach((pane) => {
      pane.classList.toggle("hidden", pane.id !== targetTabId);
    });

    tabButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === targetTabId);
    });
  }

  function setFormFromItem(item) {
    fields.id.value = item.id || "";
    fields.prompt.value = item.prompt_text || "";
    fields.agentAId.value = item.agent_a_id || "";
    fields.agentBId.value = item.agent_b_id || "";
    fields.agentASystem.value = item.agent_a_system_prompt || "";
    fields.agentBSystem.value = item.agent_b_system_prompt || "";
    fields.agentAResponse.value = item.agent_a_response || "";
    fields.agentBResponse.value = item.agent_b_response || "";
    fields.active.checked = item.active !== false;
  }

  function clearForm() {
    setFormFromItem({ active: true });
  }

  function renderItemsTable(items) {
    if (!items.length) {
      itemsTableBody.innerHTML = '<tr><td colspan="6">Кейсов пока нет.</td></tr>';
      return;
    }

    itemsTableBody.innerHTML = items
      .map((item) => {
        const activeLabel = item.active ? "Да" : "Нет";
        const question = truncate(item.prompt_text, 100);
        const pair = `${item.agent_a_id || "-"} vs ${item.agent_b_id || "-"}`;
        const updated = item.updated_at ? new Date(item.updated_at).toLocaleString("ru-RU") : "-";

        return `
          <tr>
            <td>${escapeHtml(item.id)}</td>
            <td>${escapeHtml(activeLabel)}</td>
            <td>${escapeHtml(question)}</td>
            <td>${escapeHtml(pair)}</td>
            <td>${escapeHtml(updated)}</td>
            <td>
              <div class="table-actions">
                <button class="small-btn edit" data-action="edit" data-id="${escapeHtml(item.id)}">Редактировать</button>
                <button class="small-btn delete" data-action="delete" data-id="${escapeHtml(item.id)}">Удалить</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadItems() {
    const result = await apiGet("getItems", { activeOnly: 0 });
    if (!result.ok) {
      throw new Error(result.error || "Не удалось получить кейсы");
    }

    itemsCache = Array.isArray(result.items) ? result.items : [];
    renderItemsTable(itemsCache);
  }

  function collectFormPayload() {
    return {
      id: fields.id.value.trim(),
      prompt_text: fields.prompt.value.trim(),
      agent_a_id: fields.agentAId.value.trim(),
      agent_b_id: fields.agentBId.value.trim(),
      agent_a_system_prompt: fields.agentASystem.value.trim(),
      agent_b_system_prompt: fields.agentBSystem.value.trim(),
      agent_a_response: fields.agentAResponse.value.trim(),
      agent_b_response: fields.agentBResponse.value.trim(),
      active: fields.active.checked
    };
  }

  async function saveItem(event) {
    event.preventDefault();

    const item = collectFormPayload();
    if (!item.prompt_text || !item.agent_a_id || !item.agent_b_id || !item.agent_a_response || !item.agent_b_response) {
      alert("Заполните вопрос, ID агентов и оба ответа.");
      return;
    }

    const result = await apiPost({ action: "upsertItem", item });
    if (!result.ok) {
      throw new Error(result.error || "Не удалось сохранить кейс");
    }

    await loadItems();
    clearForm();
  }

  async function deleteItem(id) {
    if (!confirm("Удалить кейс? Он станет неактивным и исчезнет из теста.")) {
      return;
    }

    const result = await apiPost({ action: "deleteItem", id });
    if (!result.ok) {
      throw new Error(result.error || "Не удалось удалить кейс");
    }

    await loadItems();

    if (fields.id.value.trim() === id) {
      clearForm();
    }
  }

  function renderAgentStats(stats) {
    if (!stats.length) {
      agentsStatsBody.innerHTML = '<tr><td colspan="4">Нет данных за период.</td></tr>';
      return;
    }

    agentsStatsBody.innerHTML = stats
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.agentId)}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.winRate}%</td>
          </tr>
        `
      )
      .join("");
  }

  function renderSystemStats(stats) {
    if (!stats.length) {
      systemStatsBody.innerHTML = '<tr><td colspan="4">Нет данных за период.</td></tr>';
      return;
    }

    systemStatsBody.innerHTML = stats
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(truncate(row.systemPrompt || "(пусто)", 120))}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.winRate}%</td>
          </tr>
        `
      )
      .join("");
  }

  function renderPromptStats(stats) {
    if (!stats.length) {
      promptStatsBody.innerHTML = '<tr><td colspan="4">Нет данных за период.</td></tr>';
      return;
    }

    promptStatsBody.innerHTML = stats
      .map((row) => {
        const winner = row.leadingAgent ? `${row.leadingAgent} (${row.leadingWins})` : "-";
        return `
          <tr>
            <td>${escapeHtml(row.itemId || "-")}</td>
            <td>${escapeHtml(truncate(row.prompt, 120))}</td>
            <td>${row.totalVotes}</td>
            <td>${escapeHtml(winner)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadResults() {
    const from = dateFromInput.value;
    const to = dateToInput.value;

    const result = await apiGet("getResults", { from, to });
    if (!result.ok) {
      throw new Error(result.error || "Не удалось получить отчёт");
    }

    const summary = result.summary || { sessions: 0, votes: 0 };
    sessionsCountEl.textContent = String(summary.sessions || 0);
    votesCountEl.textContent = String(summary.votes || 0);

    renderAgentStats(result.agentStats || []);
    renderSystemStats(result.systemPromptStats || []);
    renderPromptStats(result.promptStats || []);
  }

  async function readDatasetInput() {
    const file = datasetFileInput.files && datasetFileInput.files[0] ? datasetFileInput.files[0] : null;
    if (file) {
      return file.text();
    }

    const text = datasetTextInput.value.trim();
    if (text) {
      return text;
    }

    throw new Error("Выберите CSV-файл или вставьте таблицу в текстовое поле.");
  }

  async function importDataset() {
    const rawText = await readDatasetInput();
    const rows = parseDatasetTable(rawText);

    const result = await apiPost({
      action: "importDataset",
      replaceActive: replaceActiveItemsInput.checked,
      rows
    });

    if (!result.ok) {
      throw new Error(result.error || "Ошибка импорта");
    }

    const summary = result.summary || {};
    alert(
      [
        "Импорт завершён.",
        `Исходных строк: ${summary.sourceRows || 0}`,
        `Создано кейсов A/B: ${summary.createdItems || 0}`,
        `Пропущено групп (меньше 2 моделей): ${summary.skippedGroups || 0}`,
        `Деактивировано старых кейсов: ${summary.deactivatedItems || 0}`
      ].join("\n")
    );

    datasetTextInput.value = "";
    datasetFileInput.value = "";
    await loadItems();
    await loadResults();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  form.addEventListener("submit", async (event) => {
    try {
      await saveItem(event);
    } catch (error) {
      alert(error.message || "Ошибка сохранения");
    }
  });

  newItemBtn.addEventListener("click", clearForm);

  itemsTableBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) {
      return;
    }

    try {
      if (action === "edit") {
        const item = itemsCache.find((entry) => entry.id === id);
        if (item) {
          setFormFromItem(item);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }

      if (action === "delete") {
        await deleteItem(id);
      }
    } catch (error) {
      alert(error.message || "Ошибка операции");
    }
  });

  loadResultsBtn.addEventListener("click", async () => {
    try {
      await loadResults();
    } catch (error) {
      alert(error.message || "Ошибка загрузки отчёта");
    }
  });

  importDatasetBtn.addEventListener("click", async () => {
    try {
      await importDataset();
    } catch (error) {
      alert(error.message || "Ошибка импорта таблицы");
    }
  });

  async function init() {
    if (!apiBaseUrl) {
      alert("В config.js не заполнен API_BASE_URL.");
      return;
    }

    const today = new Date();
    const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    dateToInput.value = formatDateInput(today);
    dateFromInput.value = formatDateInput(weekAgo);

    clearForm();

    try {
      await loadItems();
      await loadResults();
    } catch (error) {
      alert(error.message || "Ошибка инициализации");
    }
  }

  init();
})();
