/**
 * Popup Script - Wallapop Tools v3.0
 *
 * Dashboard with stats, activity log, auto-republish toggle, price controls.
 * Fully internationalized via I18nRuntime (runtime locale loading).
 */

(() => {
  'use strict';

  // --- Shorthand for I18nRuntime.getMessage ---
  const t = (key, subs) => I18nRuntime.getMessage(key, subs);

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const statusDot = $('status-dot');
  const statusLabel = $('status-label');
  const statItems = $('stat-items');
  const statLastRepublish = $('stat-last-republish');
  const statRepublishes = $('stat-republishes');
  const btnRepublish = $('btn-republish');
  const autoToggle = $('auto-republish-toggle');
  const autoInterval = $('auto-republish-interval');
  const progressSection = $('progress-section');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const activityToggle = $('activity-toggle');
  const activityArrow = $('activity-arrow');
  const activityList = $('activity-list');
  const languageSelect = $('language-select');

  // Price controls
  const pricePercentInput = $('popup-price-percent');
  const btnPriceMinus = $('popup-price-minus');
  const btnPricePlus = $('popup-price-plus');
  const btnPriceLower = $('popup-price-lower');
  const btnPriceRaise = $('popup-price-raise');

  // --- i18n hydration ---
  function hydrateI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const msg = t(key);
      if (msg && msg !== key) el.textContent = msg;
    });
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', async () => {
    // Load preferred language first, then hydrate
    const locale = await loadLanguageSetting();
    await I18nRuntime.loadLocale(locale);
    hydrateI18n();

    await refreshStatus();
    await loadAutoRepublish();
    await loadStats();
    await loadActivityLog();
    setupButtons();
    listenForProgress();
  });

  // --- Status ---
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
        btnRepublish.disabled = true;
        setPriceButtonsDisabled(true);
      }
    } catch (err) {
      setDisconnected(t('statusError'));
    }
  }

  function setConnected(itemCount) {
    statusDot.className = 'popup-header-dot connected';
    const suffix = itemCount > 0 ? ` \u00B7 ${itemCount} ${t('labelProducts').toLowerCase()}` : '';
    statusLabel.textContent = t('statusConnected') + suffix;
    btnRepublish.disabled = false;
    setPriceButtonsDisabled(false);
  }

  function setDisconnected(msg) {
    statusDot.className = 'popup-header-dot disconnected';
    statusLabel.textContent = msg;
    btnRepublish.disabled = true;
    setPriceButtonsDisabled(true);
  }

  // --- Price button helpers ---
  function setPriceButtonsDisabled(disabled) {
    if (btnPriceLower) btnPriceLower.disabled = disabled;
    if (btnPriceRaise) btnPriceRaise.disabled = disabled;
  }

  // --- Cooldown ---
  let cooldownTimer = null;

  function setCooldown(seconds) {
    btnRepublish.disabled = true;
    btnRepublish.classList.add('popup-btn-cooldown', 'active');
    updateCooldownText(seconds);

    clearInterval(cooldownTimer);
    let remaining = seconds;
    cooldownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        btnRepublish.classList.remove('popup-btn-cooldown', 'active');
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

  // --- Buttons ---
  function setupButtons() {
    btnRepublish.addEventListener('click', async () => {
      btnRepublish.disabled = true;
      showProgress(0, 1, t('progressStarting'));
      const resp = await sendMessage({ type: 'REPUBLISH_ALL' });
      if (resp?.error) {
        hideProgress();
        statusLabel.textContent = resp.error;
        btnRepublish.disabled = false;
      }
    });

    // Activity log toggle
    activityToggle.addEventListener('click', () => {
      const isHidden = activityList.style.display === 'none';
      activityList.style.display = isHidden ? 'block' : 'none';
      activityArrow.classList.toggle('open', isHidden);
    });

    // Language selector — reload locale + re-hydrate on change
    languageSelect.addEventListener('change', async () => {
      const newLocale = languageSelect.value;
      chrome.storage.local.set({ preferred_language: newLocale });
      await I18nRuntime.loadLocale(newLocale);
      hydrateI18n();
      // Re-render dynamic content
      await refreshStatus();
      await loadStats();
      // Clear and reload activity
      while (activityList.firstChild) activityList.firstChild.remove();
      await loadActivityLog();
    });

    // Price stepper controls
    if (btnPriceMinus && btnPricePlus && pricePercentInput) {
      btnPriceMinus.addEventListener('click', () => {
        let val = parseInt(pricePercentInput.value, 10) || 0;
        val = Math.max(1, val - 1);
        pricePercentInput.value = val;
      });

      btnPricePlus.addEventListener('click', () => {
        let val = parseInt(pricePercentInput.value, 10) || 0;
        val = Math.min(50, val + 1);
        pricePercentInput.value = val;
      });
    }

    // Price action buttons
    if (btnPriceLower) {
      btnPriceLower.addEventListener('click', () => doAdjustPrices(-1));
    }
    if (btnPriceRaise) {
      btnPriceRaise.addEventListener('click', () => doAdjustPrices(1));
    }
  }

  // --- Price adjustment ---
  async function doAdjustPrices(direction) {
    const rawPct = parseInt(pricePercentInput.value, 10) || 0;
    if (rawPct === 0) return;

    const pct = direction < 0 ? -Math.abs(rawPct) : Math.abs(rawPct);

    setPriceButtonsDisabled(true);
    btnRepublish.disabled = true;
    showProgress(0, 1, t('progressAdjusting'));

    const resp = await sendMessage({ type: 'ADJUST_PRICES', percent: pct });
    if (resp?.error) {
      hideProgress();
      statusLabel.textContent = resp.error;
      setPriceButtonsDisabled(false);
      btnRepublish.disabled = false;
    }
  }

  // --- Auto-republish ---
  async function loadAutoRepublish() {
    const resp = await sendMessage({ type: 'GET_AUTO_REPUBLISH_STATUS' });
    if (!resp) return;

    if (resp.autoRepublish?.enabled) {
      autoToggle.checked = true;
      autoInterval.value = String(resp.autoRepublish.intervalHours || 12);
    }

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
  }

  // --- Stats ---
  async function loadStats() {
    const resp = await sendMessage({ type: 'GET_STATS' });
    if (!resp?.stats) return;

    statRepublishes.textContent = resp.stats.totalRepublishes || 0;
  }

  // --- Activity Log ---
  async function loadActivityLog() {
    const resp = await sendMessage({ type: 'GET_ACTIVITY_LOG', limit: 5 });
    if (!resp?.log || resp.log.length === 0) {
      const noActivity = document.createElement('div');
      noActivity.className = 'popup-no-activity';
      noActivity.textContent = t('labelNoActivity');
      activityList.appendChild(noActivity);
      return;
    }

    for (const entry of resp.log) {
      const item = document.createElement('div');
      item.className = 'popup-activity-item';

      const icon = document.createElement('span');
      icon.className = 'popup-activity-icon ' + (entry.failed > 0 ? 'error' : 'success');
      icon.textContent = entry.failed > 0 ? '\u2717' : '\u2713';

      const text = document.createElement('span');
      text.className = 'popup-activity-text';
      if (entry.type === 'republish') {
        text.textContent = t('activityRepublish', [String(entry.success)]);
      } else if (entry.type === 'prices') {
        const pctStr = (entry.percent > 0 ? '+' : '') + entry.percent;
        text.textContent = t('activityPrices', [pctStr, String(entry.total)]);
      }

      const time = document.createElement('span');
      time.className = 'popup-activity-time';
      time.textContent = timeAgo(new Date(entry.timestamp).toISOString());

      item.appendChild(icon);
      item.appendChild(text);
      item.appendChild(time);
      activityList.appendChild(item);
    }
  }

  // --- Language ---
  async function loadLanguageSetting() {
    const data = await chrome.storage.local.get(['preferred_language']);
    if (data.preferred_language) {
      languageSelect.value = data.preferred_language;
      return data.preferred_language;
    }
    // Try to detect from browser locale
    const uiLang = chrome.i18n.getUILanguage();
    let locale = 'en';
    if (uiLang.startsWith('es')) locale = 'es';
    else if (uiLang.startsWith('fr')) locale = 'fr';
    else if (uiLang.startsWith('it')) locale = 'it';
    else if (uiLang.startsWith('pt')) locale = 'pt_PT';
    languageSelect.value = locale;
    return locale;
  }

  // --- Progress ---
  function listenForProgress() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PROGRESS') {
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
        btnRepublish.disabled = false;
        setPriceButtonsDisabled(false);
        refreshStatus();
        loadStats();
        while (activityList.firstChild) activityList.firstChild.remove();
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

  // --- Helpers ---
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
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
