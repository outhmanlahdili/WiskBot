import type { Language } from '../../../../shared/ipc'
import en from './en.json'
import fr from './fr.json'
import ar from './ar.json'

const catalogs: Record<Language, Record<string, string>> = { en, fr, ar }
export type TranslationKey = keyof typeof en

export function translate(language: Language, key: TranslationKey): string {
  return catalogs[language]?.[key] ?? en[key] ?? key
}

export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
}
