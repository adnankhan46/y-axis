(() => {
  if (window.__scrollNavInjected) return;
  window.__scrollNavInjected = true;

  // 1. LLM PROVIDERS
  const PROVIDERS = {
    chatgpt: {
      isMatch: () =>
        window.location.hostname.includes("chatgpt") ||
        window.location.hostname.includes("openai"),
      scrollContainerSelector:
        'main div[class*="overflow-y-auto"], [data-scroll-root="true"]',
      getTurns: (container) => {
        const turns = Array.from(
          container.querySelectorAll(
            'article[data-turn], article[data-testid^="conversation-turn"], section[data-turn], section[data-testid^="conversation-turn"]'
          )
        );
        return turns.map((turnEl) => {
          let role = turnEl.dataset.turn;
          if (!role) {
            const hasUserMsg = turnEl.querySelector(
              '[data-message-author-role="user"]'
            );
            role = hasUserMsg ? "user" : "assistant";
          }

          let text = "";
          let headings = [];

          if (role === "user") {
            const textEl =
              turnEl.querySelector('[data-message-author-role="user"]') ||
              turnEl.querySelector(".user-message-bubble-color") ||
              turnEl.querySelector(".whitespace-pre-wrap");
            text = textEl ? textEl.innerText : "";
          } else {
            const contentEl =
              turnEl.querySelector(".markdown.prose") ||
              turnEl.querySelector('[class*="markdown"]') ||
              turnEl.querySelector(".markdown") ||
              turnEl.querySelector('[data-message-author-role="assistant"]');
            if (contentEl) {
              text = contentEl.innerText || "";
              headings = Array.from(
                contentEl.querySelectorAll("h1, h2, h3, h4")
              ).map((h) => ({ innerText: h.innerText, element: h }));
            }
          }
          return { role, element: turnEl, text, headings };
        });
      },
    },
    gemini: {
      isMatch: () =>
        window.location.hostname.includes("gemini") ||
        window.location.hostname.includes("google"),
      scrollContainerSelector: ".mat-sidenav-content",
      getTurns: (container) => {
        const turns = [];
        const items = Array.from(
          container.querySelectorAll("user-query, model-response")
        );
        items.forEach((item) => {
          const isUser = item.tagName.toLowerCase() === "user-query";
          let text = "";
          let headings = [];

          if (isUser) {
            const textEl = item.querySelector(".query-text");
            text = textEl ? textEl.innerText
            .replace(/^\s*You\s+said[:\s]*/i, "").trim() : ""; // remove "You said:" prefix
          } else {
            const markdown = item.querySelector(".markdown");
            if (markdown) {
              text = markdown.innerText || "";
              headings = Array.from(
                markdown.querySelectorAll("h1, h2, h3, h4")
              ).map((h) => ({ innerText: h.innerText, element: h }));
            }
          }

          turns.push({
            role: isUser ? "user" : "assistant",
            element: item,
            text,
            headings,
          });
        });
        return turns;
      },
    },
    // beta testing with Claude
    claude: {
      isMatch: () => window.location.hostname.includes("claude"),
      scrollContainerSelector: 'main div[class*="overflow-y-auto"]',
      getTurns: (container) => {
        const turns = [];
        const assistantSelectors = [
          ".font-claude-response",
          '[data-testid="assistant-response"]',
          '[data-testid="assistant-message"]',
        ].join(", ");
        const selector = `[data-testid="user-message"], ${assistantSelectors}`;
        const seen = new Set();
        const allItems = Array.from(
          container.querySelectorAll(selector)
        ).filter((el) => {
          if (!el) return false;
          if (seen.has(el)) return false;
          const containerEl =
            el.closest('[data-testid="conversation-turn"]') ||
            el.closest(".group");
          if (!containerEl) return false;
          const text = (el.innerText || "").trim();
          if (!text) return false;
          seen.add(el);
          return true;
        });

        allItems.forEach((el) => {
          const isUser = el.getAttribute("data-testid") === "user-message";
          const turnContainer =
            el.closest('[data-testid="conversation-turn"]') ||
            el.closest(".group") ||
            el.parentElement;

          let headings = [];
          if (!isUser) {
            headings = Array.from(el.querySelectorAll("h1, h2, h3, h4")).map(
              (h) => ({ innerText: h.innerText, element: h })
            );
          }

          turns.push({
            role: isUser ? "user" : "assistant",
            element: turnContainer,
            text: el.innerText || "",
            headings,
          });
        });
        return turns;
      },
    },
    // beta testing with Deepseek
    deepseek: {
      isMatch: () => window.location.hostname.includes("deepseek"),
      scrollContainerSelector: "#root > div, main",
      getTurns: (container) => {
        const turns = [];
        const bubbles = Array.from(
          document.querySelectorAll(
            '.ds-chat-bubble, .chat-message, [class*="message"]'
          )
        );

        bubbles.forEach((el) => {
          const isUser =
            el.classList.contains("ds-user") ||
            el.textContent.includes("You") ||
            window.getComputedStyle(el).justifyContent === "flex-end";
          const headings = [];

          if (!isUser) {
            const hTags = el.querySelectorAll("h1, h2, h3");
            hTags.forEach((h) =>
              headings.push({ innerText: h.innerText, element: h })
            );
          }

          turns.push({
            role: isUser ? "user" : "assistant",
            element: el,
            text: el.innerText,
            headings,
          });
        });
        return turns;
      },
    },
  };

  // ALL States
  const state = {
    isOpen: false,
    currentProvider: null,
    searchTerm: "",
    viewLevel: 1, // 1 for Only Prompt | 2 for View All
    navTargets: new Map(), // ID for element mapping
    navItems: new Map(), // ID for DOM element mapping
    focusableIds: [], // Array of nav item IDs in focus order
    focusedIndex: -1, // Current keyboard focus index
    activeNavId: null, // Currently active item (scroll-based)
    scrollContainer: null,
    scrollEventTarget: null,
    scrollListenerTarget: null,
    suppressNavAutoScroll: false,
    navAutoScrollTimeout: null,
    scrollAnimationFrame: null,
    drag: {
      active: false,
      wasDragging: false,
      target: null, // element currently being dragged
      currentX: 0,
      currentY: 0,
      initialX: 0,
      initialY: 0,
      xOffset: 0,
      yOffset: 0,
    },
    uiMode: "icon", // 'icon' | 'floating-bar'
    floatingBarText: "", // currently displayed text in the floating bar
    sortedTurns: [], // all turns in document order, saved after each refresh
    scrollDirection: "down", // 'up' | 'down'
    lastScrollTop: 0,
  };

  // Initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    state.currentProvider = Object.values(PROVIDERS).find((p) => p.isMatch());
    if (!state.currentProvider) return;

    createUI();
    applyTheme();

    // Global scroll capturing listener fixes issues with React virtualized
    // or nested scroll areas (like catgpt) not bubbling scroll events.
    // this still # need fixes , for chatgpt dynamically rendering DOM.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    // Watch for chat load
    const observer = new MutationObserver(() => {
      const container = findConversationContainer();
      if (container && container !== state.scrollContainer) {
        setConversationContainer(container);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const container = findConversationContainer();
    if (container) {
      setConversationContainer(container);
    }
  }

  function findConversationContainer() {
    if (!state.currentProvider) return null;
    return (
      document.querySelector(state.currentProvider.scrollContainerSelector) ||
      document.querySelector("main") ||
      document.body
    );
  }

  function setConversationContainer(container) {
    if (container === state.scrollContainer) return;
    state.scrollContainer = container;
    observeContainerContent(container);
    setScrollEventTarget(container);
    refreshNavigation();
  }

  function observeContainerContent(node) {
    const contentObserver = new MutationObserver(
      debounce(() => { refreshNavigation(); }, 500)
    );
    contentObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Create UI
  function createUI() {
    const root = document.createElement("div");
    root.id = "ai-nav-root";

    // 1. Draggable Toggle Button
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "ai-nav-toggle";
    toggleBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="5" y1="3" x2="5" y2="21"></line>
        <line x1="5" y1="6" x2="11" y2="6"></line>
        <line x1="5" y1="11" x2="15" y2="11"></line>
        <line x1="5" y1="16" x2="9" y2="16"></line>
        <line x1="5" y1="21" x2="19" y2="21"></line>
      </svg>`;
    initDraggable(toggleBtn);
    toggleBtn.addEventListener("click", (e) => {
      if (state.drag.wasDragging) return;
      if (state.uiMode === "floating-bar") {
        toggleFloatingBar();
      } else {
        toggleNav();
      }
    });

    // 2. Floating Bar
    const floatingBar = document.createElement("div");
    floatingBar.className = "ai-floating-bar";
    floatingBar.innerHTML = `
      <div class="ai-floating-bar-content">
        <div class="ai-floating-bar-icon"></div>
        <div class="ai-floating-bar-text-wrapper">
          <span class="ai-floating-bar-text" id="ai-floating-bar-text">No conversations, try opening an existing chat</span>
        </div>
        <div class="ai-floating-bar-spinner">
          <svg viewBox="0 0 36 36" class="circular-chart">
            <path class="circle-bg"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path class="circle" id="ai-floating-spinner"
              stroke-dasharray="0, 100"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
        </div>
      </div>`;
    initDraggable(floatingBar);
    // Clicking the floating bar opens the full panel
    floatingBar.addEventListener("click", (e) => {
      if (!state.drag.wasDragging) toggleNav();
    });

    // 3. Main Panel
    const panel = document.createElement("div");
    panel.className = "ai-nav-panel";
    panel.innerHTML = `
      <div class="ai-nav-header">
        <div class="ai-nav-progress-bar" id="ai-progress-bar"></div>
        <div class="ai-nav-tools">
          <div class="ai-nav-tools-1st">
            <button class="ai-tool-btn" id="ai-export-btn" title="Export Chat to Markdown">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <a href="https://yaxis.vercel.app" target="_blank" class="ai-nav-title">Y-Axis</a>
          </div>
          <div class="ai-view-switch">
            <button data-level="1" class="${state.viewLevel === 1 ? "active" : ""}">Only Prompts</button>
            <button data-level="2" class="${state.viewLevel === 2 ? "active" : ""}">View All</button>
          </div>
        </div>
        <div class="ai-search-container">
          <div class="ai-search-wrapper">
            <svg class="ai-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="ai-search" placeholder="Filter..." id="ai-search-input">
          </div>

          <div class="ai-mode-switch">
              <button class="ai-mode-btn active" id="ai-mode-icon" title="Icon mode">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
              </button>
              <button class="ai-mode-btn" id="ai-mode-bar" title="Floating bar mode">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="8" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
              </button>
            </div>
        </div>
      </div>
      <div class="ai-nav-content" id="ai-nav-content"></div>
    `;

    root.appendChild(toggleBtn);
    root.appendChild(floatingBar);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Search Listeners
    const searchInput = panel.querySelector("#ai-search-input");
    searchInput.addEventListener("input", (e) => {
      state.searchTerm = e.target.value.toLowerCase();
      refreshNavigation();
    });
    searchInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        state.searchTerm = "";
        searchInput.value = "";
        refreshNavigation();
        searchInput.blur();
      }
    });

    panel.querySelectorAll(".ai-view-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const level = parseInt(btn.dataset.level);
        setViewLevel(level);
      });
    });

    document.getElementById("ai-export-btn").addEventListener("click", exportChat);
    document.getElementById("ai-mode-icon").addEventListener("click", () => switchMode("icon"));
    document.getElementById("ai-mode-bar").addEventListener("click", () => switchMode("floating-bar"));

    setupKeyboardNavigation();
  }

  // Keyboard Setup
  function setupKeyboardNavigation() {
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "." || e.key === ";")) {
        e.preventDefault();
        toggleNav();
        return;
      }

      if (!state.isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        toggleNav(false);
        return;
      }

      const activeEl = document.activeElement;
      const typingContext =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable);
      if (typingContext) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        activateFocusedItem();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setViewLevel(1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setViewLevel(2);
      }
    });
  }

  function toggleNav(forceState) {
    const root = document.getElementById("ai-nav-root");
    const newState = forceState !== undefined ? forceState : !state.isOpen;
    state.isOpen = newState;
    root.classList.toggle("open", newState);

    if (newState) {
      const activeIndex = state.focusableIds.indexOf(state.activeNavId);
      if (activeIndex >= 0) {
        state.focusedIndex = activeIndex;
      } else if (state.focusableIds.length > 0) {
        state.focusedIndex = 0;
      } else {
        state.focusedIndex = -1;
      }
    } else {
      state.focusedIndex = -1;
    }
    updateFocusVisuals();
  }

  function setViewLevel(level) {
    if (state.viewLevel === level) return;
    const root = document.getElementById("ai-nav-root");
    if (!root) return;

    const viewBtns = root.querySelectorAll(".ai-view-switch button");
    viewBtns.forEach((b) => {
      const btnLevel = parseInt(b.dataset.level);
      b.classList.toggle("active", btnLevel === level);
    });

    state.viewLevel = level;
    refreshNavigation();
  }

  // Focus Management
  function moveFocus(direction) {
    const ids = state.focusableIds;
    if (!ids.length) return;
    if (state.focusedIndex === -1) {
      const activeIndex = state.focusableIds.indexOf(state.activeNavId);
      if (activeIndex >= 0) {
        state.focusedIndex = activeIndex;
      } else {
        state.focusedIndex = direction > 0 ? 0 : ids.length - 1;
      }
    } else {
      state.focusedIndex =
        (state.focusedIndex + direction + ids.length) % ids.length;
    }
    updateFocusVisuals();
  }

  function activateFocusedItem() {
    if (state.focusedIndex === -1) return;
    const id = state.focusableIds[state.focusedIndex];
    if (!id) return;
    const target = state.navTargets.get(id);
    if (target) scrollToElement(target, id);
  }

  function updateFocusVisuals() {
    const root = document.getElementById("ai-nav-root");
    if (!root) return;
    root
      .querySelectorAll(".ai-nav-focused")
      .forEach((el) => el.classList.remove("ai-nav-focused"));
    if (state.focusedIndex === -1) return;
    const id = state.focusableIds[state.focusedIndex];
    const el = id ? state.navItems.get(id) : null;
    if (!el) return;
    el.classList.add("ai-nav-focused");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function applyTheme() {
    const host = window.location.hostname;
    const root = document.getElementById("ai-nav-root");
    if (host.includes("claude")) root.classList.add("theme-claude");
    else if (host.includes("chatgpt")) root.classList.add("theme-openai");
    else if (host.includes("gemini")) root.classList.add("theme-gemini");
    else root.classList.add("theme-dark");
  }

  // Logic for Refresh & Render
  function refreshNavigation() {
    if (!state.scrollContainer) return;
    const listContainer = document.getElementById("ai-nav-content");
    if (!listContainer) return;

    let turns = state.currentProvider.getTurns(state.scrollContainer);
    state.currentTurns = turns; // Save for export

    updateScrollTargetFromTurns(turns);

    // Sort turns by document position
    turns.sort((a, b) => {
      if (!a.element || !b.element) return 0;
      const position = a.element.compareDocumentPosition(b.element);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    state.sortedTurns = turns; // Save sorted turns for floating bar

    state.navTargets.clear();
    state.navItems.clear();
    const focusOrder = [];

    const list = document.createElement("ul");
    list.className = "ai-nav-list";
    let hasVisibleItems = false;

    turns.forEach((turn, index) => {
      const isUser = turn.role === "user";
      if (state.viewLevel === 1 && !isUser) return;

      const textLower = (turn.text || "").toLowerCase();
      const term = state.searchTerm.trim();
      const promptMatch = term === "" || textLower.includes(term);
      const matchingHeadings = turn.headings.filter(
        (h) => term === "" || h.innerText.toLowerCase().includes(term)
      );

      if (!promptMatch && matchingHeadings.length === 0) return;
      hasVisibleItems = true;

      const targetId = `nav-target-${index}`;

      const li = document.createElement("li");
      li.className = `ai-nav-item ${isUser ? "user" : "ai"}`;
      li.innerHTML = `
         <span class="ai-nav-icon">
            ${
              isUser
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 2a10 10 0 0 1 10 10h-10V2z"></path><path d="M12 12l9.5 5.5"></path><path d="M12 12l-9.5 5.5"></path></svg>'
            }
         </span>
         <span class="ai-nav-text">${cleanText(turn.text)}</span>
       `;

      state.navTargets.set(targetId, turn.element);
      state.navItems.set(targetId, li);
      focusOrder.push(targetId);

      li.addEventListener("click", (e) => {
        e.stopPropagation();
        scrollToElement(turn.element, targetId);
      });

      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const textSpan = li.querySelector(".ai-nav-text");
        const originalText = textSpan.textContent;
        navigator.clipboard
          .writeText(turn.text)
          .then(() => {
            textSpan.textContent = "Copied to clipboard!";
            textSpan.style.color = "var(--ai-accent)";
            setTimeout(() => {
              textSpan.textContent = originalText;
              textSpan.style.color = "";
            }, 1200);
          })
          .catch(() => {
            textSpan.textContent = "Copy failed";
            setTimeout(() => {
              textSpan.textContent = originalText;
            }, 1200);
          });
      });

      list.appendChild(li);

      const headingsToShow = state.searchTerm ? matchingHeadings : turn.headings;
      if (!isUser && headingsToShow.length > 0) {
        const subUl = document.createElement("ul");
        subUl.className = "ai-nav-sublist";
        headingsToShow.forEach((h, hIndex) => {
          const subLi = document.createElement("li");
          subLi.className = "ai-nav-subitem";
          subLi.innerText = h.innerText;

          const hId = `${targetId}-h-${hIndex}`;
          state.navTargets.set(hId, h.element);
          state.navItems.set(hId, subLi);
          focusOrder.push(hId);

          subLi.addEventListener("click", (e) => {
            e.stopPropagation();
            scrollToElement(h.element, hId);
          });
          subUl.appendChild(subLi);
        });
        list.appendChild(subUl);
      }
    });

    listContainer.innerHTML = "";
    if (hasVisibleItems) {
      listContainer.appendChild(list);
    } else {
      listContainer.innerHTML = `<div class="ai-nav-empty-state">No Conversations found</div>
      <div class="ai-nav-empty-state">Try Opening an existing conversation. Or Start a new conversation</div>`;
    }

    state.focusableIds = focusOrder;
    if (!focusOrder.length) {
      state.focusedIndex = -1;
    } else if (state.focusedIndex >= focusOrder.length) {
      state.focusedIndex = focusOrder.length - 1;
    }
    updateFocusVisuals();

    // Re-apply active highlight to the rebuilt DOM element — setActiveItem's
    // early-return guard skips this when the ID hasn't changed.
    if (state.activeNavId && state.navItems.has(state.activeNavId)) {
      state.navItems.get(state.activeNavId).classList.add("ai-nav-active");
    }

    if (!state.searchTerm) {
      setTimeout(updateScrollProgress, 100);
    }
  }

  // Logic for Active Item Tracking & Scroll Management
  function scrollToElement(element, targetId) {
    if (!element) return;

    state.suppressNavAutoScroll = true;
    if (state.navAutoScrollTimeout) clearTimeout(state.navAutoScrollTimeout);
    state.navAutoScrollTimeout = setTimeout(() => {
      state.suppressNavAutoScroll = false;
    }, 800);

    setActiveItem(targetId);

    const scrollSource = getScrollSourceNode();
    const offset = getScrollOffset();

    if (!scrollSource) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (isDocumentScroller(scrollSource)) {
      const globalTop = window.scrollY || window.pageYOffset || 0;
      const targetTop = element.getBoundingClientRect().top + globalTop - offset;
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      const containerRect = scrollSource.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const targetTop =
        scrollSource.scrollTop + (elementRect.top - containerRect.top) - offset;
      if (typeof scrollSource.scrollTo === "function") {
        scrollSource.scrollTo({ top: targetTop, behavior: "smooth" });
      } else {
        scrollSource.scrollTop = targetTop;
      }
    }

    const idx = state.focusableIds.indexOf(targetId);
    if (idx !== -1) {
      state.focusedIndex = idx;
      updateFocusVisuals();
    }
  }

  function setActiveItem(id) {
    if (state.activeNavId === id) return;
    if (state.activeNavId) {
      const oldItem = state.navItems.get(state.activeNavId);
      if (oldItem) oldItem.classList.remove("ai-nav-active");
    }
    const newItem = state.navItems.get(id);
    if (newItem) {
      newItem.classList.add("ai-nav-active");
      // Only scroll the panel when it's visible to avoid fighting page scroll
      if (state.isOpen) {
        newItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    state.activeNavId = id;
  }

  function updateScrollProgress() {
    if (!state.scrollContainer) return;

    const scrollSource = getScrollSourceNode();
    if (!scrollSource) return;

    let scrolled = 0;
    let max = 0;

    if (
      scrollSource === document ||
      scrollSource === document.body ||
      scrollSource === document.documentElement
    ) {
      const docEl =
        document.scrollingElement || document.documentElement || document.body;
      scrolled = docEl.scrollTop || 0;
      max = docEl.scrollHeight - docEl.clientHeight;
    } else {
      scrolled = scrollSource.scrollTop;
      max = scrollSource.scrollHeight - scrollSource.clientHeight;
    }

    if (max < 0) max = 0;
    let pct = max > 0 ? Math.round((scrolled / max) * 100) : 0;

    const progressBar = document.getElementById("ai-progress-bar");
    if (progressBar) {
      progressBar.style.width = `${pct}%`;
    }

    const spinner = document.getElementById("ai-floating-spinner");
    if (spinner) {
      spinner.setAttribute("stroke-dasharray", `${pct}, 100`);
    }

    // Floating bar always updates on scroll, independent of panel suppression
    if (state.uiMode === "floating-bar") updateFloatingBarText();

    if (state.suppressNavAutoScroll) return;

    const headerOffset = getScrollOffset();
    const containerTop = Math.max(0, state.scrollContainer.getBoundingClientRect().top);
    const viewLine = containerTop + headerOffset;
    let closestId = null;
    let minDist = Infinity;

    for (const [id, el] of state.navTargets) {
      if (!el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - viewLine);
      if (dist < minDist) {
        minDist = dist;
        closestId = id;
      }
    }
    if (closestId) setActiveItem(closestId);
  }

  function getScrollSourceNode() {
    return (
      state.scrollEventTarget ||
      state.scrollContainer ||
      document.scrollingElement ||
      document.documentElement ||
      document.body
    );
  }

  function isDocumentScroller(node) {
    if (!node) return false;
    const docEl = document.documentElement;
    const body = document.body;
    const scrollingEl = document.scrollingElement;
    return node === body || node === docEl || node === scrollingEl;
  }

  function getScrollOffset() {
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;
    const dynamicOffset = viewportHeight ? viewportHeight * 0.15 : 0;
    const baseOffset = dynamicOffset || 110;
    return Math.min(Math.max(baseOffset, 80), 170);
  }

  function findScrollableAncestor(node) {
    let current = node;
    while (current) {
      if (elementCanScroll(current)) return current;
      if (current === document.body || current === document.documentElement)
        break;
      current = getParentNode(current);
    }
    return (
      document.scrollingElement || document.documentElement || document.body
    );
  }

  function getParentNode(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    if (root && root.host) return root.host;
    return null;
  }

  function updateScrollTargetFromTurns(turns) {
    if (!turns || !turns.length) return;
    const firstWithElement = turns.find(
      (t) => t.element && t.element.isConnected
    );
    if (!firstWithElement) return;
    const scrollable = findScrollableAncestor(firstWithElement.element);
    if (scrollable) setScrollEventTarget(scrollable);
  }

  function elementCanScroll(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY || style.overflow;
    if (!overflowY || overflowY === "visible") return false;
    // Don't rely on content.scrollHeight immediately, as virtualized 
    // frameworks like React (in ChatGPT) might not overflow at mount time.
    return /(auto|scroll|overlay)/.test(overflowY);
  }

  function setScrollEventTarget(target) {
    const metricsTarget = target || null;

    if (state.scrollEventTarget === metricsTarget) return;

    state.scrollEventTarget = metricsTarget;
    updateScrollProgress();
  }

  function onScroll() {
    if (state.scrollAnimationFrame) return;
    state.scrollAnimationFrame = requestAnimationFrame(() => {
      // Detect scroll direction before processing
      const scrollSource = getScrollSourceNode();
      let currentScrollTop = 0;
      if (scrollSource && !isDocumentScroller(scrollSource)) {
        currentScrollTop = scrollSource.scrollTop;
      } else {
        const docEl = document.scrollingElement || document.documentElement || document.body;
        currentScrollTop = docEl.scrollTop || 0;
      }
      state.scrollDirection = currentScrollTop >= state.lastScrollTop ? "down" : "up";
      state.lastScrollTop = currentScrollTop;

      updateScrollProgress();
      state.scrollAnimationFrame = null;
    });
  }

  // Feature: Export to Markdown
  function exportChat() {
    if (!state.currentTurns) return;

    let mdContent = `# Chat Export - ${new Date().toLocaleDateString()}\n\n`;
    state.currentTurns.forEach((turn) => {
      const role = turn.role.toUpperCase();
      mdContent += `### ${role}\n\n${turn.text}\n\n---\n\n`;
    });

    const blob = new Blob([mdContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Feature: Floating Bar
  function switchMode(mode) {
    state.uiMode = mode;
    const root = document.getElementById("ai-nav-root");
    if (!root) return;

    const floatingBar = root.querySelector(".ai-floating-bar");
    const iconBtn = root.querySelector("#ai-mode-icon");
    const barBtn = root.querySelector("#ai-mode-bar");

    if (mode === "floating-bar") {
      if (state.isOpen) toggleNav(false);
      floatingBar.style.display = "flex";
      iconBtn.classList.remove("active");
      barBtn.classList.add("active");
      updateScrollProgress();
      updateFloatingBarText();
    } else {
      floatingBar.style.display = "none";
      iconBtn.classList.add("active");
      barBtn.classList.remove("active");
    }
  }

  function toggleFloatingBar() {
    const root = document.getElementById("ai-nav-root");
    if (!root) return;
    const floatingBar = root.querySelector(".ai-floating-bar");
    if (!floatingBar) return;
    const isVisible = floatingBar.style.display === "flex";
    floatingBar.style.display = isVisible ? "none" : "flex";
    if (!isVisible) updateFloatingBarText();
  }

  // Re-fetches turns fresh from DOM on every call so lazy-loaded elements are
  // always included. Finds the last user turn whose top has passed the viewLine.
  function updateFloatingBarText() {
    if (!state.scrollContainer || !state.currentProvider) return;

    const turns = state.currentProvider.getTurns(state.scrollContainer);
    if (!turns.length) return;

    const containerTop = Math.max(0, state.scrollContainer.getBoundingClientRect().top);
    const viewLine = containerTop + getScrollOffset();

    let currentUserTurn = null;
    for (const turn of turns) {
      if (!turn.element || !turn.element.isConnected || turn.role !== "user") continue;
      const rect = turn.element.getBoundingClientRect();
      if (rect.top <= viewLine) {
        currentUserTurn = turn; // keep updating — last one wins
      }
    }

    // Fallback: nothing past viewLine yet — show first user turn
    if (!currentUserTurn) {
      currentUserTurn = turns.find(
        (t) => t.role === "user" && t.element && t.element.isConnected
      );
    }

    if (!currentUserTurn) return;

    const newText = cleanText(currentUserTurn.text);
    if (newText === state.floatingBarText) return;
    animateFloatingBarText(newText, state.scrollDirection);
  }

  function animateFloatingBarText(newText, direction = "down") {
    const textEl = document.getElementById("ai-floating-bar-text");
    if (!textEl) return;

    // First render — set directly with no animation
    if (!state.floatingBarText) {
      textEl.textContent = newText;
      state.floatingBarText = newText;
      return;
    }

    // Scrolling down: current exits up, new enters from below
    // Scrolling up:   current exits down, new enters from above
    const exitY   = direction === "down" ? "-100%" : "100%";
    const enterY  = direction === "down" ? "100%"  : "-100%";

    textEl.style.transition = "transform 0.25s ease-in-out, opacity 0.25s ease-in-out";
    textEl.style.transform = `translateY(${exitY})`;
    textEl.style.opacity = "0";

    setTimeout(() => {
      textEl.textContent = newText;
      state.floatingBarText = newText;
      // Snap to entry position without transition, then animate in
      textEl.style.transition = "none";
      textEl.style.transform = `translateY(${enterY})`;
      textEl.style.opacity = "0";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          textEl.style.transition = "transform 0.25s ease-in-out, opacity 0.25s ease-in-out";
          textEl.style.transform = "translateY(0)";
          textEl.style.opacity = "1";
        });
      });
    }, 250);
  }

  // Utils
  function cleanText(text) {
    let clean = text.replace(/\s+/g, " ").trim();
    if (clean.length > 60) clean = clean.substring(0, 58) + "...";
    return clean;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // Draggable Logic — shared document listeners, per-element mousedown
  document.addEventListener("mouseup", () => {
    state.drag.initialX = state.drag.currentX;
    state.drag.initialY = state.drag.currentY;
    state.drag.active = false;
    state.drag.target = null;
  });

  document.addEventListener("mousemove", (e) => {
    if (!state.drag.active || !state.drag.target) return;
    e.preventDefault();
    state.drag.wasDragging = true;
    state.drag.currentX = e.clientX - state.drag.initialX;
    state.drag.currentY = e.clientY - state.drag.initialY;
    state.drag.xOffset = state.drag.currentX;
    state.drag.yOffset = state.drag.currentY;
    state.drag.target.style.transform = `translate3d(${state.drag.currentX}px, ${state.drag.currentY}px, 0)`;
  });

  function initDraggable(el) {
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ai-nav-panel")) return;
      state.drag.target = el;
      state.drag.initialX = e.clientX - state.drag.xOffset;
      state.drag.initialY = e.clientY - state.drag.yOffset;
      state.drag.active = true;
      state.drag.wasDragging = false;
    });
  }
})();
