/**
 * i18n Runtime - Wallapop Tools v3.0
 *
 * Loads locale JSON files at runtime via fetch, allowing the user to
 * change language without restarting the browser.
 * Works in both popup pages and content scripts.
 */

/* global chrome */

const I18nRuntime = (() => {
  'use strict';

  const SUPPORTED_LOCALES = ['es', 'en', 'fr', 'it', 'pt_PT'];
  const DEFAULT_LOCALE = 'es';

  let _currentLocale = DEFAULT_LOCALE;
  let _messages = {};

  /**
   * Load a locale's messages.json from _locales/{locale}/messages.json
   * @param {string} locale - e.g. 'es', 'en', 'fr', 'it', 'pt_PT'
   * @returns {Promise<void>}
   */
  async function loadLocale(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      locale = DEFAULT_LOCALE;
    }

    try {
      const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      _messages = await resp.json();
      _currentLocale = locale;
    } catch (err) {
      console.warn(`[I18nRuntime] Failed to load locale "${locale}", falling back to ${DEFAULT_LOCALE}`, err);
      if (locale !== DEFAULT_LOCALE) {
        await loadLocale(DEFAULT_LOCALE);
      }
    }
  }

  /**
   * Get a translated message by key, with optional placeholder substitutions.
   * Mimics chrome.i18n.getMessage() behavior.
   *
   * @param {string} key - The message key
   * @param {string|string[]} [substitutions] - Replacement values for $1, $2, etc.
   * @returns {string} The translated message, or the key if not found
   */
  function getMessage(key, substitutions) {
    const entry = _messages[key];
    if (!entry || !entry.message) return key;

    let msg = entry.message;

    // Normalize substitutions to an array
    if (substitutions != null) {
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];

      // Replace named placeholders like $NAME$ using the placeholders map
      if (entry.placeholders) {
        for (const [name, def] of Object.entries(entry.placeholders)) {
          // def.content is something like "$1", "$2", etc.
          const idx = parseInt(def.content.replace('$', ''), 10) - 1;
          if (idx >= 0 && idx < subs.length) {
            const pattern = new RegExp('\\$' + name + '\\$', 'gi');
            msg = msg.replace(pattern, subs[idx]);
          }
        }
      }

      // Also replace positional $1, $2, etc. directly
      subs.forEach((sub, i) => {
        msg = msg.replace(new RegExp('\\$' + (i + 1), 'g'), sub);
      });
    }

    return msg;
  }

  /**
   * @returns {string} The currently loaded locale
   */
  function getLocale() {
    return _currentLocale;
  }

  /**
   * @returns {string[]} List of supported locales
   */
  function getSupportedLocales() {
    return [...SUPPORTED_LOCALES];
  }

  return {
    loadLocale,
    getMessage,
    getLocale,
    getSupportedLocales,
  };
})();

// Make available globally (works in both content scripts and popup)
if (typeof globalThis !== 'undefined') {
  globalThis.I18nRuntime = I18nRuntime;
}
