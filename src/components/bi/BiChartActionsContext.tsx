import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ExternalLink,
  Loader2,
  Maximize2,
  Pin,
  Presentation,
  Users,
  X,
} from 'lucide-react';
import type { CreatePinnedChartInput } from '../../lib/pinnedChartService';
import type { ChartType, ChartValueFormat, PinnedChartDocument } from '../../types/sop';

export interface BiChartActionsContextValue {
  pinnedCharts: PinnedChartDocument[];
  onPinChart?: (payload: CreatePinnedChartInput) => Promise<void>;
  onOpenDashboard?: () => void;
  sourceModuleLabel?: string;
}

const BiChartActionsContext = createContext<BiChartActionsContextValue>({
  pinnedCharts: [],
});

export const BiChartActionsProvider: React.FC<{
  value: BiChartActionsContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <BiChartActionsContext.Provider value={value}>{children}</BiChartActionsContext.Provider>
);

export function useBiChartActions(): BiChartActionsContextValue {
  return useContext(BiChartActionsContext);
}

export function mapBiShapeToPinnedChartType(
  shape: 'column' | 'cone' | 'cylinder' | 'horizontal' | 'line' | 'area'
): ChartType {
  if (shape === 'horizontal') return 'horizontal_bar';
  if (shape === 'line') return 'line';
  if (shape === 'area') return 'area';
  return 'bar';
}

export function detectBiValueFormat(samples: string[]): {
  valueFormat: ChartValueFormat;
  unitLabel: string;
} {
  const joined = samples.filter(Boolean).join(' ');
  if (/\bRp\b|Rp\s?[-0-9]|IDR/i.test(joined)) {
    return { valueFormat: 'currency', unitLabel: 'Rp' };
  }
  if (/%/.test(joined)) {
    return { valueFormat: 'percent', unitLabel: '%' };
  }
  if (/\bhari\b|\bhr\b/i.test(joined)) {
    return { valueFormat: 'number', unitLabel: 'hari' };
  }
  if (/\bunit\b|\bpcs\b/i.test(joined)) {
    return { valueFormat: 'number', unitLabel: 'unit' };
  }
  if (/[0-9][.,]?[0-9]*\s*x\b/i.test(joined)) {
    return { valueFormat: 'number', unitLabel: 'x' };
  }
  return { valueFormat: 'number', unitLabel: '' };
}

export type BiPinPayloadBuilder = () => Omit<
  CreatePinnedChartInput,
  'title' | 'speakerNotes' | 'isShared' | 'displayOrder'
> | null;

export function useBiChartCardActions(params: {
  title: string;
  subtitle: string;
  buildPinPayload: BiPinPayloadBuilder;
}) {
  const { pinnedCharts, onPinChart, onOpenDashboard, sourceModuleLabel } = useBiChartActions();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPinComposer, setShowPinComposer] = useState(false);
  const [pinTitle, setPinTitle] = useState(params.title);
  const [speakerNotes, setSpeakerNotes] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [savingPin, setSavingPin] = useState(false);
  const [pinnedJustNow, setPinnedJustNow] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    setPinTitle(params.title);
    setPinnedJustNow(false);
    setPinError(null);
  }, [params.title]);

  const normalizedTitle = params.title.trim().toLowerCase();
  const isAlreadyPinned =
    pinnedJustNow ||
    pinnedCharts.some((pc) => pc.title.trim().toLowerCase() === normalizedTitle);

  const handleOpenComposer = () => {
    setPinError(null);
    setPinTitle(params.title);
    setShowPinComposer((prev) => !prev);
  };

  const handleConfirmPin = async () => {
    if (!onPinChart || savingPin) return;
    const basePayload = params.buildPinPayload();
    if (!basePayload || basePayload.labels.length === 0 || basePayload.series.length === 0) {
      setPinError('Belum ada data grafik untuk disematkan ke Dashboard.');
      return;
    }

    setSavingPin(true);
    setPinError(null);
    try {
      await onPinChart({
        ...basePayload,
        title: (pinTitle || params.title).trim().slice(0, 140) || 'Diagram BI',
        subtitle: (basePayload.subtitle || params.subtitle || '').trim().slice(0, 220),
        speakerNotes: speakerNotes.trim().slice(0, 1500),
        sourceLabel:
          basePayload.sourceLabel || sourceModuleLabel || 'Business Intelligence (BI)',
        isShared,
      });
      setPinnedJustNow(true);
      setShowPinComposer(false);
    } catch (err) {
      setPinError(
        err instanceof Error ? err.message : 'Gagal menyematkan grafik ke Dashboard.'
      );
    } finally {
      setSavingPin(false);
    }
  };

  return {
    canPin: Boolean(onPinChart),
    isAlreadyPinned,
    onOpenDashboard,
    sourceModuleLabel,
    isFullscreen,
    setIsFullscreen,
    showPinComposer,
    setShowPinComposer,
    pinTitle,
    setPinTitle,
    speakerNotes,
    setSpeakerNotes,
    isShared,
    setIsShared,
    savingPin,
    pinError,
    handleOpenComposer,
    handleConfirmPin,
  };
}

