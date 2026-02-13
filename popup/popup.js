/**
 * Popup Script - Wallapop Tools
 *
 * Controls the extension popup UI.
 * Communicates with content scripts (on Wallapop tabs) and the background worker.
 */

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  await checkConnection();
  await loadStats();
  setupButtons();
  setupAutoRepublish();
}

// ============================================================
// CONNECTION CHECK
// ============================================================

async function checkConnection() {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const tab = await getWallapopTab();
    if (!tab) {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Abre es.wallapop.com primero';
      disableActions();
      return;
    }

    const response = await sendToTab(tab.id, { action: 'getStatus' });
    if (response?.authenticated) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Conectado a Wallapop';
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Navega por Wallapop para conectar';
    }
  } catch (err) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Error de conexion';
    console.error('[WallapopTools Popup]', err);
  }
}

// ============================================================
// STATS
// ============================================================

async function loadStats() {
  const data = await chrome.storage.local.get([
    'wallapop_item_count',
    'last_republish',
  ]);

  document.getElementById('stat-items').textContent =
    data.wallapop_item_count || '-';

  if (data.last_republish?.date) {
    const date = new Date(data.last_republish.date);
    const now = new Date();
    const diffMs = now - date;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    const diffM = Math.floor(diffMs / (1000 * 60));

    let timeAgo;
    if (diffM < 60) {
      timeAgo = `${diffM}m`;
    } else if (diffH < 24) {
      timeAgo = `${diffH}h`;
    } else {
      timeAgo = `${Math.floor(diffH / 24)}d`;
    }
    document.getElementById('stat-last-republish').textContent = timeAgo;
  }
}

// ============================================================
// BUTTONS
// ============================================================

function setupButtons() {
  document.getElementById('btn-republish').addEventListener('click', async () => {
    const tab = await getWallapopTab();
    if (!tab) return alert('Abre Wallapop primero');
    sendToTab(tab.id, { action: 'republishAll' });
    window.close();
  });

  document.getElementById('btn-lower').addEventListener('click', async () => {
    const tab = await getWallapopTab();
    if (!tab) return alert('Abre Wallapop primero');
    sendToTab(tab.id, { action: 'adjustPrices', percent: -5 });
    window.close();
  });

  document.getElementById('btn-raise').addEventListener('click', async () => {
    const tab = await getWallapopTab();
    if (!tab) return alert('Abre Wallapop primero');
    sendToTab(tab.id, { action: 'adjustPrices', percent: 5 });
    window.close();
  });
}

// ============================================================
// AUTO-REPUBLISH
// ============================================================

async function setupAutoRepublish() {
  const toggle = document.getElementById('auto-republish-toggle');
  const interval = document.getElementById('auto-republish-interval');

  // Load saved state
  const response = await chrome.runtime.sendMessage({
    action: 'getAutoRepublishStatus',
  });

  if (response?.autoRepublish?.enabled) {
    toggle.checked = true;
    interval.value = String(response.autoRepublish.intervalHours || 12);
  }

  // Toggle handler
  toggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      action: 'setAutoRepublish',
      enabled: toggle.checked,
      intervalHours: parseInt(interval.value),
    });
  });

  // Interval change handler
  interval.addEventListener('change', () => {
    if (toggle.checked) {
      chrome.runtime.sendMessage({
        action: 'setAutoRepublish',
        enabled: true,
        intervalHours: parseInt(interval.value),
      });
    }
  });
}

// ============================================================
// HELPERS
// ============================================================

async function getWallapopTab() {
  const tabs = await chrome.tabs.query({ url: 'https://es.wallapop.com/*' });
  return tabs[0] || null;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[WallapopTools Popup]', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

function disableActions() {
  document.querySelectorAll('.popup-btn').forEach((btn) => {
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
  });
}
