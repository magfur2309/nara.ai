import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  AreaChart,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  Hash,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Palette,
  PieChart,
  Pin,
  Printer,
  RefreshCw,
  Save,
  StickyNote,
  Table as TableIcon,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import type {
  AiChartSpec,
  ChartColorPalette,
  ChartSeriesData,
  ChartSortMode,
  ChartType,
  ChartValueFormat,
  PinnedChartDocument,
} from '../types/sop';
import {
  CHART_PALETTES,
  CHART_PALETTES_LIGHT,
  CHART_TYPE_OPTIONS,
  applySortToChartData,
  computeChartInsights,
  exportChartDataCsv,
  exportChartDataExcel,
  exportChartSlidePng,
  formatChartValue,
} from '../lib/chartDataExtractor';

export interface PresentationChartCardProps {
  mode: 'chat' | 'dashboard';
  spec: AiChartSpec;
  pinnedDoc?: PinnedChartDocument;
  sourceQuestion?: string;
  isAlreadyPinned?: boolean;
  canEdit?: boolean;
  appDark?: boolean;
  compact?: boolean;
  // Chat mode callbacks
  onPinToDashboard?: (payload: {
    title: string;
    subtitle: string;
    chartType: ChartType;
    palette: ChartColorPalette;
    valueFormat: ChartValueFormat;
    unitLabel: string;
    categoryLabel: string;
    labels: string[];
    series: ChartSeriesData[];
    activeSeriesIndices: number[];
    showDataLabels: boolean;
    sortMode: ChartSortMode;
    speakerNotes: string;
    sourceQuestion: string;
    sourceLabel: string;
    isShared: boolean;
  }) => Promise<void>;
  onOpenDashboard?: () => void;
  // Dashboard mode callbacks
  onUpdatePinned?: (
    doc: PinnedChartDocument,
    patch: {
      title?: string;
      subtitle?: string;
      chartType?: ChartType;
      palette?: ChartColorPalette;
      activeSeriesIndices?: number[];
      showDataLabels?: boolean;
      sortMode?: ChartSortMode;
      speakerNotes?: string;
      isShared?: boolean;
    }
  ) => Promise<void>;
  onDeletePinned?: (chartId: string) => Promise<void>;
  onMoveOrder?: (chartId: string, direction: 'up' | 'down') => Promise<void>;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReAskAi?: (question: string) => void;
  // Optional external fullscreen deck trigger
  onRequestDeckAtHere?: () => void;
}

export interface FullscreenPresentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  sourceLabel: string;
  categoryLabel: string;
  labels: string[];
  series: ChartSeriesData[];
  valueFormat: ChartValueFormat;
  unitLabel: string;
  chartType: ChartType;
  onChangeChartType: (t: ChartType) => void;
  palette: ChartColorPalette;
  onChangePalette: (p: ChartColorPalette) => void;
  activeSeriesIndices: number[];
  onToggleSeries: (idx: number) => void;
  showDataLabels: boolean;
  onToggleDataLabels: () => void;
  sortMode: ChartSortMode;
  onChangeSortMode: (s: ChartSortMode) => void;
  speakerNotes: string;
  appDark: boolean;
  // Optional Slideshow Deck navigation
  slideIndex?: number;
  slideCount?: number;
  onPrevSlide?: () => void;
  onNextSlide?: () => void;
}

