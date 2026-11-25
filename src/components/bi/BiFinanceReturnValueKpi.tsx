import React, { useEffect, useMemo, useState } from 'react';
import {
  BiGroupedColumnChart,
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiLineChart,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatCompactIdr,
  formatDecimal,
  formatIdr,
  formatNumberPlain,
  formatPct,
  useBiFinancePeriodData,
} from './biFinanceShared';

export type BiFinanceReturnValueMode = 'tsr' | 'eva' | 'roi' | 'roce' | 'roa' | 'roe';

interface BiFinanceReturnValueKpiProps {
  mode: BiFinanceReturnValueMode;
  idToken: string;
  onDownloadBridge?: () => void;
}

interface TsrManualInput {
  startPrice: number;
  endPrice: number;
  startDividend: number;
  endDividend: number;
}

const TSR_STORAGE_KEY = 'nara_bi_tsr_inputs_v1';

function loadTsrInputs(): Record<string, TsrManualInput> {
  try {
    const raw = localStorage.getItem(TSR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const MODE_META: Record<
  BiFinanceReturnValueMode,
  {
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
    csvPrefix: string;
  }
> = {
  tsr: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '07. Total Shareholder Return (TSR)',
    description:
      'Mengukur total tingkat pengembalian pemegang saham berdasarkan kenaikan harga saham dan dividen per periode. Kolom parameter saham dapat diisi langsung dan tersimpan otomatis.',
    csvPrefix: 'BI_TSR',
  },
  eva: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '08. Economic Value Added (EVA)',
    description:
      'Mengukur nilai tambah ekonomi perusahaan berdasarkan perbandingan L/R Setelah Pajak terhadap Modal aktual pada neraca MyERP Plus.',
    csvPrefix: 'BI_EVA',
  },
  roi: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '09. Return On Investment (ROI)',
    description:
      'Mengukur persentase imbal hasil L/R Setelah Pajak terhadap total nilai investasi / modal yang ditanamkan per bulan.',
    csvPrefix: 'BI_ROI',
  },
  roce: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Garis (Line Chart)',
    title: '10. Return On Capital Employed (ROCE)',
    description:
      'Mengukur efektivitas perusahaan menghasilkan L/R Sebelum Pajak (atau EBIT) dari rata-rata modal yang digunakan (Total Aset − Liabilitas Lancar).',
    csvPrefix: 'BI_ROCE',
  },
  roa: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '11. Return On Assets (ROA)',
    description:
      'Mengukur kemampuan total aset perusahaan menghasilkan L/R Setelah Pajak per bulan berdasarkan saldo neraca aktual MyERP Plus.',
    csvPrefix: 'BI_ROA',
  },
  roe: {
    category: 'Imbal Hasil & Nilai',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '12. Return On Equity (ROE)',
    description:
      'Mengukur tingkat pengembalian L/R Setelah Pajak terhadap total ekuitas pemegang saham per bulan.',
    csvPrefix: 'BI_ROE',
  },
};

