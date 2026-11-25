import type {
  AssetCategory,
  AssetMaintenanceSchedule,
  CompanyAsset,
  MaintenanceStatus,
} from '../src/types/sop.ts';

const ASSET_MAINTENANCE_INTENT_REGEX =
  /\b(aset|asset|inventaris|inventori|kendaraan|mobil|motor|truk|armada|plat\s*nomor|nopol|meja|kursi|bangunan|gedung|gudang|furnitur|furniture|peralatan|mesin|maintenance|perawatan|pemeliharaan|servis|service|oli|ganti\s*oli|pajak|stnk|kir|uji\s*kir|asuransi|odometer|kilometer|\bkm\b|jatuh\s*tempo|jadwal\s*servis|jadwal\s*pajak|jadwal\s*kir|apar|genset|\bac\b)\b/i;

export function isAssetMaintenanceQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  if (ASSET_MAINTENANCE_INTENT_REGEX.test(question)) {
    return true;
  }
  // Check last 2 turns for short follow-up questions (e.g., "kalau pajaknya kapan?", "totalnya berapa?")
  const wordCount = question.trim().split(/\s+/).length;
  if (wordCount <= 10 && history.length > 0) {
    const recentText = history
      .slice(-3)
      .map((m) => m.content)
      .join(' ');
    if (ASSET_MAINTENANCE_INTENT_REGEX.test(recentText)) {
      return true;
    }
  }
  return false;
}

function computeEffectiveStatusServer(
  schedule: AssetMaintenanceSchedule,
  todayStartMs: number
): {
  effectiveStatus: MaintenanceStatus;
  daysUntilDue: number;
  urgencyText: string;
} {
  if (schedule.status === 'Selesai') {
    return { effectiveStatus: 'Selesai', daysUntilDue: 0, urgencyText: 'Selesai' };
  }
  if (schedule.status === 'Dibatalkan') {
    return { effectiveStatus: 'Dibatalkan', daysUntilDue: 0, urgencyText: 'Dibatalkan' };
  }
  const parsed = new Date(`${schedule.dueDate}T00:00:00`);
  const dueStart = Number.isNaN(parsed.getTime()) ? todayStartMs : parsed.getTime();
  const daysUntilDue = Math.round((dueStart - todayStartMs) / 86_400_000);
  if (daysUntilDue < 0) {
    return {
      effectiveStatus: 'Terlambat',
      daysUntilDue,
      urgencyText: `TERLAMBAT ${Math.abs(daysUntilDue)} hari`,
    };
  }
  if (daysUntilDue === 0) {
    return {
      effectiveStatus: 'Mendekati Jatuh Tempo',
      daysUntilDue: 0,
      urgencyText: 'JATUH TEMPO HARI INI',
    };
  }
  const lead = Math.max(1, schedule.reminderDaysBefore || 14);
  if (daysUntilDue <= lead) {
    return {
      effectiveStatus: 'Mendekati Jatuh Tempo',
      daysUntilDue,
      urgencyText: `H-${daysUntilDue} hari lagi`,
    };
  }
  return {
    effectiveStatus: 'Terjadwal',
    daysUntilDue,
    urgencyText: `${daysUntilDue} hari lagi`,
  };
}