function getChartIcon(type: ChartType) {
  switch (type) {
    case 'bar':
      return BarChart3;
    case 'horizontal_bar':
      return AlignLeft;
    case 'line':
      return TrendingUp;
    case 'area':
      return AreaChart;
    case 'donut':
      return CircleDot;
    case 'pie':
      return PieChart;
    case 'stacked_bar':
      return Layers;
  }
}

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(3, maxLen - 1))}…`;
}

function computeNiceTicks(minVal: number, maxVal: number, targetCount = 5): number[] {
  const safeMin = Math.min(0, minVal);
  const safeMax = Math.max(0, maxVal);
  const range = safeMax - safeMin || 1;
  const roughStep = range / Math.max(2, targetCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  let niceNorm = 1;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 2.5) niceNorm = 2.5;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  const step = niceNorm * mag;

  const start = Math.floor(safeMin / step) * step;
  const end = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.01; v += step) {
    ticks.push(Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1000) / 1000);
    if (ticks.length > 10) break;
  }
  return ticks;
}

interface InteractiveSvgChartProps {
  svgRef: React.RefObject<SVGSVGElement | null>;
  chartType: ChartType;
  labels: string[];
  series: ChartSeriesData[];
  activeSeriesIndices: number[];
  palette: ChartColorPalette;
  valueFormat: ChartValueFormat;
  unitLabel: string;
  showDataLabels: boolean;
  isDarkSurface: boolean;
  height?: number;
}

export const InteractiveSvgChart: React.FC<InteractiveSvgChartProps> = ({
  svgRef,
  chartType,
  labels,
  series,
  activeSeriesIndices,
  palette,
  valueFormat,
  unitLabel,
  showDataLabels,
  isDarkSurface,
  height = 320,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hoveredSeriesPos, setHoveredSeriesPos] = useState<number | null>(null);

  const colors = isDarkSurface
    ? CHART_PALETTES[palette]?.colors || CHART_PALETTES.corporate.colors
    : CHART_PALETTES_LIGHT[palette] || CHART_PALETTES_LIGHT.corporate;
  const activeSeries = useMemo(() => {
    const picked = activeSeriesIndices
      .filter((i) => i >= 0 && i < series.length)
      .map((i) => ({ ...series[i], colorIndex: i }));
    if (picked.length > 0) return picked;
    return series.length > 0 ? [{ ...series[0], colorIndex: 0 }] : [];
  }, [series, activeSeriesIndices]);

  const textColor = isDarkSurface ? '#CBD5E1' : '#1F2328';
  const mutedTextColor = isDarkSurface ? '#94A3B8' : '#4F5761';
  const gridColor = isDarkSurface ? '#1E293B' : '#CACED4';
  const zeroLineColor = isDarkSurface ? '#475569' : '#B3B9C1';
  const cardBg = isDarkSurface ? '#0F172A' : '#EDEEF0';
  const hoverGuide = isDarkSurface ? 'rgba(148,163,184,0.16)' : 'rgba(31,35,40,0.06)';

  if (labels.length === 0 || activeSeries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500">
        Tidak ada data numerik untuk ditampilkan.
      </div>
    );
  }

  // PIE / DONUT CHART
  if (chartType === 'pie' || chartType === 'donut') {
    const primary = activeSeries[0];
    const items = labels.map((label, i) => ({
      label,
      rawValue: primary.values[i] ?? 0,
      absValue: Math.abs(primary.values[i] ?? 0),
      color: colors[i % colors.length],
      idx: i,
    }));
    const totalAbs = items.reduce((s, it) => s + it.absValue, 0);
    const hasNegatives = items.some((it) => it.rawValue < 0);

    const W = 860;
    const H = Math.max(320, height);
    const cx = 225;
    const cy = H / 2;
    const outerR = Math.min(148, H * 0.42);
    const innerR = chartType === 'donut' ? outerR * 0.56 : 0;

    let cumAngle = -Math.PI / 2;
    const slices = items.map((item) => {
      const ratio = totalAbs > 0 ? item.absValue / totalAbs : 0;
      const angle = ratio * Math.PI * 2;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;
      const midAngle = (startAngle + endAngle) / 2;

      const isHovered = hoveredIdx === item.idx;
      const rOut = isHovered ? outerR + 7 : outerR;
      const rIn = innerR;

      const x1 = cx + rOut * Math.cos(startAngle);
      const y1 = cy + rOut * Math.sin(startAngle);
      const x2 = cx + rOut * Math.cos(endAngle);
      const y2 = cy + rOut * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;

      let path = '';
      if (ratio >= 0.9999) {
        // Full circle special case
        path = `M ${cx} ${cy - rOut} A ${rOut} ${rOut} 0 1 1 ${cx - 0.01} ${cy - rOut} Z`;
      } else if (rIn > 0) {
        const ix1 = cx + rIn * Math.cos(endAngle);
        const iy1 = cy + rIn * Math.sin(endAngle);
        const ix2 = cx + rIn * Math.cos(startAngle);
        const iy2 = cy + rIn * Math.sin(startAngle);
        path = `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${rIn} ${rIn} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
      } else {
        path = `M ${cx} ${cy} L ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      }

      const labelR = rIn > 0 ? (rOut + rIn) / 2 : rOut * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);

      return { ...item, ratio, path, lx, ly };
    });

    const activeSlice = hoveredIdx !== null ? slices.find((s) => s.idx === hoveredIdx) : null;
    const legendList = slices.slice(0, 10);

    return (
      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label={`Diagram ${chartType}`}
        >
          {slices.map((s) => (
            <g
              key={s.idx}
              className="cursor-pointer transition-opacity duration-150"
              opacity={hoveredIdx === null || hoveredIdx === s.idx ? 1 : 0.45}
              onMouseEnter={() => setHoveredIdx(s.idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <path
                d={s.path}
                fill={s.color}
                stroke={cardBg}
                strokeWidth={2}
              />
              {showDataLabels && s.ratio >= 0.06 && (
                <text
                  x={s.lx}
                  y={s.ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isDarkSurface ? '#F8FAFC' : '#F4F5F6'}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {(s.ratio * 100).toFixed(0)}%
                </text>
              )}
            </g>
          ))}

          {chartType === 'donut' && (
            <g>
              <text
                x={cx}
                y={cy - 10}
                textAnchor="middle"
                fill={mutedTextColor}
                fontSize="11"
                fontWeight="600"
              >
                {activeSlice ? truncateLabel(activeSlice.label, 18) : 'TOTAL'}
              </text>
              <text
                x={cx}
                y={cy + 14}
                textAnchor="middle"
                fill={textColor}
                fontSize="16"
                fontWeight="700"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatChartValue(
                  activeSlice ? activeSlice.rawValue : primary.values.reduce((a, b) => a + b, 0),
                  valueFormat,
                  unitLabel,
                  true
                )}
              </text>
              {activeSlice && (
                <text
                  x={cx}
                  y={cy + 34}
                  textAnchor="middle"
                  fill={activeSlice.color}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {(activeSlice.ratio * 100).toFixed(1)}%
                </text>
              )}
            </g>
          )}

          {/* Right-side Breakdown Table Legend inside SVG (so PNG export includes it cleanly!) */}
          <g transform={`translate(430, ${Math.max(24, (H - legendList.length * 28) / 2)})`}>
            {legendList.map((s, rowIdx) => {
              const y = rowIdx * 28;
              const isRowHovered = hoveredIdx === s.idx;
              return (
                <g
                  key={s.idx}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(s.idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {isRowHovered && (
                    <rect
                      x={-8}
                      y={y - 14}
                      width={418}
                      height={24}
                      rx={5}
                      fill={hoverGuide}
                    />
                  )}
                  <rect x={0} y={y - 8} width={11} height={11} rx={2.5} fill={s.color} />
                  <text
                    x={18}
                    y={y + 1}
                    fill={textColor}
                    fontSize="12"
                    fontWeight={isRowHovered ? '700' : '500'}
                  >
                    {truncateLabel(s.label, 24)}
                  </text>
                  <text
                    x={338}
                    y={y + 1}
                    textAnchor="end"
                    fill={textColor}
                    fontSize="12"
                    fontWeight="600"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatChartValue(s.rawValue, valueFormat, unitLabel, true)}
                  </text>
                  <text
                    x={404}
                    y={y + 1}
                    textAnchor="end"
                    fill={mutedTextColor}
                    fontSize="11.5"
                    fontWeight="600"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {(s.ratio * 100).toFixed(1)}%
                  </text>
                </g>
              );
            })}
            {slices.length > 10 && (
              <text
                x={0}
                y={legendList.length * 28 + 10}
                fill={mutedTextColor}
                fontSize="11"
              >
                +{slices.length - 10} item lainnya (lihat Tabel Data)
              </text>
            )}
          </g>
        </svg>

        {hasNegatives && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Catatan: Proporsi irisan dihitung dari nilai absolut karena terdapat angka negatif.
          </p>
        )}
      </div>
    );
  }

  // HORIZONTAL BAR CHART
  if (chartType === 'horizontal_bar') {
    const primary = activeSeries[0];
    const rowCount = labels.length;
    const rowH = rowCount > 12 ? 28 : 36;
    const W = 880;
    const padTop = 20;
    const padBottom = 34;
    const padLeft = 210;
    const padRight = 135;
    const H = Math.max(240, padTop + padBottom + rowCount * rowH);
    const plotW = W - padLeft - padRight;

    const allVals = activeSeries.flatMap((s) => s.values);
    const minVal = Math.min(0, ...allVals);
    const maxVal = Math.max(0, ...allVals);
    const ticks = computeNiceTicks(minVal, maxVal, 5);
    const domainMin = ticks[0] ?? 0;
    const domainMax = ticks[ticks.length - 1] ?? 1;
    const domainSpan = domainMax - domainMin || 1;
    const xScale = (v: number) => padLeft + ((v - domainMin) / domainSpan) * plotW;
    const zeroX = xScale(0);

    const barGroupH = rowH * 0.68;
    const singleBarH = Math.max(6, barGroupH / activeSeries.length - (activeSeries.length > 1 ? 2 : 0));

    return (
      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label="Diagram Batang Horizontal"
        >
          {/* Vertical Gridlines */}
          {ticks.map((tick) => {
            const tx = xScale(tick);
            return (
              <g key={tick}>
                <line
                  x1={tx}
                  y1={padTop - 4}
                  x2={tx}
                  y2={H - padBottom}
                  stroke={tick === 0 ? zeroLineColor : gridColor}
                  strokeWidth={tick === 0 ? 1.4 : 1}
                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                />
                <text
                  x={tx}
                  y={H - padBottom + 18}
                  textAnchor="middle"
                  fill={mutedTextColor}
                  fontSize="11"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {formatChartValue(tick, valueFormat, unitLabel, true)}
                </text>
              </g>
            );
          })}

          {/* Rows */}
          {labels.map((label, rowIdx) => {
            const yTop = padTop + rowIdx * rowH;
            const isRowHovered = hoveredIdx === rowIdx;
            const startBarsY = yTop + (rowH - barGroupH) / 2;

            return (
              <g
                key={rowIdx}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(rowIdx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {isRowHovered && (
                  <rect
                    x={4}
                    y={yTop + 1}
                    width={W - 8}
                    height={rowH - 2}
                    rx={4}
                    fill={hoverGuide}
                  />
                )}
                <text
                  x={padLeft - 12}
                  y={yTop + rowH / 2 + 4}
                  textAnchor="end"
                  fill={textColor}
                  fontSize="12"
                  fontWeight={isRowHovered ? '700' : '500'}
                >
                  {truncateLabel(label, 28)}
                </text>

                {activeSeries.map((s, sIdx) => {
                  const val = s.values[rowIdx] ?? 0;
                  const bx1 = Math.min(zeroX, xScale(val));
                  const bx2 = Math.max(zeroX, xScale(val));
                  const bw = Math.max(2, bx2 - bx1);
                  const by = startBarsY + sIdx * (singleBarH + 2);
                  const barColor =
                    activeSeries.length === 1
                      ? colors[rowIdx % colors.length]
                      : colors[s.colorIndex % colors.length];

                  return (
                    <g key={sIdx}>
                      <rect
                        x={bx1}
                        y={by}
                        width={bw}
                        height={singleBarH}
                        rx={3}
                        fill={barColor}
                        opacity={hoveredIdx === null || isRowHovered ? 0.94 : 0.65}
                      />
                      {showDataLabels && (activeSeries.length === 1 || isRowHovered) && (
                        <text
                          x={bx2 + 8}
                          y={by + singleBarH / 2 + 4}
                          fill={textColor}
                          fontSize="11.5"
                          fontWeight="600"
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        >
                          {formatChartValue(val, valueFormat, unitLabel, true)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {hoveredIdx !== null && (
          <div className="pointer-events-none mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 text-xs dark:border-slate-800">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {labels[hoveredIdx]}
            </span>
            {activeSeries.map((s, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor:
                      activeSeries.length === 1
                        ? colors[hoveredIdx % colors.length]
                        : colors[s.colorIndex % colors.length],
                  }}
                />
                {activeSeries.length > 1 ? `${s.name}: ` : `${primary.name}: `}
                <strong className="text-slate-900 dark:text-white">
                  {formatChartValue(s.values[hoveredIdx] ?? 0, valueFormat, unitLabel, false)}
                </strong>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // CARTESIAN CHARTS: BAR, STACKED_BAR, LINE, AREA
  const W = 880;
  const H = Math.max(300, height);
  const needsAngledX = labels.length > 8 || labels.some((l) => l.length > 13);
  const padTop = 30;
  const padRight = 24;
  const padLeft = 92;
  const padBottom = needsAngledX ? 74 : 44;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  let domainMinVal = 0;
  let domainMaxVal = 0;

  if (chartType === 'stacked_bar') {
    for (let i = 0; i < labels.length; i++) {
      let posSum = 0;
      let negSum = 0;
      for (const s of activeSeries) {
        const v = s.values[i] ?? 0;
        if (v >= 0) posSum += v;
        else negSum += v;
      }
      if (posSum > domainMaxVal) domainMaxVal = posSum;
      if (negSum < domainMinVal) domainMinVal = negSum;
    }
  } else {
    for (const s of activeSeries) {
      for (const v of s.values) {
        if (v > domainMaxVal) domainMaxVal = v;
        if (v < domainMinVal) domainMinVal = v;
      }
    }
  }

  const ticks = computeNiceTicks(domainMinVal, domainMaxVal, 5);
  const yMin = ticks[0] ?? 0;
  const yMax = ticks[ticks.length - 1] ?? 1;
  const ySpan = yMax - yMin || 1;
  const yScale = (v: number) => padTop + plotH - ((v - yMin) / ySpan) * plotH;
  const zeroY = yScale(0);

  const slotW = plotW / Math.max(1, labels.length);
  const xCenter = (i: number) =>
    chartType === 'line' || chartType === 'area'
      ? labels.length === 1
        ? padLeft + plotW / 2
        : padLeft + (i / (labels.length - 1)) * (plotW - 36) + 18
      : padLeft + i * slotW + slotW / 2;

  const showEveryNLabel = labels.length > 16 ? Math.ceil(labels.length / 12) : 1;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={`Diagram ${chartType}`}
      >
        <defs>
          {activeSeries.map((s, sIdx) => {
            const c = colors[s.colorIndex % colors.length];
            return (
              <linearGradient
                key={sIdx}
                id={`areaGrad_${palette}_${s.colorIndex}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={c} stopOpacity={isDarkSurface ? 0.38 : 0.28} />
                <stop offset="100%" stopColor={c} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>

        {/* Horizontal Y Gridlines */}
        {ticks.map((tick) => {
          const ty = yScale(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={ty}
                x2={W - padRight}
                y2={ty}
                stroke={tick === 0 ? zeroLineColor : gridColor}
                strokeWidth={tick === 0 ? 1.4 : 1}
                strokeDasharray={tick === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 10}
                y={ty + 4}
                textAnchor="end"
                fill={mutedTextColor}
                fontSize="11"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatChartValue(tick, valueFormat, unitLabel, true)}
              </text>
            </g>
          );
        })}

        {/* Hover Band */}
        {hoveredIdx !== null && (
          <rect
            x={
              chartType === 'line' || chartType === 'area'
                ? xCenter(hoveredIdx) - 18
                : padLeft + hoveredIdx * slotW + 2
            }
            y={padTop}
            width={
              chartType === 'line' || chartType === 'area'
                ? 36
                : Math.max(12, slotW - 4)
            }
            height={plotH}
            fill={hoverGuide}
            rx={4}
          />
        )}

        {/* BAR CHART */}
        {chartType === 'bar' &&
          labels.map((_, idx) => {
            const groupW = Math.min(slotW * 0.72, activeSeries.length * 46);
            const gap = activeSeries.length > 1 ? 3 : 0;
            const barW = Math.max(
              5,
              (groupW - gap * (activeSeries.length - 1)) / activeSeries.length
            );
            const startX = xCenter(idx) - groupW / 2;

            return (
              <g
                key={idx}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => {
                  setHoveredIdx(null);
                  setHoveredSeriesPos(null);
                }}
              >
                {activeSeries.map((s, sIdx) => {
                  const val = s.values[idx] ?? 0;
                  const yTop = val >= 0 ? yScale(val) : zeroY;
                  const yBot = val >= 0 ? zeroY : yScale(val);
                  const bh = Math.max(2, yBot - yTop);
                  const bx = startX + sIdx * (barW + gap);
                  const fill =
                    activeSeries.length === 1 && labels.length <= 8
                      ? colors[idx % colors.length]
                      : colors[s.colorIndex % colors.length];
                  const isFocused = hoveredIdx === null || hoveredIdx === idx;

                  return (
                    <g key={sIdx} onMouseEnter={() => setHoveredSeriesPos(sIdx)}>
                      <rect
                        x={bx}
                        y={yTop}
                        width={barW}
                        height={bh}
                        rx={3}
                        fill={fill}
                        opacity={isFocused ? 0.94 : 0.55}
                      />
                      {showDataLabels &&
                        (labels.length <= 10 || hoveredIdx === idx) &&
                        (activeSeries.length <= 2 || hoveredIdx === idx) && (
                          <text
                            x={bx + barW / 2}
                            y={val >= 0 ? yTop - 6 : yBot + 13}
                            textAnchor="middle"
                            fill={textColor}
                            fontSize="10.5"
                            fontWeight="600"
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          >
                            {formatChartValue(val, valueFormat, unitLabel, true)}
                          </text>
                        )}
                    </g>
                  );
                })}
              </g>
            );
          })}

        {/* STACKED BAR CHART */}
        {chartType === 'stacked_bar' &&
          labels.map((_, idx) => {
            const barW = Math.min(56, Math.max(10, slotW * 0.58));
            const bx = xCenter(idx) - barW / 2;
            let posAcc = 0;
            let negAcc = 0;
            const totalNet = activeSeries.reduce((acc, s) => acc + (s.values[idx] ?? 0), 0);

            return (
              <g
                key={idx}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {activeSeries.map((s, sIdx) => {
                  const val = s.values[idx] ?? 0;
                  let y1: number;
                  let y2: number;
                  if (val >= 0) {
                    y2 = yScale(posAcc);
                    posAcc += val;
                    y1 = yScale(posAcc);
                  } else {
                    y1 = yScale(negAcc);
                    negAcc += val;
                    y2 = yScale(negAcc);
                  }
                  const bh = Math.max(0, y2 - y1);
                  return (
                    <rect
                      key={sIdx}
                      x={bx}
                      y={y1}
                      width={barW}
                      height={bh}
                      fill={colors[s.colorIndex % colors.length]}
                      stroke={cardBg}
                      strokeWidth={0.8}
                      opacity={hoveredIdx === null || hoveredIdx === idx ? 0.94 : 0.55}
                    />
                  );
                })}
                {showDataLabels && (labels.length <= 12 || hoveredIdx === idx) && (
                  <text
                    x={xCenter(idx)}
                    y={yScale(posAcc) - 6}
                    textAnchor="middle"
                    fill={textColor}
                    fontSize="10.5"
                    fontWeight="700"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatChartValue(totalNet, valueFormat, unitLabel, true)}
                  </text>
                )}
              </g>
            );
          })}

        {/* LINE / AREA CHART */}
        {(chartType === 'line' || chartType === 'area') && (
          <g>
            {activeSeries.map((s, sIdx) => {
              const color = colors[s.colorIndex % colors.length];
              const pts = labels.map((_, idx) => ({
                x: xCenter(idx),
                y: yScale(s.values[idx] ?? 0),
                val: s.values[idx] ?? 0,
              }));
              const linePath = pts
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                .join(' ');
              const areaPath =
                pts.length > 0
                  ? `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
                  : '';

              return (
                <g key={sIdx}>
                  {chartType === 'area' && areaPath && (
                    <path d={areaPath} fill={`url(#areaGrad_${palette}_${s.colorIndex})`} />
                  )}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {pts.map((p, idx) => {
                    const isActive = hoveredIdx === idx;
                    return (
                      <g key={idx}>
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isActive ? 6 : 3.8}
                          fill={cardBg}
                          stroke={color}
                          strokeWidth={isActive ? 3 : 2.2}
                        />
                        {showDataLabels &&
                          (labels.length <= 12 || isActive) &&
                          (activeSeries.length === 1 || isActive) && (
                            <text
                              x={p.x}
                              y={p.y - 10}
                              textAnchor="middle"
                              fill={textColor}
                              fontSize="10.5"
                              fontWeight="600"
                              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                            >
                              {formatChartValue(p.val, valueFormat, unitLabel, true)}
                            </text>
                          )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Invisible interactive hover columns */}
            {labels.map((_, idx) => (
              <rect
                key={idx}
                x={xCenter(idx) - Math.max(14, slotW / 2)}
                y={padTop}
                width={Math.max(28, slotW)}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            ))}
          </g>
        )}

        {/* X Axis Labels */}
        {labels.map((label, idx) => {
          if (idx % showEveryNLabel !== 0 && idx !== labels.length - 1) return null;
          const lx = xCenter(idx);
          const ly = padTop + plotH + 16;
          return (
            <text
              key={idx}
              x={lx}
              y={ly}
              textAnchor={needsAngledX ? 'end' : 'middle'}
              transform={needsAngledX ? `rotate(-28 ${lx} ${ly})` : undefined}
              fill={hoveredIdx === idx ? textColor : mutedTextColor}
              fontSize="11"
              fontWeight={hoveredIdx === idx ? '700' : '500'}
            >
              {truncateLabel(label, needsAngledX ? 18 : 14)}
            </text>
          );
        })}
      </svg>

      {/* Interactive Precision Readout Footer on Hover */}
      {hoveredIdx !== null && (
        <div
          className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs ${
            isDarkSurface
              ? 'border-slate-800 text-slate-300'
              : 'border-[var(--border)] text-slate-700'
          }`}
        >
          <span className={`font-semibold ${isDarkSurface ? 'text-white' : 'text-slate-900'}`}>
            {labels[hoveredIdx]}
          </span>
          {activeSeries.map((s, sIdx) => (
            <span
              key={sIdx}
              className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${
                hoveredSeriesPos === sIdx ? 'font-bold underline' : ''
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{
                  backgroundColor:
                    chartType === 'bar' && activeSeries.length === 1 && labels.length <= 8
                      ? colors[hoveredIdx % colors.length]
                      : colors[s.colorIndex % colors.length],
                }}
              />
              <span>{s.name}:</span>
              <strong className={isDarkSurface ? 'text-white' : 'text-slate-900'}>
                {formatChartValue(s.values[hoveredIdx] ?? 0, valueFormat, unitLabel, false)}
              </strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const FullscreenPresentationModal: React.FC<FullscreenPresentationModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  sourceLabel,
  categoryLabel,
  labels,
  series,
  valueFormat,
  unitLabel,
  chartType,
  onChangeChartType,
  palette,
  onChangePalette,
  activeSeriesIndices,
  onToggleSeries,
  showDataLabels,
  onToggleDataLabels,
  sortMode,
  onChangeSortMode,
  speakerNotes,
  appDark,
  slideIndex,
  slideCount,
  onPrevSlide,
  onNextSlide,
}) => {
  const modalSvgRef = useRef<SVGSVGElement | null>(null);
  const [slideTheme, setSlideTheme] = useState<'projector_light' | 'executive_dark' | 'follow'>('projector_light');
  const [showDataTable, setShowDataTable] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);

  const isDarkSlide =
    slideTheme === 'executive_dark' || (slideTheme === 'follow' && appDark);

  const sortedData = useMemo(
    () => applySortToChartData(labels, series, activeSeriesIndices, sortMode),
    [labels, series, activeSeriesIndices, sortMode]
  );

  const primarySeriesIdx = activeSeriesIndices[0] ?? 0;
  const primarySeries = sortedData.series[primarySeriesIdx] || sortedData.series[0];
  const insights = useMemo(
    () => computeChartInsights(sortedData.labels, primarySeries?.values || []),
    [sortedData.labels, primarySeries]
  );

  const colors = CHART_PALETTES[palette]?.colors || CHART_PALETTES.corporate.colors;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrevSlide) onPrevSlide();
      if (e.key === 'ArrowRight' && onNextSlide) onNextSlide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, onPrevSlide, onNextSlide]);

  if (!isOpen) return null;

  const kpiCards = [
    {
      label: `Total (${primarySeries?.name || 'Nilai'})`,
      value: formatChartValue(insights.total, valueFormat, unitLabel, true),
      hint: formatChartValue(insights.total, valueFormat, unitLabel, false),
    },
    {
      label: 'Rata-rata',
      value: formatChartValue(insights.average, valueFormat, unitLabel, true),
      hint: `${insights.count} ${categoryLabel.toLowerCase()}`,
    },
    {
      label: 'Tertinggi',
      value: formatChartValue(insights.maxItem.value, valueFormat, unitLabel, true),
      hint: `${truncateLabel(insights.maxItem.label, 22)}${
        insights.topSharePct !== null ? ` (${insights.topSharePct.toFixed(1)}%)` : ''
      }`,
    },
    insights.trendPct !== null
      ? {
          label: 'Perubahan Periode',
          value: `${insights.trendPct >= 0 ? '+' : ''}${insights.trendPct.toFixed(1)}%`,
          hint: `${sortedData.labels[0]} → ${sortedData.labels[sortedData.labels.length - 1]}`,
        }
      : {
          label: 'Terendah',
          value: formatChartValue(insights.minItem.value, valueFormat, unitLabel, true),
          hint: truncateLabel(insights.minItem.label, 26),
        },
  ];

  const handleDownloadSlidePng = async () => {
    setExportingPng(true);
    try {
      const legendItems =
        chartType === 'pie' || chartType === 'donut'
          ? []
          : activeSeriesIndices
              .filter((i) => i < series.length)
              .map((i) => ({
                label: series[i].name,
                color: colors[i % colors.length],
              }));
      await exportChartSlidePng({
        svgElement: modalSvgRef.current,
        title,
        subtitle,
        sourceLabel,
        speakerNotes,
        theme: isDarkSlide ? 'dark' : 'light',
        kpis: kpiCards,
        legendItems,
      });
    } finally {
      setExportingPng(false);
    }
  };

  const lightSlideVars = !isDarkSlide
    ? ({
        '--bg': '#E3E5E8',
        '--surface': '#EDEEF0',
        '--surface-2': '#E4E6E9',
        '--surface-3': '#DADDE1',
        '--input-bg': '#F2F3F4',
        '--border': '#CACED4',
        '--border-strong': '#B3B9C1',
        '--text': '#1F2328',
        '--text-muted': '#4F5761',
        '--text-subtle': '#5B646F',
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      style={lightSlideVars}
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden ${
        isDarkSlide ? 'bg-[#080E1A] text-slate-100' : 'bg-[var(--bg)] text-[var(--text)]'
      }`}
    >
      {/* Top Presentation Header Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 ${
          isDarkSlide
            ? 'border-slate-800 bg-[#0B1222]'
            : 'border-[var(--border)] bg-[var(--surface-2)]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {slideCount && slideCount > 1 && slideIndex !== undefined && (
            <div className="flex items-center gap-1.5 border-r border-[var(--border-strong)] pr-3 dark:border-slate-700">
              <button
                type="button"
                onClick={onPrevSlide}
                className={`rounded-md border p-1.5 transition ${
                  isDarkSlide
                    ? 'border-slate-700 hover:bg-slate-800'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface)]'
                }`}
                title="Slide Sebelumnya (←)"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-xs font-semibold tabular-nums">
                {slideIndex + 1} / {slideCount}
              </span>
              <button
                type="button"
                onClick={onNextSlide}
                className={`rounded-md border p-1.5 transition ${
                  isDarkSlide
                    ? 'border-slate-700 hover:bg-slate-800'
                    : 'border-[var(--border-strong)] hover:bg-[var(--surface)]'
                }`}
                title="Slide Berikutnya (→)"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold tracking-tight sm:text-lg">
              {title}
            </h2>
            <p
              className={`truncate text-xs ${
                isDarkSlide ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              {subtitle} · Sumber: {sourceLabel}
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Slide Theme Toggle */}
          <div
            className={`inline-flex rounded-md border p-0.5 text-xs ${
              isDarkSlide ? 'border-slate-700 bg-slate-900' : 'border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            <button
              type="button"
              onClick={() => setSlideTheme('projector_light')}
              className={`whitespace-nowrap rounded px-2.5 py-1 font-medium transition ${
                slideTheme === 'projector_light'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : isDarkSlide
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Slide Putih
            </button>
            <button
              type="button"
              onClick={() => setSlideTheme('executive_dark')}
              className={`whitespace-nowrap rounded px-2.5 py-1 font-medium transition ${
                slideTheme === 'executive_dark'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : isDarkSlide
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Slide Gelap
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowDataTable((v) => !v)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              showDataTable
                ? 'border-[var(--accent)]/40 bg-[var(--accent)] text-[var(--on-accent)]'
                : isDarkSlide
                  ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                  : 'border-[var(--border)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-2)]'
            }`}
          >
            <TableIcon className="h-3.5 w-3.5" />
            Tabel Data
          </button>

          <button
            type="button"
            onClick={handleDownloadSlidePng}
            disabled={exportingPng}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--accent)] text-[var(--on-accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingPng ? 'Membuat Slide...' : 'Unduh Slide PNG (16:9)'}
          </button>

          <button
            type="button"
            onClick={() =>
              exportChartDataExcel({
                title,
                subtitle,
                categoryLabel,
                labels: sortedData.labels,
                series: sortedData.series,
                valueFormat,
                unitLabel,
                sourceLabel,
                speakerNotes,
              })
            }
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              isDarkSlide
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                : 'border-[var(--border)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-2)]'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            Excel
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              isDarkSlide
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                : 'border-[var(--border)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-2)]'
            }`}
            title="Cetak / Simpan PDF"
          >
            <Printer className="h-3.5 w-3.5" />
            Cetak
          </button>

          <button
            type="button"
            onClick={onClose}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              isDarkSlide
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                : 'border-[var(--border)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-2)]'
            }`}
            title="Tutup Presentasi (Esc)"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            Tutup
          </button>
        </div>
      </div>

      {/* Interactive Chart Controls Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs ${
          isDarkSlide ? 'border-slate-800/80 bg-[#0B1222]/60' : 'border-[var(--border)] bg-[var(--surface)]'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {CHART_TYPE_OPTIONS.map((opt) => {
            const Icon = getChartIcon(opt.id);
            const active = chartType === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeChartType(opt.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : isDarkSlide
                      ? 'text-slate-300 hover:bg-slate-800'
                      : 'text-slate-600 hover:bg-[var(--surface-2)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.shortLabel}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              onChangeSortMode(
                sortMode === 'original' ? 'desc' : sortMode === 'desc' ? 'asc' : 'original'
              )
            }
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 font-medium ${
              isDarkSlide
                ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                : 'border-[var(--border)] text-slate-700 hover:bg-[var(--surface-2)]'
            }`}
          >
            <ArrowUpDown className="h-3 w-3" />
            Urutan: {sortMode === 'original' ? 'Asli' : sortMode === 'desc' ? 'Tertinggi' : 'Terendah'}
          </button>

          <button
            type="button"
            onClick={onToggleDataLabels}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 font-medium ${
              showDataLabels
                ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-text)] dark:text-[var(--accent)]'
                : isDarkSlide
                  ? 'border-slate-700 text-slate-400'
                  : 'border-[var(--border)] text-slate-500'
            }`}
          >
            <Hash className="h-3 w-3" />
            Label Angka
          </button>

          <div className="flex items-center gap-1">
            {(Object.keys(CHART_PALETTES) as ChartColorPalette[]).map((pKey) => (
              <button
                key={pKey}
                type="button"
                onClick={() => onChangePalette(pKey)}
                title={CHART_PALETTES[pKey].label}
                className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${
                  palette === pKey
                    ? 'border-[var(--accent)]/40 ring-1 ring-blue-600'
                    : isDarkSlide
                      ? 'border-slate-700'
                      : 'border-[var(--border)]'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ backgroundColor: CHART_PALETTES[pKey].colors[0] }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Presentation Stage */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-7xl space-y-5">
          {/* Executive KPI Strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpiCards.map((kpi, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-3.5 ${
                  isDarkSlide
                    ? 'border-slate-800 bg-[#0F172A]'
                    : 'border-[var(--border)] bg-[var(--surface-2)]/70'
                }`}
              >
                <p
                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                    isDarkSlide ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {kpi.label}
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums tracking-tight">
                  {kpi.value}
                </p>
                <p
                  className={`mt-0.5 truncate text-xs ${
                    isDarkSlide ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {kpi.hint}
                </p>
              </div>
            ))}
          </div>

          {/* Series Toggles */}
          {series.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-medium ${
                  isDarkSlide ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Metrik ditampilkan:
              </span>
              {series.map((s, idx) => {
                const isActive = activeSeriesIndices.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onToggleSeries(idx)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      isActive
                        ? isDarkSlide
                          ? 'border-slate-600 bg-slate-800 text-white'
                          : 'border-[var(--border-strong)] bg-[var(--surface)] text-slate-900'
                        : isDarkSlide
                          ? 'border-slate-800 text-slate-500 opacity-60'
                          : 'border-[var(--border)] text-slate-400 opacity-60'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: colors[idx % colors.length] }}
                    />
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Chart + Optional Data Table Split */}
          <div className={`grid gap-5 ${showDataTable ? 'lg:grid-cols-12' : 'grid-cols-1'}`}>
            <div
              className={`${showDataTable ? 'lg:col-span-8' : 'col-span-1'} rounded-xl border p-5 ${
                isDarkSlide
                  ? 'border-slate-800 bg-[#0F172A]'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              <InteractiveSvgChart
                svgRef={modalSvgRef}
                chartType={chartType}
                labels={sortedData.labels}
                series={sortedData.series}
                activeSeriesIndices={activeSeriesIndices}
                palette={palette}
                valueFormat={valueFormat}
                unitLabel={unitLabel}
                showDataLabels={showDataLabels}
                isDarkSurface={isDarkSlide}
                height={430}
              />
            </div>

            {showDataTable && (
              <div
                className={`lg:col-span-4 flex flex-col rounded-xl border ${
                  isDarkSlide
                    ? 'border-slate-800 bg-[#0F172A]'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div
                  className={`flex items-center justify-between border-b px-4 py-2.5 text-xs font-semibold ${
                    isDarkSlide ? 'border-slate-800' : 'border-[var(--border)]'
                  }`}
                >
                  <span>Tabel Rincian Data</span>
                  <button
                    type="button"
                    onClick={() =>
                      exportChartDataCsv({
                        title,
                        categoryLabel,
                        labels: sortedData.labels,
                        series: sortedData.series,
                      })
                    }
                    className="text-[var(--accent-text)] hover:underline dark:text-[var(--accent)]"
                  >
                    Unduh CSV
                  </button>
                </div>
                <div className="max-h-[430px] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead
                      className={`sticky top-0 border-b ${
                        isDarkSlide
                          ? 'border-slate-800 bg-slate-900 text-slate-400'
                          : 'border-[var(--border)] bg-[var(--surface-2)] text-slate-600'
                      }`}
                    >
                      <tr>
                        <th className="px-3 py-2 font-semibold">{categoryLabel}</th>
                        {sortedData.series
                          .filter((_, idx) => activeSeriesIndices.includes(idx))
                          .map((s, idx) => (
                            <th key={idx} className="px-3 py-2 text-right font-semibold">
                              {s.name}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isDarkSlide ? 'divide-slate-800/80' : 'divide-slate-100'
                      }`}
                    >
                      {sortedData.labels.map((lbl, rIdx) => (
                        <tr key={rIdx}>
                          <td className="px-3 py-2 font-medium">{lbl}</td>
                          {sortedData.series
                            .filter((_, idx) => activeSeriesIndices.includes(idx))
                            .map((s, sIdx) => (
                              <td
                                key={sIdx}
                                className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums"
                              >
                                {formatChartValue(
                                  s.values[rIdx] ?? 0,
                                  valueFormat,
                                  unitLabel,
                                  false
                                )}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Speaker Notes Bar */}
          {speakerNotes.trim() && (
            <div
              className={`rounded-lg border p-4 ${
                isDarkSlide
                  ? 'border-slate-800 bg-[#0F172A]'
                  : 'border-[var(--border)] bg-[var(--surface-2)]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-text)] dark:text-[var(--accent)]">
                <StickyNote className="h-3.5 w-3.5" />
                Catatan Presenter
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                {speakerNotes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PresentationChartCard: React.FC<PresentationChartCardProps> = ({
  mode,
  spec,
  pinnedDoc,
  sourceQuestion = '',
  isAlreadyPinned = false,
  canEdit = true,
  appDark = false,
  compact = false,
  onPinToDashboard,
  onOpenDashboard,
  onUpdatePinned,
  onDeletePinned,
  onMoveOrder,
  canMoveUp = false,
  canMoveDown = false,
  onReAskAi,
  onRequestDeckAtHere,
}) => {
  const cardSvgRef = useRef<SVGSVGElement | null>(null);

  const [chartType, setChartType] = useState<ChartType>(
    pinnedDoc?.chartType || spec.recommendedType || 'bar'
  );
  const [palette, setPalette] = useState<ChartColorPalette>(
    pinnedDoc?.palette || 'corporate'
  );
  const [activeSeriesIndices, setActiveSeriesIndices] = useState<number[]>(() =>
    pinnedDoc?.activeSeriesIndices?.length
      ? pinnedDoc.activeSeriesIndices
      : spec.series.map((_, i) => i)
  );
  const [showDataLabels, setShowDataLabels] = useState<boolean>(
    pinnedDoc?.showDataLabels ?? true
  );
  const [sortMode, setSortMode] = useState<ChartSortMode>(
    pinnedDoc?.sortMode || 'original'
  );
  const [title, setTitle] = useState<string>(pinnedDoc?.title || spec.title);
  const [subtitle, setSubtitle] = useState<string>(pinnedDoc?.subtitle || spec.subtitle);
  const [speakerNotes, setSpeakerNotes] = useState<string>(
    pinnedDoc?.speakerNotes || spec.insightSummary || ''
  );
  const [isShared, setIsShared] = useState<boolean>(pinnedDoc?.isShared ?? false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPinComposer, setShowPinComposer] = useState(false);
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [showPaletteMenu, setShowPaletteMenu] = useState(false);
  const [showCardTable, setShowCardTable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [savingPin, setSavingPin] = useState(false);
  const [pinnedJustNow, setPinnedJustNow] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [deletingPin, setDeletingPin] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Keep synced if pinnedDoc prop updates externally
  useEffect(() => {
    if (!pinnedDoc) return;
    setChartType(pinnedDoc.chartType);
    setPalette(pinnedDoc.palette);
    setActiveSeriesIndices(
      pinnedDoc.activeSeriesIndices?.length
        ? pinnedDoc.activeSeriesIndices
        : pinnedDoc.series.map((_, i) => i)
    );
    setShowDataLabels(pinnedDoc.showDataLabels);
    setSortMode(pinnedDoc.sortMode);
    setTitle(pinnedDoc.title);
    setSubtitle(pinnedDoc.subtitle);
    setSpeakerNotes(pinnedDoc.speakerNotes);
    setIsShared(pinnedDoc.isShared);
  }, [pinnedDoc]);

  const sortedData = useMemo(
    () => applySortToChartData(spec.labels, spec.series, activeSeriesIndices, sortMode),
    [spec.labels, spec.series, activeSeriesIndices, sortMode]
  );

  const primarySeriesIdx = activeSeriesIndices[0] ?? 0;
  const primarySeries = sortedData.series[primarySeriesIdx] || sortedData.series[0];
  const insights = useMemo(
    () => computeChartInsights(sortedData.labels, primarySeries?.values || []),
    [sortedData.labels, primarySeries]
  );

  const colors = CHART_PALETTES[palette]?.colors || CHART_PALETTES.corporate.colors;

  const persistDashboardVisualChange = async (patch: {
    chartType?: ChartType;
    palette?: ChartColorPalette;
    activeSeriesIndices?: number[];
    showDataLabels?: boolean;
    sortMode?: ChartSortMode;
    isShared?: boolean;
  }) => {
    if (mode !== 'dashboard' || !pinnedDoc || !onUpdatePinned || !canEdit) return;
    setSavingUpdate(true);
    setActionError(null);
    try {
      await onUpdatePinned(pinnedDoc, patch);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1600);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan diagram.');
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleSelectChartType = (nextType: ChartType) => {
    setChartType(nextType);
    void persistDashboardVisualChange({ chartType: nextType });
  };

  const handleSelectPalette = (nextPalette: ChartColorPalette) => {
    setPalette(nextPalette);
    setShowPaletteMenu(false);
    void persistDashboardVisualChange({ palette: nextPalette });
  };

  const handleToggleDataLabels = () => {
    const next = !showDataLabels;
    setShowDataLabels(next);
    void persistDashboardVisualChange({ showDataLabels: next });
  };

  const handleCycleSortMode = () => {
    const next: ChartSortMode =
      sortMode === 'original' ? 'desc' : sortMode === 'desc' ? 'asc' : 'original';
    setSortMode(next);
    void persistDashboardVisualChange({ sortMode: next });
  };

  const handleToggleSeries = (idx: number) => {
    setActiveSeriesIndices((prev) => {
      const exists = prev.includes(idx);
      let next: number[];
      if (exists) {
        if (prev.length <= 1) return prev; // Always keep at least 1 active series
        next = prev.filter((i) => i !== idx);
      } else {
        next = [...prev, idx].sort((a, b) => a - b);
      }
      void persistDashboardVisualChange({ activeSeriesIndices: next });
      return next;
    });
  };

  const handleConfirmPin = async () => {
    if (!onPinToDashboard || savingPin) return;
    setSavingPin(true);
    setActionError(null);
    try {
      await onPinToDashboard({
        title: title.trim() || spec.title,
        subtitle: subtitle.trim() || spec.subtitle,
        chartType,
        palette,
        valueFormat: spec.valueFormat,
        unitLabel: spec.unitLabel,
        categoryLabel: spec.categoryLabel,
        labels: spec.labels,
        series: spec.series,
        activeSeriesIndices,
        showDataLabels,
        sortMode,
        speakerNotes: speakerNotes.trim(),
        sourceQuestion,
        sourceLabel: spec.sourceLabel || 'Analisa AI · NARA AI',
        isShared,
      });
      setPinnedJustNow(true);
      setShowPinComposer(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyematkan diagram ke Dashboard.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleSaveEditDetails = async () => {
    if (!pinnedDoc || !onUpdatePinned || !canEdit) return;
    setSavingUpdate(true);
    setActionError(null);
    try {
      await onUpdatePinned(pinnedDoc, {
        title: title.trim() || pinnedDoc.title,
        subtitle: subtitle.trim(),
        speakerNotes: speakerNotes.trim(),
        isShared,
      });
      setShowEditDrawer(false);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1800);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memperbarui info diagram.');
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleDownloadSlidePng = async () => {
    setExportingPng(true);
    try {
      const kpis = [
        {
          label: `Total (${primarySeries?.name || 'Nilai'})`,
          value: formatChartValue(insights.total, spec.valueFormat, spec.unitLabel, true),
          hint: formatChartValue(insights.total, spec.valueFormat, spec.unitLabel, false),
        },
        {
          label: 'Rata-rata',
          value: formatChartValue(insights.average, spec.valueFormat, spec.unitLabel, true),
          hint: `${insights.count} ${spec.categoryLabel.toLowerCase()}`,
        },
        {
          label: 'Tertinggi',
          value: formatChartValue(insights.maxItem.value, spec.valueFormat, spec.unitLabel, true),
          hint: truncateLabel(insights.maxItem.label, 24),
        },
        insights.trendPct !== null
          ? {
              label: 'Perubahan',
              value: `${insights.trendPct >= 0 ? '+' : ''}${insights.trendPct.toFixed(1)}%`,
              hint: `${sortedData.labels[0]} → ${sortedData.labels[sortedData.labels.length - 1]}`,
            }
          : {
              label: 'Terendah',
              value: formatChartValue(insights.minItem.value, spec.valueFormat, spec.unitLabel, true),
              hint: truncateLabel(insights.minItem.label, 24),
            },
      ];
      const legendItems =
        chartType === 'pie' || chartType === 'donut'
          ? []
          : activeSeriesIndices
              .filter((i) => i < spec.series.length)
              .map((i) => ({
                label: spec.series[i].name,
                color: colors[i % colors.length],
              }));

      await exportChartSlidePng({
        svgElement: cardSvgRef.current,
        title,
        subtitle,
        sourceLabel: spec.sourceLabel || 'NARA AI · Analisa AI',
        speakerNotes,
        theme: appDark ? 'dark' : 'light',
        kpis,
        legendItems,
      });
    } finally {
      setExportingPng(false);
    }
  };

  const effectivelyPinned = isAlreadyPinned || pinnedJustNow;

  return (
    <>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] dark:border-slate-800 dark:bg-slate-900/90">
        {/* Card Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                {title}
              </h3>
              {mode === 'dashboard' && pinnedDoc && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {isShared ? (
                    <>
                      <Globe className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      Tim
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" />
                      Pribadi
                    </>
                  )}
                </span>
              )}
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  Tersimpan
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
              {mode === 'dashboard' && pinnedDoc?.ownerName
                ? ` · Oleh ${pinnedDoc.ownerName}`
                : spec.sourceLabel
                  ? ` · ${spec.sourceLabel}`
                  : ''}
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5">
            {mode === 'chat' && onPinToDashboard && (
              <>
                {effectivelyPinned ? (
                  <button
                    type="button"
                    onClick={() => (onOpenDashboard ? onOpenDashboard() : setShowPinComposer((v) => !v))}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-emerald-200 bg-[var(--success-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--success)] transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                    title="Lihat diagram di Dashboard Presentasi"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Terpin
                    {onOpenDashboard && <ExternalLink className="h-3 w-3 opacity-75" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowPinComposer((v) => !v)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--accent)] text-[var(--on-accent)] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                    title="Sematkan diagram ini ke Dashboard Presentasi"
                  >
                    <Pin className="h-3.5 w-3.5" />
                    Pin ke Dashboard
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() =>
                onRequestDeckAtHere ? onRequestDeckAtHere() : setIsFullscreen(true)
              }
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[var(--surface-2)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Buka Mode Presentasi Layar Penuh"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Maximize
            </button>

            <button
              type="button"
              onClick={handleDownloadSlidePng}
              disabled={exportingPng}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[var(--surface-2)] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Unduh Slide Presentasi PNG 1920×1080 (16:9)"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Slide PNG</span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportChartDataExcel({
                  title,
                  subtitle,
                  categoryLabel: spec.categoryLabel,
                  labels: sortedData.labels,
                  series: sortedData.series,
                  valueFormat: spec.valueFormat,
                  unitLabel: spec.unitLabel,
                  sourceLabel: spec.sourceLabel,
                  speakerNotes,
                })
              }
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[var(--surface-2)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Ekspor data grafik ke Excel (.xlsx)"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden sm:inline">Excel</span>
            </button>

            {mode === 'dashboard' && pinnedDoc && (
              <>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowEditDrawer((v) => !v)}
                    className={`rounded-md border p-1.5 transition ${
                      showEditDrawer
                        ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-text)] dark:bg-[var(--accent-soft)] dark:text-[var(--accent)]'
                        : 'border-[var(--border)] text-slate-600 hover:bg-[var(--surface-2)] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                    title="Edit Judul, Catatan Presenter & Akses Tim"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                )}

                {onReAskAi && pinnedDoc.sourceQuestion && (
                  <button
                    type="button"
                    onClick={() => onReAskAi(pinnedDoc.sourceQuestion)}
                    className="rounded-md border border-[var(--border)] p-1.5 text-slate-600 transition hover:bg-[var(--surface-2)] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    title="Tanya Ulang di AI untuk Perbarui Data Terbaru"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}

                {canEdit && onMoveOrder && (
                  <div className="inline-flex items-center overflow-hidden rounded-md border border-[var(--border)] dark:border-slate-700">
                    <button
                      type="button"
                      disabled={!canMoveUp}
                      onClick={() => onMoveOrder(pinnedDoc.id, 'up')}
                      className="p-1.5 text-slate-600 transition hover:bg-[var(--surface-2)] disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                      title="Geser Urutan Naik"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveDown}
                      onClick={() => onMoveOrder(pinnedDoc.id, 'down')}
                      className="border-l border-[var(--border)] p-1.5 text-slate-600 transition hover:bg-[var(--surface-2)] disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      title="Geser Urutan Turun"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {canEdit && onDeletePinned && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="rounded-md border border-[var(--border)] p-1.5 text-slate-500 transition hover:border-red-300 hover:text-red-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-red-800 dark:hover:text-red-400 cursor-pointer"
                    title="Lepas Pin dari Dashboard"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Delete Confirmation Popup Modal */}
        <DeleteConfirmModal
          open={Boolean(confirmDelete && pinnedDoc && onDeletePinned)}
          title="Lepas Diagram dari Dashboard?"
          description={
            pinnedDoc ? (
              <>
                Diagram <strong>{pinnedDoc.title}</strong> akan dihapus dari Dashboard Presentasi
                Eksekutif.
              </>
            ) : null
          }
          details={
            pinnedDoc
              ? [
                  { label: 'Judul Diagram', value: pinnedDoc.title },
                  ...(pinnedDoc.subtitle
                    ? [{ label: 'Subjudul', value: pinnedDoc.subtitle }]
                    : []),
                ]
              : undefined
          }
          warningNote="Anda dapat menyematkan ulang diagram serupa kapan saja dari Ask AI."
          confirmLabel="Ya, Lepas Pin"
          loading={deletingPin}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (!pinnedDoc || !onDeletePinned) return;
            setDeletingPin(true);
            try {
              await onDeletePinned(pinnedDoc.id);
              setConfirmDelete(false);
            } finally {
              setDeletingPin(false);
            }
          }}
        />

        {/* Inline Pin Composer (Chat Mode) OR Edit Drawer (Dashboard Mode) */}
        {(showPinComposer || showEditDrawer) && (
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Judul Slide / Diagram
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={140}
                  className="mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--input-bg)] px-2.5 py-1.5 text-xs text-slate-900 focus:border-[var(--accent)]/40 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Subjudul / Periode
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  maxLength={220}
                  className="mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--input-bg)] px-2.5 py-1.5 text-xs text-slate-900 focus:border-[var(--accent)]/40 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Catatan Presenter / Poin Kunci Presentasi (opsional)
                </label>
                <textarea
                  value={speakerNotes}
                  onChange={(e) => setSpeakerNotes(e.target.value)}
                  rows={2}
                  maxLength={1500}
                  placeholder="Contoh: Penjualan memuncak pada bulan Juni (+47% dari Maret); fokus perbaikan piutang jatuh tempo."
                  className="mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--input-bg)] px-2.5 py-1.5 text-xs text-slate-900 focus:border-[var(--accent)]/40 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--border-strong)] text-[var(--accent-text)]"
                />
                <span>Bagikan ke Dashboard Tim / Manajemen (semua pengguna dapat melihat)</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPinComposer(false);
                    setShowEditDrawer(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-[var(--surface-2)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                  Batal
                </button>
                {showPinComposer ? (
                  <button
                    type="button"
                    onClick={handleConfirmPin}
                    disabled={savingPin}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] text-[var(--on-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    <Pin className="h-3.5 w-3.5" />
                    {savingPin ? 'Menyematkan...' : 'Simpan ke Dashboard'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveEditDetails}
                    disabled={savingUpdate}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] text-[var(--on-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingUpdate ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {actionError && (
          <div className="border-b border-red-200 bg-[var(--danger-soft)] px-4 py-2 text-xs text-[var(--danger)] dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {actionError}
          </div>
        )}

        {/* Diagram Type Selector & Visual Options Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-[var(--surface-2)]/50 px-4 py-2 dark:border-slate-800/80 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center gap-1">
            {CHART_TYPE_OPTIONS.map((opt) => {
              const Icon = getChartIcon(opt.id);
              const active = chartType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectChartType(opt.id)}
                  title={`${opt.label} — ${opt.description}`}
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-[var(--accent)] dark:text-[var(--on-accent)] dark:text-white'
                      : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.shortLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleCycleSortMode}
              title="Ubah urutan nilai"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[var(--surface-2)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortMode === 'original' ? 'Asli' : sortMode === 'desc' ? 'Tertinggi' : 'Terendah'}
            </button>

            <button
              type="button"
              onClick={handleToggleDataLabels}
              title="Tampilkan / sembunyikan angka di grafik"
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                showDataLabels
                  ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-text)] dark:border-blue-900 dark:bg-[var(--accent-soft)] dark:text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              <Hash className="h-3 w-3" />
              Angka
            </button>

            <button
              type="button"
              onClick={() => setShowCardTable((v) => !v)}
              title="Lihat data dalam bentuk tabel"
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                showCardTable
                  ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-text)] dark:border-blue-900 dark:bg-[var(--accent-soft)] dark:text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <TableIcon className="h-3 w-3" />
              Tabel
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPaletteMenu((v) => !v)}
                title="Pilih palet warna korporat"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-[var(--surface-2)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <Palette className="h-3 w-3" />
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: colors[0] }}
                />
              </button>
              {showPaletteMenu && (
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--modal-shadow)] dark:shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {(Object.keys(CHART_PALETTES) as ChartColorPalette[]).map((pKey) => (
                    <button
                      key={pKey}
                      type="button"
                      onClick={() => handleSelectPalette(pKey)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                        palette === pKey
                          ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)] dark:bg-[var(--accent-soft)] dark:text-[var(--accent)]'
                          : 'text-slate-700 hover:bg-[var(--surface-2)] dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{CHART_PALETTES[pKey].label}</span>
                      <span className="flex items-center gap-0.5">
                        {CHART_PALETTES[pKey].colors.slice(0, 3).map((c, ci) => (
                          <span
                            key={ci}
                            className="h-2.5 w-2.5 rounded-xs"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Auto-Insights KPI Bar */}
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-100 text-xs sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800/80 dark:border-slate-800/80">
          <div className="px-4 py-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total ({truncateLabel(primarySeries?.name || 'Nilai', 16)})
            </span>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
              {formatChartValue(insights.total, spec.valueFormat, spec.unitLabel, true)}
            </p>
          </div>
          <div className="px-4 py-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Rata-rata
            </span>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
              {formatChartValue(insights.average, spec.valueFormat, spec.unitLabel, true)}
            </p>
          </div>
          <div className="px-4 py-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tertinggi
            </span>
            <p className="mt-0.5 truncate font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
              {formatChartValue(insights.maxItem.value, spec.valueFormat, spec.unitLabel, true)}
              {insights.topSharePct !== null && (
                <span className="ml-1 text-[11px] font-medium text-[var(--accent-text)] dark:text-[var(--accent)]">
                  ({insights.topSharePct.toFixed(0)}%)
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {insights.maxItem.label}
            </p>
          </div>
          <div className="px-4 py-2.5">
            {insights.trendPct !== null ? (
              <>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Tren Periode
                </span>
                <p
                  className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                    insights.trendPct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {insights.trendPct >= 0 ? '+' : ''}
                  {insights.trendPct.toFixed(1)}%
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {sortedData.labels[0]} → {sortedData.labels[sortedData.labels.length - 1]}
                </p>
              </>
            ) : (
              <>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Terendah
                </span>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatChartValue(insights.minItem.value, spec.valueFormat, spec.unitLabel, true)}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {insights.minItem.label}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Multi-Series Interactive Legend / Toggles */}
        {spec.series.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            {spec.series.map((s, idx) => {
              const active = activeSeriesIndices.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleToggleSeries(idx)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition ${
                    active
                      ? 'border-[var(--border-strong)] bg-[var(--surface)] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                      : 'border-[var(--border)] bg-transparent text-slate-400 line-through opacity-60 dark:border-slate-800 dark:text-slate-500'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-xs"
                    style={{ backgroundColor: colors[idx % colors.length] }}
                  />
                  {s.name}
                </button>
              );
            })}
            {(chartType === 'pie' || chartType === 'donut') && activeSeriesIndices.length > 1 && (
              <span className="text-[11px] text-slate-400">
                (Menampilkan metrik pertama: {spec.series[activeSeriesIndices[0]]?.name})
              </span>
            )}
          </div>
        )}

        {/* Main SVG Visualization Canvas */}
        <div className="px-4 py-3">
          <InteractiveSvgChart
            svgRef={cardSvgRef}
            chartType={chartType}
            labels={sortedData.labels}
            series={sortedData.series}
            activeSeriesIndices={activeSeriesIndices}
            palette={palette}
            valueFormat={spec.valueFormat}
            unitLabel={spec.unitLabel}
            showDataLabels={showDataLabels}
            isDarkSurface={appDark}
            height={compact ? 280 : 325}
          />
        </div>

        {/* Optional Collapsible Inline Data Table */}
        {showCardTable && (
          <div className="border-t border-[var(--border)] px-4 py-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Rincian Data ({sortedData.labels.length} baris)
              </span>
              <button
                type="button"
                onClick={() =>
                  exportChartDataCsv({
                    title,
                    categoryLabel: spec.categoryLabel,
                    labels: sortedData.labels,
                    series: sortedData.series,
                  })
                }
                className="font-medium text-[var(--accent-text)] hover:underline dark:text-[var(--accent)]"
              >
                Ekspor CSV
              </button>
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-2)] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5 font-semibold">{spec.categoryLabel}</th>
                    {sortedData.series
                      .filter((_, idx) => activeSeriesIndices.includes(idx))
                      .map((s, idx) => (
                        <th key={idx} className="px-3 py-1.5 text-right font-semibold">
                          {s.name}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {sortedData.labels.map((lbl, rIdx) => (
                    <tr key={rIdx}>
                      <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-200">
                        {lbl}
                      </td>
                      {sortedData.series
                        .filter((_, idx) => activeSeriesIndices.includes(idx))
                        .map((s, sIdx) => (
                          <td
                            key={sIdx}
                            className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300"
                          >
                            {formatChartValue(
                              s.values[rIdx] ?? 0,
                              spec.valueFormat,
                              spec.unitLabel,
                              false
                            )}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Speaker Notes Preview */}
        {speakerNotes.trim() && (
          <div className="flex items-start gap-2 border-t border-slate-100 bg-[var(--surface-2)]/60 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/40 dark:text-slate-400">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-text)] dark:text-[var(--accent)]" />
            <p className="line-clamp-2 leading-relaxed">{speakerNotes}</p>
          </div>
        )}
      </div>

      {/* Standalone Fullscreen Presentation Modal */}
      <FullscreenPresentationModal
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        title={title}
        subtitle={subtitle}
        sourceLabel={spec.sourceLabel || 'NARA AI · Analisa AI'}
        categoryLabel={spec.categoryLabel}
        labels={spec.labels}
        series={spec.series}
        valueFormat={spec.valueFormat}
        unitLabel={spec.unitLabel}
        chartType={chartType}
        onChangeChartType={handleSelectChartType}
        palette={palette}
        onChangePalette={handleSelectPalette}
        activeSeriesIndices={activeSeriesIndices}
        onToggleSeries={handleToggleSeries}
        showDataLabels={showDataLabels}
        onToggleDataLabels={handleToggleDataLabels}
        sortMode={sortMode}
        onChangeSortMode={(s) => {
          setSortMode(s);
          void persistDashboardVisualChange({ sortMode: s });
        }}
        speakerNotes={speakerNotes}
        appDark={appDark}
      />
    </>
  );
};
