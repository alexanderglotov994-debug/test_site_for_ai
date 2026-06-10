const FILTER_CONFIG = [
  { key: "industries", label: "Отрасль клиента" },
  { key: "products", label: "Продукт" },
  { key: "divisions", label: "Подразделение" }
];

const state = {
  items: [],
  search: "",
  industries: new Set(),
  products: new Set(),
  divisions: new Set()
};

const elements = {
  searchInput: document.getElementById("search-input"),
  filterGroups: document.getElementById("filter-groups"),
  activeFilters: document.getElementById("active-filters"),
  resultsState: document.getElementById("results-state"),
  cardsGrid: document.getElementById("cards-grid"),
  resetFilters: document.getElementById("reset-filters"),
  template: document.getElementById("case-card-template")
};

boot();

async function boot() {
  bindEvents();

  try {
    const response = await fetch("./data/cases.csv", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const payload = parseCasesCsv(csvText);
    state.items = payload.map(normalizeItem);
    renderFilterGroups();
    render();
  } catch (error) {
    console.error(error);
    elements.resultsState.textContent = "Не удалось загрузить файл data/cases.csv.";
    elements.cardsGrid.innerHTML = "";
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  elements.resetFilters.addEventListener("click", () => {
    state.search = "";
    elements.searchInput.value = "";

    FILTER_CONFIG.forEach(({ key }) => state[key].clear());
    syncFilterInputs();
    render();
  });
}

function normalizeItem(item, index) {
  return {
    id: item.id || `case-${index + 1}`,
    title: item.title || "Без названия",
    description: item.description || "",
    url: item.url || "#",
    industries: sanitizeList(item.industries),
    products: sanitizeList(item.products),
    divisions: sanitizeList(item.divisions)
  };
}

function parseCasesCsv(csvText) {
  const delimiter = detectDelimiter(csvText);
  const rows = parseDelimited(csvText, delimiter);
  if (rows.length < 2) {
    return [];
  }

  const header = rows[0].map((cell) => normalizeCsvCell(cell));
  const indexes = {
    title: header.indexOf("Название доработки"),
    description: header.indexOf("Описание"),
    industries: header.indexOf("Отрасли"),
    products: header.indexOf("Продукты"),
    divisions: header.indexOf("Подразделения"),
    url: header.indexOf("Ссылка")
  };

  Object.entries(indexes).forEach(([columnName, index]) => {
    if (index === -1) {
      throw new Error(`В CSV отсутствует обязательная колонка: ${columnName}`);
    }
  });

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => normalizeCsvCell(cell) !== ""))
    .map((row) => ({
      title: normalizeCsvCell(row[indexes.title]),
      description: normalizeCsvCell(row[indexes.description]),
      industries: splitMultiValue(row[indexes.industries]),
      products: splitMultiValue(row[indexes.products]),
      divisions: splitMultiValue(row[indexes.divisions]),
      url: normalizeCsvCell(row[indexes.url])
    }));
}

function splitMultiValue(value) {
  return normalizeCsvCell(value)
    .split("|")
    .map((item) => normalizeCsvCell(item))
    .filter(Boolean);
}

function normalizeCsvCell(value) {
  return `${value || ""}`.replace(/^\uFEFF/, "").trim();
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return firstLine.includes(";") ? ";" : ",";
}

function sanitizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => `${value}`.trim())
    .filter(Boolean);
}

function renderFilterGroups() {
  const fragment = document.createDocumentFragment();

  FILTER_CONFIG.forEach(({ key, label }, index) => {
    const group = document.createElement("details");
    group.className = "filter-group";
    group.open = false;

    const options = collectOptions(key);
    group.dataset.key = key;

    group.innerHTML = `
      <summary>
        <div class="filter-group__meta">
          <span class="filter-group__label">${label}</span>
          <span class="filter-group__status">${options.length} значений</span>
        </div>
        <span class="chip">${options.length}</span>
      </summary>
      <div class="filter-group__body">
        <div class="filter-actions">
          <button class="filter-action" data-action="all" type="button">Всё</button>
          <button class="filter-action" data-action="clear" type="button">Очистить</button>
        </div>
        <div class="checkbox-list"></div>
      </div>
    `;

    const checkboxList = group.querySelector(".checkbox-list");
    checkboxList.appendChild(createAllCheckbox(key));

    options.forEach((option) => {
      checkboxList.appendChild(createValueCheckbox(key, option));
    });

    group.addEventListener("change", handleFilterChange);
    group.addEventListener("click", handleFilterAction);
    fragment.appendChild(group);
  });

  elements.filterGroups.innerHTML = "";
  elements.filterGroups.appendChild(fragment);
  syncFilterInputs();
}

