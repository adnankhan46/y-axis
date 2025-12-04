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
        // Selectors optimized for reliability
        const userSelector = '[data-testid="user-message"]';
        const aiSelectors = [
          '.font-claude-response',
          '[data-testid="assistant-message"]',
          '.claude-response' 
        ].join(', ');
        
        const allItems = Array.from(container.querySelectorAll(`${userSelector}, ${aiSelectors}`));
        
        allItems.forEach(el => {
           // Find the "Turn" container to scroll to (usually a parent wrapper)
           const turnContainer = el.closest('[data-testid="conversation-turn"]') || el.parentElement;
           const isUser = el.matches(userSelector) || el.querySelector(userSelector);
           
           // Extract headings only from AI responses
           let headings = [];
           if (!isUser) {
              headings = Array.from(el.querySelectorAll('h1, h2, h3')).map(h => ({
                 innerText: h.innerText, element: h
              }));
           }
           
           turns.push({
              role: isUser ? 'user' : 'assistant',
              element: turnContainer || el,
              text: (el.innerText || '').trim(), 
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
      scrollContainerSelector: '.mat-sidenav-content, main', // Fallback added
      getTurns: (container) => {
        const turns = [];
        // Gemini uses custom elements often
        const items = Array.from(container.querySelectorAll('user-query, model-response'));
        
        items.forEach(item => {
           const isUser = item.tagName.toLowerCase() === 'user-query';
           let text = '';
           let headings = [];
           
           if (isUser) {
              const textEl = item.querySelector('.query-text') || item;
              text = textEl.innerText || '';
           } else {
              const markdown = item.querySelector('.markdown');
              if (markdown) {
                 text = markdown.innerText || '';
                 headings = Array.from(markdown.querySelectorAll('h1, h2, h3')).map(h => ({
                   innerText: h.innerText, element: h
                 }));
              }
           }
           turns.push({ role: isUser ? 'user' : 'assistant', element: item, text, headings });
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
    navTargets: new Map(),
    scrollContainer: null,
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
            state.scrollContainer = container;
            refreshNavigation();
            // Once found, we can slow down or stop this observer if stable, 
            // but for SPAs we keep watching the container content:
            observeContainerContent(container);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function findConversationContainer() {
    return document.querySelector(state.currentProvider.scrollContainerSelector);
  }

  function observeContainerContent(node) {
      const contentObserver = new MutationObserver(debounce(() => refreshNavigation(), 300));
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
  }

  function toggleNav() {
    state.isOpen = !state.isOpen;
    document.getElementById('ai-nav-root').classList.toggle('open', state.isOpen);
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
    
    // Get Turns
    const turns = state.currentProvider.getTurns(state.scrollContainer);
    state.currentTurns = turns; // Save for export

    const list = document.createElement('ul');
    
    turns.forEach((turn, index) => {
       const isUser = turn.role === 'user';
       if (state.viewLevel === 1 && !isUser) return;

       const textLower = turn.text.toLowerCase();
       const matchesSearch = !state.searchTerm || textLower.includes(state.searchTerm);
       
       if (!matchesSearch) return;

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
       
       li.onclick = () => {
           turn.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
           // Highlight effect
           turn.element.style.transition = 'background 0.3s';
           const oldBg = turn.element.style.backgroundColor;
           turn.element.style.backgroundColor = 'rgba(255, 255, 0, 0.1)';
           setTimeout(() => { turn.element.style.backgroundColor = oldBg; }, 1000);
       };

       list.appendChild(li);

       // Render Headings (Sub-items)
       if (!isUser && turn.headings.length > 0) {
           const subUl = document.createElement('ul');
           subUl.className = 'ai-nav-sublist';
           turn.headings.forEach(h => {
               const subLi = document.createElement('li');
               subLi.innerText = h.innerText;
               subLi.onclick = (e) => {
                   e.stopPropagation();
                   h.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
               };
               subUl.appendChild(subLi);
           });
           list.appendChild(subUl);
       }
    });

    listContainer.innerHTML = '';
    listContainer.appendChild(list);
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