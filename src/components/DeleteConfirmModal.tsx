import React, { useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';

export interface DeleteConfirmDetailRow {
  label: string;
  value: string;
}

export interface DeleteConfirmModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  details?: DeleteConfirmDetailRow[];
  warningNote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Dialog konfirmasi penghapusan standar di seluruh modul NARA AI & MyERP Plus.
 * Menggunakan z-[80] agar tampil aman di atas tabel maupun modal detail (z-50).
 */
export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  open,
  title,
  description,
  details,
  warningNote = 'Tindakan ini bersifat permanen dan tidak dapat dibatalkan.',
  confirmLabel = 'Ya, Hapus',
  cancelLabel = 'Batal',
  loading = false,
  onCancel,
  onConfirm,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 dark:bg-black/75 backdrop-blur-[2px] transition-opacity duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-modal-title"
      aria-describedby="delete-confirm-modal-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] dark:border-slate-800 bg-[var(--surface)] dark:bg-slate-900 shadow-2xl overflow-hidden transition-transform duration-150">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-900/70 flex items-center justify-center shrink-0 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="delete-confirm-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100 leading-snug"
              >
                {title}
              </h3>
              <p className="mt-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                Konfirmasi Penghapusan Data
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            aria-label="Tutup dialog konfirmasi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-3.5">
          <p
            id="delete-confirm-modal-desc"
            className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed"
          >
            {description}
          </p>

          {details && details.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] dark:border-slate-800 bg-[var(--surface-2)]/80 dark:bg-slate-950/60 divide-y divide-[var(--border)]/60 dark:divide-slate-800/80 text-xs">
              {details
                .filter((row) => row.value && row.value.trim().length > 0)
                .map((row) => (
                  <div
                    key={row.label}
                    className="flex items-start justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">
                      {row.label}
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 text-right break-words tabular-nums">
                      {row.value}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {warningNote && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {warningNote}
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-[var(--border)] dark:border-slate-800 bg-[var(--surface-2)]/60 dark:bg-slate-950/40">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface)] dark:bg-slate-800 border border-[var(--border)] dark:border-slate-700 hover:bg-[var(--surface-2)] dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>{loading ? 'Menghapus...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
