import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import idMessages from '../locales/id.json';
import enMessages from '../locales/en.json';
import jaMessages from '../locales/ja.json';

export type LocaleCode = 'id' | 'en' | 'ja';

const STORAGE_KEY = 'sop-brain-locale';

const LOCALE_TAGS: Record<LocaleCode, string> = {
  id: 'id-ID',
  en: 'en-US',
  ja: 'ja-JP',
};

const LOCALE_LABELS: Record<LocaleCode, { code: string; nativeName: string }> = {
  id: { code: 'ID', nativeName: 'Bahasa Indonesia' },
  en: { code: 'EN', nativeName: 'English' },
  ja: { code: 'JA', nativeName: '日本語' },
};

type MessageTree = Record<string, unknown>;

const DICTIONARIES: Record<LocaleCode, MessageTree> = {
  id: idMessages as MessageTree,
  en: enMessages as MessageTree,
  ja: jaMessages as MessageTree,
};

function resolveKey(tree: MessageTree, path: string): string | undefined {
  const parts = path.split('.');
  let curr: unknown = tree;
  for (const part of parts) {
    if (curr && typeof curr === 'object' && part in (curr as Record<string, unknown>)) {
      curr = (curr as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'string' ? curr : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const val = params[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

function detectInitialLocale(): LocaleCode {
  if (typeof window === 'undefined') return 'id';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'id' || stored === 'en' || stored === 'ja') {
      return stored;
    }
  } catch {
    // Ignore storage restriction
  }

  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || 'id'];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').toLowerCase();
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('id') || normalized.startsWith('in')) return 'id';
  }
  return 'id';
}

export interface I18nContextValue {
  locale: LocaleCode;
  localeTag: string;
  setLocale: (next: LocaleCode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (
    value: number | null | undefined,
    currency?: string,
    options?: Intl.NumberFormatOptions
  ) => string;
  formatDate: (
    value: Date | string | number | null | undefined,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  formatDateTime: (value: Date | string | number | null | undefined) => string;
  formatPercent: (value: number | null | undefined, fractionDigits?: number) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'id',
  localeTag: 'id-ID',
  setLocale: () => {},
  t: (key) => key,
  formatNumber: (v) => String(v ?? 0),
  formatCurrency: (v) => String(v ?? 0),
  formatDate: (v) => String(v ?? ''),
  formatDateTime: (v) => String(v ?? ''),
  formatPercent: (v) => `${v ?? 0}%`,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<LocaleCode>(detectInitialLocale);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      const fullTitle = resolveKey(DICTIONARIES[locale], 'app.fullName');
      const appName = resolveKey(DICTIONARIES[locale], 'app.name');
      if (appName && fullTitle) {
        document.title = `${appName} — ${fullTitle}`;
      }
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage persistence errors
    }
  }, [locale]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY &&
        (e.newValue === 'id' || e.newValue === 'en' || e.newValue === 'ja')
      ) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
  }, []);

  const localeTag = LOCALE_TAGS[locale];

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let resolved: string | undefined;
      if (params && typeof params.count === 'number') {
        const suffix = params.count === 1 ? '_one' : '_other';
        resolved =
          resolveKey(DICTIONARIES[locale], `${key}${suffix}`) ??
          resolveKey(DICTIONARIES[locale], key) ??
          resolveKey(DICTIONARIES.id, `${key}${suffix}`) ??
          resolveKey(DICTIONARIES.id, key);
      } else {
        resolved =
          resolveKey(DICTIONARIES[locale], key) ??
          resolveKey(DICTIONARIES.id, key);
      }
      return interpolate(resolved ?? key, params);
    },
    [locale]
  );

  const formatNumber = useCallback(
    (value: number | null | undefined, options?: Intl.NumberFormatOptions): string => {
      const num = Number(value ?? 0);
      if (!Number.isFinite(num)) return '0';
      try {
        return new Intl.NumberFormat(localeTag, options).format(num);
      } catch {
        return String(num);
      }
    },
    [localeTag]
  );

  const formatCurrency = useCallback(
    (
      value: number | null | undefined,
      currency = 'IDR',
      options?: Intl.NumberFormatOptions
    ): string => {
      const num = Number(value ?? 0);
      if (!Number.isFinite(num)) return '0';
      try {
        return new Intl.NumberFormat(localeTag, {
          style: 'currency',
          currency,
          maximumFractionDigits: currency === 'IDR' || currency === 'JPY' ? 0 : 2,
          ...options,
        }).format(num);
      } catch {
        return `${currency} ${formatNumber(num)}`;
      }
    },
    [localeTag, formatNumber]
  );

  const formatDate = useCallback(
    (
      value: Date | string | number | null | undefined,
      options?: Intl.DateTimeFormatOptions
    ): string => {
      if (value === null || value === undefined || value === '') return '-';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      try {
        return new Intl.DateTimeFormat(localeTag, {
          year: 'numeric',
          month: locale === 'ja' ? 'long' : 'short',
          day: 'numeric',
          ...options,
        }).format(date);
      } catch {
        return date.toISOString().slice(0, 10);
      }
    },
    [locale, localeTag]
  );

  const formatDateTime = useCallback(
    (value: Date | string | number | null | undefined): string => {
      if (value === null || value === undefined || value === '') return '-';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      try {
        return new Intl.DateTimeFormat(localeTag, {
          year: 'numeric',
          month: locale === 'ja' ? 'long' : 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date);
      } catch {
        return date.toISOString();
      }
    },
    [locale, localeTag]
  );

  const formatPercent = useCallback(
    (value: number | null | undefined, fractionDigits = 1): string => {
      const num = Number(value ?? 0);
      if (!Number.isFinite(num)) return '0%';
      try {
        return new Intl.NumberFormat(localeTag, {
          style: 'percent',
          minimumFractionDigits: 0,
          maximumFractionDigits: fractionDigits,
        }).format(num / 100);
      } catch {
        return `${num.toFixed(fractionDigits)}%`;
      }
    },
    [localeTag]
  );

  const ctxValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeTag,
      setLocale,
      t,
      formatNumber,
      formatCurrency,
      formatDate,
      formatDateTime,
      formatPercent,
    }),
    [
      locale,
      localeTag,
      setLocale,
      t,
      formatNumber,
      formatCurrency,
      formatDate,
      formatDateTime,
      formatPercent,
    ]
  );

  return <I18nContext.Provider value={ctxValue}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

interface LanguageSwitcherProps {
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '' }) => {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const active = LOCALE_LABELS[locale];

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('lang.label')}
        title={t('lang.label')}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Globe className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
        <span className="tracking-wide">{active.code}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('lang.label')}
          className="absolute right-0 mt-2 w-48 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-xl py-1.5 z-50"
        >
          {(['id', 'en', 'ja'] as LocaleCode[]).map((code) => {
            const meta = LOCALE_LABELS[code];
            const selected = locale === code;
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setLocale(code);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-xs transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[var(--accent-soft)] text-[var(--text)] font-semibold'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono text-[11px] font-bold w-6 text-left text-[var(--accent-text)] shrink-0">
                    {meta.code}
                  </span>
                  <span className="truncate">{meta.nativeName}</span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
