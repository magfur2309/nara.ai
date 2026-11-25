export type UserRole = 'Super Admin' | 'Admin Divisi' | 'Penulis' | 'Karyawan';

export type SopStatus = 'Draft' | 'Review' | 'Disetujui' | 'Arsip';

export type AccessLevel = 'Umum' | 'Per Divisi' | 'Rahasia';

export type FeedbackType = 'none' | 'helpful' | 'inaccurate' | 'outdated';

export interface UserProfile {
  uid: string;
  rbacUserId?: string;
  username?: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  divisionId: string;
  divisionName: string;
  erpUserId?: number;
  erpUserCode?: string;
  erpUserName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DirectoryMember {
  uid: string;
  displayName: string;
  role: UserRole;
  divisionId: string;
  divisionName: string;
  updatedAt?: unknown;
}

export interface Division {
  id: string;
  name: string;
  code: string;
  description: string;
  leadUid: string;
  leadName: string;
  suggestedQuestions: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Department {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  code: string;
  description: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SopSectionImage {
  id: string;
  caption: string;
  dataUrl: string;
  fileName?: string;
  ocrText?: string;
  aiWarning?: string;
}

export interface SopSection {
  id: string;
  order: number;
  title: string;
  content: string;
  images?: SopSectionImage[];
}

export interface SopAttachmentVisualPage {
  pageNumber: number;
  caption: string;
  dataUrl: string;
}

export interface SopAttachment {
  id: string;
  name: string;
  fileType: string;
  sizeLabel: string;
  extractedText: string;
  visualPages?: SopAttachmentVisualPage[];
}

export interface SopDocument {
  id: string;
  docNumber: string;
  title: string;
  divisionId: string;
  divisionName: string;
  departmentId: string;
  departmentName: string;
  purpose: string;
  scope: string;
  ownerUid: string;
  ownerName: string;
  relatedRoles: string[];
  sections: SopSection[];
  attachments: SopAttachment[];
  effectiveDate: string;
  nextReviewDate: string;
  status: SopStatus;
  accessLevel: AccessLevel;
  allowedUserUids: string[];
  viewerUids: string[];
  version: number;
  createdByUid: string;
  createdByName: string;
  approvedByUid: string;
  approvedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SopVersionSnapshot {
  id: string;
  sopId: string;
  version: number;
  docNumber: string;
  title: string;
  purpose: string;
  scope: string;
  relatedRoles: string[];
  sections: SopSection[];
  attachments: SopAttachment[];
  effectiveDate: string;
  nextReviewDate: string;
  status: SopStatus;
  accessLevel: AccessLevel;
  createdByUid: string;
  ownerUid: string;
  viewerUids: string[];
  changeNote: string;
  editedByUid: string;
  editedByName: string;
  createdAt?: unknown;
}

export interface SopChunk {
  id: string;
  sopId: string;
  docNumber: string;
  title: string;
  version: number;
  divisionId: string;
  divisionName: string;
  departmentName: string;
  sectionIndex: number;
  sectionTitle: string;
  content: string;
  keywords: string;
  embedding: number[];
  status: 'Disetujui';
  accessLevel: AccessLevel;
  viewerUids: string[];
  ownerUid: string;
  ownerName: string;
  createdAt?: unknown;
}

export interface CitationSource {
  sopId: string;
  docNumber: string;
  title: string;
  version: number;
  sectionTitle: string;
  divisionName: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  userName: string;
  divisionId: string;
  title: string;
  isPinned?: boolean;
  pinnedAt?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: CitationSource[];
  hasConflict: boolean;
  answered: boolean;
  suggestedContact: string;
  feedback: FeedbackType;
  feedbackNote: string;
  logId: string;
  createdAt?: unknown;
}

export interface QueryLog {
  id: string;
  userId: string;
  userName: string;
  divisionId: string;
  divisionName: string;
  question: string;
  answered: boolean;
  matchedSopIds: string[];
  primarySopId: string;
  primarySopTitle: string;
  primarySopDocNumber: string;
  feedback: FeedbackType;
  feedbackNote: string;
  resolvedAsSopId: string;
  adminViewerUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AiSopDraft {
  title: string;
  docNumber: string;
  suggestedDivisionName: string;
  suggestedDepartmentName: string;
  purpose: string;
  scope: string;
  relatedRoles: string[];
  sections: { title: string; content: string }[];
  attachmentSummary: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  action: string;
  targetType: 'SOP' | 'USER' | 'DIVISION' | 'DEPARTMENT' | 'MEETING' | 'ASSET' | 'MAINTENANCE';
  targetId: string;
  targetLabel: string;
  divisionId: string;
  detail: string;
  adminViewerUids: string[];
  createdAt?: unknown;
}

export type ConflictType = 'Konflik Aturan' | 'Duplikasi' | 'Tumpang Tindih PIC';

export interface SopConflictItem {
  sopAId: string;
  sopADocNumber: string;
  sopATitle: string;
  sopBId: string;
  sopBDocNumber: string;
  sopBTitle: string;
  conflictType?: ConflictType;
  severity: 'Tinggi' | 'Sedang' | 'Rendah';
  description: string;
  recommendation: string;
}

export interface PrePublishConflictItem {
  existingSopId: string;
  existingDocNumber: string;
  existingTitle: string;
  conflictType: ConflictType;
  severity: 'Tinggi' | 'Sedang' | 'Rendah';
  description: string;
  recommendation: string;
}

export interface PrePublishConflictReport {
  hasIssues: boolean;
  summary: string;
  checkedCount: number;
  conflicts: PrePublishConflictItem[];
}

export interface SopFeedbackRevisionResult {
  title: string;
  purpose: string;
  scope: string;
  relatedRoles: string[];
  sections: { id?: string; title: string; content: string }[];
  changeSummary: string;
  revisionNotes: string;
}

export type MeetingStatus = 'Terjadwal' | 'Berlangsung' | 'Selesai' | 'Dibatalkan';

export type ParticipantAttendanceStatus = 'Menunggu' | 'Hadir' | 'Tidak Bisa Hadir';

export interface MeetingParticipantResponse {
  uid: string;
  name: string;
  status: ParticipantAttendanceStatus;
  reason: string;
  updatedByName: string;
}

export interface MeetingActionItem {
  id: string;
  task: string;
  assigneeName: string;
  dueDate: string;
  done: boolean;
}

export interface MeetingDocument {
  id: string;
  title: string;
  description: string;
  divisionId: string;
  divisionName: string;
  date: string;
  startTime: string;
  endTime: string;
  startAtMs: number;
  reminderMinutes: number;
  location: string;
  status: MeetingStatus;
  participantUids: string[];
  participantNames: string[];
  participantResponses?: MeetingParticipantResponse[];
  externalParticipants: string;
  organizerUid: string;
  organizerName: string;
  viewerUids: string[];
  isPublic: boolean;
  minutesSummary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  minutesVersion: number;
  minutesUpdatedByName: string;
  linkedSopId: string;
  linkedSopDocNumber: string;
  linkedSopTitle: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MeetingMinuteVersion {
  id: string;
  meetingId: string;
  version: number;
  minutesSummary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  changeNote: string;
  editedByUid: string;
  editedByName: string;
  viewerUids: string[];
  isPublic: boolean;
  createdAt?: unknown;
}

export type AssetCategory =
  | 'Kendaraan'
  | 'Meja'
  | 'Kursi'
  | 'Bangunan'
  | 'Elektronik & IT'
  | 'Mesin & Peralatan'
  | 'Lainnya';

export type AssetCondition =
  | 'Baik'
  | 'Perlu Perhatian'
  | 'Dalam Perbaikan'
  | 'Rusak / Nonaktif';

export type MaintenanceType =
  | 'Servis Berkala'
  | 'Ganti Oli'
  | 'Bayar Pajak STNK'
  | 'Uji KIR'
  | 'Perpanjangan Asuransi'
  | 'Perawatan Bangunan / AC'
  | 'Inspeksi & Kalibrasi'
  | 'Perbaikan'
  | 'Lainnya';

export type MaintenanceStatus =
  | 'Terjadwal'
  | 'Mendekati Jatuh Tempo'
  | 'Terlambat'
  | 'Selesai'
  | 'Dibatalkan';

export interface MaintenanceHistoryEntry {
  id: string;
  completedDate: string;
  performedByName: string;
  vendorName: string;
  cost: number;
  odometerKm: number;
  notes: string;
}

export interface CompanyAsset {
  id: string;
  assetCode: string;
  name: string;
  category: AssetCategory;
  subCategory: string;
  quantity: number;
  unit: string;
  condition: AssetCondition;
  location: string;
  divisionId: string;
  divisionName: string;
  picUid: string;
  picName: string;
  plateOrSerial: string;
  brandModel: string;
  purchaseDate: string;
  currentOdometerKm: number;
  notes: string;
  isPublic: boolean;
  viewerUids: string[];
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AssetMaintenanceSchedule {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  assetCategory: AssetCategory;
  plateOrSerial: string;
  maintenanceType: MaintenanceType;
  title: string;
  dueDate: string;
  dueAtMs: number;
  intervalMonths: number;
  intervalKm: number;
  targetOdometerKm: number;
  reminderDaysBefore: number;
  status: MaintenanceStatus;
  lastCompletedDate: string;
  estimatedCost: number;
  vendorName: string;
  picUid: string;
  picName: string;
  divisionId: string;
  divisionName: string;
  notes: string;
  history: MaintenanceHistoryEntry[];
  isPublic: boolean;
  viewerUids: string[];
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'area'
  | 'donut'
  | 'pie'
  | 'stacked_bar';

export type ChartValueFormat = 'currency' | 'number' | 'percent';

export type ChartColorPalette = 'corporate' | 'emerald' | 'boardroom' | 'contrast';

export type ChartSortMode = 'original' | 'desc' | 'asc';

export interface ChartSeriesData {
  name: string;
  values: number[];
}

export interface AiChartSpec {
  title: string;
  subtitle: string;
  recommendedType: ChartType;
  valueFormat: ChartValueFormat;
  unitLabel: string;
  categoryLabel: string;
  labels: string[];
  series: ChartSeriesData[];
  insightSummary?: string;
  sourceLabel?: string;
}

export interface PinnedChartDocument {
  id: string;
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
  displayOrder: number;
  isShared: boolean;
  divisionId: string;
  divisionName: string;
  ownerUid: string;
  ownerName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ErpEmployeeRecord {
  id: number;
  code: string;
  name: string;
  category: string;
  division: string;
  jobTitle: string;
  email: string;
  phone: string;
  secondaryPhone: string;
  whatsappNormalized: string;
  address: string;
  isActive: boolean;
  isEmployeeFlag: boolean;
  missingFields: ('email' | 'phone')[];
}

export interface ErpEmployeesQueryResult {
  sourceTable: string;
  totalContactsScanned: number;
  totalEmployees: number;
  readyEmailCount: number;
  readyWhatsappCount: number;
  readyBothCount: number;
  missingEmailCount: number;
  missingPhoneCount: number;
  detectedColumns: {
    idCol: string | null;
    codeCol: string | null;
    nameCol: string | null;
    emailCol: string | null;
    phoneCol: string | null;
    secondaryPhoneCol: string | null;
    activeCol: string | null;
    employeeFlagCol: string | null;
    categoryCol: string | null;
    divisionCol: string | null;
    jobTitleCol: string | null;
    addressCol: string | null;
    allColumns: string[];
  };
  categoryValues: string[];
  filterMode: 'employee_only' | 'all_contacts';
  employees: ErpEmployeeRecord[];
  fetchedAt: string;
}

export interface EmployeeContactOverride {
  id: string;
  erpContactId: number;
  erpContactCode: string;
  employeeName: string;
  linkedUid: string;
  divisionId: string;
  divisionName: string;
  jobTitle: string;
  email: string;
  whatsappPhone: string;
  notes: string;
  adminViewerUids: string[];
  updatedByUid: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type NotificationCategory = 'maintenance' | 'meeting' | 'sop_review' | 'general';

export type NotificationPriority = 'normal' | 'warning' | 'urgent';

export type NotificationChannel = 'in_app' | 'email' | 'whatsapp';

export type NotificationSourceType = 'ASSET_MAINTENANCE' | 'MEETING' | 'SOP' | 'MANUAL';

export type NotificationChannelDeliveryStatus =
  | 'not_requested'
  | 'sent'
  | 'failed'
  | 'manual_fallback'
  | 'missing_contact';

export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  sourceLabel: string;
  dueDate: string;
  recipientUid: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  recipientErpCode: string;
  divisionId: string;
  channels: NotificationChannel[];
  inAppRead: boolean;
  emailStatus: NotificationChannelDeliveryStatus;
  whatsappStatus: NotificationChannelDeliveryStatus;
  deliveryNote: string;
  senderUid: string;
  senderName: string;
  viewerUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationChannelStatus {
  emailConfigured: boolean;
  emailProvider: 'smtp' | 'resend' | 'none';
  emailFromPreview: string;
  whatsappConfigured: boolean;
  whatsappProvider: 'fonnte' | 'meta' | 'none';
}

export interface ReminderComposeDraft {
  category: NotificationCategory;
  priority: NotificationPriority;
  sourceType: NotificationSourceType;
  sourceId: string;
  sourceLabel: string;
  dueDate: string;
  title: string;
  message: string;
  recipients: {
    uid: string;
    name: string;
    email?: string;
    phone?: string;
    erpCode?: string;
  }[];
}


