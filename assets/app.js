(function () {
  const config = window.APP_CONFIG || {};
  const apiBaseUrl = (config.API_BASE_URL || "").trim();
  const questionsPerSession = Number(config.QUESTIONS_PER_SESSION || 7);

  const screens = {
    intro: document.getElementById("screen-intro"),
    question: document.getElementById("screen-question"),
    finish: document.getElementById("screen-finish"),
    error: document.getElementById("screen-error")
  };

  const elements = {
    startBtn: document.getElementById("start-test-btn"),
    retryBtn: document.getElementById("retry-btn"),
    restartBtn: document.getElementById("restart-btn"),
    pickLeftBtn: document.getElementById("pick-left-btn"),
    pickRightBtn: document.getElementById("pick-right-btn"),
    pickTieBtn: document.getElementById("pick-tie-btn"),
    promptText: document.getElementById("prompt-text"),
    answerLeftText: document.getElementById("answer-left-text"),
    answerRightText: document.getElementById("answer-right-text"),
    progressText: document.getElementById("progress-text"),
    progressBar: document.getElementById("progress-bar"),
    finishStatus: document.getElementById("finish-status"),
    errorText: document.getElementById("error-text")
  };

  const state = {
    startedAt: null,
    sessionId: null,
    selectedItems: [],
    index: 0,
    votes: [],
    currentSides: null
  };

  function setVisible(screenName) {
    Object.values(screens).forEach((el) => el.classList.add("hidden"));
    screens[screenName].classList.remove("hidden");
  }

  function setError(message) {
    elements.errorText.textContent = message;
    setVisible("error");
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function toIsoNow() {
    return new Date().toISOString();
  }

  function createSessionId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `sess_${Date.now()}_${random}`;
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

  function lockButtons(locked) {
    elements.pickLeftBtn.disabled = locked;
    elements.pickRightBtn.disabled = locked;
    elements.pickTieBtn.disabled = locked;
    elements.startBtn.disabled = locked;
  }

  function renderQuestion() {
    const item = state.selectedItems[state.index];
    if (!item) {
      return;
    }

    const showAOnLeft = Math.random() < 0.5;
    state.currentSides = {
      left: showAOnLeft
        ? {
            answer: item.agent_a_response,
            agentId: item.agent_a_id,
            systemPrompt: item.agent_a_system_prompt
          }
        : {
            answer: item.agent_b_response,
            agentId: item.agent_b_id,
            systemPrompt: item.agent_b_system_prompt
          },
      right: showAOnLeft
        ? {
            answer: item.agent_b_response,
            agentId: item.agent_b_id,
            systemPrompt: item.agent_b_system_prompt
          }
        : {
            answer: item.agent_a_response,
            agentId: item.agent_a_id,
            systemPrompt: item.agent_a_system_prompt
          }
    };

    const currentNumber = state.index + 1;
    elements.progressText.textContent = `Вопрос ${currentNumber} из ${state.selectedItems.length}`;
    elements.progressBar.style.width = `${(currentNumber / state.selectedItems.length) * 100}%`;

    elements.promptText.textContent = item.prompt_text;
    elements.answerLeftText.textContent = state.currentSides.left.answer;
    elements.answerRightText.textContent = state.currentSides.right.answer;
  }

  async function loadActiveItems() {
    const result = await apiGet("getItems", { activeOnly: 1 });
    if (!result.ok) {
      throw new Error(result.error || "Не удалось получить список кейсов");
    }

    const items = Array.isArray(result.items) ? result.items : [];
    if (items.length < 2) {
      throw new Error("Недостаточно активных кейсов для теста");
    }

    return items;
  }

  async function startTest() {
    if (!apiBaseUrl) {
      setError("В config.js не заполнен API_BASE_URL.");
      return;
    }

    try {
      lockButtons(true);
      const items = await loadActiveItems();
      const mixed = shuffle(items);
      const selectedCount = Math.min(questionsPerSession, mixed.length);

      state.sessionId = createSessionId();
      state.startedAt = toIsoNow();
      state.selectedItems = mixed.slice(0, selectedCount);
      state.index = 0;
      state.votes = [];
      state.currentSides = null;

      renderQuestion();
      setVisible("question");
    } catch (error) {
      setError(error.message || "Ошибка запуска теста");
    } finally {
      lockButtons(false);
    }
  }

  async function submitSession() {
    const payload = {
      action: "submitSession",
      session: {
        sessionId: state.sessionId,
        startedAt: state.startedAt,
        completedAt: toIsoNow(),
        questionCount: state.selectedItems.length
      },
      votes: state.votes
    };

    const result = await apiPost(payload);
    if (!result.ok) {
      throw new Error(result.error || "Не удалось сохранить результаты");
    }
  }

  async function pickSide(side) {
    const item = state.selectedItems[state.index];
    if (!item || !state.currentSides) {
      return;
    }

    let winner = null;
    let loser = null;

    if (side === "left") {
      winner = state.currentSides.left;
      loser = state.currentSides.right;
    } else if (side === "right") {
      winner = state.currentSides.right;
      loser = state.currentSides.left;
    }

    state.votes.push({
      itemId: item.id,
      promptText: item.prompt_text,
      shownLeftAgent: state.currentSides.left.agentId,
      shownRightAgent: state.currentSides.right.agentId,
      shownLeftSystemPrompt: state.currentSides.left.systemPrompt,
      shownRightSystemPrompt: state.currentSides.right.systemPrompt,
      winnerSide: side,
      winnerAgentId: winner ? winner.agentId : "",
      loserAgentId: loser ? loser.agentId : "",
      winnerSystemPrompt: winner ? winner.systemPrompt : "",
      loserSystemPrompt: loser ? loser.systemPrompt : "",
      createdAt: toIsoNow()
    });

    state.index += 1;

    if (state.index < state.selectedItems.length) {
      renderQuestion();
      return;
    }

    try {
      lockButtons(true);
      await submitSession();
      elements.finishStatus.textContent = "Результаты сохранены. Можете пройти тест снова.";
      setVisible("finish");
    } catch (error) {
      setError(error.message || "Ошибка отправки результатов");
    } finally {
      lockButtons(false);
    }
  }

  elements.startBtn.addEventListener("click", startTest);
  elements.retryBtn.addEventListener("click", startTest);
  elements.restartBtn.addEventListener("click", () => setVisible("intro"));
  elements.pickLeftBtn.addEventListener("click", () => pickSide("left"));
  elements.pickRightBtn.addEventListener("click", () => pickSide("right"));
  elements.pickTieBtn.addEventListener("click", () => pickSide("tie"));

  if (config.SITE_TITLE) {
    document.title = config.SITE_TITLE;
  }
})();
