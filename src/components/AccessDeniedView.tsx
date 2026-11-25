import React from 'react';
import { Lock, ArrowLeft } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface AccessDeniedViewProps {
  menuLabel?: string;
  roleCode?: string;
  roleName?: string;
  onGoHome?: () => void;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  menuLabel,
  roleCode,
  roleName,
  onGoHome,
}) => {
  const { t } = useI18n();
  const roleLabel = roleCode
    ? `${roleCode} — ${t(`roles.${roleCode}`) !== `roles.${roleCode}` ? t(`roles.${roleCode}`) : roleName || ''}`
    : roleName || '';

  return (
    <div className="min-h-[65vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-7 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
          <Lock className="w-5 h-5" />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-lg font-bold text-[var(--text)]">
            {t('rbac.accessDeniedTitle')}
          </h2>
          {menuLabel && (
            <p className="text-xs font-semibold text-[var(--accent)]">
              {menuLabel}
              {roleLabel ? ` · ${roleLabel}` : ''}
            </p>
          )}
          <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
            {t('rbac.accessDeniedDesc')}
          </p>
        </div>
        {onGoHome && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onGoHome}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t('rbac.backToHome')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

