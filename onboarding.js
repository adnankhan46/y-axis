(() => {
  // Prevent multiple injections
  if (window.__yaxisOnboardingInjected) return;
  window.__yaxisOnboardingInjected = true;

  // Email extraction methods per platform
  const EMAIL_EXTRACTORS = {
    chatgpt: () => {
      try {
        const bootstrapScript = document.getElementById('client-bootstrap');
        if (bootstrapScript) {
          const data = JSON.parse(bootstrapScript.textContent);
          return data?.user?.email || data?.session?.user?.email || null;
        }
      } catch (e) { console.warn('ChatGPT email parse error', e); }
      return null;
    },
    claude: () => {
      const selectors = ['[data-testid="user-email"]', '.user-email', '[class*="AccountEmail"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent && isValidEmail(el.textContent.trim())) return el.textContent.trim();
      }
      return null;
    },
    gemini: () => {
      // method1
      const accountBtn = document.querySelector('a[aria-label*="@"], button[aria-label*="@"]');
      if (accountBtn) {
        const label = accountBtn.getAttribute('aria-label');
        const emailMatch = label.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) return emailMatch[0];
      }
      // method2
      const profileLinks = document.querySelectorAll('a[href*="accounts.google.com"]');
      for (const link of profileLinks) {
        const text = link.textContent || link.getAttribute('aria-label') || '';
        const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) return emailMatch[0];
      }
      // method3
      const allWithAria = document.querySelectorAll('[aria-label]');
      for (const el of allWithAria) {
        const label = el.getAttribute('aria-label');
        if (label && label.includes('@') && !label.includes('mailto:')) {
          const emailMatch = label.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch && isValidEmail(emailMatch[0])) return emailMatch[0];
        }
      }
      // method4
      const selectors = ['[data-profile-email]', '.profile-identifier', '[data-email]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent && isValidEmail(el.textContent.trim())) return el.textContent.trim();
      }
      return null;
    },
    deepseek: () => {
      const selectors = ['.user-email', '[class*="email"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent && isValidEmail(el.textContent.trim())) return el.textContent.trim();
      }
      return null;
    }
  };

  // current provider
  function detectProvider() {
    const host = window.location.hostname;
    if (host.includes('claude')) return 'claude';
    if (host.includes('chatgpt') || host.includes('openai')) return 'chatgpt';
    if (host.includes('gemini') || host.includes('google')) return 'gemini';
    if (host.includes('deepseek')) return 'deepseek';
    return null;
  }

  // extract email from page using platform-specific methods
  function extractEmailFromPage() {
    const provider = detectProvider();
    if (!provider || !EMAIL_EXTRACTORS[provider]) return null;
    return EMAIL_EXTRACTORS[provider]();
  }

  // email validation
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // check if onboarding is needed
  async function checkOnboarding() {
    try {
      const data = await chrome.storage.local.get('yaxis_user');
      if (!data.yaxis_user || !data.yaxis_user.onboardingComplete) {
        // Wait a bit for page to load
        setTimeout(showOnboardingModal, 2000);
      } else {
        // User already onboarded, show user icon to Main UI
        // addUserIconToUI(data.yaxis_user.email);
      }
    } catch (e) {
      console.error('Y-Axis: Error checking onboarding status', e);
    }
  }

  // Save user data to storage and optionally send to backend
  async function saveUserData(email, method) {
    const userData = {
      email: email || null,
      method: method, // 'manual', 'extracted', or 'skipped'
      onboardingComplete: true,
      consentedAt: method !== 'skipped' ? new Date().toISOString() : null,
      provider: detectProvider()
    };

    // Save to local storage
    await chrome.storage.local.set({ yaxis_user: userData });

    // Send to backend if email was provided
    if (email) {
      try {
        await fetch(CONFIG.API_URL + '/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
      } catch (e) {
        console.warn('Y-Axis: Could not send data to backend', e);
      }
    }

    return userData;
  }

  // Create and show the onboarding modal
  function showOnboardingModal() {
    // Remove any existing modal
    const existing = document.getElementById('yaxis-onboarding');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'yaxis-onboarding';
    overlay.className = 'yaxis-onboarding-overlay';

    const headerBgUrl = chrome.runtime.getURL('public/images/header-1.jpeg');

    overlay.innerHTML = `
      <div class="yaxis-onboarding-modal">
        <div class="yaxis-onboarding-header" style="background-image: url('${headerBgUrl}');">
         <h2 class="yaxis-onboarding-title">Welcome to Y-Axis</h2>
          <p class="yaxis-onboarding-subtitle">
            Navigate through your long AI chats.<br />
           Chat navigation that saves your thumb and your time.
          </p>
        </div>

        <div class="yaxis-form-group">
          <label class="yaxis-form-label">Your Email</label>
          <input 
            type="email" 
            id="yaxis-email-input"
            class="yaxis-email-input" 
            placeholder="hello@yaxis.vercel.app"
          >
        </div>

        <div class="yaxis-consent-box">
          <label class="yaxis-consent-row">
            <input type="checkbox" id="yaxis-consent-checkbox" class="yaxis-checkbox">
            <div>
              <span class="yaxis-consent-text">
                Auto-extract my email from this page
              </span>
              <div class="yaxis-consent-note">
                (I consent to automatic email collection from this page)
              </div>
            </div>
          </label>
          <button id="yaxis-extract-btn" class="yaxis-extract-btn" disabled>
            Auto Extract My Email
          </button>
          <div id="yaxis-extracted-result"></div>
        </div>

        <button id="yaxis-submit-btn" class="yaxis-submit-btn">
          Continue
        </button>
        
        <button id="yaxis-skip-btn" class="yaxis-skip-btn">
        Skip for now
        </button>

        <p class="yaxis-skip-btn-notice">None of your data touches our server.
       <br /> To know who our users are, we take only your email</p>
      
       </div>
    `;

    document.body.appendChild(overlay);

    // Get elements
    const emailInput = overlay.querySelector('#yaxis-email-input');
    const consentCheckbox = overlay.querySelector('#yaxis-consent-checkbox');
    const extractBtn = overlay.querySelector('#yaxis-extract-btn');
    const extractedResult = overlay.querySelector('#yaxis-extracted-result');
    const submitBtn = overlay.querySelector('#yaxis-submit-btn');
    const skipBtn = overlay.querySelector('#yaxis-skip-btn');

    // Enable/disable submit button based on email content
    const updateSubmitButton = () => {
      const hasEmail = emailInput.value.trim().length > 0;
      submitBtn.disabled = !hasEmail;
    };

    // Initially disable submit button
    submitBtn.disabled = true;

    // Listen for email input changes
    emailInput.addEventListener('input', updateSubmitButton);

    // Enable/disable extract button based on consent
    consentCheckbox.addEventListener('change', () => {
      extractBtn.disabled = !consentCheckbox.checked;
    });

    // Extract email on button click
    extractBtn.addEventListener('click', () => {
      const extracted = extractEmailFromPage();
      if (extracted) {
        emailInput.value = extracted;
        extractedResult.innerHTML = `<div class="yaxis-extracted-email">Found: ${extracted}</div>`;
        updateSubmitButton(); // Enable submit button after extraction
      } else {
        extractedResult.innerHTML = `<div class="yaxis-extracted-email" style="color: #ff6b6b; background: rgba(255,107,107,0.15);">
          Email not found on this page. Please enter manually.
        </div>`;
      }
    });

    // Submit handler
    submitBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const method = consentCheckbox.checked && extractEmailFromPage() === email ? 'extracted' : 'manual';
      
      if (email && !isValidEmail(email)) {
        emailInput.style.borderColor = '#ff6b6b';
        return;
      }

      submitBtn.textContent = 'Saving...';
      submitBtn.disabled = true;

      const userData = await saveUserData(email, method);
      closeModal(overlay, userData.email);
    });

    // Skip handler, Now Disabled
    skipBtn.addEventListener('click', async () => {
      await saveUserData(null, 'skipped');
      closeModal(overlay, null);
    });

    // Prevent clicks inside modal from closing
    overlay.querySelector('.yaxis-onboarding-modal').addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close on overlay click (optional - currently disabled for UX)
    // overlay.addEventListener('click', () => closeModal(overlay));
  }

  // Close modal with animation
  function closeModal(overlay, email) {
    overlay.style.animation = 'yaxis-fade-in 0.2s ease reverse';
    setTimeout(() => {
      overlay.remove();
      // if (email) {
      //   addUserIconToUI(email);
      // }
    }, 200);
  }

  // Add user icon to the Y-Axis UI, removing for Now
//   function addUserIconToUI(email) {
//     // Wait for Y-Axis UI to be created
//     const checkUI = setInterval(() => {
//       const toolsContainer = document.querySelector('.ai-nav-tools-1st');
//       if (toolsContainer && !document.querySelector('.yaxis-user-icon')) {
//         clearInterval(checkUI);
        
//         const userIcon = document.createElement('div');
//         userIcon.className = 'yaxis-user-icon';
//         userIcon.innerHTML = `
//           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
//             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
//             <circle cx="12" cy="7" r="4"></circle>
//           </svg>
//           <div class="yaxis-user-tooltip">${email || 'No email'}</div>
//         `;
        
//         toolsContainer.insertBefore(userIcon, toolsContainer.firstChild);
//       }
//     }, 500);

//     // Stop checking after 10 seconds
//     setTimeout(() => clearInterval(checkUI), 10000);
//   }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkOnboarding);
  } else {
    // Small delay to let the main content.js initialize first
    setTimeout(checkOnboarding, 500);
  }
})();
