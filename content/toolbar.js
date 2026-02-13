/**
 * Floating Toolbar - Wallapop Tools v3.0
 *
 * Runs at document_idle on wallapop.com domains (es/it/fr/pt).
 * Builds UI entirely with createElement + textContent (no innerHTML).
 * Communicates exclusively with the service worker via chrome.runtime.sendMessage.
 * Supports drag, collapse/expand, progress, item list, toast notifications, and i18n.
 * Uses I18nRuntime for runtime locale switching.
 */

(() => {
  'use strict';

  // ============================================================
  // HELPERS
  // ============================================================

  const i18n = (key, substitutions) => I18nRuntime.getMessage(key, substitutions);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, val] of Object.entries(attrs)) {
        if (key === 'className') node.className = val;
        else if (key === 'textContent') node.textContent = val;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), val);
        else node.setAttribute(key, val);
      }
    }
    if (children) {
      for (const child of Array.isArray(children) ? children : [children]) {
        if (typeof child === 'string') node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  // ============================================================
  // STATE
  // ============================================================

  let toolbar = null;
  let collapsed = false;
  let statusDotEl = null;
  let statusTextEl = null;
  let progressContainer = null;
  let progressFill = null;
  let progressTextEl = null;
  let itemsSummary = null;
  let toastContainer = null;
  let actionButtons = [];
  let pricePanelItems = [];
  let pricePercentInput = null;
  let priceSelectAllCheckbox = null;
  let priceListEl = null;
  let priceItemsContainer = null;

  // ============================================================
  // BUILD TOOLBAR
  // ============================================================

  function buildToolbar() {
    if (document.getElementById('wt-toolbar')) return;

    // macOS traffic lights: red=collapse, green=status indicator
    const dotClose = el('button', { className: 'wt-dot wt-dot-close', title: i18n('labelMinimize'), onClick: () => toggleCollapse() });
    statusDotEl = el('span', { className: 'wt-dot wt-dot-status', title: i18n('labelConnectionStatus') });
    const dots = el('div', { className: 'wt-header-dots' }, [dotClose, statusDotEl]);

    const titleEl = el('span', { className: 'wt-header-title', textContent: 'Wallapop Tools' });
    const header = el('div', { className: 'wt-toolbar-header' }, [dots, titleEl]);

    // Status pill
    const statusDot = el('span', { className: 'wt-status-dot' });
    statusTextEl = el('span', { textContent: i18n('statusConnecting') });
    const statusPill = el('div', { className: 'wt-status-pill' }, [statusDot, statusTextEl]);

    // Republish button
    const btnRepublish = el('button', {
      className: 'wt-btn wt-btn-primary',
      onClick: () => doRepublish(),
    }, [el('span', { className: 'wt-btn-icon', textContent: '\u21BB' }), ' ' + i18n('btnRepublishAll')]);

    // Price stepper row (always visible)
    const btnMinus = el('button', { className: 'wt-stepper-btn', textContent: '\u2212', onClick: () => stepPercent(-1) });
    pricePercentInput = el('input', {
      type: 'number', className: 'wt-stepper-input', value: '5', min: '-50', max: '50', step: '1',
      onInput: () => updatePricePreview(),
    });
    const btnPlus = el('button', { className: 'wt-stepper-btn', textContent: '+', onClick: () => stepPercent(1) });
    const pctLabel = el('span', { className: 'wt-stepper-label', textContent: '%' });
    const stepperRow = el('div', { className: 'wt-price-stepper' }, [btnMinus, pricePercentInput, btnPlus, pctLabel]);

    // Bajar / Subir buttons
    const btnLower = el('button', {
      className: 'wt-btn wt-btn-secondary',
      onClick: () => doAdjustPrices(-1),
    }, [el('span', { className: 'wt-btn-icon', textContent: '\u2193' }), ' ' + i18n('btnLowerPrice')]);

    const btnRaise = el('button', {
      className: 'wt-btn wt-btn-secondary',
      onClick: () => doAdjustPrices(1),
    }, [el('span', { className: 'wt-btn-icon', textContent: '\u2191' }), ' ' + i18n('btnRaisePrice')]);

    const priceActionsRow = el('div', { className: 'wt-actions-row' }, [btnLower, btnRaise]);

    // Load items button
    const btnLoad = el('button', {
      className: 'wt-btn wt-btn-secondary',
      onClick: () => doLoadItems(),
    }, [el('span', { className: 'wt-btn-icon', textContent: '\uD83D\uDCE6' }), ' ' + i18n('btnLoadProducts')]);

    actionButtons = [btnRepublish, btnLower, btnRaise, btnLoad];

    const actions = el('div', { className: 'wt-actions' }, [btnRepublish, stepperRow, priceActionsRow, btnLoad]);

    // Progress
    progressFill = el('div', { className: 'wt-progress-fill' });
    const progressBar = el('div', { className: 'wt-progress-bar' }, [progressFill]);
    progressTextEl = el('div', { className: 'wt-progress-text' });
    progressContainer = el('div', { className: 'wt-progress' }, [progressBar, progressTextEl]);

    // Items container (checkboxes + preview, populated by doLoadItems)
    priceItemsContainer = el('div', { className: 'wt-price-items-container' });

    // Items summary (legacy display)
    itemsSummary = el('div', { className: 'wt-items' });

    // Footer
    const footerLink = el('a', {
      href: 'https://altitudstudio.ad',
      target: '_blank',
      rel: 'noopener',
      className: 'wt-toolbar-footer-link',
      textContent: i18n('footerBy') + ' \u00B7 altitudstudio.ad',
    });
    const footer = el('div', { className: 'wt-toolbar-footer' }, [footerLink]);

    // Body
    const body = el('div', { className: 'wt-toolbar-body' }, [
      statusPill, actions, progressContainer, priceItemsContainer, itemsSummary, footer,
    ]);

    // Toolbar
    toolbar = el('div', { id: 'wt-toolbar' }, [header, body]);
    document.body.appendChild(toolbar);

    // Toast container
    toastContainer = el('div', { className: 'wt-toast-container' });
    document.body.appendChild(toastContainer);

    // Init
    setupDrag(header);
    checkStatus();
    listenForProgress();
  }

  // ============================================================
  // PRICE CONTROLS
  // ============================================================

  function stepPercent(delta) {
    let val = parseInt(pricePercentInput.value, 10) || 0;
    val = Math.max(-50, Math.min(50, val + delta));
    pricePercentInput.value = val;
    updatePricePreview();
  }

  function renderPriceList() {
    if (!priceListEl) return;
    while (priceListEl.firstChild) priceListEl.firstChild.remove();

    const pct = parseInt(pricePercentInput.value, 10) || 0;

    for (const item of pricePanelItems) {
      const cb = el('input', { type: 'checkbox', 'data-id': item.id, onChange: (e) => {
        item.selected = e.target.checked;
        updateSelectAllState();
        updateItemPreview(row, item, pct);
      }});
      if (item.selected) cb.checked = true;

      const titleSpan = el('span', { className: 'wt-price-item-title', textContent: item.title });
      const previewSpan = el('span', { className: 'wt-price-preview' });
      const row = el('div', { className: 'wt-price-item' }, [cb, titleSpan, previewSpan]);
      updateItemPreview(row, item, pct);
      priceListEl.appendChild(row);
    }

    updateSelectAllState();
  }

  function updateItemPreview(row, item, pct) {
    const previewSpan = row.querySelector('.wt-price-preview');
    if (item.selected && pct !== 0) {
      const newPrice = Math.round(item.price * (1 + pct / 100) * 100) / 100;
      previewSpan.textContent = item.price + '\u20AC \u2192 ' + newPrice + '\u20AC';
    } else {
      previewSpan.textContent = item.selected ? item.price + '\u20AC' : '';
    }
  }

  function updatePricePreview() {
    if (!priceListEl) return;
    const pct = parseInt(pricePercentInput.value, 10) || 0;
    const rows = priceListEl.querySelectorAll('.wt-price-item');
    rows.forEach((row, i) => {
      if (pricePanelItems[i]) {
        updateItemPreview(row, pricePanelItems[i], pct);
      }
    });
  }

  function toggleSelectAll() {
    const checked = priceSelectAllCheckbox.checked;
    for (const item of pricePanelItems) {
      item.selected = checked;
    }
    const checkboxes = priceListEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => { cb.checked = checked; });
    updatePricePreview();
  }

  function updateSelectAllState() {
    if (!priceSelectAllCheckbox) return;
    const allSelected = pricePanelItems.every((item) => item.selected);
    priceSelectAllCheckbox.checked = allSelected;
  }

  async function doAdjustPrices(direction) {
    const rawPct = parseInt(pricePercentInput.value, 10) || 0;
    if (rawPct === 0) {
      showToast(i18n('errorPercentZero'), 'error');
      return;
    }
    const pct = direction < 0 ? -Math.abs(rawPct) : Math.abs(rawPct);
    const dirLabel = pct > 0 ? i18n('dirRaise') : i18n('dirLower');

    // If items loaded with selection, use selected items
    const selectedItems = pricePanelItems.filter((item) => item.selected);
    const useSelected = pricePanelItems.length > 0 && selectedItems.length > 0;
    const count = useSelected ? String(selectedItems.length) : i18n('labelProducts').toLowerCase();

    const confirmMsg = i18n('confirmPriceChange', [dirLabel, count, String(Math.abs(pct))]);
    if (!confirm(confirmMsg)) {
      return;
    }

    setButtonsDisabled(true);
    showToast(i18n('progressAdjusting'), 'info');
    showProgress(0, 1, i18n('progressAdjusting'));

    let resp;
    if (useSelected) {
      const selectedIds = selectedItems.map((item) => item.id);
      resp = await sendMessage({ type: 'ADJUST_SELECTED_PRICES', percent: pct, itemIds: selectedIds });
    } else {
      resp = await sendMessage({ type: 'ADJUST_PRICES', percent: pct });
    }

    if (resp?.error) {
      hideProgress();
      showToast(resp.error, 'error');
      setButtonsDisabled(false);
    }
  }

  // ============================================================
  // DRAG
  // ============================================================

  function setupDrag(header) {
    let isDragging = false;
    let startX, startY, origX, origY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = toolbar.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      toolbar.style.left = (origX + dx) + 'px';
      toolbar.style.top = (origY + dy) + 'px';
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ============================================================
  // COLLAPSE / EXPAND
  // ============================================================

  function toggleCollapse() {
    collapsed = !collapsed;
    toolbar.classList.toggle('wt-collapsed', collapsed);
    if (collapsed) {
      toolbar.addEventListener('click', expandOnClick, { once: true });
    }
  }

  function expandOnClick(e) {
    if (e.target.closest('.wt-header-dots')) return;
    if (collapsed) {
      collapsed = false;
      toolbar.classList.remove('wt-collapsed');
    }
  }


  // ============================================================
  // STATUS
  // ============================================================

  async function checkStatus() {
    const status = await sendMessage({ type: 'GET_STATUS' });
    if (!status) {
      setStatus(i18n('statusError'), 'error');
      return;
    }

    if (status.authenticated) {
      setStatus(i18n('statusConnected'), 'ok');
      statusDotEl.classList.add('connected');
      setButtonsDisabled(false);

      // Auto-load items when connected and not yet loaded
      if (pricePanelItems.length === 0) {
        doLoadItems();
      }
    } else {
      setStatus(i18n('statusDisconnected'), 'waiting');
      setButtonsDisabled(true);
      setTimeout(checkStatus, 3000);
    }

    if (status.operationInProgress) {
      setButtonsDisabled(true);
    }
  }

  function setStatus(msg, type) {
    if (statusTextEl) statusTextEl.textContent = msg;
    const dot = statusTextEl?.previousElementSibling;
    if (dot) dot.className = 'wt-status-dot ' + (type || '');
  }

  function setButtonsDisabled(disabled) {
    for (const btn of actionButtons) {
      btn.disabled = disabled;
    }
  }

  // ============================================================
  // ACTIONS
  // ============================================================

  async function doRepublish() {
    setButtonsDisabled(true);
    showProgress(0, 1, i18n('startingRepublish'));
    const resp = await sendMessage({ type: 'REPUBLISH_ALL' });
    if (resp?.error) {
      hideProgress();
      showToast(resp.error, 'error');
      setButtonsDisabled(false);
    }
  }

  async function doLoadItems() {
    setButtonsDisabled(true);
    setStatus(i18n('statusLoadingProducts'), 'waiting');
    const resp = await sendMessage({ type: 'LOAD_ITEMS' });
    setButtonsDisabled(false);

    if (resp?.error) {
      setStatus(resp.error, 'error');
      showToast(resp.error, 'error');
      return;
    }

    if (resp?.items) {
      pricePanelItems = resp.items.map((item) => ({ ...item, selected: true }));
      displayItemsWithCheckboxes();
      setStatus(i18n('productsLoaded', [String(resp.items.length)]), 'ok');
      showToast(i18n('productsLoaded', [String(resp.items.length)]), 'success');
    }
  }

  // ============================================================
  // ITEMS DISPLAY (with checkboxes + price preview)
  // ============================================================

  function displayItemsWithCheckboxes() {
    while (priceItemsContainer.firstChild) priceItemsContainer.firstChild.remove();
    while (itemsSummary.firstChild) itemsSummary.firstChild.remove();

    if (pricePanelItems.length === 0) return;

    // Select all
    priceSelectAllCheckbox = el('input', { type: 'checkbox', checked: 'true', onChange: () => toggleSelectAll() });
    const selectAllLabel = el('label', { className: 'wt-price-select-all' }, [
      priceSelectAllCheckbox, ' ' + i18n('labelSelectAll', [String(pricePanelItems.length)]),
    ]);

    // Items list
    priceListEl = el('div', { className: 'wt-price-list' });

    priceItemsContainer.appendChild(selectAllLabel);
    priceItemsContainer.appendChild(priceListEl);

    renderPriceList();
  }

  // ============================================================
  // PROGRESS
  // ============================================================

  function showProgress(current, total, label) {
    progressContainer.classList.add('active');
    const pct = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = pct + '%';
    progressTextEl.textContent = label || `${current}/${total}`;
  }

  function hideProgress() {
    progressContainer.classList.remove('active');
    progressFill.style.width = '0%';
    progressTextEl.textContent = '';
  }

  function listenForProgress() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PROGRESS') {
        if (msg.loading) {
          showProgress(0, 1, i18n('statusLoadingProducts'));
        } else {
          const label = msg.operation === 'republish'
            ? i18n('progressRepublishing')
            : i18n('progressUpdating');
          showProgress(msg.current, msg.total, `${msg.current}/${msg.total} ${label}`);
        }
      }
      if (msg.type === 'OPERATION_COMPLETE') {
        hideProgress();
        let resultMsg;
        if (msg.operation === 'republish') {
          resultMsg = i18n('toastRepublished', [String(msg.success), String(msg.failed)]);
        } else {
          resultMsg = i18n('toastPricesUpdated', [String(msg.success), String(msg.failed)]);
        }
        setStatus(resultMsg, msg.failed > 0 ? 'warning' : 'ok');
        showToast(resultMsg, msg.failed > 0 ? 'warning' : 'success');
        setButtonsDisabled(false);

        // Reload items after price operation to show updated prices
        if (msg.operation === 'prices') {
          doLoadItems();
        }
      }
    });
  }

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================

  function showToast(message, type = 'info') {
    const dot = el('span', { className: 'wt-toast-dot' });
    const text = el('span', { textContent: message });
    const toast = el('div', { className: `wt-toast ${type}` }, [dot, text]);
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('wt-toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    // Load preferred language before building toolbar
    const data = await chrome.storage.local.get(['preferred_language']);
    const locale = data.preferred_language || 'es';
    await I18nRuntime.loadLocale(locale);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(buildToolbar, 500));
    } else {
      setTimeout(buildToolbar, 500);
    }

    // Listen for language changes and rebuild toolbar
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.preferred_language) {
        const newLocale = changes.preferred_language.newValue;
        I18nRuntime.loadLocale(newLocale).then(() => {
          // Remove old toolbar and rebuild with new locale
          const old = document.getElementById('wt-toolbar');
          if (old) old.remove();
          if (toastContainer) toastContainer.remove();
          toolbar = null;
          pricePanelItems = [];
          buildToolbar();
        });
      }
    });
  }

  init();
})();
