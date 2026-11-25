import React, { useEffect, useMemo, useState } from 'react';
import {
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatDecimal,
  formatIdr,
  formatNumberPlain,
  formatPct,
  useBiFinancePeriodData,
} from './biFinanceShared';

export type BiFinanceEfficiencyValuationMode = 'wctr' | 'opex_to_sales' | 'capex_to_sales' | 'per';

interface BiFinanceEfficiencyValuationKpiProps {
  mode: BiFinanceEfficiencyValuationMode;
  idToken: string;
  onDownloadBridge?: () => void;
}

interface PerManualInput {
  sharePrice: number;
  shareCount: number;
}

const PER_STORAGE_KEY = 'nara_bi_per_inputs_v1';

function loadPerInputs(): Record<string, PerManualInput> {
  try {
    const raw = localStorage.getItem(PER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const MODE_META: Record<
  BiFinanceEfficiencyValuationMode,
  {
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
    csvPrefix: string;
  }
> = {
  wctr: {
    category: 'Efisiensi, Investasi & Valuasi',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '16. Working Capital Turn Over Ratio (WCTR)',
    description:
      'Mengukur seberapa efisien modal kerja bersih (Aset Lancar − Liabilitas Lancar) menghasilkan pendapatan penjualan setiap bulan.',
    csvPrefix: 'BI_WCTR',
  },
  opex_to_sales: {
    category: 'Efisiensi, Investasi & Valuasi',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '17. Opex to Sales / Operating Expense Ratio (OER) / BOPO',
    description:
      'Mengukur persentase biaya operasional terhadap pendapatan operasional (BOPO) untuk mengevaluasi tingkat efisiensi biaya perusahaan.',
    csvPrefix: 'BI_Opex_To_Sales_BOPO',
  },
  capex_to_sales: {
    category: 'Efisiensi, Investasi & Valuasi',
    chartTypeLabel: 'Diagram Kerucut Vertikal',
    title: '18. CAPEX To Sales Ratio',
    description:
      'Mengukur persentase belanja modal (penambahan bersih Aktiva Tetap: Saldo Akhir − Saldo Awal Aktiva Tetap) terhadap pendapatan bulanan.',
    csvPrefix: 'BI_CAPEX_To_Sales',
  },
  per: {
    category: 'Efisiensi, Investasi & Valuasi',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '19. Price Earnings Ratio (PER)',
    description:
      'Mengukur rasio valuasi harga saham terhadap laba bersih per lembar saham (EPS = L/R Setelah Pajak ÷ Jumlah Saham). L/R Setelah Pajak diambil langsung dari jurnal ERP.',
    csvPrefix: 'BI_PER',
  },
};

export const BiFinanceEfficiencyValuationKpi: React.FC<BiFinanceEfficiencyValuationKpiProps> = ({
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

  // Mode-specific basis controls
  const [wctrBasis, setWctrBasis] = useState<'current_wc' | 'total_net_assets'>('current_wc');
  const [bopoBasis, setBopoBasis] = useState<'bopo_total' | 'opex_only' | 'all_costs'>('bopo_total');
  const [taxBasis, setTaxBasis] = useState<'erp_actual' | 'estimated_rate'>('erp_actual');
  const [estimatedTaxRate, setEstimatedTaxRate] = useState<number>(25);

  // Manual PER market inputs persisted in localStorage
  const [perInputs, setPerInputs] = useState<Record<string, PerManualInput>>(() => loadPerInputs());

  useEffect(() => {
    try {
      localStorage.setItem(PER_STORAGE_KEY, JSON.stringify(perInputs));
    } catch {
      // Ignore storage quota errors
    }
  }, [perInputs]);

  const updatePerField = (month: string, field: keyof PerManualInput, rawValue: string) => {
    const parsed = Number(rawValue.replace(/[^\d.-]/g, ''));
    const safeVal = Number.isFinite(parsed) ? parsed : 0;
    setPerInputs((prev) => ({
      ...prev,
      [month]: {
        sharePrice: prev[month]?.sharePrice ?? 0,
        shareCount: prev[month]?.shareCount ?? 0,
        [field]: safeVal,
      },
    }));
  };

  const computedRows = useMemo(() => {
    const safeTaxRate = Number.isFinite(estimatedTaxRate)
      ? Math.max(0, Math.min(100, estimatedTaxRate))
      : 0;

    return monthlyRows.map((row) => {
      // 16: WCTR = Pendapatan / (Asset - Liabilitas)
      const wctrAsset = wctrBasis === 'current_wc' ? row.currentAssetsEnd : row.totalAssetsEnd;
      const wctrLiab =
        wctrBasis === 'current_wc' ? row.currentLiabilitiesEnd : row.totalLiabilitiesEnd;
      const workingCapital = wctrAsset - wctrLiab;
      const wctrRatio = Math.abs(workingCapital) >= 1 ? row.revenueOperating / workingCapital : 0;

      // 17: Opex to Sales / OER / BOPO
      const bopoPend = bopoBasis === 'all_costs' ? row.totalPendapatan : row.revenueOperating;
      const bopoBiaya =
        bopoBasis === 'bopo_total'
          ? row.operatingExpenseTotal
          : bopoBasis === 'opex_only'
            ? row.opex
            : row.totalBiaya;
      const bopoPct = bopoPend > 0 ? (bopoBiaya / bopoPend) * 100 : 0;

      // 18: CAPEX To Sales = ((Saldo Akhir Aktiva Tetap - Saldo Awal Aktiva Tetap) / Pendapatan) * 100
      const capexNominal = row.fixedAssetsEnd - row.fixedAssetsStart;
      const capexToSalesPct =
        row.revenueOperating > 0 ? (capexNominal / row.revenueOperating) * 100 : 0;

      // 19: PER = Harga Saham / (LR Setelah Pajak / Jml Saham)
      const pbt = row.profitBeforeTax;
      const taxAmount =
        taxBasis === 'erp_actual'
          ? row.erpTaxNetExpense
          : pbt > 0
            ? pbt * (safeTaxRate / 100)
            : 0;
      const eat = pbt - taxAmount;
      const perIn = perInputs[row.month] || { sharePrice: 0, shareCount: 0 };
      const eps = perIn.shareCount > 0 ? eat / perIn.shareCount : 0;
      const perRatio = Math.abs(eps) > 1e-6 && perIn.sharePrice > 0 ? perIn.sharePrice / eps : 0;

      return {
        row,
        wctrAsset,
        wctrLiab,
        workingCapital,
        wctrRatio,
        bopoPend,
        bopoBiaya,
        bopoPct,
        capexNominal,
        capexToSalesPct,
        eat,
        perIn,
        eps,
        perRatio,
      };
    });
  }, [bopoBasis, estimatedTaxRate, monthlyRows, perInputs, taxBasis, wctrBasis]);

  const summary = useMemo(() => {
    const n = computedRows.length;
    const last = n > 0 ? computedRows[n - 1] : null;
    const avgWctr = n > 0 ? computedRows.reduce((s, r) => s + r.wctrRatio, 0) / n : 0;
    const sumBopoPend = computedRows.reduce((s, r) => s + r.bopoPend, 0);
    const sumBopoBiaya = computedRows.reduce((s, r) => s + r.bopoBiaya, 0);
    const weightedBopoPct = sumBopoPend > 0 ? (sumBopoBiaya / sumBopoPend) * 100 : 0;
    const sumCapex = computedRows.reduce((s, r) => s + r.capexNominal, 0);
    const sumRevOp = computedRows.reduce((s, r) => s + r.row.revenueOperating, 0);
    const weightedCapexPct = sumRevOp > 0 ? (sumCapex / sumRevOp) * 100 : 0;
    const sumEat = computedRows.reduce((s, r) => s + r.eat, 0);
    const validPers = computedRows.filter((r) => r.perRatio !== 0);
    const avgPer =
      validPers.length > 0
        ? validPers.reduce((s, r) => s + r.perRatio, 0) / validPers.length
        : 0;
    return {
      last,
      avgWctr,
      sumBopoPend,
      sumBopoBiaya,
      weightedBopoPct,
      sumCapex,
      sumRevOp,
      weightedCapexPct,
      sumEat,
      avgPer,
    };
  }, [computedRows]);

  const needsBsNotice = (mode === 'wctr' || mode === 'capex_to_sales') && !hasMonthlyBalanceSheet && Boolean(data);
  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (cutoffWarning) {
      parts.push(`Periode jurnal aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if (needsBsNotice) {
      parts.push(
        'Bridge ERP lokal Anda belum mengirim snapshot Neraca bulanan (monthlyBalanceSheet). Unduh ulang Bridge ERP terbaru agar saldo Aset Lancar, Liabilitas Lancar, dan Aktiva Tetap per bulan terisi otomatis.'
      );
    }
    if (mode === 'per') {
      parts.push(
        'L/R Setelah Pajak dibaca otomatis dari jurnal MyERP Plus. Silakan isi Harga Saham dan Jumlah Saham pada kolom tabel di bawah (tersimpan otomatis) untuk menghitung EPS & PER.'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, mode, needsBsNotice]);

  const handleExportCsv = () => {
    if (computedRows.length === 0) return;
    const suffix = `${selectedYear}_${String(effectiveStartMonth).padStart(2, '0')}-${String(effectiveEndMonth).padStart(2, '0')}`;

    if (mode === 'wctr') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Pendapatan', 'Asset', 'Liabilitas', 'Modal Kerja Bersih', 'WCTR (x)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.row.revenueOperating),
          Math.round(r.wctrAsset),
          Math.round(r.wctrLiab),
          Math.round(r.workingCapital),
          r.wctrRatio.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'opex_to_sales') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Pendapatan', 'Biaya', 'Opex to Sales / BOPO (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.bopoPend),
          Math.round(r.bopoBiaya),
          r.bopoPct.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'capex_to_sales') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Saldo Awal Aktiva Tetap', 'Saldo Akhir Aktiva Tetap', 'CAPEX', 'Pendapatan', 'CAPEX to Sales (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.row.fixedAssetsStart),
          Math.round(r.row.fixedAssetsEnd),
          Math.round(r.capexNominal),
          Math.round(r.row.revenueOperating),
          r.capexToSalesPct.toFixed(2),
        ]),
      ]);
      return;
    }

    downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
      ['Bulan', 'Harga Saham', 'LR Setelah Pajak', 'Jml Saham', 'EPS', 'Price Earnings Ratio (x)'],
      ...computedRows.map((r) => [
        r.row.labelShort,
        r.perIn.sharePrice,
        Math.round(r.eat),
        r.perIn.shareCount,
        r.eps.toFixed(2),
        r.perRatio.toFixed(2),
      ]),
    ]);
  };

  const extraControls = (
    <>
      {mode === 'wctr' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Modal Kerja
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setWctrBasis('current_wc')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                wctrBasis === 'current_wc'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Aset Lancar − Liab. Lancar
            </button>
            <button
              type="button"
              onClick={() => setWctrBasis('total_net_assets')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                wctrBasis === 'total_net_assets'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Total Aset − Total Liab.
            </button>
          </div>
        </div>
      )}

      {mode === 'opex_to_sales' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Cakupan Biaya (BOPO / OER)
          </span>
          <select
            value={bopoBasis}
            onChange={(e) => setBopoBasis(e.target.value as typeof bopoBasis)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
          >
            <option value="bopo_total">BOPO Operasional (HPP + Beban Ops / COA 12+13)</option>
            <option value="opex_only">Opex Murni (Beban Operasional / COA 13)</option>
            <option value="all_costs">Total Biaya (COA 12+13+15 vs Total Pendapatan)</option>
          </select>
        </div>
      )}

      {mode === 'per' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Pajak (L/R Stlh Pajak)
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setTaxBasis('erp_actual')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
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
                className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  taxBasis === 'estimated_rate'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Tarif (%)
              </button>
            </div>
            {taxBasis === 'estimated_rate' && (
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={estimatedTaxRate}
                onChange={(e) => setEstimatedTaxRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-14 px-2 py-1.5 text-xs font-mono tabular-nums text-right rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
                aria-label="Tarif pajak persen"
              />
            )}
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
          {mode === 'wctr' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Aset Akhir Periode</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.wctrAsset ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {wctrBasis === 'current_wc' ? 'Aset Lancar (COA 0–4)' : 'Total Aset Neto (COA 0–6)'}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Liabilitas Akhir Periode</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.wctrLiab ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {wctrBasis === 'current_wc' ? 'Liabilitas Lancar (COA 7–8)' : 'Total Liabilitas (COA 7–9)'}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Modal Kerja Bersih Akhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.workingCapital ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">Aset − Liabilitas</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata WCTR</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(summary.avgWctr)}x
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Bulan terakhir: {formatDecimal(summary.last?.wctrRatio ?? 0)}x
                </span>
              </div>
            </div>
          )}

          {mode === 'opex_to_sales' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumBopoPend)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {computedRows.length} bulan terposting
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Biaya Operasional</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumBopoBiaya)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {bopoBasis === 'bopo_total'
                    ? 'HPP + Beban Ops (12+13)'
                    : bopoBasis === 'opex_only'
                      ? 'Beban Operasional (13)'
                      : 'Total Biaya (12+13+15)'}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">BOPO / OER Akumulasi</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatPct(summary.weightedBopoPct)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  (Biaya ÷ Pendapatan) × 100%
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">BOPO Bulan Terakhir</span>
                <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                  {formatPct(summary.last?.bopoPct ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {summary.last?.row.labelFull}
                </span>
              </div>
            </div>
          )}

          {mode === 'capex_to_sales' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Saldo Akhir Aktiva Tetap</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.row.fixedAssetsEnd ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  COA tipe 5 · {summary.last?.row.labelShort}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total CAPEX Periode</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumCapex)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Mutasi bersih Aktiva Tetap
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan Usaha</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumRevOp)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">COA tipe 11</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">CAPEX to Sales Akumulasi</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatPct(summary.weightedCapexPct)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Bulan terakhir: {formatPct(summary.last?.capexToSalesPct ?? 0)}
                </span>
              </div>
            </div>
          )}

          {mode === 'per' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total L/R Setelah Pajak</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.sumEat)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">Data aktual MyERP Plus</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">EPS Bulan Terakhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatDecimal(summary.last?.eps ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  L/R Stlh Pajak ÷ Jml Saham
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">PER Bulan Terakhir</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(summary.last?.perRatio ?? 0)}x
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {summary.last?.row.labelFull}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata PER</span>
                <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(summary.avgPer)}x
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Harga Saham ÷ EPS
                </span>
              </div>
            </div>
          )}

          {/* PRIMARY CHARTS */}
          {mode === 'wctr' && (
            <BiHorizontalBarChart
              title="WCTR"
              subtitle="Working Capital Turn Over Ratio (x) — efisiensi perputaran modal kerja terhadap pendapatan"
              legendLabel="WCTR"
              formatAxisTick={(v) => v.toFixed(2)}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.wctrRatio,
                valueLabel: `${formatDecimal(r.wctrRatio)}x`,
                hoverSummary: `Pendapatan ${formatIdr(r.row.revenueOperating)} ÷ Modal Kerja ${formatIdr(r.workingCapital)} = ${formatDecimal(r.wctrRatio)}x`,
              }))}
            />
          )}

          {mode === 'opex_to_sales' && (
            <BiVerticalSingleChart
              title="Opex to Sales"
              subtitle="Persentase Biaya Operasional terhadap Pendapatan Operasional (OER / BOPO %)"
              legendLabel="Opex to Sales (%)"
              formatAxisTick={(v) => `${Math.round(v)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.bopoPct,
                valueLabel: `${Math.round(r.bopoPct)}%`,
                hoverSummary: `Biaya ${formatIdr(r.bopoBiaya)} ÷ Pendapatan ${formatIdr(r.bopoPend)} = ${formatPct(r.bopoPct)}`,
              }))}
            />
          )}

          {mode === 'capex_to_sales' && (
            <BiVerticalSingleChart
              title="Capex to Sales"
              subtitle="Persentase penambahan bersih Aktiva Tetap (CAPEX) terhadap Pendapatan bulanan (%)"
              legendLabel="Capex to Sales (%)"
              shape="cone"
              formatAxisTick={(v) => `${v.toFixed(0)}%`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.capexToSalesPct,
                valueLabel: formatPct(r.capexToSalesPct),
                hoverSummary: `(Akhir ${formatIdr(r.row.fixedAssetsEnd)} − Awal ${formatIdr(r.row.fixedAssetsStart)}) ÷ Pendapatan ${formatIdr(r.row.revenueOperating)} = ${formatPct(r.capexToSalesPct)}`,
              }))}
            />
          )}

          {mode === 'per' && (
            <BiHorizontalBarChart
              title="Price Earnings Ratio"
              subtitle="Rasio Harga Saham dibagi Laba per Saham (EPS) per bulan"
              legendLabel="Price Earnings Ratio"
              formatAxisTick={(v) => v.toFixed(2)}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.perRatio,
                valueLabel: `${formatDecimal(r.perRatio)}x`,
                hoverSummary: `Harga Saham ${formatIdr(r.perIn.sharePrice)} ÷ EPS ${formatDecimal(r.eps)} = ${formatDecimal(r.perRatio)}x`,
              }))}
            />
          )}

          {/* STRUCTURED TABLES */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)]">
              <h4 className="font-display text-sm font-bold text-[var(--text)]">
                Tabel Perhitungan {meta.title}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {mode === 'per'
                  ? 'L/R Setelah Pajak dari MyERP Plus; kolom Harga Saham & Jumlah Saham dapat diedit langsung.'
                  : 'Sumber aktual: Buku Besar ERP (jurnal terposting, non-void)'}
              </p>
            </div>

            <div className="overflow-x-auto">
              {mode === 'wctr' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Pendapatan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Asset</th>
                      <th className="text-right font-semibold px-4 py-2.5">Liabilitas</th>
                      <th className="text-right font-semibold px-4 py-2.5">Modal Kerja</th>
                      <th className="text-right font-semibold px-4 py-2.5">WCTR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.row.revenueOperating)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.wctrAsset)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.wctrLiab)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                          {formatNumberPlain(r.workingCapital)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                          {formatDecimal(r.wctrRatio)}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {mode === 'opex_to_sales' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Pendapatan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Biaya</th>
                      <th className="text-right font-semibold px-4 py-2.5">Opex to Sales / BOPO (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.bopoPend)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.bopoBiaya)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                          {formatPct(r.bopoPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {mode === 'capex_to_sales' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Saldo Awal Aktiva Tetap</th>
                      <th className="text-right font-semibold px-4 py-2.5">Saldo Akhir Aktiva Tetap</th>
                      <th className="text-right font-semibold px-4 py-2.5">CAPEX (Selisih)</th>
                      <th className="text-right font-semibold px-4 py-2.5">Pendapatan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Capex to Sales (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.row.fixedAssetsStart)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.row.fixedAssetsEnd)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                          {formatNumberPlain(r.capexNominal)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.row.revenueOperating)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                          {formatPct(r.capexToSalesPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {mode === 'per' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Harga Saham</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">LR Setelah Pajak (ERP)</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Jml Saham</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">EPS</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Price Earnings Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {r.row.labelShort}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Harga saham ${r.row.labelShort}`}
                            value={r.perIn.sharePrice || ''}
                            placeholder="0"
                            onChange={(e) => updatePerField(r.row.month, 'sharePrice', e.target.value)}
                            className="w-32 px-2.5 py-1 text-xs font-mono tabular-nums text-right rounded-md border border-amber-400/60 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(r.eat)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Jumlah saham ${r.row.labelShort}`}
                            value={r.perIn.shareCount || ''}
                            placeholder="0"
                            onChange={(e) => updatePerField(r.row.month, 'shareCount', e.target.value)}
                            className="w-32 px-2.5 py-1 text-xs font-mono tabular-nums text-right rounded-md border border-amber-400/60 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </td>
                        <td className="px-4 py-2 text-right text-[var(--text-muted)] whitespace-nowrap">
                          {formatDecimal(r.eps)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-[var(--accent)] whitespace-nowrap">
                          {formatDecimal(r.perRatio)}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 text-[11px] text-[var(--text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                {mode === 'wctr' &&
                  'Rumus: WCTR = Pendapatan Usaha ÷ (Aset Lancar − Liabilitas Lancar).'}
                {mode === 'opex_to_sales' &&
                  'Rumus: Opex to Sales / OER / BOPO (%) = (Biaya Operasional ÷ Pendapatan Operasional) × 100%.'}
                {mode === 'capex_to_sales' &&
                  'Rumus: CAPEX to Sales (%) = ((Saldo Akhir Aktiva Tetap − Saldo Awal Aktiva Tetap) ÷ Pendapatan) × 100%.'}
                {mode === 'per' &&
                  'Rumus: EPS = L/R Setelah Pajak ÷ Jumlah Saham · Price Earnings Ratio (PER) = Harga Saham ÷ EPS.'}
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">Nominal dalam IDR</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
