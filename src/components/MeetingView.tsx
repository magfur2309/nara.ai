import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellRing,
  BookOpen,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  History,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  buildParticipantAttendanceList,
  createMeeting,
  deleteMeeting,
  fetchMeetingMinuteVersions,
  formatMeetingMinutesForAiSop,
  formatMeetingMinutesMarkdown,
  saveMeetingMinutesWithHistory,
  sortMeetings,
  updateMeetingSchedule,
  updateMeetingStatus,
  updateParticipantAttendance,
} from '../lib/meetingService';
import { makeSafeId } from '../lib/sopService';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import type {
  DirectoryMember,
  Division,
  MeetingActionItem,
  MeetingDocument,
  MeetingMinuteVersion,
  MeetingStatus,
  ParticipantAttendanceStatus,
  ReminderComposeDraft,
  UserProfile,
} from '../types/sop';

interface MeetingViewProps {
  user: UserProfile;
  divisions: Division[];
  directory: DirectoryMember[];
  meetings: MeetingDocument[];
  initialSelectedMeetingId?: string | null;
  onClearInitialSelection?: () => void;
  onMeetingsChange: (next: MeetingDocument[]) => void;
  onConvertMinutesToSop: (notes: string, titleHint: string, meetingId: string) => void;
  onOpenLinkedSop: (sopId: string) => void;
  browserNotifPermission: NotificationPermission | 'unsupported';
  onRequestBrowserNotif: () => Promise<void>;
  onSendReminder?: (draft: ReminderComposeDraft) => void;
}

const REMINDER_OPTIONS = [
  { value: 15, label: '15 menit sebelum' },
  { value: 30, label: '30 menit sebelum (Disarankan)' },
  { value: 60, label: '1 jam sebelum' },
  { value: 120, label: '2 jam sebelum' },
  { value: 0, label: 'Tanpa pengingat' },
];

const STATUS_OPTIONS: MeetingStatus[] = ['Terjadwal', 'Berlangsung', 'Selesai', 'Dibatalkan'];

