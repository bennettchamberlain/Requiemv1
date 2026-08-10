import en from '@ci/common/i18n/translations/en.json';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

let initialized = false;

/**
 * Initialise the shared i18next instance.
 *
 * Mirrors CI-Hub's setup (i18next + react-i18next + browser language detection,
 * flat SCREAMING_SNAKE keys in a single `translation` namespace, `en.json` as the
 * Crowdin source) with one deliberate difference: `en` is bundled and init is
 * synchronous, so `t()` resolves on the first render and in tests without a
 * provider. Hub blocks its first paint on an HTTP fetch because it ships 30
 * locales; we ship one. When more locales land, add `i18next-http-backend` with
 * `partialBundledLanguages: true` and serve them from the API, as Hub does.
 *
 * Idempotent — safe to call from both the app entrypoint and the test setup.
 */
export function initI18n(): typeof i18n {
  if (initialized) {
    return i18n;
  }

  initialized = true;

  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        'en-US': { translation: en },
      },
      fallbackLng: 'en',
      load: 'currentOnly',
      react: { useSuspense: false },
      // React already escapes interpolated values; escaping again double-encodes
      // apostrophes and quotes in names that flow through {{...}} placeholders.
      interpolation: { escapeValue: false },
    });

  return i18n;
}

export { i18n };
