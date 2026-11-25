import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useI18n } from './i18n';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'sop-brain-theme';

function readStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
  return null;
}

function readInitialTheme(): ThemeMode {
  const stored = readStoredTheme();
  if (stored) return stored;
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  }
  // Dark mode is the primary visual identity by default
  return 'dark';
}

let themeTransitionTimer: number | null = null;

function applyThemeToDocument(mode: ThemeMode, animate = false): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transitioning');
    if (themeTransitionTimer !== null) {
      window.clearTimeout(themeTransitionTimer);
    }
    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
      themeTransitionTimer = null;
    }, 220);
  }
  if (mode === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    root.style.backgroundColor = '#131316';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    root.style.backgroundColor = '#E3E5E8';
  }
}

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);
  const [hasExplicitPref, setHasExplicitPref] = useState<boolean>(() => readStoredTheme() !== null);
  const hasMountedRef = React.useRef(false);

  useEffect(() => {
    applyThemeToDocument(theme, hasMountedRef.current);
    hasMountedRef.current = true;
    if (hasExplicitPref) {
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Ignore storage persistence errors
      }
    }
  }, [theme, hasExplicitPref]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      if (!readStoredTheme()) {
        setThemeState(e.matches ? 'light' : 'dark');
      }
    };
    mq.addEventListener('change', handleSystemChange);
    return () => mq.removeEventListener('change', handleSystemChange);
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setHasExplicitPref(true);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setHasExplicitPref(true);
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setHasExplicitPref(true);
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

interface ThemeToggleButtonProps {
  showLabelOnMobile?: boolean;
  iconOnly?: boolean;
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  showLabelOnMobile = false,
  iconOnly = true,
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      aria-label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      aria-pressed={isDark}
      className={`inline-flex items-center justify-center gap-1.5 h-9 ${
        iconOnly ? 'w-9 px-0' : 'px-3'
      } text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] hover:border-[var(--text-muted)] border border-[var(--border)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
      ) : (
        <Moon className="w-4 h-4 text-[var(--text)] shrink-0" />
      )}
      {!iconOnly && (
        <span className={showLabelOnMobile ? 'inline' : 'hidden sm:inline'}>
          {isDark ? t('theme.light') : t('theme.dark')}
        </span>
      )}
    </button>
  );
};
