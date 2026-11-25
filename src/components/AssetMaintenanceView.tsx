import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Edit3,
  History,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { LOCAL_BRIDGE_SCRIPT } from '../lib/erpBridgeTemplate';
import { useI18n } from '../lib/i18n';
import {
  ErpAssetsPanel,
  type ErpAssetItem,
  type ErpAssetsQueryResult,
} from './ErpAssetsPanel';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_PRESETS,
  SAMPLE_ASSET_CODES,
  addDaysIso,
  addMonthsIso,
  completeMaintenanceSchedule,
  computeEffectiveMaintenanceStatus,
  createCompanyAsset,
  createMaintenanceSchedule,
  deleteCompanyAsset,
  deleteMaintenanceSchedule,
  downloadAssetsCsv,
  downloadMaintenanceCsv,
  formatIsoDateLocal,
  seedSampleAssetsAndMaintenance,
  sortAssets,
  sortMaintenanceSchedules,
  updateCompanyAsset,
  updateMaintenanceSchedule,
} from '../lib/assetService';
import type {
  AssetCategory,
  AssetCondition,
  AssetMaintenanceSchedule,
  CompanyAsset,
  DirectoryMember,
  Division,
  MaintenanceStatus,
  MaintenanceType,
  ReminderComposeDraft,
  UserProfile,
} from '../types/sop';

interface AssetMaintenanceViewProps {
  user: UserProfile;
  idToken: string;
  divisions: Division[];
  directory: DirectoryMember[];
  assets: CompanyAsset[];
  schedules: AssetMaintenanceSchedule[];
  loading: boolean;
  onAssetsChange: (next: CompanyAsset[]) => void;
  onSchedulesChange: (next: AssetMaintenanceSchedule[]) => void;
  onAskAiQuestion: (question: string) => void;
  onSendReminder?: (draft: ReminderComposeDraft) => void;
}

type SubTab = 'erp' | 'schedules' | 'inventory' | 'timeline';

