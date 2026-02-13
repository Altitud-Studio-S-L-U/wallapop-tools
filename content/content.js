/**
 * Content Script - Wallapop Tools
 *
 * Se inyecta en es.wallapop.com y:
 * 1. Detecta en qué página estás (catálogo, producto, chat)
 * 2. Inyecta botones de acción rápida
 * 3. Se comunica con el popup y background via chrome.runtime
 */

(() => {
  // ============================================================
  // STATE
  // ============================================================
  let toolbarInjected = false;

  // ============================================================
  // TOOLBAR - Barra flotante con acciones rápidas
  // ============================================================
  function injectToolbar() {
    if (toolbarInjected) return;
    if (document.getElementById('wt-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'wt-toolbar';
    toolbar.innerHTML = `
      <div class="wt-toolbar-header">
        <span class="wt-toolbar-logo">WT</span>
        <span class="wt-toolbar-title">Wallapop Tools</span>
        <button class="wt-toolbar-toggle" id="wt-toggle">_</button>
      </div>
      <div class="wt-toolbar-body" id="wt-toolbar-body">
        <div class="wt-status" id="wt-status">Conectando...</div>
        <div class="wt-actions">
          <button class="wt-btn wt-btn-primary" id="wt-republish-all">
            Republicar todo
          </button>
          <button class="wt-btn wt-btn-secondary" id="wt-lower-prices">
            Bajar precios -5%
          </button>
          <button class="wt-btn wt-btn-secondary" id="wt-raise-prices">
            Subir precios +5%
          </button>
          <button class="wt-btn wt-btn-secondary" id="wt-load-items">
            Cargar mis productos
          </button>
        </div>
        <div class="wt-progress" id="wt-progress" style="display:none">
          <div class="wt-progress-bar">
            <div class="wt-progress-fill" id="wt-progress-fill"></div>
          </div>
          <span class="wt-progress-text" id="wt-progress-text">0/0</span>
        </div>
        <div class="wt-items-summary" id="wt-items-summary"></div>
      </div>
    `;

    document.body.appendChild(toolbar);
    toolbarInjected = true;
    setupToolbarEvents();
    checkAuthStatus();
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  function setupToolbarEvents() {
    // Toggle minimize
    document.getElementById('wt-toggle').addEventListener('click', () => {
      const body = document.getElementById('wt-toolbar-body');
      const btn = document.getElementById('wt-toggle');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
      btn.textContent = body.style.display === 'none' ? '+' : '_';
    });

    // Republish all
    document.getElementById('wt-republish-all').addEventListener('click', () => {
      republishAll();
    });

    // Lower prices
    document.getElementById('wt-lower-prices').addEventListener('click', () => {
      adjustAllPrices(-5);
    });

    // Raise prices
    document.getElementById('wt-raise-prices').addEventListener('click', () => {
      adjustAllPrices(5);
    });

    // Load items
    document.getElementById('wt-load-items').addEventListener('click', () => {
      loadAndDisplayItems();
    });
  }

  // ============================================================
  // AUTH CHECK
  // ============================================================
  function checkAuthStatus() {
    const status = document.getElementById('wt-status');
    if (window.__wallapopAPI && window.__wallapopAPI.isAuthenticated()) {
      status.textContent = 'Conectado';
      status.className = 'wt-status wt-status-ok';
    } else {
      status.textContent = 'Navega por Wallapop para conectar...';
      status.className = 'wt-status wt-status-waiting';
      // Retry check after a few seconds (token might be captured later)
      setTimeout(checkAuthStatus, 3000);
    }
  }

  // ============================================================
  // CORE ACTIONS
  // ============================================================

  function showProgress(current, total, label) {
    const container = document.getElementById('wt-progress');
    const fill = document.getElementById('wt-progress-fill');
    const text = document.getElementById('wt-progress-text');
    container.style.display = 'block';
    const pct = total > 0 ? (current / total) * 100 : 0;
    fill.style.width = `${pct}%`;
    text.textContent = label || `${current}/${total}`;
  }

  function hideProgress() {
    document.getElementById('wt-progress').style.display = 'none';
  }

  function setStatus(msg, type = 'ok') {
    const status = document.getElementById('wt-status');
    status.textContent = msg;
    status.className = `wt-status wt-status-${type}`;
  }

  async function loadAndDisplayItems() {
    const api = window.__wallapopAPI;
    if (!api || !api.isAuthenticated()) {
      setStatus('No conectado. Navega por Wallapop primero.', 'error');
      return;
    }

    setStatus('Cargando productos...', 'waiting');
    try {
      const items = await api.getAllMyItems();
      const summary = document.getElementById('wt-items-summary');

      // Store items for later use
      window.__wallapopItems = items;

      // Save count to storage for popup
      chrome.storage.local.set({ wallapop_item_count: items.length });

      summary.innerHTML = `
        <div class="wt-items-count">${items.length} productos encontrados</div>
        <div class="wt-items-list">
          ${items
            .slice(0, 20)
            .map(
              (item) => `
            <div class="wt-item-row">
              <span class="wt-item-title">${escapeHtml(item.title || item.name || 'Sin titulo')}</span>
              <span class="wt-item-price">${item.sale_price || item.price || '?'}${item.currency || '\u20AC'}</span>
            </div>
          `
            )
            .join('')}
          ${items.length > 20 ? `<div class="wt-items-more">...y ${items.length - 20} mas</div>` : ''}
        </div>
      `;

      setStatus(`${items.length} productos cargados`, 'ok');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      console.error('[WallapopTools]', err);
    }
  }

  async function republishAll() {
    const api = window.__wallapopAPI;
    if (!api || !api.isAuthenticated()) {
      setStatus('No conectado. Navega por Wallapop primero.', 'error');
      return;
    }

    setStatus('Cargando productos para republicar...', 'waiting');

    try {
      let items = window.__wallapopItems;
      if (!items) {
        items = await api.getAllMyItems();
        window.__wallapopItems = items;
      }

      const total = items.length;
      let success = 0;
      let failed = 0;

      setStatus(`Republicando ${total} productos...`, 'waiting');

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        showProgress(i + 1, total, `Republicando ${i + 1}/${total}...`);

        try {
          await api.republishItem(item.id);
          success++;
        } catch (err) {
          failed++;
          console.warn(`[WallapopTools] Failed to republish ${item.id}:`, err);
        }

        // Delay between requests to avoid rate limiting
        // Random delay between 2-5 seconds to look more human
        const delay = 2000 + Math.random() * 3000;
        await new Promise((r) => setTimeout(r, delay));
      }

      hideProgress();
      setStatus(`Republicados: ${success} ok, ${failed} errores`, success > 0 ? 'ok' : 'error');

      // Log to storage for analytics
      chrome.storage.local.set({
        last_republish: {
          date: new Date().toISOString(),
          total,
          success,
          failed,
        },
      });
    } catch (err) {
      hideProgress();
      setStatus(`Error: ${err.message}`, 'error');
    }
  }

  async function adjustAllPrices(percentChange) {
    const api = window.__wallapopAPI;
    if (!api || !api.isAuthenticated()) {
      setStatus('No conectado.', 'error');
      return;
    }

    const direction = percentChange > 0 ? 'subir' : 'bajar';
    const confirmed = confirm(
      `Vas a ${direction} el precio de TODOS tus productos un ${Math.abs(percentChange)}%. ¿Continuar?`
    );
    if (!confirmed) return;

    setStatus('Cargando productos...', 'waiting');

    try {
      let items = window.__wallapopItems;
      if (!items) {
        items = await api.getAllMyItems();
        window.__wallapopItems = items;
      }

      const total = items.length;
      let success = 0;
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const currentPrice = parseFloat(item.sale_price || item.price || 0);
        if (currentPrice <= 0) continue;

        const newPrice = Math.round(currentPrice * (1 + percentChange / 100) * 100) / 100;
        showProgress(i + 1, total, `Actualizando precio ${i + 1}/${total}...`);

        try {
          await api.updateItemPrice(item.id, newPrice);
          success++;
        } catch (err) {
          failed++;
          console.warn(`[WallapopTools] Failed to update price for ${item.id}:`, err);
        }

        // Random delay to avoid rate limits
        const delay = 1500 + Math.random() * 2500;
        await new Promise((r) => setTimeout(r, delay));
      }

      hideProgress();
      setStatus(`Precios actualizados: ${success} ok, ${failed} errores`, success > 0 ? 'ok' : 'error');
    } catch (err) {
      hideProgress();
      setStatus(`Error: ${err.message}`, 'error');
    }
  }

  // ============================================================
  // MESSAGING - Communication with popup & background
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const api = window.__wallapopAPI;

    switch (message.action) {
      case 'getStatus':
        sendResponse({
          authenticated: api ? api.isAuthenticated() : false,
          status: api ? api.getStatus() : null,
          itemCount: window.__wallapopItems?.length || 0,
        });
        break;

      case 'getItems':
        if (api && api.isAuthenticated()) {
          api
            .getAllMyItems()
            .then((items) => {
              window.__wallapopItems = items;
              sendResponse({ items });
            })
            .catch((err) => sendResponse({ error: err.message }));
          return true; // Keep channel open for async response
        }
        sendResponse({ error: 'Not authenticated' });
        break;

      case 'republishAll':
        republishAll();
        sendResponse({ started: true });
        break;

      case 'adjustPrices':
        adjustAllPrices(message.percent);
        sendResponse({ started: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  });

  // ============================================================
  // HELPERS
  // ============================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Wait for page to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => injectToolbar());
    } else {
      // Small delay to let Wallapop's app initialize
      setTimeout(injectToolbar, 1500);
    }
  }

  init();
})();