function formatDateIdServer(isoDate: string): string {
  if (!isoDate) return '-';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export interface AssetMaintenanceAiContext {
  totalAssetRecords: number;
  totalAssetUnits: number;
  totalSchedules: number;
  summaryText: string;
}

const ORDERED_CATEGORIES: AssetCategory[] = [
  'Kendaraan',
  'Meja',
  'Kursi',
  'Bangunan',
  'Elektronik & IT',
  'Mesin & Peralatan',
  'Lainnya',
];

export function buildAssetMaintenanceAiContext(
  assets: CompanyAsset[],
  schedules: AssetMaintenanceSchedule[]
): AssetMaintenanceAiContext {
  const now = new Date();
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayLabel = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const totalAssetRecords = assets.length;
  const totalAssetUnits = assets.reduce((sum, a) => sum + Math.max(1, Number(a.quantity) || 1), 0);

  if (assets.length === 0 && schedules.length === 0) {
    return {
      totalAssetRecords: 0,
      totalAssetUnits: 0,
      totalSchedules: 0,
      summaryText: [
        `Tanggal Hari Ini: ${todayLabel}`,
        'Status Data Aset & Maintenance: BELUM ADA DATA ASET atau JADWAL MAINTENANCE yang tercatat di sistem saat ini.',
        'Saran: Arahkan pengguna untuk menambahkan data aset & jadwal maintenance (atau klik "Muat Contoh Data Aset") di menu "Aset & Maintenance".',
      ].join('\n'),
    };
  }

  // Category aggregation
  const catStats = new Map<AssetCategory, { units: number; records: number }>();
  for (const cat of ORDERED_CATEGORIES) {
    catStats.set(cat, { units: 0, records: 0 });
  }
  const conditionCounts: Record<string, number> = {};
  for (const a of assets) {
    const qty = Math.max(1, Number(a.quantity) || 1);
    const current = catStats.get(a.category) || { units: 0, records: 0 };
    current.units += qty;
    current.records += 1;
    catStats.set(a.category, current);
    conditionCounts[a.condition] = (conditionCounts[a.condition] || 0) + qty;
  }

  const categoryLines = ORDERED_CATEGORIES.map((cat) => {
    const st = catStats.get(cat)!;
    return `- ${cat}: ${st.units} unit (${st.records} entri aset)`;
  });

  const conditionSummary = Object.entries(conditionCounts)
    .map(([cond, cnt]) => `${cond}: ${cnt} unit`)
    .join(' | ');

  // Detailed assets (up to 120 items)
  const assetLines = assets.slice(0, 120).map((a, idx) => {
    const extras: string[] = [];
    if (a.plateOrSerial) extras.push(`Plat/Seri: ${a.plateOrSerial}`);
    if (a.brandModel) extras.push(`Model: ${a.brandModel}`);
    if (a.currentOdometerKm > 0) {
      extras.push(`Odometer: ${a.currentOdometerKm.toLocaleString('id-ID')} km`);
    }
    if (a.location) extras.push(`Lokasi: ${a.location}`);
    if (a.divisionName) extras.push(`Divisi: ${a.divisionName}`);
    if (a.picName) extras.push(`PIC: ${a.picName}`);
    return `${idx + 1}. [${a.assetCode}] ${a.name} | Kategori: ${a.category}${
      a.subCategory ? ` (${a.subCategory})` : ''
    } | Jumlah: ${a.quantity} ${a.unit} | Kondisi: ${a.condition}${
      extras.length ? ` | ${extras.join(' | ')}` : ''
    }`;
  });

  // Sort schedules by urgency then date
  const rankOrder: Record<MaintenanceStatus, number> = {
    Terlambat: 0,
    'Mendekati Jatuh Tempo': 1,
    Terjadwal: 2,
    Selesai: 3,
    Dibatalkan: 4,
  };
  const enrichedSchedules = schedules
    .map((s) => ({
      schedule: s,
      eff: computeEffectiveStatusServer(s, todayStartMs),
    }))
    .sort((a, b) => {
      if (rankOrder[a.eff.effectiveStatus] !== rankOrder[b.eff.effectiveStatus]) {
        return rankOrder[a.eff.effectiveStatus] - rankOrder[b.eff.effectiveStatus];
      }
      return a.schedule.dueAtMs - b.schedule.dueAtMs;
    });

  const overdueCount = enrichedSchedules.filter((x) => x.eff.effectiveStatus === 'Terlambat').length;
  const dueSoonCount = enrichedSchedules.filter(
    (x) => x.eff.effectiveStatus === 'Mendekati Jatuh Tempo'
  ).length;
  const scheduledCount = enrichedSchedules.filter(
    (x) => x.eff.effectiveStatus === 'Terjadwal'
  ).length;

  const scheduleLines = enrichedSchedules.slice(0, 120).map(({ schedule: s, eff }, idx) => {
    const cycleParts: string[] = [];
    if (s.intervalMonths > 0) cycleParts.push(`Setiap ${s.intervalMonths} bulan`);
    if (s.intervalKm > 0) cycleParts.push(`Setiap ${s.intervalKm.toLocaleString('id-ID')} km`);
    const cycleText = cycleParts.length ? cycleParts.join(' / ') : 'Sekali jadwal';
    const costText =
      s.estimatedCost > 0 ? `Estimasi Biaya: Rp ${s.estimatedCost.toLocaleString('id-ID')}` : '';
    const odoText =
      s.targetOdometerKm > 0
        ? `Target Odometer: ${s.targetOdometerKm.toLocaleString('id-ID')} km`
        : '';
    const lastText = s.lastCompletedDate
      ? `Terakhir Selesai: ${formatDateIdServer(s.lastCompletedDate)}`
      : '';
    const extras = [
      s.plateOrSerial ? `Plat/Seri: ${s.plateOrSerial}` : '',
      `Siklus: ${cycleText}`,
      odoText,
      costText,
      s.vendorName ? `Vendor/Lokasi: ${s.vendorName}` : '',
      s.picName ? `PIC: ${s.picName}` : '',
      lastText,
      s.notes ? `Catatan: ${s.notes}` : '',
    ].filter(Boolean);

    return `${idx + 1}. [${eff.effectiveStatus} — ${eff.urgencyText}] ${s.maintenanceType}: ${
      s.title
    } | Aset: ${s.assetCode} - ${s.assetName} (${s.assetCategory}) | Jatuh Tempo: ${formatDateIdServer(
      s.dueDate
    )} (${s.dueDate}) | ${extras.join(' | ')}`;
  });

  const summaryText = [
    `TANGGAL HARI INI: ${todayLabel}`,
    `RINGKASAN TOTAL ASET PERUSAHAAN:`,
    `- Total Seluruh Unit Aset: ${totalAssetUnits} unit (dari ${totalAssetRecords} entri aset terdaftar)`,
    `- Kondisi Aset: ${conditionSummary || '-'}`,
    `REKAP JUMLAH ASET PER KATEGORI:`,
    ...categoryLines,
    ``,
    `DAFTAR RINCIAN INVENTARIS ASET:`,
    ...(assetLines.length ? assetLines : ['(Belum ada aset terdaftar)']),
    ``,
    `RINGKASAN JADWAL MAINTENANCE ASET:`,
    `- Total Jadwal: ${schedules.length} | Terlambat: ${overdueCount} | Mendekati Jatuh Tempo: ${dueSoonCount} | Terjadwal: ${scheduledCount}`,
    `DAFTAR JADWAL MAINTENANCE (DIURUTKAN DARI PALING MENDESAK):`,
    ...(scheduleLines.length ? scheduleLines : ['(Belum ada jadwal maintenance terdaftar)']),
  ].join('\n');

  return {
    totalAssetRecords,
    totalAssetUnits,
    totalSchedules: schedules.length,
    summaryText,
  };
}
