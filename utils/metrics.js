
const METRICS_CONFIG = {
  METRICS_ENDPOINT: CONFIG.API_URL + '/metrics', 
  FLUSH_INTERVAL: 30*1000, // 30 sec
  BATCH_SIZE: 10,
  DEBUG: true // true for console logs
};

class MetricsManager {
  constructor() {
    this.queue = [];
    this.installId = null;
    this.isFlushing = false;
    
    // Init
    this._loadInstallId();
    this._setupLifecycleListeners();
  }

  /**
   * Loads or generates a unique Install ID.
   * Tracks 'extension_installed' if a new ID is generated.
   */
  async _loadInstallId() {
    try {
      const result = await chrome.storage.local.get(['install_id']);
      if (result.install_id) {
        this.installId = result.install_id;
      } else {
        // New Install
        this.installId = crypto.randomUUID();
        await chrome.storage.local.set({ install_id: this.installId });
        this.track('extension_installed', { timestamp: Date.now() });
      }
    } catch (e) {
      if (METRICS_CONFIG.DEBUG) console.error('Error loading install ID:', e);
    }
  }

  /**
   * Tracks an event.
   * @param {string} eventName - Name of the event
   * @param {object} payload - Optional data
   */
  track(eventName, payload = {}) {
    if (!this.installId) {
      // If ID not loaded yet, queue temporarily (or retry slightly later)
      // For simplicity, we just push; flush will handle missing ID checks
    }

    const event = {
      name: eventName,
      timestamp: Date.now(),
      payload: payload
    };

    this.queue.push(event);

    if (METRICS_CONFIG.DEBUG) console.log(`[Metrics] Queued: ${eventName}`, event);

    // Schedule a flush when the browser is idle
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => this._flushIfNeeded());
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(() => this._flushIfNeeded(), 5000);
    }
  }

  /**
   * Determines if a flush is necessary based on batch size.
   */
  _flushIfNeeded() {
    if (this.queue.length >= METRICS_CONFIG.BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Sends the queued events to the backend.
   */
  async flush() {
    if (this.queue.length === 0 || this.isFlushing || !this.installId) return;

    this.isFlushing = true;
    const batch = this.queue.slice(0, METRICS_CONFIG.BATCH_SIZE); // Take a batch
    
    // Optimistic remove from queue (to avoid infinite loops on hard failures)
    // In a critical system, we might remove ONLY after success. 
    // For "Fail Silently", removing immediately prevents memory leaks if backend is down.
    this.queue = this.queue.slice(METRICS_CONFIG.BATCH_SIZE);

    try {
      const body = {
        install_id: this.installId,
        sent_at: Date.now(),
        events: batch
      };

      // Use keepalive to allow request to complete even if tab closes
      await fetch(METRICS_CONFIG.METRICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      });

      if (METRICS_CONFIG.DEBUG) console.log(`[Metrics] Flushed ${batch.length} events`);

    } catch (error) {
       // Fail Silently
       if (METRICS_CONFIG.DEBUG) console.error('[Metrics] Flush failed:', error);
    } finally {
      this.isFlushing = false;
      
      // If items remain, schedule another flush
      if (this.queue.length > 0) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => this.flush());
        }
      }
    }
  }

  /**
   * Ensure data is sent before the page unloads.
   */
  _setupLifecycleListeners() {
    // Flush on page visibility change (user leaves tab)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }
}

window.metrics = new MetricsManager();