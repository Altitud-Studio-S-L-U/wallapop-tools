/**
 * i18n Tests - Verify translation completeness and consistency
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, '../_locales');

function loadMessages(locale) {
  const path = resolve(localesDir, locale, 'messages.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const LOCALES = ['es', 'en', 'fr', 'it', 'pt_PT'];
const esMessages = loadMessages('es');
const esKeys = Object.keys(esMessages).sort();

describe('i18n completeness', () => {
  for (const locale of LOCALES) {
    if (locale === 'es') continue;

    describe(`${locale} locale`, () => {
      const messages = loadMessages(locale);
      const localeKeys = Object.keys(messages).sort();

      it(`should have all keys from es (default locale)`, () => {
        const missingKeys = esKeys.filter((key) => !messages[key]);
        expect(missingKeys).toEqual([]);
      });

      it(`should not have orphaned keys missing from es`, () => {
        const orphanedKeys = localeKeys.filter((key) => !esMessages[key]);
        expect(orphanedKeys).toEqual([]);
      });

      it(`should have non-empty messages for all keys`, () => {
        const emptyKeys = localeKeys.filter((key) => {
          const msg = messages[key]?.message;
          return !msg || msg.trim() === '';
        });
        expect(emptyKeys).toEqual([]);
      });
    });
  }
});

describe('Placeholder consistency', () => {
  for (const locale of LOCALES) {
    if (locale === 'es') continue;

    describe(`${locale} locale placeholders`, () => {
      const messages = loadMessages(locale);

      it('should have matching placeholders with es locale', () => {
        for (const key of esKeys) {
          const esEntry = esMessages[key];
          const localeEntry = messages[key];
          if (!localeEntry) continue;

          const esPlaceholders = esEntry.placeholders ? Object.keys(esEntry.placeholders).sort() : [];
          const localePlaceholders = localeEntry.placeholders ? Object.keys(localeEntry.placeholders).sort() : [];

          expect(localePlaceholders, `Key "${key}" in ${locale}`).toEqual(esPlaceholders);
        }
      });
    });
  }
});

describe('es (default) locale', () => {
  it('should have extName defined', () => {
    expect(esMessages.extName.message).toBe('Wallapop Tools');
  });

  it('should have extDescription defined', () => {
    expect(esMessages.extDescription.message).toBeTruthy();
  });

  it('should have all required UI keys', () => {
    const requiredKeys = [
      'statusConnected',
      'statusDisconnected',
      'btnRepublishAll',
      'btnLowerPrice',
      'btnRaisePrice',
      'labelProducts',
      'labelLastRepublish',
      'labelAutoRepublish',
      'labelEvery',
      'progressRepublishing',
      'progressUpdating',
      'errorCooldown',
      'errorPercentInvalid',
      'errorTokenExpired',
      'errorOperationInProgress',
      'labelSuccessRate',
      'labelLanguage',
      'labelRecentActivity',
      'footerBy',
      'confirmPriceChange',
    ];

    for (const key of requiredKeys) {
      expect(esMessages[key], `Missing key: ${key}`).toBeDefined();
      expect(esMessages[key].message, `Empty message for: ${key}`).toBeTruthy();
    }
  });
});

describe('Message format', () => {
  for (const locale of LOCALES) {
    const messages = loadMessages(locale);

    it(`${locale}: all entries should have a "message" field`, () => {
      for (const [key, entry] of Object.entries(messages)) {
        expect(entry.message, `Key "${key}" in ${locale} missing message`).toBeDefined();
        expect(typeof entry.message, `Key "${key}" in ${locale} message not string`).toBe('string');
      }
    });
  }
});