function formatDateId(dateStr: string): string {
  if (!dateStr) return '-';
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTimestampId(ts: unknown): string {
  const sec = (ts as { seconds?: number })?.seconds;
  if (!sec) return 'Baru saja';
  return new Date(sec * 1000).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCountdownLabel(meeting: MeetingDocument, nowMs: number): {
  text: string;
  urgent: boolean;
} | null {
  if (meeting.status === 'Selesai' || meeting.status === 'Dibatalkan') return null;
  const diffMs = meeting.startAtMs - nowMs;
  const diffMin = Math.round(diffMs / 60_000);
  const reminderMin = meeting.reminderMinutes || 0;

  if (diffMin <= 0 && diffMin >= -90) {
    return {
      text: diffMin === 0 ? 'Dimulai sekarang' : `Sedang berlangsung (${Math.abs(diffMin)} mnt lalu)`,
      urgent: true,
    };
  }
  if (diffMin > 0 && reminderMin > 0 && diffMin <= reminderMin) {
    return { text: `Mulai dalam ${diffMin} menit`, urgent: true };
  }
  if (diffMin > 0 && diffMin < 60 * 24) {
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return {
      text: hrs > 0 ? `Dalam ${hrs}j ${mins}m` : `Dalam ${mins} menit`,
      urgent: false,
    };
  }
  if (diffMin >= 60 * 24) {
    const days = Math.floor(diffMin / (60 * 24));
    return { text: `Dalam ${days} hari`, urgent: false };
  }
  return { text: 'Jadwal terlewat', urgent: false };
}

function statusTextClass(status: MeetingStatus): string {
  switch (status) {
    case 'Terjadwal':
      return 'text-[var(--accent-text)] dark:text-[var(--accent)]';
    case 'Berlangsung':
      return 'text-amber-700 dark:text-amber-400';
    case 'Selesai':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'Dibatalkan':
      return 'text-rose-700 dark:text-rose-400';
  }
}

function getDefaultDateAndTimes(): { date: string; startTime: string; endTime: string } {
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  const end = new Date(next.getTime() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  const startTime = `${pad(next.getHours())}:${pad(next.getMinutes())}`;
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return { date, startTime, endTime };
}

export const MeetingView: React.FC<MeetingViewProps> = ({
  user,
  divisions,
  directory,
  meetings,
  initialSelectedMeetingId,
  onClearInitialSelection,
  onMeetingsChange,
  onConvertMinutesToSop,
  onOpenLinkedSop,
  browserNotifPermission,
  onRequestBrowserNotif,
  onSendReminder,
}) => {
  const { t } = useI18n();

  const triggerMeetingReminder = (mtg: MeetingDocument) => {
    if (!onSendReminder) return;
    const pUids = Array.isArray(mtg.participantUids) ? mtg.participantUids : [];
    const pNames = Array.isArray(mtg.participantNames) ? mtg.participantNames : [];
    const recipients = pUids.map((uid, idx) => ({
      uid,
      name:
        pNames[idx] ||
        directory.find((d) => d.uid === uid)?.displayName ||
        'Peserta Meeting',
    }));
    if (recipients.length === 0) {
      recipients.push({
        uid: mtg.organizerUid,
        name: mtg.organizerName || 'Penyelenggara',
      });
    }
    const msgLines = [
      `Pengingat Jadwal Meeting: ${mtg.title}`,
      `Tanggal & Waktu: ${mtg.date}, ${mtg.startTime}–${mtg.endTime}`,
      mtg.location ? `Lokasi / Tautan: ${mtg.location}` : '',
      `Penyelenggara: ${mtg.organizerName}${mtg.divisionName ? ` (${mtg.divisionName})` : ''}`,
      mtg.description ? `Agenda: ${mtg.description.slice(0, 400)}` : '',
      'Mohon kehadiran tepat waktu dan konfirmasi kehadiran Anda di aplikasi.',
    ].filter(Boolean);

    onSendReminder({
      category: 'meeting',
      priority: 'warning',
      sourceType: 'MEETING',
      sourceId: mtg.id,
      sourceLabel: `${mtg.date} ${mtg.startTime} · ${mtg.location || 'Meeting'}`,
      dueDate: mtg.date,
      title: `[Meeting] ${mtg.title}`,
      message: msgLines.join('\n'),
      recipients,
    });
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Semua' | MeetingStatus>('Semua');
  const [divisionFilter, setDivisionFilter] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedMeetingId || meetings[0]?.id || null
  );
  const [detailTab, setDetailTab] = useState<'detail' | 'minutes' | 'history'>('detail');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Feedback banners
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedMinutes, setCopiedMinutes] = useState(false);

  // Schedule Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MeetingDocument | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDivisionId, setFormDivisionId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndTime, setFormEndTime] = useState('10:00');
  const [formReminderMinutes, setFormReminderMinutes] = useState(30);
  const [formLocation, setFormLocation] = useState('');
  const [formIsPublic, setFormIsPublic] = useState(true);
  const [formParticipantUids, setFormParticipantUids] = useState<string[]>([user.uid]);
  const [formExternalParticipants, setFormExternalParticipants] = useState('');
  const [participantSearch, setParticipantSearch] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteMeeting, setConfirmDeleteMeeting] = useState<MeetingDocument | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Participant Attendance (RSVP / Tidak Bisa Hadir) state
  const [updatingAttendanceUid, setUpdatingAttendanceUid] = useState<string | null>(null);
  const [absenceEditorUid, setAbsenceEditorUid] = useState<string | null>(null);
  const [absenceReasonDraft, setAbsenceReasonDraft] = useState('');

  // Minutes Editor state
  const [minutesSummary, setMinutesSummary] = useState('');
  const [decisions, setDecisions] = useState<string[]>([]);
  const [newDecisionText, setNewDecisionText] = useState('');
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [newActionTask, setNewActionTask] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState('');
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [markCompletedOnSave, setMarkCompletedOnSave] = useState(false);
  const [savingMinutes, setSavingMinutes] = useState(false);

  // Minutes History state
  const [historyList, setHistoryList] = useState<MeetingMinuteVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  // Live clock tick every 30s for countdowns & reminders
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Honor external selection from global reminder banner
  useEffect(() => {
    if (initialSelectedMeetingId) {
      setSelectedId(initialSelectedMeetingId);
      setDetailTab('detail');
      onClearInitialSelection?.();
    }
  }, [initialSelectedMeetingId, onClearInitialSelection]);

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return meetings.filter((m) => {
      if (statusFilter !== 'Semua' && m.status !== statusFilter) return false;
      if (divisionFilter !== 'ALL') {
        if (divisionFilter === 'GENERAL' && m.divisionId !== '') return false;
        if (divisionFilter !== 'GENERAL' && m.divisionId !== divisionFilter) return false;
      }
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.location.toLowerCase().includes(q) ||
        m.divisionName.toLowerCase().includes(q) ||
        m.minutesSummary.toLowerCase().includes(q) ||
        m.participantNames.some((n) => n.toLowerCase().includes(q)) ||
        m.externalParticipants.toLowerCase().includes(q)
      );
    });
  }, [meetings, searchQuery, statusFilter, divisionFilter]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedId) || filteredMeetings[0] || null,
    [meetings, selectedId, filteredMeetings]
  );

  // Sync minutes editor whenever selectedMeeting changes
  useEffect(() => {
    if (!selectedMeeting) {
      setMinutesSummary('');
      setDecisions([]);
      setActionItems([]);
      setChangeNote('');
      setHistoryList([]);
      return;
    }
    setMinutesSummary(selectedMeeting.minutesSummary || '');
    setDecisions(selectedMeeting.decisions || []);
    setActionItems(selectedMeeting.actionItems || []);
    setChangeNote('');
    setMarkCompletedOnSave(false);
    setExpandedVersionId(null);
    setAbsenceEditorUid(null);
    setAbsenceReasonDraft('');
  }, [selectedMeeting]);

  const loadHistory = useCallback(
    async (mtg: MeetingDocument) => {
      setHistoryLoading(true);
      try {
        const versions = await fetchMeetingMinuteVersions(mtg, user);
        setHistoryList(versions);
        if (versions.length > 0) {
          setExpandedVersionId(versions[0].id);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat histori notulen.');
      } finally {
        setHistoryLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (selectedMeeting && detailTab === 'history') {
      void loadHistory(selectedMeeting);
    }
  }, [selectedMeeting, detailTab, loadHistory]);

  // Metrics
  const metrics = useMemo(() => {
    let upcoming = 0;
    let startingSoon = 0;
    let withMinutes = 0;
    let convertedToSop = 0;
    for (const m of meetings) {
      if (m.status === 'Terjadwal' || m.status === 'Berlangsung') {
        upcoming += 1;
        const diffMin = Math.round((m.startAtMs - nowMs) / 60_000);
        const rem = m.reminderMinutes || 30;
        if (diffMin <= rem && diffMin >= -60) {
          startingSoon += 1;
        }
      }
      if (m.minutesVersion > 0 || m.minutesSummary.trim()) {
        withMinutes += 1;
      }
      if (m.linkedSopId) {
        convertedToSop += 1;
      }
    }
    return { upcoming, startingSoon, withMinutes, convertedToSop };
  }, [meetings, nowMs]);

  const canWriteSop = user.role !== 'Karyawan';

  const canManageSchedule = (mtg: MeetingDocument): boolean =>
    user.role === 'Super Admin' ||
    mtg.organizerUid === user.uid ||
    (user.role === 'Admin Divisi' && Boolean(mtg.divisionId) && user.divisionId === mtg.divisionId);

  const canEditMinutes = (mtg: MeetingDocument): boolean =>
    canManageSchedule(mtg) || mtg.participantUids.includes(user.uid);

  const openCreateModal = () => {
    const def = getDefaultDateAndTimes();
    setEditingMeeting(null);
    setFormTitle('');
    setFormDesc('');
    setFormDivisionId(user.divisionId || '');
    setFormDate(def.date);
    setFormStartTime(def.startTime);
    setFormEndTime(def.endTime);
    setFormReminderMinutes(30);
    setFormLocation('');
    setFormIsPublic(true);
    setFormParticipantUids([user.uid]);
    setFormExternalParticipants('');
    setParticipantSearch('');
    setErrorMsg(null);
    setFormOpen(true);
  };

  const openEditModal = (mtg: MeetingDocument) => {
    setEditingMeeting(mtg);
    setFormTitle(mtg.title);
    setFormDesc(mtg.description);
    setFormDivisionId(mtg.divisionId);
    setFormDate(mtg.date);
    setFormStartTime(mtg.startTime);
    setFormEndTime(mtg.endTime);
    setFormReminderMinutes(mtg.reminderMinutes);
    setFormLocation(mtg.location);
    setFormIsPublic(mtg.isPublic);
    setFormParticipantUids(
      mtg.participantUids.length > 0 ? mtg.participantUids : [mtg.organizerUid]
    );
    setFormExternalParticipants(mtg.externalParticipants);
    setParticipantSearch('');
    setErrorMsg(null);
    setFormOpen(true);
  };

  const toggleParticipant = (uid: string) => {
    setFormParticipantUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSubmitSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDate || !formStartTime || !formEndTime || savingForm) return;
    setSavingForm(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const divObj = divisions.find((d) => d.id === formDivisionId);
      const divName = divObj?.name || 'Lintas Divisi';

      const uidSet = new Set<string>([
        editingMeeting ? editingMeeting.organizerUid : user.uid,
        ...formParticipantUids,
      ]);
      const finalUids = Array.from(uidSet);
      const finalNames = finalUids.map((uid) => {
        if (uid === user.uid) return user.displayName;
        const found = directory.find((m) => m.uid === uid);
        return found?.displayName || 'Anggota Tim';
      });

      if (editingMeeting) {
        const updated = await updateMeetingSchedule({
          meeting: editingMeeting,
          updates: {
            title: formTitle,
            description: formDesc,
            divisionId: formDivisionId,
            divisionName: divName,
            date: formDate,
            startTime: formStartTime,
            endTime: formEndTime,
            reminderMinutes: formReminderMinutes,
            location: formLocation,
            status: editingMeeting.status,
            participantUids: finalUids,
            participantNames: finalNames,
            externalParticipants: formExternalParticipants,
            isPublic: formIsPublic,
          },
          actor: user,
          directory,
        });
        onMeetingsChange(
          sortMeetings(meetings.map((m) => (m.id === updated.id ? updated : m)))
        );
        setSelectedId(updated.id);
        setStatusMsg(`Jadwal meeting "${updated.title}" berhasil diperbarui.`);
      } else {
        const created = await createMeeting({
          title: formTitle,
          description: formDesc,
          divisionId: formDivisionId,
          divisionName: divName,
          date: formDate,
          startTime: formStartTime,
          endTime: formEndTime,
          reminderMinutes: formReminderMinutes,
          location: formLocation,
          participantUids: finalUids,
          participantNames: finalNames,
          externalParticipants: formExternalParticipants,
          isPublic: formIsPublic,
          actor: user,
          directory,
        });
        onMeetingsChange(sortMeetings([created, ...meetings]));
        setSelectedId(created.id);
        setDetailTab('detail');
        setStatusMsg(
          `Meeting "${created.title}" terjadwal pada ${formatDateId(created.date)} pukul ${created.startTime} (pengingat ${created.reminderMinutes} menit sebelumnya).`
        );
      }
      setFormOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan jadwal meeting.');
    } finally {
      setSavingForm(false);
    }
  };

  const handleQuickStatusChange = async (nextStatus: MeetingStatus) => {
    if (!selectedMeeting || updatingStatus || selectedMeeting.status === nextStatus) return;
    setUpdatingStatus(true);
    setErrorMsg(null);
    try {
      const updated = await updateMeetingStatus({
        meeting: selectedMeeting,
        status: nextStatus,
        actor: user,
        directory,
      });
      onMeetingsChange(
        sortMeetings(meetings.map((m) => (m.id === updated.id ? updated : m)))
      );
      setStatusMsg(`Status meeting diubah menjadi ${nextStatus}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengubah status meeting.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSetAttendance = async (
    targetUid: string,
    targetName: string,
    nextStatus: ParticipantAttendanceStatus,
    reason = ''
  ) => {
    if (!selectedMeeting || updatingAttendanceUid) return;
    setUpdatingAttendanceUid(targetUid);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const updated = await updateParticipantAttendance({
        meeting: selectedMeeting,
        targetUid,
        targetName,
        status: nextStatus,
        reason,
        actor: user,
        directory,
      });
      onMeetingsChange(
        sortMeetings(meetings.map((m) => (m.id === updated.id ? updated : m)))
      );
      setAbsenceEditorUid(null);
      setAbsenceReasonDraft('');
      setStatusMsg(
        nextStatus === 'Tidak Bisa Hadir'
          ? `${targetName} ditandai tidak bisa hadir${reason.trim() ? ` (${reason.trim()})` : ''}.`
          : `Status kehadiran ${targetName} diperbarui menjadi ${nextStatus}.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memperbarui konfirmasi kehadiran.'
      );
    } finally {
      setUpdatingAttendanceUid(null);
    }
  };

  const handleDeleteMeeting = async (mtg: MeetingDocument) => {
    if (deletingId) return;
    setDeletingId(mtg.id);
    setErrorMsg(null);
    try {
      await deleteMeeting(mtg, user, directory);
      const remaining = meetings.filter((m) => m.id !== mtg.id);
      onMeetingsChange(remaining);
      setSelectedId(remaining[0]?.id || null);
      setStatusMsg(`Jadwal meeting "${mtg.title}" berhasil dihapus.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus jadwal meeting.');
    } finally {
      setDeletingId(null);
      setConfirmDeleteMeeting(null);
    }
  };

  const handleAddDecision = () => {
    const clean = newDecisionText.trim();
    if (!clean) return;
    setDecisions((prev) => [...prev, clean]);
    setNewDecisionText('');
  };

  const handleAddActionItem = () => {
    const cleanTask = newActionTask.trim();
    if (!cleanTask) return;
    setActionItems((prev) => [
      ...prev,
      {
        id: makeSafeId('act'),
        task: cleanTask,
        assigneeName: newActionAssignee.trim() || user.displayName,
        dueDate: newActionDueDate,
        done: false,
      },
    ]);
    setNewActionTask('');
    setNewActionAssignee('');
    setNewActionDueDate('');
  };

  const handleSaveMinutes = async () => {
    if (!selectedMeeting || savingMinutes) return;
    if (!minutesSummary.trim() && decisions.length === 0 && actionItems.length === 0) {
      setErrorMsg('Isi ringkasan pembahasan, keputusan, atau tindak lanjut terlebih dahulu.');
      return;
    }
    setSavingMinutes(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const { meeting: updated, versionSnapshot } = await saveMeetingMinutesWithHistory({
        meeting: selectedMeeting,
        minutesSummary,
        decisions,
        actionItems,
        changeNote,
        markCompleted: markCompletedOnSave,
        actor: user,
        directory,
      });
      onMeetingsChange(
        sortMeetings(meetings.map((m) => (m.id === updated.id ? updated : m)))
      );
      setHistoryList((prev) => [versionSnapshot, ...prev.filter((v) => v.id !== versionSnapshot.id)]);
      setChangeNote('');
      setMarkCompletedOnSave(false);
      setStatusMsg(
        `Notulen v${updated.minutesVersion} tersimpan ke histori revisi meeting.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan notulen meeting.');
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleRestoreVersionToEditor = (ver: MeetingMinuteVersion) => {
    setMinutesSummary(ver.minutesSummary);
    setDecisions(ver.decisions);
    setActionItems(ver.actionItems);
    setChangeNote(`Memulihkan isi notulen dari versi v${ver.version}`);
    setDetailTab('minutes');
    setStatusMsg(
      `Isi notulen v${ver.version} dimuat ke editor. Klik "Simpan Notulen" untuk menyimpannya sebagai versi terbaru.`
    );
  };

  const handleCopyMarkdown = () => {
    if (!selectedMeeting) return;
    const md = formatMeetingMinutesMarkdown({
      ...selectedMeeting,
      minutesSummary,
      decisions,
      actionItems,
    });
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(md);
      setCopiedMinutes(true);
      window.setTimeout(() => setCopiedMinutes(false), 1800);
    }
  };

  const handleConvertToSop = () => {
    if (!selectedMeeting) return;
    const mergedMeeting: MeetingDocument = {
      ...selectedMeeting,
      minutesSummary,
      decisions,
      actionItems,
    };
    const notes = formatMeetingMinutesForAiSop(mergedMeeting);
    const titleHint = `SOP ${selectedMeeting.title}`;
    onConvertMinutesToSop(notes, titleHint, selectedMeeting.id);
  };

  const filteredDirectory = useMemo(() => {
    const q = participantSearch.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.divisionName.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [directory, participantSearch]);

  const isUrlLocation = (loc: string) => /^https?:\/\//i.test(loc.trim());

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[var(--text)]">
            {t('meetings.title')}
          </h1>
          <div className="w-10 h-[3px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <p className="text-xs sm:text-sm text-[var(--text-muted)] pt-0.5">
            {t('meetings.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {browserNotifPermission !== 'unsupported' && (
            <button
              type="button"
              onClick={onRequestBrowserNotif}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {browserNotifPermission === 'granted' ? (
                <>
                  <BellRing className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Pengingat Browser Aktif</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Aktifkan Notifikasi Browser</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CalendarPlus className="w-4 h-4" />
            <span>Jadwalkan Meeting</span>
          </button>
        </div>
      </div>

      {/* Summary Metric Strip (Single-Elevation, Tabular Numerals) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Meeting Terjadwal</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
            {metrics.upcoming}
          </p>
        </div>
        <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Segera Dimulai</p>
          <p
            className={`font-mono tabular-nums text-2xl font-semibold mt-1 ${
              metrics.startingSoon > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {metrics.startingSoon}
          </p>
        </div>
        <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Notulen Tercatat</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
            {metrics.withMinutes}
          </p>
        </div>
        <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Dikonversi ke SOP</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1">
            {metrics.convertedToSop}
          </p>
        </div>
      </div>

      {/* Feedback Alerts */}
      {statusMsg && (
        <div className="px-4 py-3 bg-[var(--success-soft)] dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{statusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-emerald-700 dark:text-emerald-300 font-medium hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 bg-[var(--danger-soft)] dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-xl text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 dark:text-rose-300 font-medium hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul, agenda, peserta, lokasi, atau isi notulen..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-900 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-x-auto">
            {(['Semua', ...STATUS_OPTIONS] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === st
                    ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-900 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
          >
            <option value="ALL">Semua Divisi</option>
            <option value="GENERAL">Lintas Divisi</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      {meetings.length === 0 ? (
        <div className="bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl p-12 text-center space-y-3">
          <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Belum ada jadwal meeting tercatat
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Jadwalkan rapat perdana lengkap dengan peserta, pengingat 30 menit sebelumnya, pencatatan notulen berhistori, serta konversi langsung menjadi SOP perusahaan.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
            >
              <CalendarPlus className="w-4 h-4" />
              <span>Jadwalkan Meeting Pertama</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Meeting List */}
          <div className="lg:col-span-5 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Daftar Jadwal ({filteredMeetings.length})
              </span>
              <span>Urutan terdekat</span>
            </div>

            {filteredMeetings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Tidak ada jadwal meeting yang cocok dengan filter saat ini.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
                {filteredMeetings.map((mtg) => {
                  const isSelected = selectedMeeting?.id === mtg.id;
                  const countdown = getCountdownLabel(mtg, nowMs);
                  const absentCount = (mtg.participantResponses || []).filter(
                    (r) => r.status === 'Tidak Bisa Hadir'
                  ).length;
                  return (
                    <button
                      key={mtg.id}
                      type="button"
                      onClick={() => setSelectedId(mtg.id)}
                      className={`w-full text-left p-4 transition-colors cursor-pointer space-y-1.5 ${
                        isSelected
                          ? 'bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)]'
                          : 'hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {formatDateId(mtg.date)} · {mtg.startTime}–{mtg.endTime}
                        </span>
                        <span className={`font-semibold ${statusTextClass(mtg.status)}`}>
                          {mtg.status}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {mtg.title}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{mtg.divisionName || 'Lintas Divisi'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {mtg.participantUids.length} peserta
                        </span>
                        {absentCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums text-rose-700 dark:text-rose-400 font-medium">
                              {absentCount} berhalangan
                            </span>
                          </>
                        )}
                        {mtg.reminderMinutes > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">Pengingat {mtg.reminderMinutes}m</span>
                          </>
                        )}
                        {mtg.minutesVersion > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-700 dark:text-slate-300 font-medium font-mono">
                              Notulen v{mtg.minutesVersion}
                            </span>
                          </>
                        )}
                        {mtg.linkedSopDocNumber && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium font-mono">
                              SOP {mtg.linkedSopDocNumber}
                            </span>
                          </>
                        )}
                      </div>

                      {countdown && (
                        <p
                          className={`text-[11px] font-medium pt-0.5 ${
                            countdown.urgent
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {countdown.urgent ? 'Pengingat aktif: ' : ''}
                          {countdown.text}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Selected Meeting Detail, Minutes Editor & History */}
          <div className="lg:col-span-7 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            {!selectedMeeting ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Pilih jadwal meeting di sebelah kiri untuk melihat detail, mencatat notulen, atau meninjau histori.
              </div>
            ) : (
              <div>
                {/* Detail Header */}
                <div className="p-5 border-b border-[var(--border)] dark:border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className={`font-semibold ${statusTextClass(selectedMeeting.status)}`}>
                          {selectedMeeting.status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedMeeting.divisionName || 'Lintas Divisi'}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {selectedMeeting.isPublic ? 'Terbuka (Perusahaan)' : 'Khusus Peserta'}
                        </span>
                      </div>
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {selectedMeeting.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 pt-0.5">
                        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {formatDateId(selectedMeeting.date)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {selectedMeeting.startTime}–{selectedMeeting.endTime}
                        </span>
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <Bell className="w-3.5 h-3.5 text-slate-400" />
                          {selectedMeeting.reminderMinutes > 0
                            ? `Pengingat ${selectedMeeting.reminderMinutes} mnt sebelumnya`
                            : 'Pengingat nonaktif'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {onSendReminder && selectedMeeting.status !== 'Dibatalkan' && (
                        <button
                          type="button"
                          onClick={() => triggerMeetingReminder(selectedMeeting)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{t('notifications.quickTrigger.remindParticipants')}</span>
                        </button>
                      )}
                      {canManageSchedule(selectedMeeting) && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(selectedMeeting)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === selectedMeeting.id}
                            onClick={() => setConfirmDeleteMeeting(selectedMeeting)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--danger)] dark:text-rose-300 bg-[var(--danger-soft)] dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {deletingId === selectedMeeting.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>Hapus</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Linked SOP Notice (if converted) */}
                  {selectedMeeting.linkedSopId && (
                    <div className="px-3.5 py-2.5 bg-[var(--success-soft)] dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 min-w-0">
                        <BookOpen className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="truncate">
                          Telah dijadikan SOP:{' '}
                          <strong className="font-mono">{selectedMeeting.linkedSopDocNumber}</strong>{' '}
                          — {selectedMeeting.linkedSopTitle}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenLinkedSop(selectedMeeting.linkedSopId)}
                        className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Buka Dokumen SOP →
                      </button>
                    </div>
                  )}

                  {/* Segmented Detail Tabs */}
                  <div className="flex items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 rounded-lg w-fit">
                    <button
                      type="button"
                      onClick={() => setDetailTab('detail')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        detailTab === 'detail'
                          ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Detail &amp; Peserta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('minutes')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        detailTab === 'minutes'
                          ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>
                        Notulen{selectedMeeting.minutesVersion > 0 ? ` (v${selectedMeeting.minutesVersion})` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('history')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        detailTab === 'history'
                          ? 'bg-[var(--surface)] dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Histori Notulen</span>
                    </button>
                  </div>
                </div>

                {/* Tab 1: Detail & Peserta */}
                {detailTab === 'detail' && (
                  <div className="p-5 space-y-6">
                    {/* Quick Status Bar */}
                    {canEditMinutes(selectedMeeting) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          Ubah status pelaksanaan:
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {STATUS_OPTIONS.map((st) => (
                            <button
                              key={st}
                              type="button"
                              disabled={updatingStatus || selectedMeeting.status === st}
                              onClick={() => handleQuickStatusChange(st)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                                selectedMeeting.status === st
                                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                                  : 'bg-[var(--surface)] dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-[var(--border)] dark:border-slate-700 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 disabled:opacity-50'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Agenda / Description */}
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Deskripsi &amp; Agenda Meeting
                      </h3>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {selectedMeeting.description || 'Belum ada deskripsi agenda.'}
                      </p>
                    </div>

                    {/* Location & Organizer */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Lokasi / Tautan Rapat
                        </p>
                        {selectedMeeting.location ? (
                          isUrlLocation(selectedMeeting.location) ? (
                            <a
                              href={selectedMeeting.location}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-text)] dark:text-[var(--accent)] hover:underline break-all"
                            >
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span>{selectedMeeting.location}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ) : (
                            <p className="text-sm text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{selectedMeeting.location}</span>
                            </p>
                          )
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">Belum ditentukan</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Penyelenggara
                        </p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {selectedMeeting.organizerName}
                        </p>
                      </div>
                    </div>

                    {/* Participants & Attendance Confirmation */}
                    {(() => {
                      const attendanceList = buildParticipantAttendanceList(selectedMeeting);
                      const hadirCount = attendanceList.filter((a) => a.status === 'Hadir').length;
                      const absentCount = attendanceList.filter(
                        (a) => a.status === 'Tidak Bisa Hadir'
                      ).length;
                      const pendingCount = attendanceList.length - hadirCount - absentCount;
                      const isManager = canManageSchedule(selectedMeeting);

                      return (
                        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              Peserta Meeting ({attendanceList.length} internal)
                            </h3>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {hadirCount} Hadir
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  absentCount > 0
                                    ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                    : ''
                                }
                              >
                                {absentCount} Tidak Bisa Hadir
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{pendingCount} Menunggu</span>
                            </div>
                          </div>

                          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
                            {attendanceList.map((row) => {
                              const isSelf = row.uid === user.uid;
                              const isOrganizer = row.uid === selectedMeeting.organizerUid;
                              const canUpdateRow = isSelf || isManager;
                              const isEditingReason = absenceEditorUid === row.uid;
                              const isSavingRow = updatingAttendanceUid === row.uid;

                              return (
                                <div
                                  key={row.uid}
                                  className="px-3.5 py-2.5 bg-[var(--surface-2)]/60 dark:bg-slate-950/60 space-y-2"
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="min-w-0 space-y-0.5">
                                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                                          {row.name}
                                        </span>
                                        {isOrganizer && (
                                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                            (Penyelenggara)
                                          </span>
                                        )}
                                        {isSelf && (
                                          <span className="text-[11px] text-[var(--accent-text)] dark:text-[var(--accent)] font-medium">
                                            (Anda)
                                          </span>
                                        )}
                                        <span className="text-slate-300 dark:text-slate-700">·</span>
                                        <span
                                          className={`text-[11px] font-medium ${
                                            row.status === 'Hadir'
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : row.status === 'Tidak Bisa Hadir'
                                              ? 'text-rose-700 dark:text-rose-400'
                                              : 'text-slate-500 dark:text-slate-400'
                                          }`}
                                        >
                                          {row.status}
                                        </span>
                                      </div>

                                      {row.status === 'Tidak Bisa Hadir' && row.reason && (
                                        <p className="text-[11px] text-rose-800 dark:text-rose-300">
                                          Alasan: {row.reason}
                                        </p>
                                      )}
                                    </div>

                                    {canUpdateRow && (
                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          disabled={isSavingRow || row.status === 'Hadir'}
                                          onClick={() =>
                                            handleSetAttendance(row.uid, row.name, 'Hadir')
                                          }
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                                            row.status === 'Hadir'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : 'bg-[var(--surface)] dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[var(--border)] dark:border-slate-700 hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50'
                                          }`}
                                        >
                                          <UserCheck className="w-3 h-3" />
                                          <span>Hadir</span>
                                        </button>

                                        <button
                                          type="button"
                                          disabled={isSavingRow}
                                          onClick={() => {
                                            if (isEditingReason) {
                                              setAbsenceEditorUid(null);
                                              setAbsenceReasonDraft('');
                                            } else {
                                              setAbsenceEditorUid(row.uid);
                                              setAbsenceReasonDraft(row.reason || '');
                                            }
                                          }}
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                                            row.status === 'Tidak Bisa Hadir'
                                              ? 'bg-rose-600 text-white border-rose-600'
                                              : 'bg-[var(--surface)] dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[var(--border)] dark:border-slate-700 hover:border-rose-400 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-50'
                                          }`}
                                        >
                                          <UserX className="w-3 h-3" />
                                          <span>
                                            {row.status === 'Tidak Bisa Hadir'
                                              ? 'Ubah Alasan'
                                              : 'Tidak Bisa Hadir'}
                                          </span>
                                        </button>

                                        {row.status !== 'Menunggu' && (
                                          <button
                                            type="button"
                                            disabled={isSavingRow}
                                            onClick={() =>
                                              handleSetAttendance(row.uid, row.name, 'Menunggu')
                                            }
                                            title="Kembalikan ke status Menunggu"
                                            className="px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer disabled:opacity-50"
                                          >
                                            Reset
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {isEditingReason && (
                                    <div className="pt-2 border-t border-[var(--border)]/80 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
                                      <input
                                        type="text"
                                        value={absenceReasonDraft}
                                        onChange={(e) => setAbsenceReasonDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void handleSetAttendance(
                                              row.uid,
                                              row.name,
                                              'Tidak Bisa Hadir',
                                              absenceReasonDraft
                                            );
                                          }
                                        }}
                                        placeholder="Alasan tidak bisa ikut meeting (opsional, cth. dinas luar / bentrok jadwal klien)..."
                                        className="flex-1 px-3 py-1.5 text-xs bg-[var(--input-bg)] dark:bg-slate-900 border border-[var(--border-strong)] dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-rose-500/25 focus:border-rose-500"
                                      />
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          disabled={isSavingRow}
                                          onClick={() => {
                                            setAbsenceEditorUid(null);
                                            setAbsenceReasonDraft('');
                                          }}
                                          className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                                        >
                                          Batal
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingRow}
                                          onClick={() =>
                                            handleSetAttendance(
                                              row.uid,
                                              row.name,
                                              'Tidak Bisa Hadir',
                                              absenceReasonDraft
                                            )
                                          }
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-md cursor-pointer"
                                        >
                                          {isSavingRow && (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          )}
                                          <span>Simpan Tidak Hadir</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {selectedMeeting.externalParticipants && (
                            <div className="pt-1">
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                Peserta Eksternal / Tamu:
                              </p>
                              <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                                {selectedMeeting.externalParticipants}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Footer Action */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {selectedMeeting.minutesVersion > 0
                          ? `Notulen terakhir v${selectedMeeting.minutesVersion} oleh ${selectedMeeting.minutesUpdatedByName || '-'}`
                          : 'Notulen meeting belum dicatat.'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDetailTab('minutes')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>
                          {selectedMeeting.minutesVersion > 0
                            ? 'Buka & Perbarui Notulen'
                            : 'Catat Notulen Meeting'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Tab 2: Notulen & Konversi ke SOP */}
                {detailTab === 'minutes' && (
                  <div className="p-5 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Catatan Hasil Meeting (Notulen)
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Setiap penyimpanan otomatis tercatat sebagai versi baru di Histori Notulen.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCopyMarkdown}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                        >
                          {copiedMinutes ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedMinutes ? 'Disalin' : 'Salin Notulen'}</span>
                        </button>
                        {canWriteSop && (
                          <button
                            type="button"
                            disabled={
                              !minutesSummary.trim() &&
                              decisions.length === 0 &&
                              actionItems.length === 0
                            }
                            onClick={handleConvertToSop}
                            title="Buka di Impor & Buat AI untuk menyusun dokumen SOP resmi dari hasil meeting ini"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Jadikan SOP via AI</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Ringkasan & Pembahasan */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Ringkasan Pembahasan &amp; Hasil Rapat
                      </label>
                      <textarea
                        rows={6}
                        disabled={!canEditMinutes(selectedMeeting)}
                        value={minutesSummary}
                        onChange={(e) => setMinutesSummary(e.target.value)}
                        placeholder="Tuliskan poin-poin pembahasan utama, kendala yang dibahas, alur kerja yang disepakati, dan catatan penting lainnya..."
                        className="w-full px-3.5 py-2.5 text-sm bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40 disabled:opacity-60"
                      />
                    </div>

                    {/* Poin Keputusan */}
                    <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Keputusan Penting ({decisions.length})
                      </label>
                      {decisions.length > 0 && (
                        <ol className="space-y-1.5">
                          {decisions.map((dec, idx) => (
                            <li
                              key={`${idx}_${dec.slice(0, 12)}`}
                              className="flex items-start justify-between gap-2 px-3 py-2 bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                            >
                              <span className="leading-relaxed">
                                <strong className="font-mono mr-1.5">{idx + 1}.</strong>
                                {dec}
                              </span>
                              {canEditMinutes(selectedMeeting) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDecisions((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0 cursor-pointer"
                                  aria-label="Hapus keputusan"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                      {canEditMinutes(selectedMeeting) && (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newDecisionText}
                            onChange={(e) => setNewDecisionText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddDecision();
                              }
                            }}
                            placeholder="Tambah keputusan rapat (tekan Enter)..."
                            className="flex-1 px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                          />
                          <button
                            type="button"
                            onClick={handleAddDecision}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Tambah</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Action Items */}
                    <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Tindak Lanjut / Action Items ({actionItems.length})
                      </label>
                      {actionItems.length > 0 && (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
                          {actionItems.map((item) => (
                            <div
                              key={item.id}
                              className="px-3 py-2.5 bg-[var(--surface-2)]/70 dark:bg-slate-950 flex items-start justify-between gap-3 text-xs"
                            >
                              <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                                <input
                                  type="checkbox"
                                  disabled={!canEditMinutes(selectedMeeting)}
                                  checked={item.done}
                                  onChange={() =>
                                    setActionItems((prev) =>
                                      prev.map((a) =>
                                        a.id === item.id ? { ...a, done: !a.done } : a
                                      )
                                    )
                                  }
                                  className="mt-0.5 rounded border-[var(--border-strong)] dark:border-slate-700"
                                />
                                <div className="space-y-0.5 min-w-0">
                                  <p
                                    className={`font-medium ${
                                      item.done
                                        ? 'line-through text-slate-400 dark:text-slate-500'
                                        : 'text-slate-900 dark:text-slate-100'
                                    }`}
                                  >
                                    {item.task}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                    PIC: {item.assigneeName || '-'}
                                    {item.dueDate ? ` · Tenggat: ${item.dueDate}` : ''}
                                  </p>
                                </div>
                              </label>
                              {canEditMinutes(selectedMeeting) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionItems((prev) => prev.filter((a) => a.id !== item.id))
                                  }
                                  className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0 cursor-pointer"
                                  aria-label="Hapus tindak lanjut"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {canEditMinutes(selectedMeeting) && (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <input
                            type="text"
                            value={newActionTask}
                            onChange={(e) => setNewActionTask(e.target.value)}
                            placeholder="Tugas tindak lanjut..."
                            className="sm:col-span-5 px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                          />
                          <input
                            type="text"
                            value={newActionAssignee}
                            onChange={(e) => setNewActionAssignee(e.target.value)}
                            placeholder="PIC (nama)"
                            className="sm:col-span-3 px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                          />
                          <input
                            type="date"
                            value={newActionDueDate}
                            onChange={(e) => setNewActionDueDate(e.target.value)}
                            className="sm:col-span-2 px-2.5 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                          />
                          <button
                            type="button"
                            onClick={handleAddActionItem}
                            className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Tambah</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Save Minutes Bar */}
                    {canEditMinutes(selectedMeeting) ? (
                      <div className="pt-4 border-t border-[var(--border)] dark:border-slate-800 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                          <input
                            type="text"
                            value={changeNote}
                            onChange={(e) => setChangeNote(e.target.value)}
                            placeholder={`Catatan revisi untuk versi v${(selectedMeeting.minutesVersion || 0) + 1} (opsional)...`}
                            className="sm:col-span-8 px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                          />
                          {selectedMeeting.status !== 'Selesai' &&
                            selectedMeeting.status !== 'Dibatalkan' && (
                              <label className="sm:col-span-4 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={markCompletedOnSave}
                                  onChange={(e) => setMarkCompletedOnSave(e.target.checked)}
                                  className="rounded border-[var(--border-strong)] dark:border-slate-700"
                                />
                                <span>Tandai meeting Selesai</span>
                              </label>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {canWriteSop
                              ? 'Tips: Setelah menyimpan notulen, klik "Jadikan SOP via AI" untuk menyusun draf SOP otomatis.'
                              : 'Notulen dapat ditinjau oleh Admin atau Penulis untuk dijadikan SOP resmi.'}
                          </span>
                          <button
                            type="button"
                            disabled={savingMinutes}
                            onClick={handleSaveMinutes}
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                          >
                            {savingMinutes ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {savingMinutes
                                ? 'Menyimpan...'
                                : `Simpan Notulen (v${(selectedMeeting.minutesVersion || 0) + 1})`}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 pt-3 border-t border-slate-100 dark:border-slate-800">
                        Mode baca saja — hanya penyelenggara, peserta meeting, atau Admin yang dapat memperbarui notulen.
                      </p>
                    )}
                  </div>
                )}

                {/* Tab 3: Histori Notulen */}
                {detailTab === 'history' && (
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Histori Revisi Notulen
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Setiap versi notulen tersimpan permanen untuk audit dan dapat dipulihkan kapan saja.
                        </p>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {historyList.length} versi
                      </span>
                    </div>

                    {historyLoading ? (
                      <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
                        <span>Memuat histori notulen...</span>
                      </div>
                    ) : historyList.length === 0 ? (
                      <div className="py-10 text-center space-y-2 border border-dashed border-[var(--border)] dark:border-slate-800 rounded-xl">
                        <History className="w-6 h-6 text-slate-400 mx-auto" />
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Belum ada versi notulen yang tersimpan untuk meeting ini.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
                        {historyList.map((ver) => {
                          const isExpanded = expandedVersionId === ver.id;
                          return (
                            <div key={ver.id} className="p-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedVersionId(isExpanded ? null : ver.id)
                                  }
                                  className="text-left flex flex-wrap items-center gap-2 text-xs cursor-pointer"
                                >
                                  <span className="font-mono font-semibold text-[var(--accent-text)] dark:text-[var(--accent)]">
                                    v{ver.version}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-medium text-slate-900 dark:text-slate-100">
                                    {ver.editedByName}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                    {formatTimestampId(ver.createdAt)}
                                  </span>
                                </button>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedVersionId(isExpanded ? null : ver.id)
                                    }
                                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                                  >
                                    {isExpanded ? 'Tutup Detail' : 'Lihat Isi'}
                                  </button>
                                  {canEditMinutes(selectedMeeting) && (
                                    <button
                                      type="button"
                                      onClick={() => handleRestoreVersionToEditor(ver)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] rounded-md cursor-pointer"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      <span>Pulihkan</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                Catatan revisi: <span className="text-slate-800 dark:text-slate-200">{ver.changeNote}</span>
                              </p>

                              {isExpanded && (
                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
                                  {ver.minutesSummary && (
                                    <div className="space-y-1">
                                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                                        Ringkasan Pembahasan
                                      </p>
                                      <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-[var(--surface-2)] dark:bg-slate-950 p-3 rounded-lg">
                                        {ver.minutesSummary}
                                      </p>
                                    </div>
                                  )}

                                  {ver.decisions.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                                        Keputusan ({ver.decisions.length})
                                      </p>
                                      <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300">
                                        {ver.decisions.map((d, i) => (
                                          <li key={i}>{d}</li>
                                        ))}
                                      </ol>
                                    </div>
                                  )}

                                  {ver.actionItems.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                                        Tindak Lanjut ({ver.actionItems.length})
                                      </p>
                                      <ul className="space-y-1 text-slate-700 dark:text-slate-300">
                                        {ver.actionItems.map((a) => (
                                          <li key={a.id}>
                                            [{a.done ? 'Selesai' : 'Proses'}] {a.task} — PIC:{' '}
                                            {a.assigneeName || '-'}
                                            {a.dueDate ? ` (${a.dueDate})` : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Schedule Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto"
          onClick={() => !savingForm && setFormOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-2xl bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-xl shadow-[var(--modal-shadow)] dark:shadow-2xl overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {editingMeeting ? 'Edit Jadwal Meeting' : 'Jadwalkan Meeting Baru'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Lengkapi agenda, peserta, jadwal tanggal &amp; jam, serta waktu pengingat otomatis.
                </p>
              </div>
              <button
                type="button"
                disabled={savingForm}
                onClick={() => setFormOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSchedule} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Judul Meeting *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="cth. Evaluasi Alur Pembelian Darurat & Pembaruan SOP Pengadaan"
                  className="w-full px-3.5 py-2 text-sm bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Deskripsi &amp; Agenda Meeting
                </label>
                <textarea
                  rows={3}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Tuliskan latar belakang, poin agenda yang akan dibahas, dan target keputusan meeting..."
                  className="w-full px-3.5 py-2 text-sm bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Tanggal *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Jam Mulai *
                  </label>
                  <input
                    type="time"
                    required
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Jam Selesai *
                  </label>
                  <input
                    type="time"
                    required
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Pengingat Otomatis
                  </label>
                  <select
                    value={formReminderMinutes}
                    onChange={(e) => setFormReminderMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  >
                    {REMINDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Divisi Terkait
                  </label>
                  <select
                    value={formDivisionId}
                    onChange={(e) => setFormDivisionId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  >
                    <option value="">Lintas Divisi (Perusahaan)</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Visibilitas Jadwal
                  </label>
                  <select
                    value={formIsPublic ? 'public' : 'private'}
                    onChange={(e) => setFormIsPublic(e.target.value === 'public')}
                    className="w-full px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                  >
                    <option value="public">Terbuka (Seluruh Karyawan)</option>
                    <option value="private">Khusus Peserta &amp; Admin</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Lokasi / Tautan Rapat (Ruang Meeting / Zoom / Google Meet)
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="cth. Ruang Rapat Lt. 3 atau https://meet.google.com/..."
                  className="w-full px-3.5 py-2 text-sm bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                />
              </div>

              {/* Participant Selection */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Peserta Internal ({formParticipantUids.length} dipilih)
                  </label>
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    placeholder="Cari nama/divisi..."
                    className="w-44 px-2.5 py-1 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto border border-[var(--border)] dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredDirectory.map((member) => {
                    const isOrg =
                      member.uid === (editingMeeting ? editingMeeting.organizerUid : user.uid);
                    const checked = isOrg || formParticipantUids.includes(member.uid);
                    return (
                      <label
                        key={member.uid}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isOrg}
                            onChange={() => toggleParticipant(member.uid)}
                            className="rounded border-[var(--border-strong)] dark:border-slate-700"
                          />
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {member.displayName}
                          </span>
                          {isOrg && (
                            <span className="text-[10px] text-[var(--accent-text)] dark:text-[var(--accent)]">
                              (Penyelenggara)
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                          {member.divisionName || 'Umum'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Peserta Eksternal / Tamu (opsional, pisahkan dengan koma)
                </label>
                <input
                  type="text"
                  value={formExternalParticipants}
                  onChange={(e) => setFormExternalParticipants(e.target.value)}
                  placeholder="cth. Vendor Logistik (Bpk. Hendra), Konsultan ISO"
                  className="w-full px-3.5 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
                />
              </div>

              <div className="pt-3 border-t border-[var(--border)] dark:border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={savingForm}
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingForm || !formTitle.trim() || !formDate}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {savingForm ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>{editingMeeting ? 'Simpan Perubahan' : 'Simpan Jadwal Meeting'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={Boolean(confirmDeleteMeeting)}
        title="Hapus Jadwal Meeting?"
        description={
          confirmDeleteMeeting ? (
            <>
              Jadwal meeting <strong>{confirmDeleteMeeting.title}</strong> beserta notulensi,
              daftar kehadiran, dan riwayat perubahannya akan dihapus permanen.
            </>
          ) : null
        }
        details={
          confirmDeleteMeeting
            ? [
                { label: 'Judul Meeting', value: confirmDeleteMeeting.title },
                {
                  label: 'Tanggal & Waktu',
                  value: `${confirmDeleteMeeting.date} · ${confirmDeleteMeeting.startTime}–${confirmDeleteMeeting.endTime}`,
                },
                {
                  label: 'Lokasi / Divisi',
                  value:
                    [confirmDeleteMeeting.location, confirmDeleteMeeting.divisionName]
                      .filter(Boolean)
                      .join(' · ') || '-',
                },
              ]
            : undefined
        }
        confirmLabel="Hapus Jadwal Meeting"
        loading={Boolean(confirmDeleteMeeting && deletingId === confirmDeleteMeeting.id)}
        onCancel={() => setConfirmDeleteMeeting(null)}
        onConfirm={() => {
          if (confirmDeleteMeeting) {
            return handleDeleteMeeting(confirmDeleteMeeting);
          }
        }}
      />
    </div>
  );
};