function downloadBridgeScript(): void {
  const blob = new Blob([LOCAL_BRIDGE_SCRIPT], { type: 'text/javascript;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'erp-mysql-bridge.mjs';
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateId(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatMonthYearId(dateStr: string): string {
  if (!dateStr) return 'Tanpa Tanggal';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });
}

function formatRupiah(amount: number): string {
  if (!amount || amount <= 0) return '-';
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function conditionColorClass(condition: AssetCondition): string {
  switch (condition) {
    case 'Baik':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'Perlu Perhatian':
      return 'text-amber-700 dark:text-amber-400';
    case 'Dalam Perbaikan':
      return 'text-[var(--accent-text)] dark:text-[var(--accent)]';
    case 'Rusak / Nonaktif':
      return 'text-rose-700 dark:text-rose-400';
  }
}

function maintenanceStatusColorClass(status: MaintenanceStatus): string {
  switch (status) {
    case 'Terlambat':
      return 'text-rose-700 dark:text-rose-400 font-semibold';
    case 'Mendekati Jatuh Tempo':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'Terjadwal':
      return 'text-[var(--accent-text)] dark:text-[var(--accent)] font-medium';
    case 'Selesai':
      return 'text-emerald-700 dark:text-emerald-400 font-medium';
    case 'Dibatalkan':
      return 'text-slate-500 dark:text-slate-400';
  }
}

function suggestAssetCode(category: AssetCategory, existing: CompanyAsset[]): string {
  const prefixMap: Record<AssetCategory, string> = {
    Kendaraan: 'KND',
    Meja: 'MJ',
    Kursi: 'KR',
    Bangunan: 'BGN',
    'Elektronik & IT': 'IT',
    'Mesin & Peralatan': 'MSN',
    Lainnya: 'AST',
  };
  const prefix = prefixMap[category];
  const count = existing.filter((a) => a.category === category).length + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

function defaultUnitForCategory(category: AssetCategory): string {
  switch (category) {
    case 'Kendaraan':
      return 'Unit';
    case 'Meja':
    case 'Kursi':
      return 'Buah';
    case 'Bangunan':
      return 'Gedung';
    default:
      return 'Unit';
  }
}

export function AssetMaintenanceView({
  user,
  idToken,
  divisions,
  directory,
  assets,
  schedules,
  loading,
  onAssetsChange,
  onSchedulesChange,
  onAskAiQuestion,
  onSendReminder,
}: AssetMaintenanceViewProps) {
  const { t } = useI18n();
  const canWrite = user.role !== 'Karyawan';

  const triggerScheduleReminder = (s: AssetMaintenanceSchedule) => {
    if (!onSendReminder) return;
    const { effectiveStatus, daysUntilDue } = computeEffectiveMaintenanceStatus(s);
    const statusLine =
      daysUntilDue < 0
        ? `TERLAMBAT ${Math.abs(daysUntilDue)} hari (jatuh tempo: ${s.dueDate})`
        : daysUntilDue === 0
          ? `JATUH TEMPO HARI INI (${s.dueDate})`
          : `Jatuh tempo dalam ${daysUntilDue} hari (${s.dueDate})`;
    const msgLines = [
      `Pengingat Maintenance Aset: ${s.title}`,
      `Aset: [${s.assetCode}] ${s.assetName}${s.plateOrSerial ? ` (${s.plateOrSerial})` : ''}`,
      `Jenis Perawatan: ${s.maintenanceType}`,
      `Status Jadwal: ${statusLine}`,
      s.vendorName ? `Vendor/Bengkel: ${s.vendorName}` : '',
      s.estimatedCost > 0
        ? `Estimasi Biaya: Rp ${Math.round(s.estimatedCost).toLocaleString('id-ID')}`
        : '',
      s.notes ? `Catatan: ${s.notes}` : '',
      'Mohon segera ditindaklanjuti dan perbarui status setelah perawatan selesai.',
    ].filter(Boolean);

    onSendReminder({
      category: 'maintenance',
      priority:
        effectiveStatus === 'Terlambat'
          ? 'urgent'
          : effectiveStatus === 'Mendekati Jatuh Tempo'
            ? 'warning'
            : 'normal',
      sourceType: 'ASSET_MAINTENANCE',
      sourceId: s.id,
      sourceLabel: `${s.assetCode} · ${s.assetName}`,
      dueDate: s.dueDate,
      title: `[Maintenance] ${s.title} — ${s.assetName}`,
      message: msgLines.join('\n'),
      recipients: [
        {
          uid: s.picUid || '',
          name: s.picName || s.createdByName || 'PIC Aset',
        },
      ],
    });
  };
  const [subTab, setSubTab] = useState<SubTab>('erp');
  const [erpAssetsData, setErpAssetsData] = useState<ErpAssetsQueryResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'urgent' | MaintenanceStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MaintenanceType>('all');
  const [conditionFilter, setConditionFilter] = useState<'all' | AssetCondition>('all');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [seedingLabel, setSeedingLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Asset Form Modal
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<CompanyAsset | null>(null);
  const [assetCode, setAssetCode] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('Kendaraan');
  const [assetSubCategory, setAssetSubCategory] = useState('');
  const [assetQty, setAssetQty] = useState('1');
  const [assetUnit, setAssetUnit] = useState('Unit');
  const [assetCondition, setAssetCondition] = useState<AssetCondition>('Baik');
  const [assetLocation, setAssetLocation] = useState('');
  const [assetDivId, setAssetDivId] = useState('');
  const [assetPicUid, setAssetPicUid] = useState('');
  const [assetPlateSerial, setAssetPlateSerial] = useState('');
  const [assetBrandModel, setAssetBrandModel] = useState('');
  const [assetPurchaseDate, setAssetPurchaseDate] = useState('');
  const [assetOdometer, setAssetOdometer] = useState('0');
  const [assetNotes, setAssetNotes] = useState('');
  const [autoCreateVehiclePack, setAutoCreateVehiclePack] = useState(false);
  const [includeKirInPack, setIncludeKirInPack] = useState(false);

  // Maintenance Form Modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AssetMaintenanceSchedule | null>(null);
  const [schAssetId, setSchAssetId] = useState('');
  const [schType, setSchType] = useState<MaintenanceType>('Servis Berkala');
  const [schTitle, setSchTitle] = useState('');
  const [schDueDate, setSchDueDate] = useState('');
  const [schIntervalMonths, setSchIntervalMonths] = useState('6');
  const [schIntervalKm, setSchIntervalKm] = useState('10000');
  const [schTargetOdo, setSchTargetOdo] = useState('0');
  const [schReminderDays, setSchReminderDays] = useState('14');
  const [schStatus, setSchStatus] = useState<MaintenanceStatus>('Terjadwal');
  const [schCost, setSchCost] = useState('0');
  const [schVendor, setSchVendor] = useState('');
  const [schPicUid, setSchPicUid] = useState('');
  const [schNotes, setSchNotes] = useState('');

  // Complete Maintenance Modal
  const [completingSchedule, setCompletingSchedule] = useState<AssetMaintenanceSchedule | null>(null);
  const [compDate, setCompDate] = useState('');
  const [compVendor, setCompVendor] = useState('');
  const [compCost, setCompCost] = useState('0');
  const [compOdometer, setCompOdometer] = useState('0');
  const [compNotes, setCompNotes] = useState('');
  const [compAutoRollover, setCompAutoRollover] = useState(true);

  // History Modal & Delete Confirm
  const [historySchedule, setHistorySchedule] = useState<AssetMaintenanceSchedule | null>(null);
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<CompanyAsset | null>(null);
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] =
    useState<AssetMaintenanceSchedule | null>(null);

  const nowMs = Date.now();

  const categoryTotals = useMemo(() => {
    const map = new Map<AssetCategory, { units: number; records: number }>();
    for (const cat of ASSET_CATEGORIES) {
      map.set(cat, { units: 0, records: 0 });
    }
    for (const a of assets) {
      const entry = map.get(a.category) || { units: 0, records: 0 };
      entry.units += Math.max(1, Number(a.quantity) || 1);
      entry.records += 1;
      map.set(a.category, entry);
    }
    return map;
  }, [assets]);

  const totalUnits = useMemo(
    () => assets.reduce((sum, a) => sum + Math.max(1, Number(a.quantity) || 1), 0),
    [assets]
  );

  const erpAssetToVirtualCompanyAsset = (item: ErpAssetItem): CompanyAsset => {
    const matchedDivision = divisions.find(
      (d) => d.name.trim().toLowerCase() === (item.division || '').trim().toLowerCase()
    );
    return {
      id: `erp_m7_${item.id}`,
      assetCode: item.assetCode || `ERP-${item.id}`,
      name: item.name,
      category: item.mappedCategory,
      subCategory: item.categoryName,
      quantity: Math.max(1, Number(item.quantity) || 1),
      unit: item.unit || 'Unit',
      condition: item.isDisposed ? 'Rusak / Nonaktif' : 'Baik',
      location: item.location || item.branch || '',
      divisionId: matchedDivision?.id || user.divisionId || divisions[0]?.id || '',
      divisionName: item.division || matchedDivision?.name || 'Umum',
      picUid: user.uid,
      picName: user.displayName,
      plateOrSerial: item.serialOrPlate || '',
      brandModel: item.categoryName || '',
      purchaseDate: item.purchaseDate || item.useDate || '',
      currentOdometerKm: 0,
      notes: item.notes || '',
      isPublic: true,
      viewerUids: [],
      createdByUid: user.uid,
      createdByName: user.displayName,
    };
  };

  const erpVirtualAssets = useMemo<CompanyAsset[]>(
    () => (erpAssetsData?.items || []).filter((a) => !a.isDisposed).map(erpAssetToVirtualCompanyAsset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [erpAssetsData, divisions, user.uid, user.displayName, user.divisionId]
  );

  const allSchedulableAssets = useMemo<CompanyAsset[]>(() => {
    const seen = new Set<string>();
    const combined: CompanyAsset[] = [];
    for (const a of [...erpVirtualAssets, ...assets]) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      combined.push(a);
    }
    return combined;
  }, [erpVirtualAssets, assets]);

  const enrichedSchedules = useMemo(
    () =>
      sortMaintenanceSchedules(schedules, nowMs).map((s) => ({
        schedule: s,
        eff: computeEffectiveMaintenanceStatus(s, nowMs),
      })),
    [schedules, nowMs]
  );

  const overdueCount = useMemo(
    () => enrichedSchedules.filter((x) => x.eff.effectiveStatus === 'Terlambat').length,
    [enrichedSchedules]
  );

  const dueSoonCount = useMemo(
    () => enrichedSchedules.filter((x) => x.eff.effectiveStatus === 'Mendekati Jatuh Tempo').length,
    [enrichedSchedules]
  );

  const next30DaysBudget = useMemo(
    () =>
      enrichedSchedules
        .filter(
          (x) =>
            x.eff.effectiveStatus !== 'Selesai' &&
            x.eff.effectiveStatus !== 'Dibatalkan' &&
            x.eff.daysUntilDue <= 30
        )
        .reduce((sum, x) => sum + (Number(x.schedule.estimatedCost) || 0), 0),
    [enrichedSchedules]
  );

  const activeScheduleCountByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const { schedule, eff } of enrichedSchedules) {
      if (eff.effectiveStatus === 'Selesai' || eff.effectiveStatus === 'Dibatalkan') continue;
      map.set(schedule.assetId, (map.get(schedule.assetId) || 0) + 1);
    }
    return map;
  }, [enrichedSchedules]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((a) => {
      if (selectedCategory !== 'all' && a.category !== selectedCategory) return false;
      if (conditionFilter !== 'all' && a.condition !== conditionFilter) return false;
      if (!q) return true;
      const hay = [
        a.assetCode,
        a.name,
        a.category,
        a.subCategory,
        a.plateOrSerial,
        a.brandModel,
        a.location,
        a.divisionName,
        a.picName,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [assets, selectedCategory, conditionFilter, searchQuery]);

  const filteredSchedules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedSchedules.filter(({ schedule: s, eff }) => {
      if (selectedCategory !== 'all' && s.assetCategory !== selectedCategory) return false;
      if (typeFilter !== 'all' && s.maintenanceType !== typeFilter) return false;
      if (statusFilter === 'urgent') {
        if (eff.effectiveStatus !== 'Terlambat' && eff.effectiveStatus !== 'Mendekati Jatuh Tempo') {
          return false;
        }
      } else if (statusFilter !== 'all' && eff.effectiveStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        s.assetCode,
        s.assetName,
        s.assetCategory,
        s.plateOrSerial,
        s.maintenanceType,
        s.title,
        s.vendorName,
        s.picName,
        s.dueDate,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [enrichedSchedules, selectedCategory, typeFilter, statusFilter, searchQuery]);

  const timelineGroups = useMemo(() => {
    const active = filteredSchedules.filter(
      (x) => x.eff.effectiveStatus !== 'Selesai' && x.eff.effectiveStatus !== 'Dibatalkan'
    );
    const overdue = active.filter((x) => x.eff.effectiveStatus === 'Terlambat');
    const upcoming = active
      .filter((x) => x.eff.effectiveStatus !== 'Terlambat')
      .sort((a, b) => a.schedule.dueAtMs - b.schedule.dueAtMs);

    const groups: {
      key: string;
      label: string;
      isOverdue: boolean;
      totalCost: number;
      items: typeof active;
    }[] = [];

    if (overdue.length > 0) {
      groups.push({
        key: 'overdue',
        label: 'Terlambat (Perlu Tindakan Segera)',
        isOverdue: true,
        totalCost: overdue.reduce((s, x) => s + (x.schedule.estimatedCost || 0), 0),
        items: overdue,
      });
    }

    const byMonth = new Map<string, typeof active>();
    for (const item of upcoming) {
      const monthKey = (item.schedule.dueDate || '').slice(0, 7) || 'unknown';
      const list = byMonth.get(monthKey) || [];
      list.push(item);
      byMonth.set(monthKey, list);
    }

    for (const [monthKey, items] of byMonth.entries()) {
      groups.push({
        key: monthKey,
        label:
          monthKey === 'unknown'
            ? 'Jadwal Tanpa Bulan'
            : formatMonthYearId(`${monthKey}-01`),
        isOverdue: false,
        totalCost: items.reduce((s, x) => s + (x.schedule.estimatedCost || 0), 0),
        items,
      });
    }

    return groups;
  }, [filteredSchedules]);

  const schedulesPaging = useTablePagination(filteredSchedules, {
    defaultPageSize: 20,
    storageKey: 'maintenance_schedules',
  });

  const assetsPaging = useTablePagination(filteredAssets, {
    defaultPageSize: 20,
    storageKey: 'maintenance_assets',
  });

  const canManageAsset = (a: CompanyAsset) =>
    user.role === 'Super Admin' ||
    a.createdByUid === user.uid ||
    (user.role === 'Admin Divisi' && a.divisionId === user.divisionId);

  const canCompleteSchedule = (s: AssetMaintenanceSchedule) =>
    user.role === 'Super Admin' ||
    s.createdByUid === user.uid ||
    s.picUid === user.uid ||
    (user.role === 'Admin Divisi' && s.divisionId === user.divisionId);

  const openCreateAssetModal = (presetCategory?: AssetCategory) => {
    const cat = presetCategory || (selectedCategory !== 'all' ? selectedCategory : 'Kendaraan');
    setEditingAsset(null);
    setAssetCategory(cat);
    setAssetCode(suggestAssetCode(cat, assets));
    setAssetName('');
    setAssetSubCategory('');
    setAssetQty('1');
    setAssetUnit(defaultUnitForCategory(cat));
    setAssetCondition('Baik');
    setAssetLocation('');
    setAssetDivId(user.divisionId || divisions[0]?.id || '');
    setAssetPicUid(user.uid);
    setAssetPlateSerial('');
    setAssetBrandModel('');
    setAssetPurchaseDate(formatIsoDateLocal(new Date()));
    setAssetOdometer('0');
    setAssetNotes('');
    setAutoCreateVehiclePack(false);
    setIncludeKirInPack(false);
    setErrorMsg(null);
    setAssetModalOpen(true);
  };

  const openEditAssetModal = (a: CompanyAsset) => {
    setEditingAsset(a);
    setAssetCategory(a.category);
    setAssetCode(a.assetCode);
    setAssetName(a.name);
    setAssetSubCategory(a.subCategory);
    setAssetQty(String(a.quantity));
    setAssetUnit(a.unit);
    setAssetCondition(a.condition);
    setAssetLocation(a.location);
    setAssetDivId(a.divisionId);
    setAssetPicUid(a.picUid || user.uid);
    setAssetPlateSerial(a.plateOrSerial);
    setAssetBrandModel(a.brandModel);
    setAssetPurchaseDate(a.purchaseDate);
    setAssetOdometer(String(a.currentOdometerKm || 0));
    setAssetNotes(a.notes);
    setAutoCreateVehiclePack(false);
    setIncludeKirInPack(false);
    setErrorMsg(null);
    setAssetModalOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetName.trim()) {
      setErrorMsg('Nama aset wajib diisi.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const divObj = divisions.find((d) => d.id === assetDivId);
      const picObj = directory.find((m) => m.uid === assetPicUid);
      const payload = {
        assetCode: assetCode.trim() || suggestAssetCode(assetCategory, assets),
        name: assetName.trim(),
        category: assetCategory,
        subCategory: assetSubCategory.trim(),
        quantity: Math.max(1, Number(assetQty) || 1),
        unit: assetUnit.trim() || defaultUnitForCategory(assetCategory),
        condition: assetCondition,
        location: assetLocation.trim(),
        divisionId: divObj?.id || assetDivId || '',
        divisionName: divObj?.name || user.divisionName || 'Umum',
        picUid: picObj?.uid || assetPicUid || user.uid,
        picName: picObj?.displayName || user.displayName,
        plateOrSerial: assetPlateSerial.trim(),
        brandModel: assetBrandModel.trim(),
        purchaseDate: assetPurchaseDate.trim(),
        currentOdometerKm: assetCategory === 'Kendaraan' ? Math.max(0, Number(assetOdometer) || 0) : 0,
        notes: assetNotes.trim(),
        isPublic: true,
      };

      if (editingAsset) {
        const updated = await updateCompanyAsset({
          asset: editingAsset,
          updates: payload,
          actor: user,
          directory,
          idToken,
        });
        onAssetsChange(sortAssets(assets.map((x) => (x.id === updated.id ? updated : x))));
        setNoticeMsg(`Data aset ${updated.assetCode} berhasil diperbarui.`);
      } else {
        const created = await createCompanyAsset({
          input: payload,
          actor: user,
          directory,
          idToken,
        });
        onAssetsChange(sortAssets([created, ...assets]));

        if (created.category === 'Kendaraan' && autoCreateVehiclePack) {
          const today = new Date();
          const baseOdo = created.currentOdometerKm || 0;
          const packDefs: {
            type: MaintenanceType;
            title: string;
            days: number;
            months: number;
            km: number;
            reminder: number;
          }[] = [
            {
              type: 'Ganti Oli',
              title: `Ganti Oli Mesin & Filter — ${created.name}`,
              days: 90,
              months: 3,
              km: 5000,
              reminder: 10,
            },
            {
              type: 'Servis Berkala',
              title: `Servis Berkala Rutin — ${created.name}`,
              days: 180,
              months: 6,
              km: 10000,
              reminder: 14,
            },
            {
              type: 'Bayar Pajak STNK',
              title: `Pembayaran Pajak STNK Tahunan — ${created.plateOrSerial || created.name}`,
              days: 365,
              months: 12,
              km: 0,
              reminder: 30,
            },
          ];
          if (includeKirInPack) {
            packDefs.push({
              type: 'Uji KIR',
              title: `Uji KIR Berkala 6 Bulanan — ${created.plateOrSerial || created.name}`,
              days: 180,
              months: 6,
              km: 0,
              reminder: 21,
            });
          }
          const createdPack: AssetMaintenanceSchedule[] = [];
          for (const def of packDefs) {
            const sch = await createMaintenanceSchedule({
              input: {
                asset: created,
                maintenanceType: def.type,
                title: def.title,
                dueDate: addDaysIso(today, def.days),
                intervalMonths: def.months,
                intervalKm: def.km,
                targetOdometerKm: def.km > 0 && baseOdo > 0 ? baseOdo + def.km : def.km,
                reminderDaysBefore: def.reminder,
                estimatedCost: 0,
                vendorName: '',
                picUid: created.picUid,
                picName: created.picName,
                notes: 'Dibuat otomatis dari paket jadwal maintenance kendaraan.',
              },
              actor: user,
              directory,
              idToken,
            });
            createdPack.push(sch);
          }
          onSchedulesChange(sortMaintenanceSchedules([...createdPack, ...schedules]));
          setNoticeMsg(
            `Aset ${created.assetCode} ditambahkan bersama ${createdPack.length} jadwal maintenance kendaraan.`
          );
        } else {
          setNoticeMsg(`Aset ${created.assetCode} (${created.quantity} ${created.unit}) berhasil ditambahkan.`);
        }
      }

      setAssetModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan data aset.');
    } finally {
      setSaving(false);
    }
  };

  const openCreateScheduleModal = (presetAsset?: CompanyAsset) => {
    const targetAsset = presetAsset || allSchedulableAssets[0];
    if (!targetAsset) {
      setErrorMsg('Tambahkan minimal 1 aset atau hubungkan ERP terlebih dahulu sebelum membuat jadwal maintenance.');
      return;
    }
    const defaultType: MaintenanceType =
      targetAsset.category === 'Kendaraan'
        ? 'Ganti Oli'
        : targetAsset.category === 'Bangunan'
          ? 'Perawatan Bangunan / AC'
          : 'Inspeksi & Kalibrasi';
    const preset = MAINTENANCE_TYPE_PRESETS[defaultType];

    setEditingSchedule(null);
    setSchAssetId(targetAsset.id);
    setSchType(defaultType);
    setSchTitle(`${preset.defaultTitle} — ${targetAsset.name}`);
    setSchDueDate('');
    setSchIntervalMonths(String(preset.intervalMonths));
    setSchIntervalKm(String(preset.intervalKm));
    setSchTargetOdo(
      preset.intervalKm > 0 && targetAsset.currentOdometerKm > 0
        ? String(targetAsset.currentOdometerKm + preset.intervalKm)
        : '0'
    );
    setSchReminderDays(String(preset.reminderDaysBefore));
    setSchStatus('Terjadwal');
    setSchCost('0');
    setSchVendor('');
    setSchPicUid(targetAsset.picUid || user.uid);
    setSchNotes('');
    setErrorMsg(null);
    setScheduleModalOpen(true);
  };

  const handleCreateScheduleForErpAsset = (item: ErpAssetItem) => {
    openCreateScheduleModal(erpAssetToVirtualCompanyAsset(item));
  };

  const openEditScheduleModal = (s: AssetMaintenanceSchedule) => {
    setEditingSchedule(s);
    setSchAssetId(s.assetId);
    setSchType(s.maintenanceType);
    setSchTitle(s.title);
    setSchDueDate(s.dueDate);
    setSchIntervalMonths(String(s.intervalMonths));
    setSchIntervalKm(String(s.intervalKm));
    setSchTargetOdo(String(s.targetOdometerKm || 0));
    setSchReminderDays(String(s.reminderDaysBefore));
    setSchStatus(s.status);
    setSchCost(String(s.estimatedCost || 0));
    setSchVendor(s.vendorName);
    setSchPicUid(s.picUid || user.uid);
    setSchNotes(s.notes);
    setErrorMsg(null);
    setScheduleModalOpen(true);
  };

  const handleMaintenanceTypeChange = (nextType: MaintenanceType) => {
    setSchType(nextType);
    if (!editingSchedule) {
      const preset = MAINTENANCE_TYPE_PRESETS[nextType];
      const chosenAsset = allSchedulableAssets.find((a) => a.id === schAssetId);
      setSchIntervalMonths(String(preset.intervalMonths));
      setSchIntervalKm(String(preset.intervalKm));
      setSchReminderDays(String(preset.reminderDaysBefore));
      if (chosenAsset) {
        setSchTitle(`${preset.defaultTitle} — ${chosenAsset.name}`);
        if (preset.intervalKm > 0 && chosenAsset.currentOdometerKm > 0) {
          setSchTargetOdo(String(chosenAsset.currentOdometerKm + preset.intervalKm));
        } else {
          setSchTargetOdo('0');
        }
      }
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAsset =
      allSchedulableAssets.find((a) => a.id === schAssetId) ||
      (editingSchedule
        ? ({
            id: editingSchedule.assetId,
            assetCode: editingSchedule.assetCode,
            name: editingSchedule.assetName,
            category: editingSchedule.assetCategory,
            subCategory: '',
            quantity: 1,
            unit: 'Unit',
            condition: 'Baik',
            location: '',
            divisionId: editingSchedule.divisionId,
            divisionName: editingSchedule.divisionName,
            picUid: editingSchedule.picUid,
            picName: editingSchedule.picName,
            plateOrSerial: editingSchedule.plateOrSerial,
            brandModel: '',
            purchaseDate: '',
            currentOdometerKm: 0,
            notes: '',
            isPublic: editingSchedule.isPublic,
            viewerUids: editingSchedule.viewerUids,
            createdByUid: editingSchedule.createdByUid,
            createdByName: editingSchedule.createdByName,
          } as CompanyAsset)
        : undefined);
    if (!targetAsset) {
      setErrorMsg('Pilih aset yang valid untuk jadwal maintenance.');
      return;
    }
    if (!schDueDate) {
      setErrorMsg('Tanggal batas waktu / jatuh tempo wajib diisi.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const picObj = directory.find((m) => m.uid === schPicUid);
      if (editingSchedule) {
        const updated = await updateMaintenanceSchedule({
          schedule: editingSchedule,
          updates: {
            maintenanceType: schType,
            title: schTitle.trim() || MAINTENANCE_TYPE_PRESETS[schType].defaultTitle,
            dueDate: schDueDate,
            intervalMonths: Number(schIntervalMonths) || 0,
            intervalKm: Number(schIntervalKm) || 0,
            targetOdometerKm: Number(schTargetOdo) || 0,
            reminderDaysBefore: Number(schReminderDays) || 14,
            status: schStatus,
            estimatedCost: Number(schCost) || 0,
            vendorName: schVendor.trim(),
            picUid: picObj?.uid || schPicUid || user.uid,
            picName: picObj?.displayName || editingSchedule.picName || user.displayName,
            notes: schNotes.trim(),
          },
          actor: user,
          directory,
          idToken,
        });
        onSchedulesChange(
          sortMaintenanceSchedules(schedules.map((x) => (x.id === updated.id ? updated : x)))
        );
        setNoticeMsg(`Jadwal "${updated.title}" berhasil diperbarui.`);
      } else {
        const created = await createMaintenanceSchedule({
          input: {
            asset: targetAsset,
            maintenanceType: schType,
            title: schTitle.trim() || `${MAINTENANCE_TYPE_PRESETS[schType].defaultTitle} — ${targetAsset.name}`,
            dueDate: schDueDate,
            intervalMonths: Number(schIntervalMonths) || 0,
            intervalKm: Number(schIntervalKm) || 0,
            targetOdometerKm: Number(schTargetOdo) || 0,
            reminderDaysBefore: Number(schReminderDays) || 14,
            estimatedCost: Number(schCost) || 0,
            vendorName: schVendor.trim(),
            picUid: picObj?.uid || schPicUid || targetAsset.picUid || user.uid,
            picName: picObj?.displayName || targetAsset.picName || user.displayName,
            notes: schNotes.trim(),
          },
          actor: user,
          directory,
          idToken,
        });
        onSchedulesChange(sortMaintenanceSchedules([created, ...schedules]));
        setNoticeMsg(`Jadwal maintenance untuk ${created.assetName} berhasil ditambahkan.`);
      }
      setScheduleModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan jadwal maintenance.');
    } finally {
      setSaving(false);
    }
  };

  const openCompleteModal = (s: AssetMaintenanceSchedule) => {
    const relatedAsset = assets.find((a) => a.id === s.assetId);
    setCompletingSchedule(s);
    setCompDate(formatIsoDateLocal(new Date()));
    setCompVendor(s.vendorName || '');
    setCompCost(String(s.estimatedCost || 0));
    setCompOdometer(String(relatedAsset?.currentOdometerKm || s.targetOdometerKm || 0));
    setCompNotes('');
    setCompAutoRollover(s.intervalMonths > 0);
    setErrorMsg(null);
  };

  const handleConfirmComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingSchedule) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const relatedAsset = assets.find((a) => a.id === completingSchedule.assetId);
      const { schedule: updatedSchedule, updatedAsset } = await completeMaintenanceSchedule({
        schedule: completingSchedule,
        asset: relatedAsset,
        completedDate: compDate,
        vendorName: compVendor,
        actualCost: Number(compCost) || 0,
        odometerKm: Number(compOdometer) || 0,
        notes: compNotes,
        autoRollover: compAutoRollover,
        actor: user,
        directory,
        idToken,
      });

      onSchedulesChange(
        sortMaintenanceSchedules(
          schedules.map((x) => (x.id === updatedSchedule.id ? updatedSchedule : x))
        )
      );
      if (updatedAsset) {
        onAssetsChange(sortAssets(assets.map((a) => (a.id === updatedAsset.id ? updatedAsset : a))));
      }
      setNoticeMsg(
        compAutoRollover && completingSchedule.intervalMonths > 0
          ? `Maintenance dicatat selesai. Siklus berikutnya otomatis dijadwalkan ke ${formatDateId(
              updatedSchedule.dueDate
            )}.`
          : `Maintenance "${completingSchedule.title}" telah ditandai selesai.`
      );
      setCompletingSchedule(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyelesaikan jadwal maintenance.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAssetConfirmed = async () => {
    if (!confirmDeleteAsset) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const related = schedules.filter((s) => s.assetId === confirmDeleteAsset.id);
      await deleteCompanyAsset({
        asset: confirmDeleteAsset,
        relatedSchedules: related,
        actor: user,
        directory,
        idToken,
      });
      onAssetsChange(assets.filter((a) => a.id !== confirmDeleteAsset.id));
      onSchedulesChange(schedules.filter((s) => s.assetId !== confirmDeleteAsset.id));
      setNoticeMsg(`Aset ${confirmDeleteAsset.assetCode} telah dihapus.`);
      setConfirmDeleteAsset(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus aset.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteScheduleConfirmed = async () => {
    if (!confirmDeleteSchedule) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await deleteMaintenanceSchedule({
        schedule: confirmDeleteSchedule,
        actor: user,
        directory,
        idToken,
      });
      onSchedulesChange(schedules.filter((s) => s.id !== confirmDeleteSchedule.id));
      setNoticeMsg(`Jadwal "${confirmDeleteSchedule.title}" telah dihapus.`);
      setConfirmDeleteSchedule(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus jadwal.');
    } finally {
      setSaving(false);
    }
  };

  const missingSampleCount = useMemo(() => {
    const existingCodes = new Set(assets.map((a) => a.assetCode.trim().toUpperCase()));
    return SAMPLE_ASSET_CODES.filter((code) => !existingCodes.has(code)).length;
  }, [assets]);

  const handleSeedSampleData = async () => {
    if (seedingLabel || !canWrite) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setSeedingLabel('Menyiapkan contoh data aset & jadwal...');
    try {
      const res = await seedSampleAssetsAndMaintenance({
        actor: user,
        divisions,
        directory,
        existingAssets: assets,
        existingSchedules: schedules,
        idToken,
        onProgress: (lbl) => setSeedingLabel(lbl),
      });
      onAssetsChange(res.assets);
      onSchedulesChange(res.schedules);
      if (res.createdAssetCount === 0 && res.createdScheduleCount === 0) {
        setNoticeMsg('Seluruh contoh data aset & jadwal maintenance uji AI sudah tersedia.');
      } else {
        setNoticeMsg(
          `Berhasil menambahkan ${res.createdAssetCount} entri aset & ${res.createdScheduleCount} jadwal maintenance uji AI tanpa duplikasi.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat contoh data aset.');
    } finally {
      setSeedingLabel(null);
    }
  };

  const kendaraanUnits = categoryTotals.get('Kendaraan')?.units || 0;
  const mejaUnits = categoryTotals.get('Meja')?.units || 0;
  const kursiUnits = categoryTotals.get('Kursi')?.units || 0;
  const bangunanUnits = categoryTotals.get('Bangunan')?.units || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[var(--text)]">
            {t('assets.title')}
          </h1>
          <div className="w-10 h-[3px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)] pt-0.5">
            {t('assets.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canWrite && subTab !== 'erp' && (assets.length === 0 || missingSampleCount > 0) && (
            <button
              type="button"
              disabled={Boolean(seedingLabel)}
              onClick={handleSeedSampleData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-lg hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {seedingLabel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Database className="w-3.5 h-3.5" />
              )}
              <span>
                {seedingLabel ||
                  (assets.length === 0
                    ? 'Muat Contoh Data Aset (Uji AI)'
                    : `Lengkapi Contoh Uji AI (+${missingSampleCount})`)}
              </span>
            </button>
          )}
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => openCreateScheduleModal()}
                disabled={allSchedulableAssets.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Jadwalkan Maintenance</span>
              </button>
              <button
                type="button"
                onClick={() => openCreateAssetModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Aset Manual</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {errorMsg && (
        <div className="bg-[var(--danger-soft)] dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-lg px-4 py-2.5 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 dark:text-rose-300 font-medium hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}
      {noticeMsg && (
        <div className="bg-[var(--success-soft)] dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 rounded-lg px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span>{noticeMsg}</span>
          <button
            type="button"
            onClick={() => setNoticeMsg(null)}
            className="text-emerald-700 dark:text-emerald-300 font-medium hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* 4-Column KPI Summary Strip (Shown on non-ERP tabs; ERP tab has its own dedicated Valuation/NBV KPI strip) */}
      {subTab !== 'erp' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Unit Aset Manual</p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
              {totalUnits.toLocaleString('id-ID')}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {assets.length} entri manual{erpAssetsData ? ` · ${erpAssetsData.kpi.totalAssets} aset ERP` : ''}
            </p>
          </div>

          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Kategori Utama
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-slate-600 dark:text-slate-300">
                Kendaraan:{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {kendaraanUnits}
                </strong>
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Bangunan:{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {bangunanUnits}
                </strong>
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Meja:{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {mejaUnits}
                </strong>
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Kursi:{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {kursiUnits}
                </strong>
              </span>
            </div>
          </div>

          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Jadwal Perlu Tindakan
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`font-mono tabular-nums text-2xl font-bold ${
                  overdueCount > 0
                    ? 'text-rose-700 dark:text-rose-400'
                    : dueSoonCount > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {overdueCount + dueSoonCount}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">jadwal</span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {overdueCount} terlambat · {dueSoonCount} mendekati jatuh tempo
            </p>
          </div>

          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Estimasi Biaya (≤ 30 Hari)
            </p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
              {next30DaysBudget > 0 ? formatRupiah(next30DaysBudget) : 'Rp 0'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Total {schedules.length} jadwal terdaftar
            </p>
          </div>
        </div>
      )}

      {/* Ask AI Quick Prompts Strip */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 shrink-0">
          <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
          <span className="font-medium">Tanya AI langsung dari data aset ERP &amp; maintenance:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            'Ringkas total nilai perolehan, akumulasi penyusutan, dan sisa nilai buku aset tetap ERP per kategori',
            'Tampilkan daftar kendaraan di ERP lengkap dengan umur ekonomis dan sisa nilai bukunya',
            'Jadwal maintenance aset mana yang terlambat atau mendekati jatuh tempo?',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onAskAiQuestion(prompt)}
              className="text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 bg-[var(--surface-2)] dark:bg-slate-950 hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] dark:hover:text-[var(--accent)] border border-[var(--border)] dark:border-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter Bar (Shown on manual inventory / schedule tabs) */}
      {subTab !== 'erp' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                : 'bg-[var(--surface)] dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[var(--border)] dark:border-slate-800 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800'
            }`}
          >
            Semua Kategori{' '}
            <span className="font-mono tabular-nums opacity-75">({totalUnits})</span>
          </button>
          {ASSET_CATEGORIES.map((cat) => {
            const cnt = categoryTotals.get(cat)?.units || 0;
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]/40'
                    : 'bg-[var(--surface)] dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[var(--border)] dark:border-slate-800 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800'
                }`}
              >
                {cat} <span className="font-mono tabular-nums opacity-80">({cnt})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Container */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Sub-Tabs + Search & Filter Toolbar */}
        <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-slate-950 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubTab('erp')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'erp'
                  ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Aset Tetap ERP</span>
              {erpAssetsData && (
                <span className="font-mono tabular-nums text-[11px] opacity-75">
                  ({erpAssetsData.kpi.totalAssets})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('schedules')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'schedules'
                  ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Jadwal Maintenance</span>
              <span className="font-mono tabular-nums text-[11px] opacity-75">
                ({filteredSchedules.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('inventory')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'inventory'
                  ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Inventaris Manual</span>
              <span className="font-mono tabular-nums text-[11px] opacity-75">
                ({filteredAssets.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('timeline')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'timeline'
                  ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Timeline Bulanan</span>
            </button>
          </div>

          {subTab !== 'erp' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari aset, plat nomor, servis, KIR..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
              />
            </div>

            {subTab !== 'inventory' ? (
              <>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'all' | MaintenanceType)}
                  aria-label="Filter jenis maintenance"
                  className="px-2.5 py-1.5 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Semua Jenis</option>
                  {MAINTENANCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'all' | 'urgent' | MaintenanceStatus)
                  }
                  aria-label="Filter status jadwal"
                  className="px-2.5 py-1.5 text-xs bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Semua Status</option>
                  <option value="urgent">Perlu Tindakan (Terlambat & H-)</option>
                  {MAINTENANCE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => downloadMaintenanceCsv(filteredSchedules.map((x) => x.schedule))}
                  disabled={filteredSchedules.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Ekspor CSV</span>
                </button>
              </>
            ) : (
              <>
                <select
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value as 'all' | AssetCondition)}
                  aria-label="Filter kondisi aset"
                  className="px-2.5 py-1.5 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Semua Kondisi</option>
                  {ASSET_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => downloadAssetsCsv(filteredAssets)}
                  disabled={filteredAssets.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Ekspor CSV</span>
                </button>
              </>
            )}
          </div>
          )}
        </div>

        {/* SUB-TAB 0: LIVE ERP FIXED ASSETS (m7_asset + m7_asset_depreciation) */}
        {subTab === 'erp' ? (
          <div className="p-4">
            <ErpAssetsPanel
              idToken={idToken}
              schedules={schedules}
              canWrite={canWrite}
              onCreateScheduleForErpAsset={handleCreateScheduleForErpAsset}
              onAskAiQuestion={onAskAiQuestion}
              onDownloadBridge={downloadBridgeScript}
              initialData={erpAssetsData}
              onDataLoaded={setErpAssetsData}
              compactHeader
            />
          </div>
        ) : loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-10 rounded-lg bg-[var(--surface-3)] dark:bg-slate-800/60 animate-pulse"
              />
            ))}
          </div>
        ) : assets.length === 0 && schedules.length === 0 ? (
          /* Empty State */
          <div className="p-10 text-center max-w-lg mx-auto">
            <Wrench className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
            <h2 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Belum ada data aset dan jadwal maintenance
            </h2>
            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Mulai catat inventaris perusahaan (kendaraan, meja, kursi, bangunan, peralatan) beserta jadwal rutin servis, ganti oli, pajak STNK, dan uji KIR. Setelah terisi, karyawan maupun manajemen dapat langsung menanyakannya di menu Tanya AI.
            </p>
            {canWrite && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openCreateAssetModal()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Aset Pertama</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(seedingLabel)}
                  onClick={handleSeedSampleData}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  {seedingLabel ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Database className="w-3.5 h-3.5" />
                  )}
                  <span>{seedingLabel || 'Muat Contoh Data Aset'}</span>
                </button>
              </div>
            )}
          </div>
        ) : subTab === 'schedules' ? (
          /* SUB-TAB 1: MAINTENANCE SCHEDULES TABLE */
          filteredSchedules.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              <p>Tidak ada jadwal maintenance yang sesuai dengan filter saat ini.</p>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => openCreateScheduleModal()}
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Jadwal Maintenance</span>
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] dark:border-slate-800 bg-[var(--surface-2)]/70 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 whitespace-nowrap">Status & Jatuh Tempo</th>
                    <th className="py-2.5 px-4">Jenis & Rincian Jadwal</th>
                    <th className="py-2.5 px-4">Aset Terkait</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Siklus & Odometer</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Biaya</th>
                    <th className="py-2.5 px-4">Vendor & PIC</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {schedulesPaging.paginatedItems.map(({ schedule: s, eff }) => {
                    const isClosed =
                      eff.effectiveStatus === 'Selesai' || eff.effectiveStatus === 'Dibatalkan';
                    return (
                      <tr
                        key={s.id}
                        className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40 transition-colors align-top"
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {eff.effectiveStatus === 'Terlambat' && (
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                            )}
                            <span className={maintenanceStatusColorClass(eff.effectiveStatus)}>
                              {eff.effectiveStatus}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100 font-medium">
                            {formatDateId(s.dueDate)}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {eff.urgencyLabel}
                          </div>
                        </td>
                        <td className="py-3 px-4 min-w-[220px]">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {s.maintenanceType}
                          </div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                            {s.title}
                          </div>
                          {s.notes && (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                              {s.notes}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 min-w-[180px]">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {s.assetName}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{s.assetCode}</span>
                            {' · '}
                            <span>{s.assetCategory}</span>
                            {s.plateOrSerial ? ` · ${s.plateOrSerial}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono tabular-nums">
                          <div>
                            {s.intervalMonths > 0 ? `Per ${s.intervalMonths} bln` : 'Sekali jadwal'}
                            {s.intervalKm > 0
                              ? ` / ${s.intervalKm.toLocaleString('id-ID')} km`
                              : ''}
                          </div>
                          {s.targetOdometerKm > 0 && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Target: {s.targetOdometerKm.toLocaleString('id-ID')} km
                            </div>
                          )}
                          {s.lastCompletedDate && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Terakhir: {formatDateId(s.lastCompletedDate)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatRupiah(s.estimatedCost)}
                        </td>
                        <td className="py-3 px-4 min-w-[150px]">
                          <div className="text-slate-800 dark:text-slate-200">
                            {s.vendorName || '-'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            PIC: {s.picName || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {!isClosed && onSendReminder && (
                              <button
                                type="button"
                                onClick={() => triggerScheduleReminder(s)}
                                title={t('notifications.quickTrigger.remindPic')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] border border-[var(--accent)]/40 rounded-md transition-colors cursor-pointer"
                              >
                                <Send className="w-3 h-3" />
                                <span>Email / WA</span>
                              </button>
                            )}
                            {!isClosed && canCompleteSchedule(s) && (
                              <button
                                type="button"
                                onClick={() => openCompleteModal(s)}
                                title="Tandai selesai & jadwalkan siklus berikutnya"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[var(--success)] dark:text-emerald-300 bg-[var(--success-soft)] dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 rounded-md transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Selesai</span>
                              </button>
                            )}
                            {(s.history?.length || 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setHistorySchedule(s)}
                                title={`Lihat riwayat (${s.history.length})`}
                                className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canWrite && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditScheduleModal(s)}
                                  title="Edit jadwal"
                                  className="p-1.5 text-slate-500 hover:text-[var(--accent-text)] dark:text-slate-400 dark:hover:text-[var(--accent)] hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSchedule(s)}
                                  title="Hapus jadwal"
                                  className="p-1.5 text-slate-500 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <TablePaginationBar {...schedulesPaging.paginationProps} />
            </div>
          )
        ) : subTab === 'inventory' ? (
          /* SUB-TAB 2: ASSET INVENTORY TABLE */
          filteredAssets.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Tidak ada aset yang sesuai dengan filter pencarian saat ini.
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] dark:border-slate-800 bg-[var(--surface-2)]/70 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 whitespace-nowrap">Kode</th>
                    <th className="py-2.5 px-4">Nama Aset & Identitas</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Kategori</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Jumlah</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Kondisi</th>
                    <th className="py-2.5 px-4">Lokasi & Divisi</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">PIC & Jadwal</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {assetsPaging.paginatedItems.map((a) => {
                    const activeCount = activeScheduleCountByAsset.get(a.id) || 0;
                    return (
                      <tr
                        key={a.id}
                        className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40 transition-colors align-top"
                      >
                        <td className="py-3 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {a.assetCode}
                        </td>
                        <td className="py-3 px-4 min-w-[220px]">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {a.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {[
                              a.plateOrSerial ? `No. ${a.plateOrSerial}` : '',
                              a.brandModel,
                              a.currentOdometerKm > 0
                                ? `Odo ${a.currentOdometerKm.toLocaleString('id-ID')} km`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {a.category}
                          </div>
                          {a.subCategory && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {a.subCategory}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {a.quantity.toLocaleString('id-ID')}{' '}
                          <span className="font-sans font-normal text-slate-500 dark:text-slate-400">
                            {a.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`font-medium ${conditionColorClass(a.condition)}`}>
                            {a.condition}
                          </span>
                        </td>
                        <td className="py-3 px-4 min-w-[160px]">
                          <div className="text-slate-800 dark:text-slate-200">
                            {a.location || '-'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {a.divisionName || 'Umum'}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-200">
                            {a.picName || '-'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                            {activeCount > 0
                              ? `${activeCount} jadwal aktif`
                              : 'Belum ada jadwal'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openCreateScheduleModal(a)}
                                title="Tambah jadwal maintenance untuk aset ini"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-md transition-colors cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Jadwal</span>
                              </button>
                            )}
                            {canManageAsset(a) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditAssetModal(a)}
                                  title="Edit aset"
                                  className="p-1.5 text-slate-500 hover:text-[var(--accent-text)] dark:text-slate-400 dark:hover:text-[var(--accent)] hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAsset(a)}
                                  title="Hapus aset"
                                  className="p-1.5 text-slate-500 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <TablePaginationBar {...assetsPaging.paginationProps} />
            </div>
          )
        ) : (
          /* SUB-TAB 3: MONTHLY TIMELINE VIEW */
          <div className="p-5 space-y-6">
            {timelineGroups.length === 0 ? (
              <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-6">
                Tidak ada jadwal maintenance aktif untuk ditampilkan pada timeline.
              </p>
            ) : (
              timelineGroups.map((group) => (
                <section key={group.key} className="space-y-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[var(--border)] dark:border-slate-800">
                    <h3
                      className={`font-display text-sm font-semibold ${
                        group.isOverdue
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {group.label}
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {group.items.length} jadwal
                      {group.totalCost > 0 ? ` · Est. ${formatRupiah(group.totalCost)}` : ''}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {group.items.map(({ schedule: s, eff }) => (
                      <div
                        key={s.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                              {formatDateId(s.dueDate)}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className={maintenanceStatusColorClass(eff.effectiveStatus)}>
                              {eff.urgencyLabel}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="font-medium text-slate-600 dark:text-slate-300">
                              {s.maintenanceType}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {s.title}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{s.assetCode}</span> · {s.assetName}
                            {s.plateOrSerial ? ` (${s.plateOrSerial})` : ''}
                            {s.vendorName ? ` · Vendor: ${s.vendorName}` : ''}
                            {s.estimatedCost > 0 ? ` · ${formatRupiah(s.estimatedCost)}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {onSendReminder && (
                            <button
                              type="button"
                              onClick={() => triggerScheduleReminder(s)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] border border-[var(--accent)]/40 rounded-lg transition-colors cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{t('notifications.quickTrigger.remindPic')}</span>
                            </button>
                          )}
                          {canCompleteSchedule(s) && (
                            <button
                              type="button"
                              onClick={() => openCompleteModal(s)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[var(--success)] dark:text-emerald-300 bg-[var(--success-soft)] dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 rounded-lg cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Tandai Selesai</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: ADD / EDIT ASSET */}
      {assetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingAsset ? `Edit Aset ${editingAsset.assetCode}` : 'Tambah Aset Perusahaan'}
              </h2>
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAsset} className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Kategori Aset *
                  </label>
                  <select
                    value={assetCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value as AssetCategory;
                      setAssetCategory(nextCat);
                      if (!editingAsset) {
                        setAssetCode(suggestAssetCode(nextCat, assets));
                        setAssetUnit(defaultUnitForCategory(nextCat));
                        setAutoCreateVehiclePack(false);
                      }
                    }}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Kode Aset *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={assetCode}
                    onChange={(e) => setAssetCode(e.target.value)}
                    placeholder="KND-001 / MJ-001"
                    className="w-full px-3 py-2 font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sub-Kategori
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={assetSubCategory}
                    onChange={(e) => setAssetSubCategory(e.target.value)}
                    placeholder="Mobil Operasional / Truk Box"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nama Aset *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="Contoh: Toyota Avanza Veloz Operasional / Meja Kerja Staff"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Jumlah *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      required
                      value={assetQty}
                      onChange={(e) => setAssetQty(e.target.value)}
                      className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Satuan *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={30}
                      value={assetUnit}
                      onChange={(e) => setAssetUnit(e.target.value)}
                      placeholder="Unit / Buah"
                      className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {assetCategory === 'Kendaraan' ? 'Nomor Polisi (Plat)' : 'Nomor Seri / Sertifikat'}
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={assetPlateSerial}
                    onChange={(e) => setAssetPlateSerial(e.target.value)}
                    placeholder={assetCategory === 'Kendaraan' ? 'B 1234 ABC' : 'SN / SHGB / IMB'}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Merek / Model / Luas
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={assetBrandModel}
                    onChange={(e) => setAssetBrandModel(e.target.value)}
                    placeholder="Toyota 2023 / 1.250 m²"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Kondisi
                  </label>
                  <select
                    value={assetCondition}
                    onChange={(e) => setAssetCondition(e.target.value as AssetCondition)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Lokasi Penempatan
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={assetLocation}
                    onChange={(e) => setAssetLocation(e.target.value)}
                    placeholder="Pool Kantor Pusat / Lt. 2"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Divisi Pengelola
                  </label>
                  <select
                    value={assetDivId}
                    onChange={(e) => setAssetDivId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Umum / Lintas Divisi</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Penanggung Jawab (PIC)
                  </label>
                  <select
                    value={assetPicUid}
                    onChange={(e) => setAssetPicUid(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {directory.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.displayName} ({m.divisionName || 'Umum'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Perolehan
                  </label>
                  <input
                    type="date"
                    value={assetPurchaseDate}
                    onChange={(e) => setAssetPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                {assetCategory === 'Kendaraan' && (
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Odometer Saat Ini (KM)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10000000}
                      value={assetOdometer}
                      onChange={(e) => setAssetOdometer(e.target.value)}
                      className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Tambahan
                </label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={assetNotes}
                  onChange={(e) => setAssetNotes(e.target.value)}
                  placeholder="Informasi spesifikasi, kelengkapan dokumen, atau ketentuan pemakaian..."
                  className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {!editingAsset && assetCategory === 'Kendaraan' && (
                <div className="p-3.5 bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-lg space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateVehiclePack}
                      onChange={(e) => setAutoCreateVehiclePack(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--border-strong)] text-[var(--accent-text)] focus:ring-[var(--accent)]/25"
                    />
                    <span className="text-slate-800 dark:text-slate-200">
                      <strong>Buat paket jadwal kendaraan otomatis</strong> (Ganti Oli per 3 bln/5.000 km, Servis Berkala per 6 bln/10.000 km, dan Pajak STNK Tahunan)
                    </span>
                  </label>
                  {autoCreateVehiclePack && (
                    <label className="flex items-center gap-2.5 pl-6 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeKirInPack}
                        onChange={(e) => setIncludeKirInPack(e.target.checked)}
                        className="rounded border-[var(--border-strong)] text-[var(--accent-text)] focus:ring-[var(--accent)]/25"
                      />
                      <span className="text-slate-700 dark:text-slate-300">
                        Sertakan jadwal <strong>Uji KIR</strong> 6 bulanan (untuk kendaraan niaga / truk / box)
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-[var(--border)] dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAssetModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingAsset ? 'Simpan Perubahan' : 'Simpan Aset'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD / EDIT MAINTENANCE SCHEDULE */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingSchedule ? 'Edit Jadwal Maintenance' : 'Jadwalkan Maintenance Aset'}
              </h2>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Aset Terkait *
                  </label>
                  <select
                    value={schAssetId}
                    disabled={Boolean(editingSchedule)}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSchAssetId(nextId);
                      const found = allSchedulableAssets.find((a) => a.id === nextId);
                      if (found && !editingSchedule) {
                        setSchTitle(
                          `${MAINTENANCE_TYPE_PRESETS[schType].defaultTitle} — ${found.name}`
                        );
                        setSchPicUid(found.picUid || user.uid);
                      }
                    }}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    {editingSchedule &&
                      !allSchedulableAssets.some((a) => a.id === editingSchedule.assetId) && (
                        <option value={editingSchedule.assetId}>
                          [{editingSchedule.assetCode}] {editingSchedule.assetName}
                          {editingSchedule.plateOrSerial
                            ? ` (${editingSchedule.plateOrSerial})`
                            : ''}
                        </option>
                      )}
                    {erpVirtualAssets.length > 0 && (
                      <optgroup label="Aset Tetap ERP">
                        {erpVirtualAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            [{a.assetCode}] {a.name}
                            {a.plateOrSerial ? ` (${a.plateOrSerial})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {assets.length > 0 && (
                      <optgroup label="Inventaris Manual">
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            [{a.assetCode}] {a.name}
                            {a.plateOrSerial ? ` (${a.plateOrSerial})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Jenis Maintenance *
                  </label>
                  <select
                    value={schType}
                    onChange={(e) =>
                      handleMaintenanceTypeChange(e.target.value as MaintenanceType)
                    }
                    className="w-full px-3 py-2 bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {MAINTENANCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Judul / Deskripsi Singkat Jadwal *
                </label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={schTitle}
                  onChange={(e) => setSchTitle(e.target.value)}
                  placeholder="Contoh: Ganti Oli Mesin & Filter / Bayar Pajak STNK Tahunan / Uji KIR"
                  className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Batas Waktu / Jatuh Tempo *
                  </label>
                  <input
                    type="date"
                    required
                    value={schDueDate}
                    onChange={(e) => setSchDueDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Dikosongkan otomatis agar diisi sesuai STNK / kartu oli / jadwal asli
                  </span>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Siklus Berulang (Bulan)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={schIntervalMonths}
                    onChange={(e) => setSchIntervalMonths(e.target.value)}
                    placeholder="0 = sekali"
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    3 = Ganti oli · 6 = KIR/Servis · 12 = Pajak · 0 = Sekali
                  </span>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Pengingat (Hari Sebelum)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={schReminderDays}
                    onChange={(e) => setSchReminderDays(e.target.value)}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Interval Odometer (KM)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={500000}
                    value={schIntervalKm}
                    onChange={(e) => setSchIntervalKm(e.target.value)}
                    placeholder="5000 / 10000"
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Target Odometer Berikut (KM)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000000}
                    value={schTargetOdo}
                    onChange={(e) => setSchTargetOdo(e.target.value)}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Estimasi Biaya (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000000000}
                    value={schCost}
                    onChange={(e) => setSchCost(e.target.value)}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Bengkel / Vendor / Samsat / Dishub
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={schVendor}
                    onChange={(e) => setSchVendor(e.target.value)}
                    placeholder="Auto2000 / Samsat Bekasi / UPTD Dishub Uji KIR"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PIC Pelaksana
                  </label>
                  <select
                    value={schPicUid}
                    onChange={(e) => setSchPicUid(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {directory.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editingSchedule && (
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Status Jadwal
                  </label>
                  <select
                    value={schStatus}
                    onChange={(e) => setSchStatus(e.target.value as MaintenanceStatus)}
                    className="w-full sm:w-64 px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {MAINTENANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Catatan / Persyaratan Dokumen
                </label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={schNotes}
                  onChange={(e) => setSchNotes(e.target.value)}
                  placeholder="Misal: Bawa STNK asli, kartu uji KIR lama, atau cek kampas rem..."
                  className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="pt-3 border-t border-[var(--border)] dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingSchedule ? 'Simpan Perubahan' : 'Simpan Jadwal'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: COMPLETE MAINTENANCE + AUTO ROLLOVER */}
      {completingSchedule && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl w-full max-w-lg">
            <div className="px-5 py-4 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Catat Penyelesaian Maintenance
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {completingSchedule.assetCode} · {completingSchedule.assetName} —{' '}
                  {completingSchedule.maintenanceType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompletingSchedule(null)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmComplete} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Selesai *
                  </label>
                  <input
                    type="date"
                    required
                    value={compDate}
                    onChange={(e) => setCompDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Biaya Aktual (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={compCost}
                    onChange={(e) => setCompCost(e.target.value)}
                    className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Vendor / Bengkel / Instansi
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={compVendor}
                    onChange={(e) => setCompVendor(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                {completingSchedule.assetCategory === 'Kendaraan' && (
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Odometer Saat Servis (KM)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={compOdometer}
                      onChange={(e) => setCompOdometer(e.target.value)}
                      className="w-full px-3 py-2 font-mono tabular-nums bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Hasil Pekerjaan / No. Kwitansi
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  placeholder="Contoh: Oli diganti 4L + filter oli, STNK sudah disahkan..."
                  className="w-full px-3 py-2 bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {completingSchedule.intervalMonths > 0 && (
                <div className="p-3 bg-[var(--success-soft)] dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 rounded-lg">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={compAutoRollover}
                      onChange={(e) => setCompAutoRollover(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--border-strong)] text-emerald-600"
                    />
                    <span className="text-slate-800 dark:text-slate-200">
                      Jadwalkan otomatis siklus berikutnya (
                      <strong>+{completingSchedule.intervalMonths} bulan</strong> →{' '}
                      <span className="font-mono font-semibold">
                        {formatDateId(addMonthsIso(compDate || formatIsoDateLocal(new Date()), completingSchedule.intervalMonths))}
                      </span>
                      )
                    </span>
                  </label>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--border)] dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCompletingSchedule(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Konfirmasi Selesai</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: MAINTENANCE HISTORY LOG */}
      {historySchedule && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Riwayat Maintenance
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {historySchedule.title} ({historySchedule.assetCode})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistorySchedule(null)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {(historySchedule.history || []).map((entry) => (
                <div key={entry.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {formatDateId(entry.completedDate)}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatRupiah(entry.cost)}
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    Vendor: {entry.vendorName || '-'} · Dicatat oleh: {entry.performedByName}
                    {entry.odometerKm > 0
                      ? ` · Odometer: ${entry.odometerKm.toLocaleString('id-ID')} km`
                      : ''}
                  </div>
                  {entry.notes && (
                    <p className="text-slate-700 dark:text-slate-300">{entry.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODALS */}
      <DeleteConfirmModal
        open={Boolean(confirmDeleteAsset)}
        title={confirmDeleteAsset ? `Hapus Aset ${confirmDeleteAsset.assetCode}?` : 'Hapus Aset?'}
        description={
          confirmDeleteAsset ? (
            <>
              Aset <strong>{confirmDeleteAsset.name}</strong> beserta seluruh jadwal maintenance
              yang terhubung akan dihapus permanen dari sistem.
            </>
          ) : null
        }
        details={
          confirmDeleteAsset
            ? [
                { label: 'Kode Aset', value: confirmDeleteAsset.assetCode },
                { label: 'Nama Aset', value: confirmDeleteAsset.name },
                {
                  label: 'Kategori & Lokasi',
                  value: [confirmDeleteAsset.category, confirmDeleteAsset.location]
                    .filter(Boolean)
                    .join(' · '),
                },
              ]
            : undefined
        }
        confirmLabel="Hapus Aset"
        loading={saving}
        onCancel={() => setConfirmDeleteAsset(null)}
        onConfirm={handleDeleteAssetConfirmed}
      />

      <DeleteConfirmModal
        open={Boolean(confirmDeleteSchedule)}
        title="Hapus Jadwal Maintenance?"
        description={
          confirmDeleteSchedule ? (
            <>
              Jadwal maintenance <strong>{confirmDeleteSchedule.title}</strong> akan dihapus
              permanen dari daftar perawatan aset.
            </>
          ) : null
        }
        details={
          confirmDeleteSchedule
            ? [
                { label: 'Judul Jadwal', value: confirmDeleteSchedule.title },
                {
                  label: 'Aset Terkait',
                  value: [confirmDeleteSchedule.assetCode, confirmDeleteSchedule.assetName]
                    .filter(Boolean)
                    .join(' — '),
                },
                { label: 'Jatuh Tempo', value: formatDateId(confirmDeleteSchedule.dueDate) },
              ]
            : undefined
        }
        confirmLabel="Hapus Jadwal"
        loading={saving}
        onCancel={() => setConfirmDeleteSchedule(null)}
        onConfirm={handleDeleteScheduleConfirmed}
      />
    </div>
  );
}
