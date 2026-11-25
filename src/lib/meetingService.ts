import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  db,
  handleFirestoreError,
  isBootstrapAdminEmail,
} from './firebase';
import { makeSafeId, recordAuditLog } from './sopService';
import type {
  DirectoryMember,
  MeetingActionItem,
  MeetingDocument,
  MeetingMinuteVersion,
  MeetingParticipantResponse,
  MeetingStatus,
  ParticipantAttendanceStatus,
  SopDocument,
  UserProfile,
} from '../types/sop';

export function buildParticipantAttendanceList(
  meeting: Pick<
    MeetingDocument,
    'participantUids' | 'participantNames' | 'participantResponses' | 'organizerUid'
  >
): MeetingParticipantResponse[] {
  const existingMap = new Map<string, MeetingParticipantResponse>();
  for (const r of meeting.participantResponses || []) {
    if (r?.uid) existingMap.set(r.uid, r);
  }

  return (meeting.participantUids || []).map((uid, idx) => {
    const fallbackName = meeting.participantNames?.[idx] || 'Anggota Tim';
    const existing = existingMap.get(uid);
    if (existing) {
      return {
        uid,
        name: existing.name || fallbackName,
        status: existing.status || 'Menunggu',
        reason: existing.reason || '',
        updatedByName: existing.updatedByName || '',
      };
    }
    return {
      uid,
      name: fallbackName,
      status: uid === meeting.organizerUid ? 'Hadir' : 'Menunggu',
      reason: '',
      updatedByName: '',
    };
  });
}

export function computeMeetingStartAtMs(date: string, startTime: string): number {
  if (!date || !startTime) return Date.now();
  const parsed = new Date(`${date}T${startTime}:00`);
  const ms = parsed.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : Date.now();
}

export function computeMeetingViewerUids(params: {
  organizerUid: string;
  participantUids: string[];
  divisionId: string;
  directory: DirectoryMember[];
}): string[] {
  const set = new Set<string>();
  if (params.organizerUid) set.add(params.organizerUid);
  for (const uid of params.participantUids) {
    if (uid) set.add(uid);
  }
  for (const m of params.directory) {
    if (m.role === 'Super Admin') {
      set.add(m.uid);
    } else if (
      params.divisionId &&
      m.role === 'Admin Divisi' &&
      m.divisionId === params.divisionId
    ) {
      set.add(m.uid);
    }
  }
  return Array.from(set).slice(0, 200);
}