export const BiChartActionButtons: React.FC<{
  canPin: boolean;
  isAlreadyPinned: boolean;
  showPinComposer: boolean;
  onTogglePinComposer: () => void;
  onOpenDashboard?: () => void;
  onOpenMaximize?: () => void;
  showMaximize?: boolean;
}> = ({
  canPin,
  isAlreadyPinned,
  showPinComposer,
  onTogglePinComposer,
  onOpenDashboard,
  onOpenMaximize,
  showMaximize = true,
}) => (
  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
    {canPin && (
      <>
        {isAlreadyPinned ? (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => (onOpenDashboard ? onOpenDashboard() : onTogglePinComposer())}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-[var(--success-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--success)] transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300 cursor-pointer"
              title="Grafik sudah terpasang di Dashboard Presentasi · Klik untuk membuka Dashboard"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Terpin</span>
              {onOpenDashboard && <ExternalLink className="w-3 h-3 opacity-75" />}
            </button>
            <button
              type="button"
              onClick={onTogglePinComposer}
              className={`inline-flex items-center justify-center rounded-lg border p-1.5 text-xs transition cursor-pointer ${
                showPinComposer
                  ? 'border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--accent)] dark:text-[var(--accent-text)]'
                  : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-muted)]'
              }`}
              title="Pin versi baru dengan filter / catatan meeting berbeda"
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onTogglePinComposer}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              showPinComposer
                ? 'bg-[var(--accent-hover)] text-[var(--on-accent)] ring-2 ring-[var(--accent)]/30'
                : 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
            }`}
            title="Sematkan grafik ini ke Dashboard Utama untuk bahan presentasi meeting"
          >
            <Pin className="w-3.5 h-3.5" />
            <span>Pin ke Dashboard</span>
          </button>
        )}
      </>
    )}

    {showMaximize && onOpenMaximize && (
      <button
        type="button"
        onClick={onOpenMaximize}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] transition hover:bg-[var(--surface-2)] hover:border-[var(--text-muted)] cursor-pointer"
        title="Perbesar grafik ke layar penuh untuk presentasi meeting"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        <span>Maximize</span>
      </button>
    )}
  </div>
);

export const BiPinComposerPanel: React.FC<{
  open: boolean;
  pinTitle: string;
  onChangePinTitle: (v: string) => void;
  speakerNotes: string;
  onChangeSpeakerNotes: (v: string) => void;
  isShared: boolean;
  onChangeIsShared: (v: boolean) => void;
  savingPin: boolean;
  pinError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  open,
  pinTitle,
  onChangePinTitle,
  speakerNotes,
  onChangeSpeakerNotes,
  isShared,
  onChangeIsShared,
  savingPin,
  pinError,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  return (
    <div className="rounded-xl border border-[var(--accent)]/35 bg-[var(--bg)] p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]">
          <Presentation className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
          <span>Sematkan ke Dashboard Presentasi Meeting</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-md cursor-pointer"
          aria-label="Tutup form pin"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 block">
          <span className="text-[11px] font-medium text-[var(--text-muted)]">
            Judul Slide di Dashboard
          </span>
          <input
            type="text"
            value={pinTitle}
            onChange={(e) => onChangePinTitle(e.target.value)}
            maxLength={140}
            placeholder="Contoh: Net Profit Mar–Nov 2026"
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-[11px] font-medium text-[var(--text-muted)]">
            Catatan Presenter / Poin Meeting (Opsional)
          </span>
          <input
            type="text"
            value={speakerNotes}
            onChange={(e) => onChangeSpeakerNotes(e.target.value)}
            maxLength={500}
            placeholder="Catatan singkat yang akan dibahas saat meeting..."
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      {pinError && (
        <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{pinError}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => onChangeIsShared(e.target.checked)}
            className="rounded border-[var(--border)] accent-[var(--accent)]"
          />
          <Users className="w-3.5 h-3.5" />
          <span>Bagikan slide ini ke Dashboard semua tim</span>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={savingPin}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={savingPin || !pinTitle.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition cursor-pointer disabled:opacity-50"
          >
            {savingPin ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
            <span>{savingPin ? 'Menyimpan...' : 'Simpan ke Dashboard'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const BiChartFullscreenModal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  sourceLabel?: string;
  headerActions?: React.ReactNode;
  pinComposer?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  open,
  onClose,
  title,
  subtitle,
  sourceLabel,
  headerActions,
  pinComposer,
  toolbar,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[1440px] max-h-[94vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Presentation Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[var(--border)] flex flex-wrap items-start justify-between gap-3 bg-[var(--surface)]">
          <div className="min-w-0 flex-1 space-y-1">
            {sourceLabel && (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)]">
                <Presentation className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{sourceLabel}</span>
              </div>
            )}
            <h3 className="font-display text-lg sm:text-xl font-bold text-[var(--text)] leading-snug break-words">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed break-words">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--surface-2)] transition cursor-pointer"
              title="Tutup mode layar penuh (Esc)"
            >
              <X className="w-3.5 h-3.5" />
              <span>Tutup</span>
            </button>
          </div>
        </div>

        {/* Optional Pin Composer + Interactive Chart Controls */}
        {(pinComposer || toolbar) && (
          <div className="px-5 sm:px-6 py-3 border-b border-[var(--border)]/70 bg-[var(--bg)]/50 space-y-3">
            {pinComposer}
            {toolbar}
          </div>
        )}

        {/* Maximized Chart Viewport */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7">{children}</div>
      </div>
    </div>,
    document.body
  );
};
