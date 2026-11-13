import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type Language } from "./messages";

const STORAGE_KEY = "gamebrain.language";
const LanguageContext = createContext({
  language: "fr" as Language,
  setLanguage: (_language: Language) => {},
  t: (source: string) => translate(source, "fr"),
});

export function LanguageProvider({ children, initialLanguage }: { children: ReactNode; initialLanguage?: Language }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (initialLanguage) return initialLanguage;
    try { return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fr"; }
    catch { return "fr"; }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Storage may be disabled. */ }
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: (source: string) => translate(source, language) }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() { return useContext(LanguageContext); }
