import type { AccessLevel, SopAttachment, SopSection, SopStatus } from '../types/sop';

export interface SeedDivision {
  id: string;
  name: string;
  code: string;
  description: string;
  suggestedQuestions: string[];
}

export interface SeedDepartment {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  code: string;
  description: string;
}

export interface SeedSopTemplate {
  id: string;
  docNumber: string;
  title: string;
  divisionId: string;
  divisionName: string;
  departmentId: string;
  departmentName: string;
  purpose: string;
  scope: string;
  relatedRoles: string[];
  sections: SopSection[];
  attachments: SopAttachment[];
  effectiveDate: string;
  nextReviewDate: string;
  status: SopStatus;
  accessLevel: AccessLevel;
  assignOwner: boolean;
}

export const SEED_DIVISIONS: SeedDivision[] = [
  {
    id: 'div_fin',
    name: 'Keuangan & Akuntansi',
    code: 'FIN',
    description: 'Pengelolaan reimbursement, kas, penganggaran, perpajakan, dan audit internal perusahaan.',
    suggestedQuestions: [
      'Bagaimana cara mengajukan reimbursement perjalanan dinas?',
      'Berapa batas maksimal klaim hotel dan uang makan perjalanan dinas?',
      'Kapan batas waktu penyerahan bukti transaksi reimbursement?',
    ],
  },
  {
    id: 'div_log',
    name: 'Pengadaan & Logistik',
    code: 'LOG',
    description: 'Manajemen inventaris gudang, stok minimum, pembelian barang/jasa, dan evaluasi vendor.',
    suggestedQuestions: [
      'Kalau stok barang kurang dari minimum, siapa yang harus saya hubungi?',
      'Berapa batas persetujuan pembelian tanpa tender?',
      'Apakah pembelian Rp12 juta di cabang boleh disetujui dengan 1 penawaran tanpa Finance Manager?',
    ],
  },
  {
    id: 'div_hrd',
    name: 'HR & Operasional',
    code: 'HRD',
    description: 'Kebijakan cuti, onboarding karyawan, absensi, keselamatan kerja, dan administrasi SDM.',
    suggestedQuestions: [
      'Bagaimana prosedur pengajuan cuti tahunan dan persetujuannya?',
      'Berapa hari hak cuti khusus untuk karyawan yang menikah atau melahirkan?',
      'Bagaimana aturan WFH dan tunjangan internet karyawan?',
    ],
  },
  {
    id: 'div_it',
    name: 'IT & Keamanan',
    code: 'ITS',
    description: 'Keamanan informasi, manajemen akses sistem, respons insiden siber, dan dukungan perangkat.',
    suggestedQuestions: [
      'Apa langkah pertama jika terjadi dugaan kebocoran data atau akun diretas?',
      'Berapa lama SLA pelaporan insiden keamanan kritis?',
    ],
  },
];

export const SEED_DEPARTMENTS: SeedDepartment[] = [
  {
    id: 'dept_fin_ap',
    divisionId: 'div_fin',
    divisionName: 'Keuangan & Akuntansi',
    name: 'Treasury & Account Payable',
    code: 'FIN-AP',
    description: 'Memproses pembayaran vendor, uang muka, dan reimbursement karyawan.',
  },
  {
    id: 'dept_log_wh',
    divisionId: 'div_log',
    divisionName: 'Pengadaan & Logistik',
    name: 'Gudang & Kontrol Inventaris',
    code: 'LOG-WH',
    description: 'Pemantauan stok minimum, penerimaan barang, dan distribusi operasional.',
  },
  {
    id: 'dept_log_prc',
    divisionId: 'div_log',
    divisionName: 'Pengadaan & Logistik',
    name: 'Procurement & Vendor Management',
    code: 'LOG-PRC',
    description: 'Proses pembelian langsung, seleksi vendor, dan tender resmi.',
  },
  {
    id: 'dept_hrd_ops',
    divisionId: 'div_hrd',
    divisionName: 'HR & Operasional',
    name: 'People Operations',
    code: 'HR-OPS',
    description: 'Administrasi cuti, izin, payroll, dan kesejahteraan karyawan.',
  },
  {
    id: 'dept_it_sec',
    divisionId: 'div_it',
    divisionName: 'IT & Keamanan',
    name: 'Information Security & SOC',
    code: 'IT-SEC',
    description: 'Pengendalian akses rahasia dan penanganan insiden keamanan siber.',
  },
];

