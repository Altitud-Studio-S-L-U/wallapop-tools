/**
 * Popup Script - Wallapop Tools v5.0
 *
 * Clean, focused popup: republish, auto-republish, product list
 * with stale indicators + inline price edit, batch price adjust.
 */

(() => {
  'use strict';

  const t = (key, subs) => I18nRuntime.getMessage(key, subs);
  const $ = (id) => document.getElementById(id);

  // DOM refs
  const statusDot = $('status-dot');
  const statusLabel = $('status-label');
  const statItems = $('stat-items');
  const statLastRepublish = $('stat-last-republish');
  const statRepublishes = $('stat-republishes');
  const btnRepublish = $('btn-republish');
  const progressSection = $('progress-section');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const autoToggle = $('auto-republish-toggle');
  const autoInterval = $('auto-republish-interval');
  const selectAllCheckbox = $('select-all');
  const selectAllText = $('select-all-text');
  const staleSummary = $('stale-summary');
  const productsList = $('products-list');
  const productsEmpty = $('products-empty');
  const pricePercent = $('price-percent');
  const btnMinus = $('price-minus');
  const btnPlus = $('price-plus');
  const btnLower = $('btn-lower');
  const btnRaise = $('btn-raise');
  const btnRepublishSelected = $('btn-republish-selected');
  const btnExportCSV = $('btn-export-csv');
  const activityToggle = $('activity-toggle');
  const activityArrow = $('activity-arrow');
  const activityList = $('activity-list');
  const languageSelect = $('language-select');

  // State
  let items = [];

  // ===== i18n =====

  function hydrateI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const msg = t(key);
      if (msg && msg !== key) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = t(key);
      if (msg && msg !== key) el.placeholder = msg;
    });
  }

  // ===== Init =====

  document.addEventListener('DOMContentLoaded', async () => {
    const locale = await loadLanguage();
    await I18nRuntime.loadLocale(locale);
    hydrateI18n();

    await refreshStatus();
    await loadAutoRepublish();
    await loadStats();
    await loadProducts();
    await loadActivityLog();
    setupListeners();
    listenForProgress();
  });

  // ===== Status =====

  async function refreshStatus() {
    try {
      const status = await sendMessage({ type: 'GET_STATUS' });
      if (!status) {
        setDisconnected(t('statusError'));
        return;
      }

      if (status.authenticated) {
        setConnected(status.itemCount);
      } else {
        setDisconnected(t('statusDisconnected'));
      }

      statItems.textContent = status.itemCount || '-';

      if (status.lastRepublish?.date) {
        statLastRepublish.textContent = timeAgo(status.lastRepublish.date);
      }

      if (status.cooldownRemaining > 0) {
        setCooldown(status.cooldownRemaining);
      }

      if (status.operationInProgress) {
        setAllButtonsDisabled(true);
      }
    } catch {
      setDisconnected(t('statusError'));
    }
  }

  function setConnected(itemCount) {
    statusDot.className = 'status-dot connected';
    const suffix = itemCount > 0 ? ` · ${itemCount} ${t('labelProducts').toLowerCase()}` : '';
    statusLabel.textContent = t('statusConnected') + suffix;
    btnRepublish.disabled = false;
    btnLower.disabled = false;
    btnRaise.disabled = false;
    btnRepublishSelected.disabled = false;
  }

  function setDisconnected(msg) {
    statusDot.className = 'status-dot disconnected';
    statusLabel.textContent = msg;
    setAllButtonsDisabled(true);
  }

  function setAllButtonsDisabled(disabled) {
    btnRepublish.disabled = disabled;
    btnLower.disabled = disabled;
    btnRaise.disabled = disabled;
    btnRepublishSelected.disabled = disabled;
  }

  // ===== Cooldown =====

  let cooldownTimer = null;

  function setCooldown(seconds) {
    btnRepublish.disabled = true;
    btnRepublish.classList.add('btn-cooldown', 'active');
    updateCooldownText(seconds);

    clearInterval(cooldownTimer);
    let remaining = seconds;
    cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        btnRepublish.classList.remove('btn-cooldown', 'active');
        btnRepublish.disabled = false;
        btnRepublish.removeAttribute('data-cooldown');
        return;
      }
      updateCooldownText(remaining);
    }, 1000);
  }

  function updateCooldownText(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    btnRepublish.setAttribute('data-cooldown', t('cooldownWait', [timeStr]));
  }

  // ===== Products =====

  async function loadProducts() {
    const resp = await sendMessage({ type: 'LOAD_ITEMS' });
    if (resp?.error) {
      productsEmpty.textContent = resp.error;
      return;
    }

    if (!resp?.items?.length) {
      productsEmpty.textContent = t('statusDisconnected');
      return;
    }

    items = resp.items.map((item) => ({ ...item, selected: true }));
    renderProducts();
  }

  function renderProducts() {
    productsList.innerHTML = '';

    if (items.length === 0) {
      productsList.appendChild(productsEmpty);
      return;
    }

    const staleCount = items.filter((i) => i.daysListed > 30).length;
    if (staleCount > 0) {
      staleSummary.textContent = t('labelStaleCount', [String(staleCount)]);
    } else {
      staleSummary.textContent = '';
    }

    selectAllText.textContent = t('labelSelectAll', [String(items.length)]);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'product-row';

      // Checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.selected;
      cb.addEventListener('change', () => {
        item.selected = cb.checked;
        updateSelectAll();
      });

      // Days badge
      const days = document.createElement('span');
      const d = item.daysListed;
      days.className = 'product-days ' + (d > 30 ? 'stale' : d > 7 ? 'aging' : 'fresh');
      days.textContent = d != null ? d + 'd' : '-';
      days.title = d != null ? d + ' ' + t('labelDaysListed') : '';

      // Info
      const info = document.createElement('div');
      info.className = 'product-info';
      const title = document.createElement('div');
      title.className = 'product-title';
      title.textContent = item.title;
      title.title = item.title;
      info.appendChild(title);
      if (item.category) {
        const cat = document.createElement('div');
        cat.className = 'product-category';
        cat.textContent = item.category;
        info.appendChild(cat);
      }

      // Price group
      const priceGroup = document.createElement('div');
      priceGroup.className = 'product-price-group';

      const priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.className = 'product-price-input';
      priceInput.value = String(item.price);
      priceInput.step = '0.5';
      priceInput.min = '0';

      const currency = document.createElement('span');
      currency.className = 'product-price-currency';
      currency.textContent = '\u20AC';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'product-price-btn';
      applyBtn.textContent = '\u2713';
      applyBtn.title = t('btnApplyPrice');
      applyBtn.addEventListener('click', async () => {
        const newPrice = parseFloat(priceInput.value);
        if (!newPrice || newPrice <= 0) return;
        applyBtn.disabled = true;
        applyBtn.textContent = '...';
        const resp = await sendMessage({ type: 'UPDATE_ITEM_PRICE', itemId: item.id, newPrice });
        if (resp?.success) {
          item.price = newPrice;
          statusLabel.textContent = t('toastPriceApplied', [item.title.slice(0, 20), String(newPrice)]);
        } else {
          statusLabel.textContent = resp?.error || 'Error';
        }
        applyBtn.textContent = '\u2713';
        applyBtn.disabled = false;
      });

      priceGroup.appendChild(priceInput);
      priceGroup.appendChild(currency);
      priceGroup.appendChild(applyBtn);

      row.appendChild(cb);
      row.appendChild(days);
      row.appendChild(info);
      row.appendChild(priceGroup);
      productsList.appendChild(row);
    }
  }

  function updateSelectAll() {
    const allSelected = items.every((i) => i.selected);
    selectAllCheckbox.checked = allSelected;
  }

  function getSelectedItems() {
    return items.filter((i) => i.selected);
  }

  // ===== Listeners =====

  function setupListeners() {
    // Republish all
    btnRepublish.addEventListener('click', async () => {
      setAllButtonsDisabled(true);
      showProgress(0, 1, t('startingRepublish'));
      const resp = await sendMessage({ type: 'REPUBLISH_ALL' });
      if (resp?.error) {
        hideProgress();
        statusLabel.textContent = resp.error;
        setAllButtonsDisabled(false);
      }
    });

    // Select all
    selectAllCheckbox.addEventListener('change', () => {
      const checked = selectAllCheckbox.checked;
      items.forEach((i) => { i.selected = checked; });
      productsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
    });

    // Price stepper
    btnMinus.addEventListener('click', () => {
      let val = parseInt(pricePercent.value, 10) || 0;
      pricePercent.value = Math.max(1, val - 1);
    });

    btnPlus.addEventListener('click', () => {
      let val = parseInt(pricePercent.value, 10) || 0;
      pricePercent.value = Math.min(50, val + 1);
    });

    // Price adjust
    btnLower.addEventListener('click', () => doAdjustPrices(-1));
    btnRaise.addEventListener('click', () => doAdjustPrices(1));

    // Republish selected
    btnRepublishSelected.addEventListener('click', async () => {
      const selected = getSelectedItems();
      if (selected.length === 0) return;

      setAllButtonsDisabled(true);
      showProgress(0, 1, t('startingRepublish'));
      const resp = await sendMessage({
        type: 'REPUBLISH_SELECTED',
        itemIds: selected.map((i) => i.id),
      });
      if (resp?.error) {
        hideProgress();
        statusLabel.textContent = resp.error;
        setAllButtonsDisabled(false);
      }
    });

    // Export CSV
    btnExportCSV.addEventListener('click', async () => {
      btnExportCSV.disabled = true;
      const resp = await sendMessage({ type: 'EXPORT_CSV' });
      btnExportCSV.disabled = false;

      if (resp?.csv) {
        const blob = new Blob([resp.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallapop-items-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        statusLabel.textContent = t('toastCSVExported');
      } else if (resp?.error) {
        statusLabel.textContent = resp.error;
      }
    });

    // Activity toggle
    activityToggle.addEventListener('click', () => {
      const isHidden = activityList.style.display === 'none';
      activityList.style.display = isHidden ? 'block' : 'none';
      activityArrow.classList.toggle('open', isHidden);
    });

    // Auto-republish
    autoToggle.addEventListener('change', () => {
      sendMessage({
        type: 'SET_AUTO_REPUBLISH',
        enabled: autoToggle.checked,
        intervalHours: parseInt(autoInterval.value, 10),
      });
    });

    autoInterval.addEventListener('change', () => {
      if (autoToggle.checked) {
        sendMessage({
          type: 'SET_AUTO_REPUBLISH',
          enabled: true,
          intervalHours: parseInt(autoInterval.value, 10),
        });
      }
    });

    // Language
    languageSelect.addEventListener('change', async () => {
      const newLocale = languageSelect.value;
      chrome.storage.local.set({ preferred_language: newLocale });
      await I18nRuntime.loadLocale(newLocale);
      hydrateI18n();
      await refreshStatus();
      await loadStats();
      renderProducts();
      activityList.innerHTML = '';
      await loadActivityLog();
    });
  }

  // ===== Price adjust =====

  async function doAdjustPrices(direction) {
    const rawPct = parseInt(pricePercent.value, 10) || 0;
    if (rawPct === 0) return;

    const pct = direction < 0 ? -Math.abs(rawPct) : Math.abs(rawPct);
    const selected = getSelectedItems();

    setAllButtonsDisabled(true);
    showProgress(0, 1, t('progressAdjusting'));

    let resp;
    if (selected.length > 0 && selected.length < items.length) {
      resp = await sendMessage({
        type: 'ADJUST_SELECTED_PRICES',
        percent: pct,
        itemIds: selected.map((i) => i.id),
      });
    } else {
      resp = await sendMessage({ type: 'ADJUST_PRICES', percent: pct });
    }

    if (resp?.error) {
      hideProgress();
      statusLabel.textContent = resp.error;
      setAllButtonsDisabled(false);
    }
  }

  // ===== Auto-republish =====

  async function loadAutoRepublish() {
    const resp = await sendMessage({ type: 'GET_AUTO_REPUBLISH_STATUS' });
    if (!resp) return;

    if (resp.autoRepublish?.enabled) {
      autoToggle.checked = true;
      autoInterval.value = String(resp.autoRepublish.intervalHours || 12);
    }
  }

  // ===== Stats =====

  async function loadStats() {
    const resp = await sendMessage({ type: 'GET_STATS' });
    if (!resp?.stats) return;
    statRepublishes.textContent = resp.stats.totalRepublishes || 0;
  }

  // ===== Activity Log =====

  async function loadActivityLog() {
    const resp = await sendMessage({ type: 'GET_ACTIVITY_LOG', limit: 5 });
    if (!resp?.log || resp.log.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'no-activity';
      empty.textContent = t('labelNoActivity');
      activityList.appendChild(empty);
      return;
    }

    for (const entry of resp.log) {
      const item = document.createElement('div');
      item.className = 'activity-item';

      const icon = document.createElement('span');
      icon.className = 'activity-icon ' + (entry.failed > 0 ? 'error' : 'success');
      icon.textContent = entry.failed > 0 ? '\u2717' : '\u2713';

      const text = document.createElement('span');
      text.className = 'activity-text';

      if (entry.type === 'republish' || entry.type === 'republish_selected') {
        text.textContent = t('activityRepublish', [String(entry.success)]);
      } else if (entry.type === 'prices') {
        const pctStr = (entry.percent > 0 ? '+' : '') + entry.percent;
        text.textContent = t('activityPrices', [pctStr, String(entry.total)]);
      } else if (entry.type === 'price_exact') {
        text.textContent = t('toastPriceApplied', ['', String(entry.newPrice)]);
      }

      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = timeAgo(new Date(entry.timestamp).toISOString());

      item.appendChild(icon);
      item.appendChild(text);
      item.appendChild(time);
      activityList.appendChild(item);
    }
  }

  // ===== Language =====

  async function loadLanguage() {
    const data = await chrome.storage.local.get(['preferred_language']);
    if (data.preferred_language) {
      languageSelect.value = data.preferred_language;
      return data.preferred_language;
    }
    const uiLang = chrome.i18n.getUILanguage();
    let locale = 'en';
    if (uiLang.startsWith('es')) locale = 'es';
    else if (uiLang.startsWith('fr')) locale = 'fr';
    else if (uiLang.startsWith('it')) locale = 'it';
    else if (uiLang.startsWith('pt')) locale = 'pt_PT';
    languageSelect.value = locale;
    return locale;
  }

  // ===== Progress =====

  function listenForProgress() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PROGRESS') {
        statusDot.className = 'status-dot working';
        if (msg.loading) {
          showProgress(0, 1, t('statusLoadingProducts'));
        } else {
          const label = msg.operation === 'republish'
            ? t('progressRepublishing')
            : t('progressUpdating');
          showProgress(msg.current, msg.total, `${msg.current}/${msg.total} ${label}`);
        }
      }

      if (msg.type === 'OPERATION_COMPLETE') {
        hideProgress();
        let resultMsg;
        if (msg.operation === 'republish') {
          resultMsg = t('toastRepublished', [String(msg.success), String(msg.failed)]);
        } else {
          resultMsg = t('toastPricesUpdated', [String(msg.success), String(msg.failed)]);
        }
        statusLabel.textContent = resultMsg;
        statusDot.className = 'status-dot connected';
        setAllButtonsDisabled(false);

        // Refresh data
        refreshStatus();
        loadStats();
        loadProducts();
        activityList.innerHTML = '';
        loadActivityLog();
      }
    });
  }

  function showProgress(current, total, label) {
    progressSection.classList.add('active');
    const pct = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = label;
  }

  function hideProgress() {
    progressSection.classList.remove('active');
    progressFill.style.width = '0%';
    progressText.textContent = '';
  }

  // ===== Helpers =====

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('timeAgoMinutes', ['<1']);
    if (minutes < 60) return t('timeAgoMinutes', [String(minutes)]);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('timeAgoHours', [String(hours)]);
    return t('timeAgoDays', [String(Math.floor(hours / 24))]);
  }
})();