function createAllCheckbox(key) {
  const label = document.createElement("label");
  label.className = "checkbox-item";
  label.innerHTML = `
    <input data-filter-key="${key}" data-filter-all="true" type="checkbox">
    <span class="checkbox-item__text">
      <span class="checkbox-item__label">Всё</span>
      <span class="checkbox-item__hint">Показывать все значения этой группы</span>
    </span>
  `;
  return label;
}

function createValueCheckbox(key, option) {
  const label = document.createElement("label");
  label.className = "checkbox-item";
  label.innerHTML = `
    <input data-filter-key="${key}" value="${escapeHtml(option)}" type="checkbox">
    <span class="checkbox-item__text">
      <span class="checkbox-item__label">${escapeHtml(option)}</span>
    </span>
  `;
  return label;
}

function handleFilterAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const group = actionButton.closest(".filter-group");
  const key = group?.dataset.key;
  if (!key) {
    return;
  }

  if (actionButton.dataset.action === "all") {
    state[key].clear();
  }

  if (actionButton.dataset.action === "clear") {
    state[key].clear();
  }

  syncFilterInputs();
  render();
}

function handleFilterChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const key = input.dataset.filterKey;
  if (!key) {
    return;
  }

  if (input.dataset.filterAll === "true") {
    state[key].clear();
    syncFilterInputs();
    render();
    return;
  }

  if (input.checked) {
    state[key].add(input.value);
  } else {
    state[key].delete(input.value);
  }

  syncFilterInputs();
  render();
}

function syncFilterInputs() {
  FILTER_CONFIG.forEach(({ key }) => {
    const selected = state[key];
    const allInput = elements.filterGroups.querySelector(`input[data-filter-key="${key}"][data-filter-all="true"]`);
    if (allInput) {
      allInput.checked = selected.size === 0;
    }

    const inputs = elements.filterGroups.querySelectorAll(`input[data-filter-key="${key}"]:not([data-filter-all="true"])`);
    inputs.forEach((input) => {
      input.checked = selected.has(input.value);
    });
  });
}

function collectOptions(key) {
  return [...new Set(state.items.flatMap((item) => item[key]))].sort((a, b) => a.localeCompare(b, "ru"));
}

function render() {
  const filteredItems = state.items.filter(matchesFilters);

  elements.resultsState.textContent = filteredItems.length
    ? `Найдено кейсов: ${filteredItems.length}`
    : "По выбранным условиям ничего не найдено.";

  renderActiveFilters();
  renderCards(filteredItems);
}

function matchesFilters(item) {
  const matchesSearch = state.search === ""
    || `${item.title} ${item.description} ${item.industries.join(" ")} ${item.products.join(" ")} ${item.divisions.join(" ")}`
      .toLowerCase()
      .includes(state.search);

  if (!matchesSearch) {
    return false;
  }

  return FILTER_CONFIG.every(({ key }) => {
    const selected = state[key];
    if (selected.size === 0) {
      return true;
    }

    // Если у кейса указано "все" (пустой список тегов), он подходит под любой выбранный фильтр
    if (item[key].length === 0) {
      return true;
    }

    return item[key].some((value) => selected.has(value));
  });
}

function renderActiveFilters() {
  elements.activeFilters.innerHTML = "";

  const activeItems = [];

  if (state.search) {
    activeItems.push(`Поиск: ${state.search}`);
  }

  FILTER_CONFIG.forEach(({ key, label }) => {
    if (state[key].size > 0) {
      activeItems.push(`${label}: ${[...state[key]].join(", ")}`);
    }
  });

  if (activeItems.length === 0) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "Показываются все кейсы";
    elements.activeFilters.appendChild(chip);
    return;
  }

  activeItems.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item;
    elements.activeFilters.appendChild(chip);
  });
}

function renderCards(items) {
  elements.cardsGrid.innerHTML = "";

  if (!items.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Измените фильтры или строку поиска, чтобы расширить выдачу.";
    elements.cardsGrid.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".case-card__title").textContent = item.title;
    node.querySelector(".case-card__description").textContent = item.description;

    const link = node.querySelector(".case-card__link");
    link.href = item.url;

    // Генерируем уникальный фоновый градиент по названию кейса
    const visual = node.querySelector(".case-card__visual");
    if (visual) {
      visual.style.background = getGradientForTitle(item.title);
      const textNode = document.createElement("div");
      textNode.className = "case-card__visual-text";
      textNode.textContent = item.title;
      visual.appendChild(textNode);
    }

    fillMetaLine(node, "industries", item.industries);
    fillMetaLine(node, "products", item.products);
    fillMetaLine(node, "divisions", item.divisions);

    fragment.appendChild(node);
  });

  elements.cardsGrid.appendChild(fragment);
}

function getGradientForTitle(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 65%, 45%) 0%, hsl(${h2}, 75%, 35%) 100%)`;
}

function fillMetaLine(node, field, values) {
  const container = node.querySelector(`[data-field="${field}"]`);
  container.textContent = values && values.length > 0 ? values.join(", ") : "все";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