export const SEED_SOPS: SeedSopTemplate[] = [
  {
    id: 'sop_fin_001',
    docNumber: 'SOP-FIN-001',
    title: 'Prosedur Pengajuan Reimbursement Perjalanan Dinas',
    divisionId: 'div_fin',
    divisionName: 'Keuangan & Akuntansi',
    departmentId: 'dept_fin_ap',
    departmentName: 'Treasury & Account Payable',
    purpose: 'Menetapkan tata cara pengajuan, verifikasi, dan pencairan penggantian biaya perjalanan dinas karyawan agar akuntabel dan tepat waktu.',
    scope: 'Berlaku bagi seluruh karyawan tetap dan kontrak yang melakukan perjalanan dinas resmi dengan surat tugas yang disetujui.',
    relatedRoles: ['Karyawan Pemohon', 'Atasan Langsung (Manager)', 'Staff Verifikasi Finance AP', 'Finance Manager'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Persiapan & Batas Waktu Pengajuan',
        content:
          '1. Pastikan Surat Tugas Perjalanan Dinas telah ditandatangani Atasan Langsung sebelum keberangkatan.\n2. Kumpulkan seluruh bukti transaksi asli (struk hotel, boarding pass/tiket, invoice taksi/BBM, dan bukti makan).\n3. Pengajuan wajib disubmit paling lambat 7 (tujuh) hari kerja setelah tanggal kepulangan. Klaim yang melewati 14 hari kerja tanpa alasan tertulis dari Kepala Divisi tidak dapat diproses.',
      },
      {
        id: 'sec_2',
        order: 2,
        title: 'Plafon Biaya Akomodasi & Uang Makan',
        content:
          '- Hotel Dalam Kota / Provinsi: Maksimal Rp750.000 per malam (setara bintang 3).\n- Hotel Luar Provinsi / Ibu Kota: Maksimal Rp1.100.000 per malam.\n- Uang Makan Harian: Maksimal Rp175.000 per hari (tidak termasuk alkohol/minibar).\n- Transportasi Lokal: Sesuai tarif riil taksi resmi atau transportasi online dengan melampirkan resi digital.',
      },
      {
        id: 'sec_3',
        order: 3,
        title: 'Langkah Pengajuan & Persetujuan di Sistem',
        content:
          '1. Isi Formulir FRM-FIN-012 (Rekap Biaya Perjalanan Dinas) melalui portal keuangan internal dan unggah scan seluruh struk dalam 1 file PDF.\n2. Ajukan ke Atasan Langsung untuk persetujuan substansi tugas (maksimal 2 hari kerja).\n3. Tim Finance AP memeriksa kelengkapan bukti dan kesesuaian plafon dalam 3 hari kerja.\n4. Dana reimbursement ditransfer ke rekening gaji karyawan setiap hari Selasa dan Jumat.',
      },
    ],
    attachments: [
      {
        id: 'att_1',
        name: 'FRM-FIN-012_Rekap_Reimbursement_Dinas.xlsx',
        fileType: 'XLSX',
        sizeLabel: '48 KB',
        extractedText: 'Formulir FRM-FIN-012 berisi kolom: Nomor Surat Tugas, Tanggal, Kota Tujuan, Kategori Biaya (Hotel/Makan/Transport), Nominal, Nomor Struk.',
      },
    ],
    effectiveDate: '2026-01-15',
    nextReviewDate: '2027-01-15',
    status: 'Disetujui',
    accessLevel: 'Umum',
    assignOwner: true,
  },
  {
    id: 'sop_log_002',
    docNumber: 'SOP-LOG-002',
    title: 'Penanganan Stok Barang di Bawah Batas Minimum & Eskalasi',
    divisionId: 'div_log',
    divisionName: 'Pengadaan & Logistik',
    departmentId: 'dept_log_wh',
    departmentName: 'Gudang & Kontrol Inventaris',
    purpose: 'Mencegah kehabisan stok (stock-out) untuk barang operasional dan material produksi dengan alur pelaporan cepat saat stok menyentuh batas minimum (ROP).',
    scope: 'Berlaku untuk seluruh gudang pusat, gudang cabang, tim kontrol inventaris, dan pemohon unit kerja.',
    relatedRoles: ['Staff Gudang', 'Inventory Controller', 'Koordinator Gudang (Warehouse Lead)', 'Buyer Procurement'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Deteksi & Pihak Pertama yang Harus Dihubungi',
        content:
          '1. Ketika jumlah fisik atau sistem menunjukkan stok berada di bawah Batas Minimum (Reorder Point / ROP), Staff Gudang atau pemohon WAJIB segera menghubungi **Inventory Controller** (PIC Kontrol Inventaris Gudang) maksimal dalam 2 jam kerja melalui kanal tiket Inventaris atau WhatsApp Grup Operasional Gudang.\n2. Jika Inventory Controller tidak merespons dalam 4 jam atau barang bersifat kritikal (menghentikan operasional harian), eskalasikan langsung ke **Koordinator Gudang (Warehouse Lead)**.',
      },
      {
        id: 'sec_2',
        order: 2,
        title: 'Verifikasi Fisik & Pembuatan Purchase Request (PR)',
        content:
          '1. Inventory Controller melakukan stock opname cepat pada SKU terkait untuk memastikan tidak ada selisih pencatatan.\n2. Jika stok aktual benar di bawah ROP, Koordinator Gudang menerbitkan Purchase Request (PR) bertanda "URGENT - BELOW ROP" ke Departemen Procurement & Vendor Management.\n3. Departemen Procurement wajib memproses PO kepada vendor terdaftar dalam waktu 1x24 jam sejak PR disetujui.',
      },
    ],
    attachments: [
      {
        id: 'att_2',
        name: 'FRM-LOG-004_Checklist_Stock_Minimum.pdf',
        fileType: 'PDF',
        sizeLabel: '124 KB',
        extractedText: 'Formulir eskalasi stok minimum mencatat Kode SKU, Nama Barang, Stok Aktual, Batas Minimum (ROP), dan Kebutuhan Harian.',
      },
    ],
    effectiveDate: '2026-02-01',
    nextReviewDate: '2027-02-01',
    status: 'Disetujui',
    accessLevel: 'Umum',
    assignOwner: true,
  },
  {
    id: 'sop_prc_003',
    docNumber: 'SOP-PRC-003',
    title: 'Batas Persetujuan Pembelian Tanpa Tender & Pengadaan Langsung',
    divisionId: 'div_log',
    divisionName: 'Pengadaan & Logistik',
    departmentId: 'dept_log_prc',
    departmentName: 'Procurement & Vendor Management',
    purpose: 'Mengatur jenjang kewenangan persetujuan pembelian barang dan jasa serta ambang batas nilai pengadaan tanpa proses tender terbuka.',
    scope: 'Seluruh permintaan pembelian barang operasional, peralatan kantor, jasa pihak ketiga, dan kebutuhan proyek di perusahaan.',
    relatedRoles: ['User Pemohon', 'Procurement Officer', 'Kepala Divisi Pemohon', 'Finance Manager', 'Direktur Operasional'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Klasifikasi Batas Nilai Pembelian Tanpa Tender',
        content:
          '1. Pembelian s/d Rp10.000.000 (Penunjukan Langsung): Dapat dilakukan tanpa tender menggunakan minimal 1 (satu) penawaran harga resmi. Disetujui oleh **Kepala Departemen Pemohon**.\n2. Pembelian > Rp10.000.000 s/d Rp50.000.000 (Perbandingan Harga Tanpa Tender): Wajib melampirkan minimal 3 (tiga) surat penawaran pembanding (quotation) dari vendor berbeda tanpa tender formal. Disetujui oleh **Kepala Divisi Pemohon** dan **Finance Manager**.\n3. Pembelian di atas Rp50.000.000: WAJIB melalui proses **Tender Tertutup / Terbuka** oleh Komite Pengadaan dengan persetujuan akhir **Direktur Operasional**. Dilarang memecah transaksi (split PO) untuk menghindari batas Rp50.000.000.',
      },
      {
        id: 'sec_2',
        order: 2,
        title: 'Pengecualian Kondisi Darurat & Vendor Tunggal',
        content:
          'Pengadaan di atas Rp50.000.000 tanpa tender hanya diperbolehkan untuk: (a) kondisi darurat keselamatan kerja / gangguan sistem kritis, atau (b) pemegang hak paten / distributor tunggal resmi dengan melampirkan Surat Keterangan Distributor Tunggal dan persetujuan tertulis Direktur Utama.',
      },
    ],
    attachments: [],
    effectiveDate: '2026-03-01',
    nextReviewDate: '2027-03-01',
    status: 'Disetujui',
    accessLevel: 'Umum',
    assignOwner: true,
  },
  {
    id: 'sop_hrd_004',
    docNumber: 'SOP-HRD-004',
    title: 'Kebijakan Cuti Tahunan, Izin Sakit, dan Cuti Khusus Karyawan',
    divisionId: 'div_hrd',
    divisionName: 'HR & Operasional',
    departmentId: 'dept_hrd_ops',
    departmentName: 'People Operations',
    purpose: 'Memberikan panduan jelas mengenai hak cuti, tata cara pengajuan, serta mekanisme serah terima pekerjaan selama karyawan tidak masuk kerja.',
    scope: 'Seluruh karyawan tetap yang telah melewati masa percobaan (probation) 3 bulan.',
    relatedRoles: ['Karyawan', 'Atasan Langsung', 'Rekan Backup Tugas', 'HR People Operations'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Hak Cuti Tahunan & Pengajuan',
        content:
          '1. Karyawan yang telah bekerja minimal 12 bulan berturut-turut berhak atas 12 hari kerja cuti tahunan.\n2. Pengajuan cuti tahunan wajib diajukan minimal H-5 hari kerja sebelum tanggal cuti (atau H-14 untuk cuti lebih dari 3 hari berturut-turut).\n3. Pemohon wajib menunjuk Rekan Backup di formulir cuti agar operasional tim tidak terhenti.',
      },
      {
        id: 'sec_2',
        order: 2,
        title: 'Cuti Khusus & Izin Sakit',
        content:
          '- Menikah: 3 hari kerja.\n- Istri melahirkan / keguguran: 2 hari kerja.\n- Cuti melahirkan (karyawan wanita): 3 bulan kalender.\n- Anggota keluarga inti meninggal dunia: 2 hari kerja.\n- Izin sakit lebih dari 1 hari wajib melampirkan surat keterangan dokter resmi maksimal saat hari pertama kembali bekerja.',
      },
    ],
    attachments: [],
    effectiveDate: '2025-08-01',
    nextReviewDate: '2026-08-01', // Intentionally past due for Admin Dashboard review alert
    status: 'Disetujui',
    accessLevel: 'Umum',
    assignOwner: true,
  },
  {
    id: 'sop_fin_005',
    docNumber: 'SOP-FIN-005',
    title: 'Prosedur Uang Muka Perjalanan Dinas Khusus Divisi Keuangan',
    divisionId: 'div_fin',
    divisionName: 'Keuangan & Akuntansi',
    departmentId: 'dept_fin_ap',
    departmentName: 'Treasury & Account Payable',
    purpose: 'Mengatur pencairan uang muka (cash advance) internal tim audit & keuangan sebelum tugas lapangan.',
    scope: 'Khusus staf dan supervisor di Divisi Keuangan & Akuntansi.',
    relatedRoles: ['Staf Audit Keuangan', 'Treasury Specialist', 'Finance Manager'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Pengajuan & Pertanggungjawaban Uang Muka',
        content:
          '1. Maksimal uang muka yang dapat diajukan adalah 80% dari estimasi total biaya perjalanan dinas.\n2. Penyelesaian pertanggungjawaban (settlement) wajib dilakukan maksimal 5 hari kerja setelah kembali. Sisa dana wajib ditransfer ke rekening operasional perusahaan.',
      },
    ],
    attachments: [],
    effectiveDate: '2026-04-01',
    nextReviewDate: '2027-04-01',
    status: 'Disetujui',
    accessLevel: 'Per Divisi',
    assignOwner: true,
  },
  {
    id: 'sop_its_006',
    docNumber: 'SOP-ITS-006',
    title: 'Eskalasi Insiden Keamanan Siber & Kebocoran Data Rahasia',
    divisionId: 'div_it',
    divisionName: 'IT & Keamanan',
    departmentId: 'dept_it_sec',
    departmentName: 'Information Security & SOC',
    purpose: 'Menetapkan protokol respons darurat jika terdeteksi akses ilegal, kebocoran kredensial, atau serangan ransomware.',
    scope: 'Tim Information Security, IT Infrastructure, dan Kepala Divisi terkait.',
    relatedRoles: ['SOC Analyst', 'CISO / Head of IT Security', 'Legal & Compliance'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Isolasi & Pelaporan Kritis (SLA 15 Menit)',
        content:
          '1. Segera putuskan koneksi jaringan perangkat terindikasi dan cabut seluruh sesi token aktif pada sistem SSO.\n2. Laporkan insiden tingkat Kritis ke kanal hotline Security Operations Center (SOC) dalam waktu maksimal 15 menit sejak deteksi awal.\n3. Dilarang menghapus log sistem atau mematikan server sebelum tim forensik mengambil snapshot memori.',
      },
    ],
    attachments: [],
    effectiveDate: '2026-05-01',
    nextReviewDate: '2027-05-01',
    status: 'Disetujui',
    accessLevel: 'Rahasia',
    assignOwner: false, // Intentionally ownerless for Admin Dashboard audit alert
  },
  {
    id: 'sop_hrd_007',
    docNumber: 'SOP-HRD-007',
    title: 'Kebijakan Kerja Jarak Jauh (WFH), Presensi, dan Tunjangan Internet',
    divisionId: 'div_hrd',
    divisionName: 'HR & Operasional',
    departmentId: 'dept_hrd_ops',
    departmentName: 'People Operations',
    purpose: 'Mengatur ketentuan kerja jarak jauh (Work From Home), pelaporan kehadiran harian, serta fasilitas tunjangan internet bagi karyawan yang memenuhi syarat.',
    scope: 'Berlaku bagi seluruh karyawan tetap pada departemen non-operasional gudang yang disetujui bekerja secara hybrid.',
    relatedRoles: ['Karyawan Hybrid', 'Atasan Langsung', 'HR People Operations', 'Finance Payroll'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Kuota WFH & Ketentuan Presensi',
        content:
          '1. Karyawan tetap berhak mengajukan WFH maksimal 2 (dua) hari per minggu dengan persetujuan Atasan Langsung paling lambat H-1 pukul 16.00.\n2. Karyawan wajib melakukan clock-in melalui aplikasi HRIS maksimal pukul 09.00 WIB dan menyertakan ringkasan target kerja harian.',
      },
      {
        id: 'sec_2',
        order: 2,
        title: 'Tunjangan Paket Internet Bulanan',
        content:
          '1. Karyawan dengan jadwal hybrid aktif berhak atas tunjangan internet sebesar Rp250.000 per bulan yang dibayarkan bersama gaji bulanan.\n2. Tunjangan tidak memerlukan klaim struk terpisah apabila status hybrid tercatat aktif di HRIS.',
      },
    ],
    attachments: [],
    effectiveDate: '2026-11-01',
    nextReviewDate: '2027-11-01',
    status: 'Review', // Intentionally Review so AI refuses until Admin approves it
    accessLevel: 'Umum',
    assignOwner: true,
  },
  {
    id: 'sop_log_008',
    docNumber: 'SOP-LOG-008',
    title: 'Prosedur Pembelian Darurat Operasional Cabang & Gudang Daerah',
    divisionId: 'div_log',
    divisionName: 'Pengadaan & Logistik',
    departmentId: 'dept_log_prc',
    departmentName: 'Procurement & Vendor Management',
    purpose: 'Memberikan jalur cepat pengadaan barang operasional mendesak di cabang agar aktivitas pengiriman gudang tidak berhenti.',
    scope: 'Seluruh Kepala Cabang dan Koordinator Gudang Daerah untuk kebutuhan operasional mendesak.',
    relatedRoles: ['Koordinator Gudang Daerah', 'Kepala Cabang', 'Procurement Officer'],
    sections: [
      {
        id: 'sec_1',
        order: 1,
        title: 'Batas Kewenangan Pembelian Darurat Cabang',
        content:
          '1. Untuk kebutuhan operasional mendesak di cabang, pembelian hingga Rp15.000.000 dapat dilakukan langsung menggunakan 1 (satu) penawaran harga tanpa perlu 3 penawaran pembanding.\n2. Persetujuan cukup diberikan oleh Kepala Cabang tanpa memerlukan persetujuan awal Finance Manager, lalu dilaporkan maksimal 2x24 jam setelah transaksi.',
      },
    ],
    attachments: [],
    effectiveDate: '2026-06-01',
    nextReviewDate: '2027-06-01',
    status: 'Disetujui', // Intentionally overlaps/conflicts with SOP-PRC-003 (limit Rp10jt vs Rp15jt) for UAT conflict detection
    accessLevel: 'Umum',
    assignOwner: true,
  },
];