export const BiFinanceReturnValueKpi: React.FC<BiFinanceReturnValueKpiProps> = ({
  mode,
  idToken,
  onDownloadBridge,
}) => {
  const {
    selectedYear,
    setSelectedYear,
    startMonth,
    setStartMonth,
    endMonth,
    setEndMonth,
    effectiveStartMonth,
    effectiveEndMonth,
    availableYears,
    data,
    monthlyRows,
    hasMonthlyBalanceSheet,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchFinanceData,
    handleResetActivePeriod,
  } = useBiFinancePeriodData(idToken);

  const meta = MODE_META[mode];

  // Shared tax basis for EAT-dependent KPIs (08 EVA, 09 ROI, 11 ROA, 12 ROE)
  const [taxBasis, setTaxBasis] = useState<'erp_actual' | 'estimated_rate'>('erp_actual');
  const [estimatedTaxRate, setEstimatedTaxRate] = useState<number>(25);

  // Basis selectors for BS denominators
  const [evaMode, setEvaMode] = useState<'template_direct' | 'wacc_rate'>('template_direct');
  const [waccPct, setWaccPct] = useState<number>(10);
  const [roiInvestBasis, setRoiInvestBasis] = useState<'capital_employed' | 'total_assets' | 'fixed_assets'>('total_assets');
  const [includeCurrentProfitInEquity, setIncludeCurrentProfitInEquity] = useState<boolean>(true);

  // Manual TSR market inputs persisted in localStorage
  const [tsrInputs, setTsrInputs] = useState<Record<string, TsrManualInput>>(() => loadTsrInputs());

  useEffect(() => {
    try {
      localStorage.setItem(TSR_STORAGE_KEY, JSON.stringify(tsrInputs));
    } catch {
      // Ignore storage quota errors
    }
  }, [tsrInputs]);

  const updateTsrField = (month: string, field: keyof TsrManualInput, rawValue: string) => {
    const parsed = Number(rawValue.replace(/[^\d.-]/g, ''));
    const safeVal = Number.isFinite(parsed) ? parsed : 0;
    setTsrInputs((prev) => ({
      ...prev,
      [month]: {
        startPrice: prev[month]?.startPrice ?? 0,
        endPrice: prev[month]?.endPrice ?? 0,
        startDividend: prev[month]?.startDividend ?? 0,
        endDividend: prev[month]?.endDividend ?? 0,
        [field]: safeVal,
      },
    }));
  };

  // Compute EAT, Equity, Capital Employed, and KPI metrics per month
  const computedRows = useMemo(() => {
    const safeTaxRate = Number.isFinite(estimatedTaxRate)
      ? Math.max(0, Math.min(100, estimatedTaxRate))
      : 0;
    const safeWacc = Number.isFinite(waccPct) ? Math.max(0, Math.min(100, waccPct)) : 10;

    return monthlyRows.map((row) => {
      const pbt = row.profitBeforeTax;
      let taxAmount = 0;
      let taxPct = 0;
      if (taxBasis === 'erp_actual') {
        taxAmount = row.erpTaxNetExpense;
        taxPct = pbt > 0 ? (taxAmount / pbt) * 100 : 0;
      } else {
        taxAmount = pbt > 0 ? pbt * (safeTaxRate / 100) : 0;
        taxPct = pbt > 0 ? safeTaxRate : 0;
      }
      const eat = pbt - taxAmount;

      const equityAdjustedEnd = includeCurrentProfitInEquity
        ? row.equityEnd + row.cumulativeNetIncome
        : row.equityEnd;
      const equityAdjustedStart = includeCurrentProfitInEquity
        ? row.equityStart + (row.cumulativeNetIncome - row.netIncome)
        : row.equityStart;

      // Modal for EVA: Capital Employed (fallback to Equity if CE is 0)
      const modalEva =
        Math.abs(row.capitalEmployedEnd) >= 1
          ? row.capitalEmployedEnd
          : equityAdjustedEnd;
      const evaValue =
        evaMode === 'template_direct'
          ? eat - modalEva
          : eat - modalEva * (safeWacc / 100);

      // Investasi for ROI
      const fixedAssetsNetEnd = row.fixedAssetsEnd - row.accumDepEnd;
      const investasiVal =
        roiInvestBasis === 'total_assets'
          ? row.totalAssetsEnd
          : roiInvestBasis === 'fixed_assets'
            ? fixedAssetsNetEnd
            : modalEva;
      const roiPct = Math.abs(investasiVal) >= 1 ? (eat / investasiVal) * 100 : 0;

      // Rata-rata Modal for ROCE
      const avgModal =
        Math.abs(row.capitalEmployedStart) >= 1 || Math.abs(row.capitalEmployedEnd) >= 1
          ? (row.capitalEmployedStart + row.capitalEmployedEnd) / 2
          : (equityAdjustedStart + equityAdjustedEnd) / 2;
      const rocePct = Math.abs(avgModal) >= 1 ? (pbt / avgModal) * 100 : 0;

      // Asset for ROA
      const roaPct = Math.abs(row.totalAssetsEnd) >= 1 ? (eat / row.totalAssetsEnd) * 100 : 0;

      // Equity for ROE
      const roePct = Math.abs(equityAdjustedEnd) >= 1 ? (eat / equityAdjustedEnd) * 100 : 0;

      // TSR manual values (exact template formula: ((EndPrice - StartPrice) + EndDividend) / StartPrice)
      const tsrIn = tsrInputs[row.month] || {
        startPrice: 0,
        endPrice: 0,
        startDividend: 0,
        endDividend: 0,
      };
      const tsrRatio =
        tsrIn.startPrice > 0
          ? (tsrIn.endPrice - tsrIn.startPrice + tsrIn.endDividend) / tsrIn.startPrice
          : 0;

      return {
        row,
        pbt,
        taxAmount,
        taxPct,
        eat,
        equityAdjustedEnd,
        modalEva,
        evaValue,
        investasiVal,
        roiPct,
        avgModal,
        rocePct,
        roaPct,
        roePct,
        tsrIn,
        tsrRatio,
      };
    });
  }, [
    estimatedTaxRate,
    evaMode,
    includeCurrentProfitInEquity,
    monthlyRows,
    roiInvestBasis,
    taxBasis,
    tsrInputs,
    waccPct,
  ]);

  const summary = useMemo(() => {
    const count = computedRows.length;
    const sumPend = computedRows.reduce((s, r) => s + r.row.totalPendapatan, 0);
    const sumBiaya = computedRows.reduce((s, r) => s + r.row.totalBiaya, 0);
    const sumPbt = computedRows.reduce((s, r) => s + r.pbt, 0);
    const sumEat = computedRows.reduce((s, r) => s + r.eat, 0);
    const sumEva = computedRows.reduce((s, r) => s + r.evaValue, 0);
    const lastRow = count > 0 ? computedRows[count - 1] : null;
    const avgTsr = count > 0 ? computedRows.reduce((s, r) => s + r.tsrRatio, 0) / count : 0;
    const avgRoi = count > 0 ? computedRows.reduce((s, r) => s + r.roiPct, 0) / count : 0;
    const avgRoce = count > 0 ? computedRows.reduce((s, r) => s + r.rocePct, 0) / count : 0;
    const avgRoa = count > 0 ? computedRows.reduce((s, r) => s + r.roaPct, 0) / count : 0;
    const avgRoe = count > 0 ? computedRows.reduce((s, r) => s + r.roePct, 0) / count : 0;

    return {
      sumPend,
      sumBiaya,
      sumPbt,
      sumEat,
      sumEva,
      lastRow,
      avgTsr,
      avgRoi,
      avgRoce,
      avgRoa,
      avgRoe,
    };
  }, [computedRows]);

  const needsBsNotice = mode !== 'tsr' && !hasMonthlyBalanceSheet && Boolean(data);
  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (cutoffWarning) {
      parts.push(`Periode jurnal aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if (needsBsNotice) {
      parts.push(
        'Bridge ERP lokal Anda belum mengirim snapshot Neraca bulanan (monthlyBalanceSheet). Unduh ulang Bridge ERP terbaru agar saldo Aset, Modal, dan Ekuitas per bulan terisi otomatis.'
      );
    }
    if (mode === 'tsr') {
      parts.push(
        'Data harga saham dan dividen bersifat eksternal di luar jurnal ERP. Silakan isi langsung pada tabel di bawah (tersimpan otomatis di browser Anda).'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, mode, needsBsNotice]);

  const handleExportCsv = () => {
    if (computedRows.length === 0) return;
    const suffix = `${selectedYear}_${String(effectiveStartMonth).padStart(2, '0')}-${String(effectiveEndMonth).padStart(2, '0')}`;

    if (mode === 'tsr') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Hrg Saham Awal', 'Hrg Saham Akhir', 'S. Awal Dividen', 'S. Akhir Dividen', 'TSR'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          r.tsrIn.startPrice,
          r.tsrIn.endPrice,
          r.tsrIn.startDividend,
          r.tsrIn.endDividend,
          r.tsrRatio.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'eva') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'L/R Setelah Pajak', 'Modal', 'EVA'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.eat),
          Math.round(r.modalEva),
          Math.round(r.evaValue),
        ]),
      ]);
      return;
    }

    if (mode === 'roi') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Pendapatan', 'Biaya', 'L/R Sebelum Pajak', 'Pajak (%)', 'L/R Setelah Pajak', 'Investasi', 'ROI (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.row.totalPendapatan),
          Math.round(r.row.totalBiaya),
          Math.round(r.pbt),
          r.taxPct.toFixed(2),
          Math.round(r.eat),
          Math.round(r.investasiVal),
          r.roiPct.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'roce') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Pendapatan', 'Biaya', 'L/R Sebelum Pajak', 'Rata2 Modal', 'ROCE (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.row.totalPendapatan),
          Math.round(r.row.totalBiaya),
          Math.round(r.pbt),
          Math.round(r.avgModal),
          r.rocePct.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'roa') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Pendapatan', 'Biaya', 'L/R Sebelum Pajak', 'Pajak (%)', 'L/R Setelah Pajak', 'Asset', 'ROA (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.row.totalPendapatan),
          Math.round(r.row.totalBiaya),
          Math.round(r.pbt),
          r.taxPct.toFixed(2),
          Math.round(r.eat),
          Math.round(r.row.totalAssetsEnd),
          r.roaPct.toFixed(2),
        ]),
      ]);
      return;
    }

    downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
      ['Bulan', 'Pendapatan', 'Biaya', 'L/R Sebelum Pajak', 'Pajak (%)', 'L/R Setelah Pajak', 'Ekuitas', 'ROE (%)'],
      ...computedRows.map((r) => [
        r.row.labelShort,
        Math.round(r.row.totalPendapatan),
        Math.round(r.row.totalBiaya),
        Math.round(r.pbt),
        r.taxPct.toFixed(2),
        Math.round(r.eat),
        Math.round(r.equityAdjustedEnd),
        r.roePct.toFixed(2),
      ]),
    ]);
  };

  // Extra filter controls per KPI
  const extraControls = (
    <>
      {['eva', 'roi', 'roa', 'roe'].includes(mode) && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Pajak (L/R Stlh Pajak)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setTaxBasis('erp_actual')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  taxBasis === 'erp_actual'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Jurnal ERP
              </button>
              <button
                type="button"
                onClick={() => setTaxBasis('estimated_rate')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  taxBasis === 'estimated_rate'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Tarif (%)
              </button>
            </div>
            {taxBasis === 'estimated_rate' && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={estimatedTaxRate}
                  onChange={(e) => setEstimatedTaxRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="w-14 px-2 py-1.5 text-xs font-mono tabular-nums text-right rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
                />
                <span className="text-xs text-[var(--text-muted)]">%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'eva' && (
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">Rumus EVA</span>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setEvaMode('template_direct')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  evaMode === 'template_direct'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                L/R − Modal
              </button>
              <button
                type="button"
                onClick={() => setEvaMode('wacc_rate')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  evaMode === 'wacc_rate'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                WACC (%)
              </button>
            </div>
            {evaMode === 'wacc_rate' && (
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={waccPct}
                onChange={(e) => setWaccPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-14 px-2 py-1.5 text-xs font-mono tabular-nums text-right rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
                aria-label="Persentase WACC"
              />
            )}
          </div>
        </div>
      )}

      {mode === 'roi' && (
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Nilai Investasi
          </span>
          <select
            value={roiInvestBasis}
            onChange={(e) => setRoiInvestBasis(e.target.value as typeof roiInvestBasis)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
          >
            <option value="total_assets">Total Aset Neto</option>
            <option value="capital_employed">Modal Diinvestasikan (CE)</option>
            <option value="fixed_assets">Aktiva Tetap Neto</option>
          </select>
        </div>
      )}

      {mode === 'roe' && (
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Ekuitas
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setIncludeCurrentProfitInEquity(true)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                includeCurrentProfitInEquity
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Ekuitas + Laba Berjalan
            </button>
            <button
              type="button"
              onClick={() => setIncludeCurrentProfitInEquity(false)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                !includeCurrentProfitInEquity
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              COA Ekuitas (10)
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={mode}
        category={meta.category}
        chartTypeLabel={meta.chartTypeLabel}
        title={meta.title}
        description={meta.description}
        selectedYear={selectedYear}
        availableYears={availableYears}
        onYearChange={setSelectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        onApplyPreset={(f, t) => {
          setStartMonth(f);
          setEndMonth(t);
        }}
        onRefresh={() => void fetchFinanceData({ refresh: true })}
        onExportCsv={handleExportCsv}
        loading={loading}
        refreshing={refreshing}
        canExport={computedRows.length > 0}
        extraControls={extraControls}
        noticeText={noticeMessage}
        noticeActionLabel={needsBsNotice && onDownloadBridge ? 'Unduh Bridge Terbaru →' : undefined}
        onNoticeAction={needsBsNotice ? onDownloadBridge : undefined}
      />

      <BiKpiStateViews
        loading={loading}
        hasData={Boolean(data)}
        errorMsg={errorMsg}
        isEmpty={computedRows.length === 0}
        selectedYear={selectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        minDateActive={data?.coverage?.minDateActive}
        maxDateActive={data?.coverage?.maxDateActive}
        onRetry={() => void fetchFinanceData({ refresh: true })}
        onResetPeriod={handleResetActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && computedRows.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 4-Card Summary Strip */}
          {mode === 'tsr' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata TSR Periode</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(summary.avgTsr)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Setara {formatPct(summary.avgTsr * 100)}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">TSR Bulan Terakhir</span>
                <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(summary.lastRow?.tsrRatio ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {summary.lastRow?.row.labelFull}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Harga Saham Akhir Terakhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.lastRow?.tsrIn.endPrice ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Parameter input pasar
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Dividen Akhir Terakhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.lastRow?.tsrIn.endDividend ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  ((Hrg Akhir − Awal) + Div. Akhir) ÷ Awal
                </span>
              </div>
            </div>
          )}

          {mode === 'eva' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total L/R Setelah Pajak</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumEat)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {computedRows.length} bulan terposting
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Modal Akhir Periode</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.lastRow?.modalEva ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Capital Employed / Ekuitas Neraca
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">EVA Bulan Terakhir</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    (summary.lastRow?.evaValue ?? 0) >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatIdr(summary.lastRow?.evaValue ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {summary.lastRow?.row.labelFull}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Akumulasi EVA Periode</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    summary.sumEva >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatIdr(summary.sumEva)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {evaMode === 'template_direct' ? 'L/R Stlh Pajak − Modal' : `L/R − (Modal × ${waccPct}%)`}
                </span>
              </div>
            </div>
          )}

          {['roi', 'roce', 'roa', 'roe'].includes(mode) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumPend)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {computedRows.length} bulan terposting
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'roce' ? 'Total L/R Sebelum Pajak' : 'Total L/R Setelah Pajak'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(mode === 'roce' ? summary.sumPbt : summary.sumEat)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Pembilang rasio {mode.toUpperCase()}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'roi' && 'Nilai Investasi Akhir'}
                  {mode === 'roce' && 'Rata-rata Modal Akhir'}
                  {mode === 'roa' && 'Total Asset Akhir'}
                  {mode === 'roe' && 'Total Ekuitas Akhir'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(
                    mode === 'roi'
                      ? (summary.lastRow?.investasiVal ?? 0)
                      : mode === 'roce'
                        ? (summary.lastRow?.avgModal ?? 0)
                        : mode === 'roa'
                          ? (summary.lastRow?.row.totalAssetsEnd ?? 0)
                          : (summary.lastRow?.equityAdjustedEnd ?? 0)
                  )}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Neraca aktual {summary.lastRow?.row.labelShort}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  Rata-rata {mode.toUpperCase()} Bulanan
                </span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatPct(
                    mode === 'roi'
                      ? summary.avgRoi
                      : mode === 'roce'
                        ? summary.avgRoce
                        : mode === 'roa'
                          ? summary.avgRoa
                          : summary.avgRoe
                  )}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Bulan terakhir:{' '}
                  {formatPct(
                    mode === 'roi'
                      ? (summary.lastRow?.roiPct ?? 0)
                      : mode === 'roce'
                        ? (summary.lastRow?.rocePct ?? 0)
                        : mode === 'roa'
                          ? (summary.lastRow?.roaPct ?? 0)
                          : (summary.lastRow?.roePct ?? 0)
                  )}
                </span>
              </div>
            </div>
          )}

          {/* PRIMARY CHART PER KPI */}
          {mode === 'tsr' && (
            <BiHorizontalBarChart
              title="TSR"
              subtitle="Total Shareholder Return per bulan (rasio pengembalian pemegang saham)"
              legendLabel="TSR"
              tapered
              formatAxisTick={(v) => v.toFixed(2)}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.tsrRatio,
                valueLabel: formatDecimal(r.tsrRatio),
                hoverSummary: `Hrg Awal ${formatIdr(r.tsrIn.startPrice)} · Akhir ${formatIdr(r.tsrIn.endPrice)} · Div. Akhir ${formatIdr(r.tsrIn.endDividend)} · TSR ${formatDecimal(r.tsrRatio)}`,
              }))}
            />
          )}

          {mode === 'eva' && (
            <BiGroupedColumnChart
              title="Grafik Economic Value Added (EVA)"
              subtitle="Perbandingan L/R Setelah Pajak, Modal, dan EVA per bulan"
              months={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                labelFull: r.row.labelFull,
              }))}
              metrics={[
                {
                  key: 'eat',
                  label: 'L/R Setelah Pajak',
                  color: '#0D7678',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.eat])),
                },
                {
                  key: 'modal',
                  label: 'Modal',
                  color: '#2563EB',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.modalEva])),
                },
                {
                  key: 'eva',
                  label: 'EVA',
                  color: '#10B981',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.evaValue])),
                },
              ]}
              formatAxisTick={formatCompactIdr}
              formatExactValue={formatIdr}
            />
          )}

          {mode === 'roi' && (
            <BiHorizontalBarChart
              title="ROI"
              subtitle="Return On Investment (%) per bulan berdasarkan L/R Setelah Pajak dibagi Investasi"
              legendLabel="ROI (%)"
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.roiPct,
                valueLabel: formatPct(r.roiPct),
                hoverSummary: `L/R Stlh Pajak ${formatIdr(r.eat)} ÷ Investasi ${formatIdr(r.investasiVal)} = ${formatPct(r.roiPct)}`,
              }))}
            />
          )}

          {mode === 'roce' && (
            <BiLineChart
              title="ROCE"
              subtitle="Return On Capital Employed (%) per bulan berdasarkan L/R Sebelum Pajak dibagi Rata-rata Modal"
              legendLabel="ROCE (%)"
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.rocePct,
                valueLabel: formatPct(r.rocePct),
                hoverSummary: `L/R Sblm Pajak ${formatIdr(r.pbt)} ÷ Rata2 Modal ${formatIdr(r.avgModal)} = ${formatPct(r.rocePct)}`,
              }))}
            />
          )}

          {mode === 'roa' && (
            <BiHorizontalBarChart
              title="ROA"
              subtitle="Return On Assets (%) per bulan berdasarkan L/R Setelah Pajak dibagi Total Asset"
              legendLabel="ROA (%)"
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.roaPct,
                valueLabel: formatPct(r.roaPct),
                hoverSummary: `L/R Stlh Pajak ${formatIdr(r.eat)} ÷ Asset ${formatIdr(r.row.totalAssetsEnd)} = ${formatPct(r.roaPct)}`,
              }))}
            />
          )}

          {mode === 'roe' && (
            <BiVerticalSingleChart
              title="ROE"
              subtitle="Return On Equity (%) per bulan berdasarkan L/R Setelah Pajak dibagi Ekuitas"
              legendLabel="ROE (%)"
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.roePct,
                valueLabel: formatPct(r.roePct),
                hoverSummary: `L/R Stlh Pajak ${formatIdr(r.eat)} ÷ Ekuitas ${formatIdr(r.equityAdjustedEnd)} = ${formatPct(r.roePct)}`,
              }))}
            />
          )}

          {/* STRUCTURED TABLE PER KPI */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)]">
              <h4 className="font-display text-sm font-bold text-[var(--text)]">
                Tabel Perhitungan {meta.title}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {mode === 'tsr'
                  ? 'Input harga saham dan dividen dapat diubah langsung pada kolom tabel; hasil TSR dihitung otomatis.'
                  : 'Sumber aktual: Buku Besar ERP (Laba Rugi & Neraca bulanan terposting)'}
              </p>
            </div>

            <div className="overflow-x-auto">
              {mode === 'tsr' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Hrg Saham Awal Periode</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Hrg Saham Akhir Periode</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">S. Awal Dividen</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">S. Akhir Dividen</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">TSR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {r.row.labelShort}
                        </td>
                        {(
                          [
                            ['startPrice', 'Harga saham awal'],
                            ['endPrice', 'Harga saham akhir'],
                            ['startDividend', 'Saldo awal dividen'],
                            ['endDividend', 'Saldo akhir dividen'],
                          ] as const
                        ).map(([field, label]) => (
                          <td key={field} className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              aria-label={`${label} ${r.row.labelShort}`}
                              value={r.tsrIn[field] || ''}
                              placeholder="0"
                              onChange={(e) => updateTsrField(r.row.month, field, e.target.value)}
                              className="w-32 px-2.5 py-1 text-xs font-mono tabular-nums text-right rounded-md border border-amber-400/60 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                            />
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-semibold text-[var(--accent)] whitespace-nowrap">
                          {formatDecimal(r.tsrRatio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {mode === 'eva' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">L/R Setelah Pajak</th>
                      <th className="text-right font-semibold px-4 py-2.5">Modal</th>
                      <th className="text-right font-semibold px-4 py-2.5">EVA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.eat)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.modalEva)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            r.evaValue >= 0 ? 'text-[var(--accent)]' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatNumberPlain(r.evaValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(mode === 'roi' || mode === 'roa' || mode === 'roe') && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pendapatan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Biaya</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">L/R Sebelum Pajak</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pajak (%)</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">L/R Setelah Pajak</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        {mode === 'roi' ? 'Investasi' : mode === 'roa' ? 'Asset' : 'Ekuitas'}
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        {mode.toUpperCase()} (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => {
                      const denom =
                        mode === 'roi'
                          ? r.investasiVal
                          : mode === 'roa'
                            ? r.row.totalAssetsEnd
                            : r.equityAdjustedEnd;
                      const pct =
                        mode === 'roi' ? r.roiPct : mode === 'roa' ? r.roaPct : r.roePct;
                      return (
                        <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                            {r.row.labelShort}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                            {formatNumberPlain(r.row.totalPendapatan)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                            {formatNumberPlain(r.row.totalBiaya)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                            {formatNumberPlain(r.pbt)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatPct(r.taxPct)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                            {formatNumberPlain(r.eat)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                            {formatNumberPlain(denom)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                              pct >= 0 ? 'text-[var(--accent)]' : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {formatPct(pct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {mode === 'roce' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pendapatan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Biaya</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">L/R Sebelum Pajak</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Rata2 Modal</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">ROCE (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.row.totalPendapatan)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.row.totalBiaya)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.pbt)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.avgModal)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            r.rocePct >= 0 ? 'text-[var(--accent)]' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatPct(r.rocePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 text-[11px] text-[var(--text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                {mode === 'tsr' &&
                  'Rumus: TSR = ((Harga Saham Akhir − Harga Saham Awal) + Saldo Akhir Dividen) ÷ Harga Saham Awal.'}
                {mode === 'eva' &&
                  (evaMode === 'template_direct'
                    ? 'Rumus: EVA = L/R Setelah Pajak − Modal (Capital Employed).'
                    : `Rumus: EVA = L/R Setelah Pajak − (Modal × WACC ${waccPct}%).`)}
                {mode === 'roi' && 'Rumus: ROI (%) = (L/R Setelah Pajak ÷ Nilai Investasi) × 100%.'}
                {mode === 'roce' &&
                  'Rumus: ROCE (%) = (L/R Sebelum Pajak ÷ Rata-rata Modal [(Modal Awal + Modal Akhir) ÷ 2]) × 100%.'}
                {mode === 'roa' && 'Rumus: ROA (%) = (L/R Setelah Pajak ÷ Total Aset Neto [COA 0–6]) × 100%.'}
                {mode === 'roe' && 'Rumus: ROE (%) = (L/R Setelah Pajak ÷ Ekuitas) × 100%.'}
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">Nominal dalam IDR</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
