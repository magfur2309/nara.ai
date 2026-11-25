import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import idMessages from '../locales/id.json';
import enMessages from '../locales/en.json';
import jaMessages from '../locales/ja.json';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

function getBoundaryCopy() {
  let lang = 'id';
  try {
    const stored = window.localStorage.getItem('sop-brain-locale');
    if (stored === 'en' || stored === 'ja' || stored === 'id') lang = stored;
    else if (document.documentElement.lang) lang = document.documentElement.lang;
  } catch {
    // Fallback to id
  }
  if (lang === 'en') return enMessages.errors;
  if (lang === 'ja') return jaMessages.errors;
  return idMessages.errors;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const copy = getBoundaryCopy();
    return {
      hasError: true,
      message: error.message || copy.boundaryFallback,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('SOP Brain ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const copy = getBoundaryCopy();
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
        };
        if (parsed?.error) {
          friendly = `${parsed.operationType || 'DB'}: ${parsed.error}`;
        }
      } catch {
        // Plain error message
      }

      return (
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[var(--danger)]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="font-display text-base font-semibold text-[var(--text)]">
                {copy.boundaryTitle}
              </h2>
            </div>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{copy.reloadPage}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
