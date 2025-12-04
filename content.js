(() => {
  if (window.__scrollNavInjected) return;
  window.__scrollNavInjected = true;

  // --- 1. SMART PROVIDERS (Added DeepSeek) ---
  const PROVIDERS = {
    claude: {
      isMatch: () => window.location.hostname.includes('claude'),
      scrollContainerSelector: 'main div[class*="overflow-y-auto"]',
      getTurns: (container) => {
        const turns = [];
        const assistantSelectors = [
          '.font-claude-response',
          '[data-testid="assistant-response"]',
          '[data-testid="assistant-message"]'  
        ].join(', ');
        const selector = `[data-testid="user-message"], ${assistantSelectors}`;
        const seen = new Set();
        const allItems = Array.from(container.querySelectorAll(selector)).filter(el => {
          if (!el) return false;
          if (seen.has(el)) return false;
          const containerEl = el.closest('[data-testid="conversation-turn"]') || el.closest('.group');
          if (!containerEl) return false;
          const text = (el.innerText || '').trim();
          if (!text) return false;
          seen.add(el);
          return true;
        });
        
        allItems.forEach(el => {
           const isUser = el.getAttribute('data-testid') === 'user-message';
           const turnContainer = el.closest('[data-testid="conversation-turn"]') || el.closest('.group') || el.parentElement;
           
           let headings = [];
           if (!isUser) {
              headings = Array.from(el.querySelectorAll('h1, h2, h3, h4')).map(h => ({
                 innerText: h.innerText, element: h
              }));
           }
           
           turns.push({
              role: isUser ? 'user' : 'assistant',
              element: turnContainer,
              text: el.innerText || '', 
              headings: headings
           });
        });
        return turns;
      }
    },
    chatgpt: {
      isMatch: () => window.location.hostname.includes('chatgpt') || window.location.hostname.includes('openai'),
      scrollContainerSelector: 'main div[class*="overflow-y-auto"]',
      getTurns: (container) => {
        const articles = Array.from(container.querySelectorAll('article[data-turn]'));
        return articles.map(article => {
          const role = article.dataset.turn; // 'user' or 'assistant'
          let text = '';
          let headings = [];
          
          if (role === 'user') {
             const textEl = article.querySelector('[data-message-author-role="user"]');
             text = textEl ? textEl.innerText : '';
          } else {
             const contentEl = article.querySelector('.markdown') || article.querySelector('[data-message-author-role="assistant"]');
             if (contentEl) {
               text = contentEl.innerText || '';
               headings = Array.from(contentEl.querySelectorAll('h1, h2, h3')).map(h => ({
                 innerText: h.innerText, element: h
               }));
             }
          }
          return { role, element: article, text, headings };
        });
      }
    },
    gemini: {
      isMatch: () => window.location.hostname.includes('gemini') || window.location.hostname.includes('google'),
      scrollContainerSelector: '.mat-sidenav-content',
      getTurns: (container) => {
        const turns = [];
        const items = Array.from(container.querySelectorAll('user-query, model-response'));
        items.forEach(item => {
           const isUser = item.tagName.toLowerCase() === 'user-query';
           let text = '';
           let headings = [];
           
           if (isUser) {
              const textEl = item.querySelector('.query-text');
              text = textEl ? textEl.innerText : '';
           } else {
              const markdown = item.querySelector('.markdown');
              if (markdown) {
                 text = markdown.innerText || '';
                 headings = Array.from(markdown.querySelectorAll('h1, h2, h3, h4')).map(h => ({
                   innerText: h.innerText, element: h
                 }));
              }
           }
           
           turns.push({ 
              role: isUser ? 'user' : 'assistant', 
              element: item, 
              text: text, 
              headings: headings 
           });
        });
        return turns;
      }
    },
    deepseek: {
      isMatch: () => window.location.hostname.includes('deepseek'),
      scrollContainerSelector: '#root > div, main', 
      getTurns: (container) => {
        // Generic React/Div structure fallback strategy
        const turns = [];
        // DeepSeek often uses specific classes for bubbles
        const bubbles = Array.from(document.querySelectorAll('.ds-chat-bubble, .chat-message, [class*="message"]'));
        
        bubbles.forEach(el => {
            const isUser = el.classList.contains('ds-user') || el.textContent.includes('You') || window.getComputedStyle(el).justifyContent === 'flex-end';
            const headings = [];
            
            if (!isUser) {
                 const hTags = el.querySelectorAll('h1, h2, h3');
                 hTags.forEach(h => headings.push({ innerText: h.innerText, element: h }));
            }

            turns.push({
                role: isUser ? 'user' : 'assistant',
                element: el,
                text: el.innerText,
                headings: headings
            });
        });
        return turns;
      }
    }
  };

  // --- State ---
  const state = {
    isOpen: false,
    currentProvider: null,
    searchTerm: '', 
    viewLevel: 2, 
    navTargets: new Map(),      // ID → element mapping
    navItems: new Map(),        // ID → DOM element mapping
    focusableIds: [],          // Array of nav item IDs in focus order
    focusedIndex: -1,          // Current keyboard focus index
    activeNavId: null,         // Currently active item (scroll-based)
    scrollContainer: null,
    scrollEventTarget: null,   // The element that actually scrolls
    scrollListenerTarget: null,// The element we listen to for scroll events
    suppressNavAutoScroll: false, // Temporarily disable auto-highlight when manually navigating
    navAutoScrollTimeout: null,
    scrollAnimationFrame: null,
    drag: { active: false, currentX: 0, currentY: 0, initialX: 0, initialY: 0, xOffset: 0, yOffset: 0 }
  };

  // --- Initialization ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    state.currentProvider = Object.values(PROVIDERS).find(p => p.isMatch());
    if (!state.currentProvider) return; // Exit if not on a supported site

    createUI();
    applyTheme();
    
    // Watch for chat load
    const observer = new MutationObserver(() => {
        const container = findConversationContainer();
        if (container && container !== state.scrollContainer) {
            setConversationContainer(container);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Try to find container immediately
    const container = findConversationContainer();
    if (container) {
      setConversationContainer(container);
    }
  }

  function findConversationContainer() {
    if (!state.currentProvider) return null;
    return document.querySelector(state.currentProvider.scrollContainerSelector) || 
           document.querySelector('main') || 
           document.body;
  }

  function setConversationContainer(container) {
    if (container === state.scrollContainer) return;
    state.scrollContainer = container;
    
    // Observe container for changes
    observeContainerContent(container);
    
    // Set scroll target to container first (will be updated by updateScrollTargetFromTurns in refreshNavigation)
    setScrollEventTarget(container);
    
    // Initial refresh (this will call updateScrollTargetFromTurns to fix scroll target)
    refreshNavigation();
  }

  function observeContainerContent(node) {
    const contentObserver = new MutationObserver(debounce(() => {
      refreshNavigation();
    }, 500));
    contentObserver.observe(node, { childList: true, subtree: true, characterData: true });
  }

  // --- UI Construction ---
  function createUI() {
    const root = document.createElement('div');
    root.id = 'ai-nav-root';
    
    // 1. Draggable Toggle Button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ai-nav-toggle';
    toggleBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <circle cx="3" cy="6" r="1"></circle>
        <circle cx="3" cy="12" r="1"></circle>
        <circle cx="3" cy="18" r="1"></circle>
      </svg>`;
    
    // Drag Logic for Button
    initDraggable(toggleBtn);
    toggleBtn.addEventListener('click', (e) => {
        if (!state.drag.wasDragging) toggleNav();
    });

    // 2. Main Panel
    const panel = document.createElement('div');
    panel.className = 'ai-nav-panel';
    panel.innerHTML = `
      <div class="ai-nav-header">
        <div class="ai-nav-tools">
            <button class="ai-tool-btn" id="ai-export-btn" title="Export Chat to Markdown">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <div class="ai-view-switch">
                <button data-level="1">View Prompts</button>
                <button data-level="2" class="active">View All</button>
            </div>
        </div>
        <input type="text" class="ai-search" placeholder="Search conversation...">
      </div>
      <div class="ai-nav-content" id="ai-nav-content"></div>
    `;

    root.appendChild(toggleBtn);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Event Listeners
    panel.querySelector('.ai-search').addEventListener('input', (e) => {
        state.searchTerm = e.target.value.toLowerCase();
        refreshNavigation();
    });

    panel.querySelectorAll('.ai-view-switch button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.viewLevel = parseInt(btn.dataset.level);
            panel.querySelectorAll('.ai-view-switch button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            refreshNavigation();
        });
    });

    document.getElementById('ai-export-btn').addEventListener('click', exportChat);

    // Keyboard Shortcuts
    setupKeyboardNavigation();
  }

  // --- Keyboard Navigation ---
  function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      // Toggle panel: Cmd/Ctrl + . or ;
      if ((e.metaKey || e.ctrlKey) && (e.key === '.' || e.key === ';')) {
        e.preventDefault();
        toggleNav();
        return;
      }

      // Only handle other shortcuts if panel is open
      if (!state.isOpen) return;

      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        toggleNav(false);
        return;
      }

      // Don't interfere with typing in inputs
      const activeEl = document.activeElement;
      const typingContext = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      );
      if (typingContext) return;

      // Navigation shortcuts
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        activateFocusedItem();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewLevel(1); // Set to "Prompts"
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewLevel(2); // Set to "All"
      }
    });
  }

  function toggleNav(forceState) {
    const root = document.getElementById('ai-nav-root');
    const newState = forceState !== undefined ? forceState : !state.isOpen;
    state.isOpen = newState;
    root.classList.toggle('open', newState);
    
    if (newState) {
      // Set initial focus when opening
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
    if (state.viewLevel === level) return; // Don't re-render if no change
    const root = document.getElementById('ai-nav-root');
    if (!root) return;
    
    const viewBtns = root.querySelectorAll('.ai-view-switch button');
    viewBtns.forEach(b => {
      const btnLevel = parseInt(b.dataset.level);
      b.classList.toggle('active', btnLevel === level);
    });
    
    state.viewLevel = level;
    refreshNavigation();
  }

  // --- Focus Management ---
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
      state.focusedIndex = (state.focusedIndex + direction + ids.length) % ids.length;
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
    const root = document.getElementById('ai-nav-root');
    if (!root) return;
    root.querySelectorAll('.ai-nav-focused').forEach(el => el.classList.remove('ai-nav-focused'));
    if (state.focusedIndex === -1) return;
    const id = state.focusableIds[state.focusedIndex];
    const el = id ? state.navItems.get(id) : null;
    if (!el) return;
    el.classList.add('ai-nav-focused');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function applyTheme() {
    const host = window.location.hostname;
    const root = document.getElementById('ai-nav-root');
    if (host.includes('claude')) root.classList.add('theme-claude');
    else if (host.includes('chatgpt')) root.classList.add('theme-openai');
    else if (host.includes('gemini')) root.classList.add('theme-gemini');
    else root.classList.add('theme-dark'); // default/deepseek
  }

  // --- Logic: Refresh & Render ---
  function refreshNavigation() {
    if (!state.scrollContainer) return;
    const listContainer = document.getElementById('ai-nav-content');
    if (!listContainer) return;
    
    // Get Turns and update scroll target from actual elements
    let turns = state.currentProvider.getTurns(state.scrollContainer);
    state.currentTurns = turns; // Save for export
    
    // Update scroll target detection from actual turn elements (critical for Gemini/Claude)
    updateScrollTargetFromTurns(turns);
    
    // Sort turns by document position
    turns.sort((a, b) => {
      if (!a.element || !b.element) return 0;
      const position = a.element.compareDocumentPosition(b.element);
      return (position & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    // Clear previous mappings
    state.navTargets.clear();
    state.navItems.clear();
    const focusOrder = [];

    const list = document.createElement('ul');
    let hasVisibleItems = false;
    
    turns.forEach((turn, index) => {
       const isUser = turn.role === 'user';
       if (state.viewLevel === 1 && !isUser) return;

       const textLower = (turn.text || '').toLowerCase();
       const term = state.searchTerm.trim();
       const promptMatch = term === '' || textLower.includes(term);
       const matchingHeadings = turn.headings.filter(h => term === '' || h.innerText.toLowerCase().includes(term));
       
       if (!promptMatch && matchingHeadings.length === 0) return;
       hasVisibleItems = true;

       // Create unique ID for this item
       const targetId = `nav-target-${index}`;
       
       const li = document.createElement('li');
       li.className = `ai-nav-item ${isUser ? 'user' : 'ai'}`;
       li.innerHTML = `
         <span class="ai-nav-icon">
            ${isUser ? 
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' : 
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 2a10 10 0 0 1 10 10h-10V2z"></path><path d="M12 12l9.5 5.5"></path><path d="M12 12l-9.5 5.5"></path></svg>'
            }
         </span>
         <span class="ai-nav-text">${cleanText(turn.text)}</span>
       `;
       
       // Store mappings
       state.navTargets.set(targetId, turn.element);
       state.navItems.set(targetId, li);
       focusOrder.push(targetId);
       
       li.addEventListener('click', (e) => {
         e.stopPropagation();
         scrollToElement(turn.element, targetId);
       });

       list.appendChild(li);

       // Render Headings (Sub-items)
       const headingsToShow = state.searchTerm ? matchingHeadings : turn.headings;
       if (!isUser && headingsToShow.length > 0) {
           const subUl = document.createElement('ul');
           subUl.className = 'ai-nav-sublist';
           headingsToShow.forEach((h, hIndex) => {
               const subLi = document.createElement('li');
               subLi.className = 'ai-nav-subitem';
               subLi.innerText = h.innerText;
               
               const hId = `${targetId}-h-${hIndex}`;
               state.navTargets.set(hId, h.element);
               state.navItems.set(hId, subLi);
               focusOrder.push(hId);
               
               subLi.addEventListener('click', (e) => {
                   e.stopPropagation();
                   scrollToElement(h.element, hId);
               });
               subUl.appendChild(subLi);
           });
           list.appendChild(subUl);
       }
    });

    listContainer.innerHTML = '';
    if (hasVisibleItems) {
      listContainer.appendChild(list);
    } else {
      listContainer.innerHTML = '<div class="ai-nav-empty-state">No matches found</div>';
    }
    
    // Update focusable IDs
    state.focusableIds = focusOrder;
    if (!focusOrder.length) {
      state.focusedIndex = -1;
    } else if (state.focusedIndex >= focusOrder.length) {
      state.focusedIndex = focusOrder.length - 1;
    }
    updateFocusVisuals();
    
    // Update scroll progress and active item if not searching
    if (!state.searchTerm) {
      setTimeout(updateScrollProgress, 100);
    }
  }

  // --- Active Item Tracking & Scroll Management ---
  function scrollToElement(element, targetId) {
    if (!element) return;
    
    // Suppress auto-scroll when manually navigating
    state.suppressNavAutoScroll = true;
    if (state.navAutoScrollTimeout) clearTimeout(state.navAutoScrollTimeout);
    state.navAutoScrollTimeout = setTimeout(() => {
      state.suppressNavAutoScroll = false;
    }, 800);
    
    setActiveItem(targetId);

    const scrollSource = getScrollSourceNode();
    const offset = getScrollOffset();

    if (!scrollSource) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (isDocumentScroller(scrollSource)) {
      const globalTop = window.scrollY || window.pageYOffset || 0;
      const targetTop = element.getBoundingClientRect().top + globalTop - offset;
      window.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      const containerRect = scrollSource.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const targetTop = scrollSource.scrollTop + (elementRect.top - containerRect.top) - offset;
      if (typeof scrollSource.scrollTo === 'function') {
        scrollSource.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        scrollSource.scrollTop = targetTop;
      }
    }

    // Update focus index
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
      if (oldItem) oldItem.classList.remove('ai-nav-active');
    }
    const newItem = state.navItems.get(id);
    if (newItem) {
      newItem.classList.add('ai-nav-active');
      newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    state.activeNavId = id;
  }

  function updateScrollProgress() {
    if (!state.scrollContainer) return;
    
    const scrollSource = getScrollSourceNode();
    if (!scrollSource) return;

    // Find closest item to viewport
    if (state.suppressNavAutoScroll) return;
    
    const headerOffset = getScrollOffset();
    const viewLine = state.scrollContainer.getBoundingClientRect().top + headerOffset;
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
    return state.scrollEventTarget || state.scrollContainer || document.scrollingElement || document.documentElement || document.body;
  }

  function isDocumentScroller(node) {
    if (!node) return false;
    const docEl = document.documentElement;
    const body = document.body;
    const scrollingEl = document.scrollingElement;
    return node === body || node === docEl || node === scrollingEl;
  }

  function getScrollOffset() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const dynamicOffset = viewportHeight ? viewportHeight * 0.15 : 0;
    const baseOffset = dynamicOffset || 110;
    return Math.min(Math.max(baseOffset, 80), 170);
  }

  function findScrollableAncestor(node) {
    let current = node;
    while (current) {
      if (elementCanScroll(current)) return current;
      if (current === document.body || current === document.documentElement) break;
      current = getParentNode(current);
    }
    return document.scrollingElement || document.documentElement || document.body;
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
    const firstWithElement = turns.find(t => t.element && t.element.isConnected);
    if (!firstWithElement) return;
    const scrollable = findScrollableAncestor(firstWithElement.element);
    if (scrollable) setScrollEventTarget(scrollable);
  }

  function elementCanScroll(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY || style.overflow;
    if (!overflowY || overflowY === 'visible') return false;
    const contentLarger = el.scrollHeight - el.clientHeight > 4;
    return contentLarger && /(auto|scroll|overlay)/.test(overflowY);
  }

  function setScrollEventTarget(target) {
    const metricsTarget = target || null;
    const listenerTarget = (metricsTarget === document.body || metricsTarget === document.documentElement) ? window : metricsTarget;
    
    if (state.scrollEventTarget === metricsTarget && state.scrollListenerTarget === listenerTarget) return;

    if (state.scrollListenerTarget) {
      state.scrollListenerTarget.removeEventListener('scroll', onScroll);
    }

    state.scrollEventTarget = metricsTarget;
    state.scrollListenerTarget = listenerTarget || null;

    if (state.scrollListenerTarget && state.scrollListenerTarget.addEventListener) {
      state.scrollListenerTarget.addEventListener('scroll', onScroll, { passive: true });
    }

    updateScrollProgress();
  }

  function onScroll() {
    if (state.scrollAnimationFrame) return;
    state.scrollAnimationFrame = requestAnimationFrame(() => {
      updateScrollProgress();
      state.scrollAnimationFrame = null;
    });
  }

  // --- Feature: Export to Markdown ---
  function exportChat() {
    if (!state.currentTurns) return;
    
    let mdContent = `# Chat Export - ${new Date().toLocaleDateString()}\n\n`;
    
    state.currentTurns.forEach(turn => {
        const role = turn.role.toUpperCase();
        mdContent += `### ${role}\n\n${turn.text}\n\n---\n\n`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Utils ---
  function cleanText(text) {
    // Better cleaning: remove newlines, take first sentence or 60 chars
    let clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length > 60) clean = clean.substring(0, 58) + '...';
    return clean;
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }
  }

  // --- Draggable Logic ---
  function initDraggable(el) {
    el.addEventListener("mousedown", dragStart);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("mousemove", drag);

    function dragStart(e) {
      if (e.target.closest('.ai-nav-panel')) return; // Don't drag if clicking panel
      state.drag.initialX = e.clientX - state.drag.xOffset;
      state.drag.initialY = e.clientY - state.drag.yOffset;
      state.drag.active = true;
      state.drag.wasDragging = false;
    }

    function dragEnd(e) {
      state.drag.initialX = state.drag.currentX;
      state.drag.initialY = state.drag.currentY;
      state.drag.active = false;
    }

    function drag(e) {
      if (!state.drag.active) return;
      e.preventDefault();
      state.drag.wasDragging = true;
      state.drag.currentX = e.clientX - state.drag.initialX;
      state.drag.currentY = e.clientY - state.drag.initialY;
      state.drag.xOffset = state.drag.currentX;
      state.drag.yOffset = state.drag.currentY;
      setTranslate(state.drag.currentX, state.drag.currentY, el);
    }

    function setTranslate(xPos, yPos, el) {
      el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
    }
  }
})();