export async function fetchAccessibleMeetings(user: UserProfile): Promise<MeetingDocument[]> {
  try {
    if (isBootstrapAdminEmail(user.email)) {
      const snap = await getDocs(collection(db, 'meetings'));
      return sortMeetings(snap.docs.map((d) => d.data() as MeetingDocument));
    }

    const [publicSnap, viewerSnap, ownSnap] = await Promise.all([
      getDocs(query(collection(db, 'meetings'), where('isPublic', '==', true))),
      getDocs(
        query(collection(db, 'meetings'), where('viewerUids', 'array-contains', user.uid))
      ),
      getDocs(query(collection(db, 'meetings'), where('organizerUid', '==', user.uid))),
    ]);

    const map = new Map<string, MeetingDocument>();
    for (const snap of [publicSnap, viewerSnap, ownSnap]) {
      for (const d of snap.docs) {
        const data = d.data() as MeetingDocument;
        map.set(data.id, data);
      }
    }
    return sortMeetings(Array.from(map.values()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'meetings');
  }
}

export function sortMeetings(list: MeetingDocument[]): MeetingDocument[] {
  const now = Date.now();
  return [...list].sort((a, b) => {
    const aActive = a.status === 'Terjadwal' || a.status === 'Berlangsung';
    const bActive = b.status === 'Terjadwal' || b.status === 'Berlangsung';
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (aActive && bActive) {
      // Nearest upcoming / ongoing first
      const aDist = Math.abs(a.startAtMs - now);
      const bDist = Math.abs(b.startAtMs - now);
      if (a.startAtMs >= now - 3600_000 && b.startAtMs >= now - 3600_000) {
        return a.startAtMs - b.startAtMs;
      }
      return aDist - bDist;
    }
    // Completed/cancelled: newest first
    return b.startAtMs - a.startAtMs;
  });
}

export async function createMeeting(params: {
  title: string;
  description: string;
  divisionId: string;
  divisionName: string;
  date: string;
  startTime: string;
  endTime: string;
  reminderMinutes: number;
  location: string;
  participantUids: string[];
  participantNames: string[];
  externalParticipants: string;
  isPublic: boolean;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<MeetingDocument> {
  const id = makeSafeId('mtg');
  const participantUids = Array.from(
    new Set([params.actor.uid, ...params.participantUids.filter(Boolean)])
  ).slice(0, 100);
  const viewerUids = computeMeetingViewerUids({
    organizerUid: params.actor.uid,
    participantUids,
    divisionId: params.divisionId,
    directory: params.directory,
  });

  const cleanDoc: MeetingDocument = {
    id,
    title: params.title.trim().slice(0, 240),
    description: params.description.trim().slice(0, 4000),
    divisionId: params.divisionId.slice(0, 128),
    divisionName: (params.divisionName || 'Lintas Divisi').slice(0, 120),
    date: params.date.slice(0, 20),
    startTime: params.startTime.slice(0, 10),
    endTime: params.endTime.slice(0, 10),
    startAtMs: computeMeetingStartAtMs(params.date, params.startTime),
    reminderMinutes: Math.max(0, Math.min(1440, Math.round(params.reminderMinutes))),
    location: params.location.trim().slice(0, 300),
    status: 'Terjadwal',
    participantUids,
    participantNames: params.participantNames.slice(0, 100),
    participantResponses: participantUids.map((uid, idx) => ({
      uid,
      name: (params.participantNames[idx] || 'Anggota Tim').slice(0, 120),
      status: uid === params.actor.uid ? 'Hadir' : 'Menunggu',
      reason: '',
      updatedByName: uid === params.actor.uid ? params.actor.displayName.slice(0, 120) : '',
    })),
    externalParticipants: params.externalParticipants.trim().slice(0, 500),
    organizerUid: params.actor.uid,
    organizerName: params.actor.displayName.slice(0, 120),
    viewerUids,
    isPublic: params.isPublic,
    minutesSummary: '',
    decisions: [],
    actionItems: [],
    minutesVersion: 0,
    minutesUpdatedByName: '',
    linkedSopId: '',
    linkedSopDocNumber: '',
    linkedSopTitle: '',
  };

  try {
    await setDoc(doc(db, 'meetings', id), {
      ...cleanDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `meetings/${id}`);
  }

  await recordAuditLog({
    actor: params.actor,
    action: 'Jadwalkan Meeting',
    targetType: 'MEETING',
    targetId: id,
    targetLabel: cleanDoc.title,
    divisionId: cleanDoc.divisionId || 'general',
    detail: `${cleanDoc.date} ${cleanDoc.startTime}–${cleanDoc.endTime} · Pengingat ${cleanDoc.reminderMinutes}m · ${cleanDoc.participantUids.length} peserta`,
    directory: params.directory,
  });

  return cleanDoc;
}

export async function updateMeetingSchedule(params: {
  meeting: MeetingDocument;
  updates: {
    title: string;
    description: string;
    divisionId: string;
    divisionName: string;
    date: string;
    startTime: string;
    endTime: string;
    reminderMinutes: number;
    location: string;
    status: MeetingStatus;
    participantUids: string[];
    participantNames: string[];
    externalParticipants: string;
    isPublic: boolean;
  };
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<MeetingDocument> {
  const { meeting, updates, actor, directory } = params;
  const participantUids = Array.from(
    new Set([meeting.organizerUid, ...updates.participantUids.filter(Boolean)])
  ).slice(0, 100);
  const viewerUids = computeMeetingViewerUids({
    organizerUid: meeting.organizerUid,
    participantUids,
    divisionId: updates.divisionId,
    directory,
  });

  const existingRespMap = new Map<string, MeetingParticipantResponse>();
  for (const r of meeting.participantResponses || []) {
    if (r?.uid) existingRespMap.set(r.uid, r);
  }
  const nextResponses: MeetingParticipantResponse[] = participantUids.map((uid, idx) => {
    const name = (updates.participantNames[idx] || 'Anggota Tim').slice(0, 120);
    const prev = existingRespMap.get(uid);
    if (prev) {
      return { ...prev, name };
    }
    return {
      uid,
      name,
      status: uid === meeting.organizerUid ? 'Hadir' : 'Menunggu',
      reason: '',
      updatedByName: '',
    };
  });

  const nextMeeting: MeetingDocument = {
    ...meeting,
    title: updates.title.trim().slice(0, 240),
    description: updates.description.trim().slice(0, 4000),
    divisionId: updates.divisionId.slice(0, 128),
    divisionName: (updates.divisionName || 'Lintas Divisi').slice(0, 120),
    date: updates.date.slice(0, 20),
    startTime: updates.startTime.slice(0, 10),
    endTime: updates.endTime.slice(0, 10),
    startAtMs: computeMeetingStartAtMs(updates.date, updates.startTime),
    reminderMinutes: Math.max(0, Math.min(1440, Math.round(updates.reminderMinutes))),
    location: updates.location.trim().slice(0, 300),
    status: updates.status,
    participantUids,
    participantNames: updates.participantNames.slice(0, 100),
    participantResponses: nextResponses,
    externalParticipants: updates.externalParticipants.trim().slice(0, 500),
    viewerUids,
    isPublic: updates.isPublic,
  };

  try {
    await updateDoc(doc(db, 'meetings', meeting.id), {
      title: nextMeeting.title,
      description: nextMeeting.description,
      divisionId: nextMeeting.divisionId,
      divisionName: nextMeeting.divisionName,
      date: nextMeeting.date,
      startTime: nextMeeting.startTime,
      endTime: nextMeeting.endTime,
      startAtMs: nextMeeting.startAtMs,
      reminderMinutes: nextMeeting.reminderMinutes,
      location: nextMeeting.location,
      status: nextMeeting.status,
      participantUids: nextMeeting.participantUids,
      participantNames: nextMeeting.participantNames,
      participantResponses: nextResponses,
      externalParticipants: nextMeeting.externalParticipants,
      viewerUids: nextMeeting.viewerUids,
      isPublic: nextMeeting.isPublic,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `meetings/${meeting.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Perbarui Jadwal Meeting',
    targetType: 'MEETING',
    targetId: meeting.id,
    targetLabel: nextMeeting.title,
    divisionId: nextMeeting.divisionId || 'general',
    detail: `${nextMeeting.date} ${nextMeeting.startTime}–${nextMeeting.endTime} · Status: ${nextMeeting.status}`,
    directory,
  });

  return nextMeeting;
}

export async function updateMeetingStatus(params: {
  meeting: MeetingDocument;
  status: MeetingStatus;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<MeetingDocument> {
  const { meeting, status, actor, directory } = params;
  try {
    await updateDoc(doc(db, 'meetings', meeting.id), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `meetings/${meeting.id}`);
  }

  await recordAuditLog({
    actor,
    action: `Status Meeting: ${status}`,
    targetType: 'MEETING',
    targetId: meeting.id,
    targetLabel: meeting.title,
    divisionId: meeting.divisionId || 'general',
    detail: `Status diubah dari ${meeting.status} menjadi ${status}`,
    directory,
  });

  return { ...meeting, status };
}

export async function updateParticipantAttendance(params: {
  meeting: MeetingDocument;
  targetUid: string;
  targetName: string;
  status: ParticipantAttendanceStatus;
  reason?: string;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<MeetingDocument> {
  const { meeting, targetUid, targetName, status, reason = '', actor, directory } = params;
  const cleanReason = status === 'Tidak Bisa Hadir' ? reason.trim().slice(0, 300) : '';
  const currentList = buildParticipantAttendanceList(meeting);
  const existsInList = currentList.some((r) => r.uid === targetUid);
  const nextResponses: MeetingParticipantResponse[] = existsInList
    ? currentList.map((r) =>
        r.uid === targetUid
          ? {
              ...r,
              name: targetName.slice(0, 120),
              status,
              reason: cleanReason,
              updatedByName: actor.displayName.slice(0, 120),
            }
          : r
      )
    : [
        ...currentList,
        {
          uid: targetUid,
          name: targetName.slice(0, 120),
          status,
          reason: cleanReason,
          updatedByName: actor.displayName.slice(0, 120),
        },
      ];

  try {
    await updateDoc(doc(db, 'meetings', meeting.id), {
      participantResponses: nextResponses.slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `meetings/${meeting.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Konfirmasi Kehadiran Meeting',
    targetType: 'MEETING',
    targetId: meeting.id,
    targetLabel: meeting.title,
    divisionId: meeting.divisionId || 'general',
    detail: `${targetName}: ${status}${cleanReason ? ` (${cleanReason})` : ''}`,
    directory,
  });

  return {
    ...meeting,
    participantResponses: nextResponses,
  };
}

export async function saveMeetingMinutesWithHistory(params: {
  meeting: MeetingDocument;
  minutesSummary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  changeNote: string;
  markCompleted?: boolean;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<{ meeting: MeetingDocument; versionSnapshot: MeetingMinuteVersion }> {
  const {
    meeting,
    minutesSummary,
    decisions,
    actionItems,
    changeNote,
    markCompleted = false,
    actor,
    directory,
  } = params;

  const nextVersion = (meeting.minutesVersion || 0) + 1;
  const cleanSummary = minutesSummary.trim().slice(0, 12000);
  const cleanDecisions = decisions
    .map((d) => d.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 40);
  const cleanActions: MeetingActionItem[] = actionItems
    .filter((a) => a.task.trim())
    .slice(0, 40)
    .map((a, idx) => ({
      id: a.id || makeSafeId(`act_${idx + 1}`),
      task: a.task.trim().slice(0, 400),
      assigneeName: a.assigneeName.trim().slice(0, 120),
      dueDate: a.dueDate.trim().slice(0, 20),
      done: Boolean(a.done),
    }));
  const cleanChangeNote = (
    changeNote.trim() ||
    (nextVersion === 1 ? 'Pencatatan notulen awal' : `Pembaruan notulen v${nextVersion}`)
  ).slice(0, 500);
  const nextStatus: MeetingStatus =
    markCompleted && meeting.status !== 'Dibatalkan' ? 'Selesai' : meeting.status;

  const versionId = makeSafeId(`min_v${nextVersion}`);
  const versionPayload: MeetingMinuteVersion = {
    id: versionId,
    meetingId: meeting.id,
    version: nextVersion,
    minutesSummary: cleanSummary,
    decisions: cleanDecisions,
    actionItems: cleanActions,
    changeNote: cleanChangeNote,
    editedByUid: actor.uid,
    editedByName: actor.displayName.slice(0, 120),
    viewerUids: meeting.viewerUids,
    isPublic: meeting.isPublic,
  };

  try {
    await updateDoc(doc(db, 'meetings', meeting.id), {
      status: nextStatus,
      minutesSummary: cleanSummary,
      decisions: cleanDecisions,
      actionItems: cleanActions,
      minutesVersion: nextVersion,
      minutesUpdatedByName: actor.displayName.slice(0, 120),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'meetings', meeting.id, 'minuteVersions', versionId), {
      ...versionPayload,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `meetings/${meeting.id}/minuteVersions`);
  }

  await recordAuditLog({
    actor,
    action: `Simpan Notulen Meeting (v${nextVersion})`,
    targetType: 'MEETING',
    targetId: meeting.id,
    targetLabel: meeting.title,
    divisionId: meeting.divisionId || 'general',
    detail: cleanChangeNote,
    directory,
  });

  return {
    meeting: {
      ...meeting,
      status: nextStatus,
      minutesSummary: cleanSummary,
      decisions: cleanDecisions,
      actionItems: cleanActions,
      minutesVersion: nextVersion,
      minutesUpdatedByName: actor.displayName.slice(0, 120),
    },
    versionSnapshot: {
      ...versionPayload,
      createdAt: { seconds: Math.floor(Date.now() / 1000) },
    },
  };
}

export async function fetchMeetingMinuteVersions(
  meeting: MeetingDocument,
  user: UserProfile
): Promise<MeetingMinuteVersion[]> {
  try {
    const colRef = collection(db, 'meetings', meeting.id, 'minuteVersions');
    let q;
    if (isBootstrapAdminEmail(user.email)) {
      q = query(colRef, where('meetingId', '==', meeting.id));
    } else if (meeting.isPublic) {
      q = query(
        colRef,
        where('meetingId', '==', meeting.id),
        where('isPublic', '==', true)
      );
    } else {
      q = query(
        colRef,
        where('meetingId', '==', meeting.id),
        where('viewerUids', 'array-contains', user.uid)
      );
    }

    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as MeetingMinuteVersion)
      .sort((a, b) => b.version - a.version);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `meetings/${meeting.id}/minuteVersions`);
  }
}

export async function linkSopToMeeting(params: {
  meetingId: string;
  sop: SopDocument;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<void> {
  const { meetingId, sop, actor, directory } = params;
  try {
    await updateDoc(doc(db, 'meetings', meetingId), {
      linkedSopId: sop.id.slice(0, 128),
      linkedSopDocNumber: sop.docNumber.slice(0, 60),
      linkedSopTitle: sop.title.slice(0, 240),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `meetings/${meetingId}`);
  }

  await recordAuditLog({
    actor,
    action: 'Konversi Notulen ke SOP',
    targetType: 'MEETING',
    targetId: meetingId,
    targetLabel: `${sop.docNumber} — ${sop.title}`,
    divisionId: sop.divisionId || 'general',
    detail: `Menautkan hasil meeting ke SOP ${sop.docNumber} (${sop.status})`,
    directory,
  });
}

export async function deleteMeeting(
  meeting: MeetingDocument,
  actor: UserProfile,
  directory: DirectoryMember[] = []
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'meetings', meeting.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `meetings/${meeting.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Hapus Jadwal Meeting',
    targetType: 'MEETING',
    targetId: meeting.id,
    targetLabel: meeting.title,
    divisionId: meeting.divisionId || 'general',
    detail: `Menghapus jadwal meeting tanggal ${meeting.date} ${meeting.startTime}`,
    directory,
  });
}

export function formatMeetingMinutesForAiSop(meeting: MeetingDocument): string {
  const attendance = buildParticipantAttendanceList(meeting);
  const absentList = attendance.filter((a) => a.status === 'Tidak Bisa Hadir');
  const presentOrInvited = attendance
    .filter((a) => a.status !== 'Tidak Bisa Hadir')
    .map((a) => a.name);

  const lines: string[] = [
    `SUMBER: Hasil Notulen Meeting Internal Perusahaan (Notulen v${Math.max(1, meeting.minutesVersion)})`,
    `Judul Meeting: ${meeting.title}`,
    `Divisi: ${meeting.divisionName || 'Lintas Divisi'}`,
    `Tanggal & Waktu: ${meeting.date}, ${meeting.startTime}–${meeting.endTime}`,
    `Penyelenggara: ${meeting.organizerName}`,
    `Peserta Hadir / Terlibat: ${[...presentOrInvited, meeting.externalParticipants].filter(Boolean).join(', ') || '-'}`,
  ];

  if (absentList.length > 0) {
    lines.push(
      `Peserta Berhalangan Hadir: ${absentList
        .map((a) => `${a.name}${a.reason ? ` (${a.reason})` : ''}`)
        .join(', ')}`
    );
  }

  if (meeting.description) {
    lines.push('', 'AGENDA & TUJUAN MEETING:', meeting.description);
  }
  if (meeting.minutesSummary) {
    lines.push('', 'RINGKASAN PEMBAHASAN & HASIL MEETING:', meeting.minutesSummary);
  }
  if (meeting.decisions.length > 0) {
    lines.push(
      '',
      'KEPUTUSAN RESMI YANG HARUS DIJADIKAN ATURAN SOP:',
      ...meeting.decisions.map((d, idx) => `${idx + 1}. ${d}`)
    );
  }
  if (meeting.actionItems.length > 0) {
    lines.push(
      '',
      'LANGKAH TINDAK LANJUT & PENANGGUNG JAWAB (PIC):',
      ...meeting.actionItems.map(
        (a, idx) =>
          `${idx + 1}. ${a.task} (PIC: ${a.assigneeName || 'Tim Terkait'}${
            a.dueDate ? `, Tenggat: ${a.dueDate}` : ''
          })`
      )
    );
  }

  lines.push(
    '',
    'INSTRUKSI PENYUSUNAN SOP:',
    'Susun notulen meeting di atas menjadi dokumen SOP standar perusahaan yang operasional, sistematis, lengkap dengan Tujuan, Ruang Lingkup, Peran Terkait, dan Langkah Prosedur bernomor sesuai keputusan meeting.'
  );

  return lines.join('\n');
}

export function formatMeetingMinutesMarkdown(meeting: MeetingDocument): string {
  const attendance = buildParticipantAttendanceList(meeting);
  const absentList = attendance.filter((a) => a.status === 'Tidak Bisa Hadir');
  const activeList = attendance.filter((a) => a.status !== 'Tidak Bisa Hadir');

  const parts: string[] = [
    `# Notulen Meeting: ${meeting.title}`,
    `- **Tanggal & Jam:** ${meeting.date} · ${meeting.startTime}–${meeting.endTime}`,
    `- **Divisi:** ${meeting.divisionName || 'Lintas Divisi'}`,
    `- **Lokasi / Tautan:** ${meeting.location || '-'}`,
    `- **Penyelenggara:** ${meeting.organizerName}`,
    `- **Peserta Hadir / Terdaftar:** ${[...activeList.map((a) => a.name), meeting.externalParticipants].filter(Boolean).join(', ') || '-'}`,
  ];

  if (absentList.length > 0) {
    parts.push(
      `- **Tidak Bisa Hadir:** ${absentList
        .map((a) => `${a.name}${a.reason ? ` (${a.reason})` : ''}`)
        .join(', ')}`
    );
  }

  parts.push(`- **Versi Notulen:** v${meeting.minutesVersion || 0}`);

  if (meeting.linkedSopDocNumber) {
    parts.push(`- **SOP Terkait:** ${meeting.linkedSopDocNumber} — ${meeting.linkedSopTitle}`);
  }

  if (meeting.description) {
    parts.push('', '## Agenda', meeting.description);
  }
  if (meeting.minutesSummary) {
    parts.push('', '## Ringkasan & Pembahasan', meeting.minutesSummary);
  }
  if (meeting.decisions.length > 0) {
    parts.push('', '## Keputusan Penting', ...meeting.decisions.map((d, i) => `${i + 1}. ${d}`));
  }
  if (meeting.actionItems.length > 0) {
    parts.push(
      '',
      '## Tindak Lanjut (Action Items)',
      ...meeting.actionItems.map(
        (a) =>
          `- [${a.done ? 'x' : ' '}] ${a.task} — PIC: ${a.assigneeName || '-'}${
            a.dueDate ? ` (Tenggat: ${a.dueDate})` : ''
          }`
      )
    );
  }
  return parts.join('\n');
}
