import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileUp,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  MessageCircleQuestion,
  PenTool,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  AlertCircle,
  X,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import { useI18n } from '../lib/i18n';
import { extractPdfVisualPages } from '../lib/pdfVisuals';
import { linkSopToMeeting } from '../lib/meetingService';
import {
  ensureDivisionAndDepartment,
  makeSafeId,
  markQueryGapResolved,
  runPrePublishConflictCheck,
  saveSopWithVersionAndIndex,
} from '../lib/sopService';
import type {
  AccessLevel,
  AiSopDraft,
  Department,
  DirectoryMember,
  Division,
  PrePublishConflictReport,
  SopAttachment,
  SopDocument,
  SopStatus,
  UserProfile,
} from '../types/sop';

interface AiStudioViewProps {
  user: UserProfile;
  idToken: string;
  divisions: Division[];
  departments: Department[];
  directory: DirectoryMember[];
  sops?: SopDocument[];
  prefillNotes?: {
    notes: string;
    titleHint: string;
    logIds?: string[];
    meetingId?: string;
  } | null;
  onClearPrefill?: () => void;
  onSopCreated: (sop: SopDocument) => void;
  onMeetingSopLinked?: (meetingId: string, sop: SopDocument) => void;
  onOrgUpdated?: () => Promise<void>;
}

interface BulkQueueItem {
  id: string;
  file: File;
  status: 'Menunggu' | 'Memproses AI' | 'Siap Ditinjau' | 'Tersimpan' | 'Gagal';
  stageText?: string;
  draft?: AiSopDraft;
  attachment?: SopAttachment;
  error?: string;
}

interface BulkProgressState {
  phase: 'running' | 'completed' | 'completed_with_errors';
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentIndex: number;
  currentFileName: string;
  currentStage: string;
  startedAt: number;
  finishedAt?: number;
}

export const AiStudioView: React.FC<AiStudioViewProps> = ({
  user,
  idToken,
  divisions,
  departments,
  directory,
  sops = [],
  prefillNotes,
  onClearPrefill,
  onSopCreated,
  onMeetingSopLinked,
  onOrgUpdated,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'import' | 'writer' | 'interview' | 'bulk'>(
    prefillNotes ? 'writer' : 'import'
  );

  // Single Import / Writer state
  const [notesInput, setNotesInput] = useState(prefillNotes?.notes || '');
  const [titleHint, setTitleHint] = useState(prefillNotes?.titleHint || '');
  const [divisionHint, setDivisionHint] = useState(divisions[0]?.name || '');
  const [legacyText, setLegacyText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fase 3: AI Handover Interview state
  const [employeeRole, setEmployeeRole] = useState('');
  const [interviewTopic, setInterviewTopic] = useState('');
  const [interviewTranscript, setInterviewTranscript] = useState<
    { speaker: 'ai' | 'user'; text: string }[]
  >([]);
  const [capturedKeyPoints, setCapturedKeyPoints] = useState<string[]>([]);
  const [interviewAnswer, setInterviewAnswer] = useState('');
  const [interviewReady, setInterviewReady] = useState(false);

  // Reviewable draft state
  const [draft, setDraft] = useState<AiSopDraft | null>(null);
  const [draftAttachment, setDraftAttachment] = useState<SopAttachment | null>(null);
  const [targetDivisionId, setTargetDivisionId] = useState(divisions[0]?.id || '');
  const [targetDeptId, setTargetDeptId] = useState(departments[0]?.id || '');
  const [targetOwnerUid, setTargetOwnerUid] = useState(user.uid);
  const [relatedRolesText, setRelatedRolesText] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [nextReviewDate, setNextReviewDate] = useState(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [targetAccessLevel, setTargetAccessLevel] = useState<AccessLevel>('Umum');
  const [targetAllowedUserUids, setTargetAllowedUserUids] = useState<string[]>([user.uid]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictReport, setConflictReport] = useState<PrePublishConflictReport | null>(null);
  const [pendingConflictStatus, setPendingConflictStatus] = useState<SopStatus | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [processAlert, setProcessAlert] = useState<string | null>(null);
  const [activeBulkId, setActiveBulkId] = useState<string | null>(null);
  const [previewZoomImage, setPreviewZoomImage] = useState<{ url: string; caption: string } | null>(
    null
  );

  // Bulk Import Queue
  const [bulkQueue, setBulkQueue] = useState<BulkQueueItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgressState | null>(null);

  useEffect(() => {
    if (prefillNotes) {
      setActiveTab('writer');
      setNotesInput(prefillNotes.notes);
      setTitleHint(prefillNotes.titleHint);
      setDraft(null);
    }
  }, [prefillNotes]);

  useEffect(() => {
    if (!divisionHint && divisions.length > 0) {
      setDivisionHint(divisions[0].name);
    }
    if (divisions.length > 0 && !divisions.some((d) => d.id === targetDivisionId)) {
      const firstDiv = divisions[0];
      setTargetDivisionId(firstDiv.id);
      const firstDept = departments.find((dp) => dp.divisionId === firstDiv.id);
      setTargetDeptId(firstDept?.id || '');
    } else if (
      targetDivisionId &&
      !departments.some((dp) => dp.id === targetDeptId && dp.divisionId === targetDivisionId)
    ) {
      const firstDept = departments.find((dp) => dp.divisionId === targetDivisionId);
      setTargetDeptId(firstDept?.id || '');
    }
  }, [divisions, departments, divisionHint, targetDivisionId, targetDeptId]);

  const applyDraftToReview = (
    nextDraft: AiSopDraft,
    attachment: SopAttachment | null,
    bulkId: string | null
  ) => {
    setDraft(nextDraft);
    setDraftAttachment(attachment);
    setActiveBulkId(bulkId);
    setConflictReport(null);
    setPendingConflictStatus(null);
    setRelatedRolesText((nextDraft.relatedRoles || []).join(', '));
    setTargetOwnerUid(user.uid);
    setTargetAccessLevel('Umum');
    setTargetAllowedUserUids([user.uid]);
    syncMatchedDivDept(nextDraft.suggestedDivisionName);
  };

  const syncMatchedDivDept = (suggestedDivName: string) => {
    const matchedDiv =
      divisions.find((d) =>
        suggestedDivName
          ? d.name.toLowerCase().includes(suggestedDivName.toLowerCase())
          : false
      ) || divisions[0];
    if (matchedDiv) {
      setTargetDivisionId(matchedDiv.id);
      const firstDept = departments.find((dp) => dp.divisionId === matchedDiv.id);
      setTargetDeptId(firstDept?.id || '');
    }
  };

  const snapshotFileInMemory = async (file: File): Promise<File> => {
    const buffer = await file.arrayBuffer();
    return new File([buffer], file.name, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    });
  };

  const handleSingleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }
    setErrorMsg(null);
    try {
      const buffered = await snapshotFileInMemory(file);
      setSelectedFile(buffered);
    } catch {
      setSelectedFile(null);
      setErrorMsg('File tidak dapat dibaca dari perangkat. Silakan pilih ulang file tersebut.');
    }
  };

  const handleSingleImport = async () => {
    if (!selectedFile && !legacyText.trim()) {
      setErrorMsg('Pilih file PDF, Word, Excel atau tempel teks dokumen lama.');
      return;
    }
    const isPdf = Boolean(
      selectedFile &&
        (selectedFile.type === 'application/pdf' ||
          selectedFile.name.toLowerCase().endsWith('.pdf'))
    );
    setProcessing(true);
    setErrorMsg(null);
    setSavedNotice(null);
    setProcessAlert(
      selectedFile
        ? isPdf
          ? `Proses dimulai: Membaca halaman & gambar pada PDF "${selectedFile.name}" serta mengekstrak SOP dengan AI...`
          : `Proses dimulai: Mengunggah "${selectedFile.name}" dan mengekstrak struktur SOP dengan AI...`
        : 'Proses dimulai: Menganalisis teks dokumen dan menyusun struktur SOP standar...'
    );

    try {
      const freshToken = await getFreshIdToken(idToken);
      const form = new FormData();
      if (selectedFile) form.append('file', selectedFile);
      if (legacyText.trim()) form.append('rawText', legacyText.trim());
      form.append('divisions', JSON.stringify(divisions));
      form.append('divisionHint', divisionHint);

      const [data, pdfVisuals] = await Promise.all([
        fetchApiJson<{
          draft: AiSopDraft;
          attachmentInfo: { name: string; fileType: string; sizeLabel: string; extractedText: string } | null;
        }>(
          '/api/ai/import-sop',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${freshToken}` },
            body: form,
          },
          'Gagal mengekstrak dokumen dengan AI.'
        ),
        selectedFile && isPdf
          ? extractPdfVisualPages(selectedFile)
          : Promise.resolve({ totalPages: 0, visualPages: [] }),
      ]);

      const attachmentObj: SopAttachment | null = data.attachmentInfo
        ? {
            id: makeSafeId('att'),
            ...data.attachmentInfo,
            ...(pdfVisuals.visualPages.length > 0 ? { visualPages: pdfVisuals.visualPages } : {}),
          }
        : null;

      applyDraftToReview(data.draft, attachmentObj, null);
      const visualNote =
        pdfVisuals.visualPages.length > 0
          ? ` (${pdfVisuals.visualPages.length} halaman visual PDF ikut tersimpan)`
          : '';
      setSavedNotice(
        `Ekstraksi selesai! Draft SOP "${data.draft.docNumber} — ${data.draft.title}" siap ditinjau di bawah${visualNote}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses file.');
    } finally {
      setProcessing(false);
      setProcessAlert(null);
    }
  };

  const handleAiWrite = async () => {
    if (!notesInput.trim()) {
      setErrorMsg('Masukkan catatan kasar atau transkrip rapat terlebih dahulu.');
      return;
    }
    setProcessing(true);
    setErrorMsg(null);
    setSavedNotice(null);
    setProcessAlert('Proses dimulai: Menyusun catatan menjadi struktur SOP standar dengan AI...');

    try {
      const freshToken = await getFreshIdToken(idToken);
      const data = await fetchApiJson<{ draft: AiSopDraft }>(
        '/api/ai/write-sop',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            notes: notesInput.trim(),
            titleHint: titleHint.trim(),
            divisionHint,
            divisions,
          }),
        },
        'Gagal menyusun SOP dengan AI.'
      );
      applyDraftToReview(data.draft, null, null);
      setSavedNotice(
        `Penyusunan selesai! Draft SOP "${data.draft.docNumber} — ${data.draft.title}" siap ditinjau di bawah.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyusun SOP.');
    } finally {
      setProcessing(false);
      setProcessAlert(null);
    }
  };

  const handleInterviewStep = async (isInitial: boolean) => {
    if (!employeeRole.trim() || !interviewTopic.trim()) {
      setErrorMsg('Isi peran karyawan dan topik pekerjaan sebelum memulai wawancara handover.');
      return;
    }
    if (!isInitial && !interviewAnswer.trim()) return;

    setProcessing(true);
    setErrorMsg(null);
    setSavedNotice(null);

    const nextTranscript = isInitial
      ? []
      : [...interviewTranscript, { speaker: 'user' as const, text: interviewAnswer.trim() }];
    if (!isInitial) {
      setInterviewTranscript(nextTranscript);
      setInterviewAnswer('');
    }

    try {
      const freshToken = await getFreshIdToken(idToken);
      const data = await fetchApiJson<{
        nextQuestion: string;
        capturedKeyPoints: string[];
        readyToDraft: boolean;
      }>(
        '/api/ai/handover-interview',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            employeeRole: employeeRole.trim(),
            divisionName: divisionHint,
            topic: interviewTopic.trim(),
            transcript: nextTranscript,
          }),
        },
        'Gagal memproses wawancara handover.'
      );

      setInterviewTranscript([
        ...nextTranscript,
        { speaker: 'ai', text: data.nextQuestion },
      ]);
      setCapturedKeyPoints(data.capturedKeyPoints);
      setInterviewReady(data.readyToDraft);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menjalankan wawancara AI.');
    } finally {
      setProcessing(false);
    }
  };

  const handleConvertInterviewToSop = async () => {
    if (interviewTranscript.length === 0) return;
    setProcessing(true);
    setErrorMsg(null);

    const compiledNotes = [
      `Peran Narasumber: ${employeeRole}`,
      `Divisi: ${divisionHint}`,
      `Topik Handover: ${interviewTopic}`,
      capturedKeyPoints.length
        ? `Poin Kunci:\n- ${capturedKeyPoints.join('\n- ')}`
        : '',
      `Transkrip Wawancara:\n${interviewTranscript
        .map((t) => `${t.speaker === 'ai' ? 'Pertanyaan' : 'Jawaban'}: ${t.text}`)
        .join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const freshToken = await getFreshIdToken(idToken);
      const data = await fetchApiJson<{ draft: AiSopDraft }>(
        '/api/ai/write-sop',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            notes: compiledNotes,
            titleHint: interviewTopic,
            divisionHint,
            divisions,
          }),
        },
        'Gagal menyusun SOP dari wawancara.'
      );
      applyDraftToReview(data.draft, null, null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengonversi hasil wawancara.');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    try {
      const bufferedFiles = await Promise.all(files.map(snapshotFileInMemory));
      const items: BulkQueueItem[] = bufferedFiles.map((file) => ({
        id: makeSafeId('q'),
        file,
        status: 'Menunggu',
      }));
      setBulkQueue((prev) => [...prev, ...items]);
    } catch {
      setErrorMsg('Sebagian file gagal dibaca dari perangkat. Silakan pilih ulang file.');
    }
  };

  const runBulkQueue = async () => {
    if (bulkRunning) return;
    const pendingItems = bulkQueue.filter((q) => q.status === 'Menunggu' || q.status === 'Gagal');
    if (pendingItems.length === 0) return;

    const startedAt = Date.now();
    setBulkRunning(true);
    setErrorMsg(null);
    setSavedNotice(null);

    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    setBulkProgress({
      phase: 'running',
      total: pendingItems.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentIndex: 1,
      currentFileName: pendingItems[0].file.name,
      currentStage: 'Proses dimulai: Menyiapkan antrean ekstraksi AI...',
      startedAt,
    });

    for (let idx = 0; idx < pendingItems.length; idx++) {
      const item = pendingItems[idx];

      setBulkProgress({
        phase: 'running',
        total: pendingItems.length,
        completed,
        succeeded,
        failed,
        currentIndex: idx + 1,
        currentFileName: item.file.name,
        currentStage: 'Mengunggah dokumen & mengekstrak struktur SOP dengan AI...',
        startedAt,
      });

      setBulkQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                status: 'Memproses AI',
                stageText: 'Mengunggah & mengekstrak isi dokumen dengan AI...',
                error: undefined,
              }
            : q
        )
      );

      try {
        const isPdf =
          item.file.type === 'application/pdf' ||
          item.file.name.toLowerCase().endsWith('.pdf');
        const freshToken = await getFreshIdToken(idToken);
        const form = new FormData();
        form.append('file', item.file);
        form.append('divisions', JSON.stringify(divisions));

        const [data, pdfVisuals] = await Promise.all([
          fetchApiJson<{
            draft: AiSopDraft;
            attachmentInfo: { name: string; fileType: string; sizeLabel: string; extractedText: string } | null;
          }>(
            '/api/ai/import-sop',
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${freshToken}` },
              body: form,
            },
            'Gagal ekstrak'
          ),
          isPdf
            ? extractPdfVisualPages(item.file)
            : Promise.resolve({ totalPages: 0, visualPages: [] }),
        ]);

        completed += 1;
        succeeded += 1;

        setBulkQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'Siap Ditinjau',
                  stageText: 'Ekstraksi selesai — klik "Tinjau & Simpan" untuk menerbitkan',
                  draft: data.draft,
                  attachment: data.attachmentInfo
                    ? {
                        id: makeSafeId('att'),
                        ...data.attachmentInfo,
                        ...(pdfVisuals.visualPages.length > 0
                          ? { visualPages: pdfVisuals.visualPages }
                          : {}),
                      }
                    : undefined,
                }
              : q
          )
        );
      } catch (err) {
        completed += 1;
        failed += 1;
        setBulkQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'Gagal',
                  stageText: undefined,
                  error: err instanceof Error ? err.message : 'Gagal',
                }
              : q
          )
        );
      }

      setBulkProgress({
        phase: 'running',
        total: pendingItems.length,
        completed,
        succeeded,
        failed,
        currentIndex: Math.min(idx + 2, pendingItems.length),
        currentFileName: pendingItems[idx + 1]?.file.name || item.file.name,
        currentStage:
          idx + 1 < pendingItems.length
            ? `Selesai ${completed}/${pendingItems.length}. Melanjutkan file berikutnya...`
            : 'Menyelesaikan seluruh antrean...',
        startedAt,
      });
    }

    const finishedAt = Date.now();
    setBulkProgress({
      phase: failed > 0 ? 'completed_with_errors' : 'completed',
      total: pendingItems.length,
      completed,
      succeeded,
      failed,
      currentIndex: pendingItems.length,
      currentFileName: pendingItems[pendingItems.length - 1].file.name,
      currentStage:
        failed > 0
          ? `Proses selesai dengan ${succeeded} berhasil dan ${failed} gagal.`
          : `Seluruh ${succeeded} dokumen berhasil diekstrak dan siap ditinjau.`,
      startedAt,
      finishedAt,
    });
    setBulkRunning(false);
  };

  const hasApprovedSops = sops.some((s) => s.status === 'Disetujui');

  const buildDraftCandidateSop = (
    targetStatus: SopStatus,
    divId: string,
    divName: string,
    deptId: string,
    deptName: string
  ): SopDocument => {
    const ownerObj = directory.find((m) => m.uid === targetOwnerUid);
    const parsedRoles = relatedRolesText
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    return {
      id: makeSafeId('sop'),
      docNumber: draft!.docNumber.trim(),
      title: draft!.title.trim(),
      divisionId: divId,
      divisionName: divName,
      departmentId: deptId,
      departmentName: deptName,
      purpose: draft!.purpose,
      scope: draft!.scope,
      ownerUid: targetOwnerUid || '',
      ownerName: ownerObj?.displayName || (targetOwnerUid === user.uid ? user.displayName : ''),
      relatedRoles: parsedRoles.length ? parsedRoles : draft!.relatedRoles,
      sections: draft!.sections.map((s, idx) => ({
        id: makeSafeId('sec'),
        order: idx + 1,
        title: s.title.trim() || `Bagian ${idx + 1}`,
        content: s.content,
      })),
      attachments: draftAttachment ? [draftAttachment] : [],
      effectiveDate,
      nextReviewDate,
      status: targetStatus,
      accessLevel: targetAccessLevel,
      allowedUserUids: targetAccessLevel === 'Rahasia' ? targetAllowedUserUids : [],
      viewerUids: [user.uid],
      version: 1,
      createdByUid: user.uid,
      createdByName: user.displayName,
      approvedByUid: targetStatus === 'Disetujui' ? user.uid : '',
      approvedByName: targetStatus === 'Disetujui' ? user.displayName : '',
    };
  };

  const handleManualConflictCheck = async () => {
    if (!draft) return;
    if (!draft.docNumber.trim() || !draft.title.trim()) {
      setErrorMsg('Nomor Dokumen dan Judul SOP wajib diisi sebelum memeriksa konflik.');
      return;
    }
    setCheckingConflicts(true);
    setErrorMsg(null);
    setPendingConflictStatus(null);
    try {
      const divObj = divisions.find((d) => d.id === targetDivisionId);
      const deptObj = departments.find((d) => d.id === targetDeptId);
      const candidate = buildDraftCandidateSop(
        'Review',
        divObj?.id || targetDivisionId || 'div_preview',
        divObj?.name || draft.suggestedDivisionName || divisionHint || 'Umum',
        deptObj?.id || targetDeptId || 'dept_preview',
        deptObj?.name || draft.suggestedDepartmentName || 'Umum'
      );
      const freshToken = await getFreshIdToken(idToken);
      const report = await runPrePublishConflictCheck({
        candidateSop: candidate,
        allSops: sops,
        idToken: freshToken,
      });
      setConflictReport(report);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memeriksa konflik antar SOP.');
    } finally {
      setCheckingConflicts(false);
    }
  };

  const handleSaveReviewedDraft = async (
    targetStatus: SopStatus,
    skipConflictCheck = false
  ) => {
    if (!draft) return;
    if (!draft.docNumber.trim() || !draft.title.trim()) {
      setErrorMsg('Nomor Dokumen dan Judul SOP wajib diisi sebelum menyimpan.');
      return;
    }
    if (!draft.sections.length) {
      setErrorMsg('Minimal harus terdapat 1 bagian prosedur.');
      return;
    }

    setErrorMsg(null);

    try {
      const freshToken = await getFreshIdToken(idToken);

      if (
        !skipConflictCheck &&
        (targetStatus === 'Review' || targetStatus === 'Disetujui') &&
        hasApprovedSops
      ) {
        setCheckingConflicts(true);
        setProcessAlert(
          `Guardrail AI: Memeriksa potensi konflik & duplikasi "${draft.docNumber}" terhadap SOP Disetujui yang aktif...`
        );
        try {
          const divObj = divisions.find((d) => d.id === targetDivisionId);
          const deptObj = departments.find((d) => d.id === targetDeptId);
          const previewCandidate = buildDraftCandidateSop(
            targetStatus,
            divObj?.id || targetDivisionId || 'div_preview',
            divObj?.name || draft.suggestedDivisionName || divisionHint || 'Umum',
            deptObj?.id || targetDeptId || 'dept_preview',
            deptObj?.name || draft.suggestedDepartmentName || 'Umum'
          );
          const report = await runPrePublishConflictCheck({
            candidateSop: previewCandidate,
            allSops: sops,
            idToken: freshToken,
          });
          setConflictReport(report);
          if (report.hasIssues) {
            setPendingConflictStatus(targetStatus);
            setCheckingConflicts(false);
            setProcessAlert(null);
            return;
          }
        } catch (conflictErr) {
          setErrorMsg(
            conflictErr instanceof Error
              ? conflictErr.message
              : 'Gagal memeriksa konflik pra-publikasi.'
          );
          setCheckingConflicts(false);
          setProcessAlert(null);
          return;
        } finally {
          setCheckingConflicts(false);
        }
      }

      setSavingDraft(true);
      setConflictReport(null);
      setPendingConflictStatus(null);
      setProcessAlert(
        targetStatus === 'Disetujui'
          ? `Proses dimulai: Menyimpan SOP "${draft.docNumber}" dan membuat indeks vektor AI...`
          : `Proses dimulai: Menyimpan SOP "${draft.docNumber}" dengan status ${targetStatus}...`
      );

      const ensured = await ensureDivisionAndDepartment({
        actor: user,
        divisions,
        departments,
        preferredDivisionId: targetDivisionId,
        preferredDepartmentId: targetDeptId,
        suggestedDivisionName: draft.suggestedDivisionName || divisionHint,
        suggestedDepartmentName: draft.suggestedDepartmentName,
      });

      if (ensured.created) {
        setTargetDivisionId(ensured.division.id);
        setTargetDeptId(ensured.department.id);
        await onOrgUpdated?.();
      }

      const newSop = buildDraftCandidateSop(
        targetStatus,
        ensured.division.id,
        ensured.division.name,
        ensured.department.id,
        ensured.department.name
      );

      const saved = await saveSopWithVersionAndIndex({
        sop: newSop,
        isNew: true,
        changeNote: 'Dibuat menggunakan asisten NARA AI',
        actor: user,
        directory,
        idToken: freshToken,
      });

      if (prefillNotes?.logIds?.length) {
        await Promise.allSettled(
          prefillNotes.logIds.map((lid) => markQueryGapResolved(lid, saved.id))
        );
        onClearPrefill?.();
      }

      if (prefillNotes?.meetingId) {
        try {
          await linkSopToMeeting({
            meetingId: prefillNotes.meetingId,
            sop: saved,
            actor: user,
            directory,
          });
          onMeetingSopLinked?.(prefillNotes.meetingId, saved);
        } catch (linkErr) {
          console.error('Failed to link SOP to meeting:', linkErr);
        }
        onClearPrefill?.();
      }

      if (activeBulkId) {
        setBulkQueue((prev) =>
          prev.map((q) => (q.id === activeBulkId ? { ...q, status: 'Tersimpan' } : q))
        );
      }

      onSopCreated(saved);
      setSavedNotice(
        `SOP "${saved.docNumber} — ${saved.title}" berhasil disimpan dengan status ${saved.status}.`
      );
      setDraft(null);
      setDraftAttachment(null);
      setConflictReport(null);
      setPendingConflictStatus(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan SOP hasil AI.');
    } finally {
      setSavingDraft(false);
      setProcessAlert(null);
    }
  };

  const canApprove =
    user.role === 'Super Admin' ||
    (user.role === 'Admin Divisi' && (user.divisionId === targetDivisionId || divisions.length === 0));

  const filteredDepts = departments.filter((d) => d.divisionId === targetDivisionId);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[var(--text)]">
            {t('aiStudio.title')}
          </h1>
          <div className="w-10 h-[3px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <p className="text-xs sm:text-sm text-[var(--text-muted)] pt-0.5">
            {t('aiStudio.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-[#131316] border border-[var(--border)] dark:border-[#33333A] rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'import'
                ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
            }`}
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>AI Import</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('writer')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'writer'
                ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>AI SOP Writer</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('interview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'interview'
                ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
            }`}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" />
            <span>AI Interview Handover</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bulk')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'bulk'
                ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Impor Massal</span>
          </button>
        </div>
      </div>

      {processAlert && (
        <div
          role="status"
          aria-live="polite"
          className="p-3.5 bg-[var(--surface-3)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg text-xs text-neutral-900 dark:text-[#F4F4F5] flex items-center gap-2.5"
        >
          <Loader2 className="w-4 h-4 text-neutral-700 dark:text-[#F4F4F5] animate-spin shrink-0" />
          <span className="font-medium">{processAlert}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 bg-[var(--danger-soft)] dark:bg-rose-950/45 border border-rose-200 dark:border-rose-800/70 rounded-lg text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedNotice && (
        <div className="p-3.5 bg-[var(--success-soft)] dark:bg-emerald-950/45 border border-emerald-200 dark:border-emerald-800/70 rounded-lg text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{savedNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSavedNotice(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 p-0.5 cursor-pointer"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: Single AI Import */}
      {activeTab === 'import' && (
        <div className="bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
                Unggah Dokumen Lama (PDF Teks/Bergambar, Word .docx, Excel .xlsx / .csv)
              </label>
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
                onChange={(e) => {
                  void handleSingleFileSelected(e);
                }}
                className="w-full text-xs text-neutral-700 dark:text-[#A1A1AA] bg-[var(--input-bg)] dark:bg-[#1C1C20] file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-neutral-100 dark:file:bg-[#2f2f2f] file:text-neutral-800 dark:file:text-[#ececec] hover:file:bg-neutral-200 dark:hover:file:bg-[#3a3a3a] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg p-1.5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
                Divisi Tujuan (Opsional)
              </label>
              <select
                value={divisionHint}
                onChange={(e) => setDivisionHint(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5]"
              >
                <option value="">-- Deteksi Otomatis AI --</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                {divisionHint && !divisions.some((d) => d.name === divisionHint) && (
                  <option value={divisionHint}>{divisionHint}</option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
              Atau Tempel Teks Dokumen Lama
            </label>
            <textarea
              rows={4}
              value={legacyText}
              onChange={(e) => setLegacyText(e.target.value)}
              placeholder="Tempel isi dokumen Word/email/catatan kebijakan yang ingin dirapikan menjadi SOP standar..."
              className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={processing}
              onClick={handleSingleImport}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{processing ? 'Mengekstrak & Merapikan SOP...' : 'Ekstrak Menjadi SOP Standar'}</span>
            </button>
            <button
              type="button"
              disabled={processing}
              onClick={() => {
                setSelectedFile(null);
                setDivisionHint(divisions[0]?.name || 'Keuangan & Akuntansi');
                setLegacyText(
                  'MEMO INTERNAL KEBIJAKAN KAS KECIL (PETTY CASH)\nDari: Finance Manager\nAturan baru berlaku mulai bulan depan:\n- Setiap cabang pegang kas kecil maksimal Rp5.000.000.\n- Pengeluaran sekali transaksi dari kas kecil maksimal Rp500.000 (di atas itu wajib transfer dari pusat).\n- Kalau saldo kas kecil sisa di bawah Rp1.000.000, admin cabang ajukan pengisian ulang (top-up) ke Finance AP tiap hari Rabu dengan melampirkan rekap excel + foto semua nota asli.\n- Nota yang hilang atau tidak bermaterai/cap toko tidak bisa diganti kecuali ada berita acara disetujui Kepala Cabang.'
                );
              }}
              className="px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Isi Contoh Dokumen Lama
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: AI SOP Writer */}
      {activeTab === 'writer' && (
        <div className="bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
                Judul / Topik SOP
              </label>
              <input
                type="text"
                value={titleHint}
                onChange={(e) => setTitleHint(e.target.value)}
                placeholder="Contoh: Prosedur Serah Terima Aset Karyawan Resign"
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
                Divisi Terkait
              </label>
              <select
                value={divisionHint}
                onChange={(e) => setDivisionHint(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5]"
              >
                <option value="">-- Deteksi Otomatis AI --</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                {divisionHint && !divisions.some((d) => d.name === divisionHint) && (
                  <option value={divisionHint}>{divisionHint}</option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1.5">
              Catatan Kasar, Poin Alur, atau Transkrip Diskusi
            </label>
            <textarea
              rows={6}
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="Contoh: Kalau ada karyawan resign, H-3 sebelum hari terakhir HR kirim form exit clearance. Laptop dan ID card dikembalikan ke IT & GA, IT cabut akses email dan VPN hari itu juga jam 17.00..."
              className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={processing}
              onClick={handleAiWrite}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{processing ? 'Menyusun Struktur SOP...' : 'Susun SOP Terstruktur dengan AI'}</span>
            </button>
            <button
              type="button"
              disabled={processing}
              onClick={() => {
                setTitleHint('Prosedur Retur Barang Rusak dari Vendor');
                setDivisionHint('Pengadaan & Logistik');
                setNotesInput(
                  'Catatan rapat gudang: Kemarin banyak barang datang penyok tapi supir vendor sudah kabur. Mulai sekarang kalau barang sampai di loading dock, checker gudang wajib buka segel & cek fisik di depan supir. Kalau rusak > 5% atau salah SKU, langsung foto kerusakan, catat di Surat Jalan bagian catatan penolakan, minta tanda tangan supir vendor saat itu juga. Jangan tanda tangan Berita Acara Penerimaan penuh! Dalam 1x24 jam kirim laporan ke Buyer Procurement untuk minta barang pengganti maksimal 3 hari kerja.'
                );
              }}
              className="px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Isi Contoh Catatan Rapat
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: AI Offboarding / Handover Interview (Fase 3) */}
      {activeTab === 'interview' && (
        <div className="bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
              Wawancara Handover Pengetahuan (Offboarding / Karyawan Kunci)
            </h2>
            <p className="text-xs text-neutral-600 dark:text-[#A1A1AA]">
              Gali prosedur kerja yang belum terdokumentasi dari karyawan yang akan resign atau mutasi melalui wawancara terarah AI, lalu ubah menjadi SOP resmi.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Peran / Jabatan Narasumber
              </label>
              <input
                type="text"
                value={employeeRole}
                onChange={(e) => setEmployeeRole(e.target.value)}
                placeholder="Contoh: Senior Finance AP"
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Divisi</label>
              <select
                value={divisionHint}
                onChange={(e) => setDivisionHint(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5]"
              >
                <option value="">-- Umum / Deteksi Otomatis --</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                {divisionHint && !divisions.some((d) => d.name === divisionHint) && (
                  <option value={divisionHint}>{divisionHint}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Topik Tugas yang Diserahterimakan
              </label>
              <input
                type="text"
                value={interviewTopic}
                onChange={(e) => setInterviewTopic(e.target.value)}
                placeholder="Contoh: Rekonsiliasi Pajak & Vendor Bulanan"
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
              />
            </div>
          </div>

          {interviewTranscript.length === 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={processing}
                onClick={() => handleInterviewStep(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {processing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Mulai Sesi Wawancara AI</span>
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={() => {
                  setEmployeeRole('Senior Finance AP (Resign)');
                  setDivisionHint('Keuangan & Akuntansi');
                  setInterviewTopic('Tutup Buku Bulanan & Rekonsiliasi Pembayaran Vendor');
                }}
                className="px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Isi Contoh Skenario Handover
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-[var(--border)] dark:border-[#33333A] rounded-xl bg-[var(--surface-2)] dark:bg-[#131316] p-4 space-y-3 max-h-80 overflow-y-auto">
                {interviewTranscript.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xl rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                        turn.speaker === 'user'
                          ? 'bg-[#f4f4f4] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5]'
                          : 'bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] text-neutral-800 dark:text-[#F4F4F5]'
                      }`}
                    >
                      <span className="block font-semibold mb-0.5 text-neutral-500 dark:text-[#A1A1AA]">
                        {turn.speaker === 'user' ? employeeRole || 'Narasumber' : 'Pewawancara AI'}
                      </span>
                      {turn.text}
                    </div>
                  </div>
                ))}
              </div>

              {capturedKeyPoints.length > 0 && (
                <div className="p-3.5 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg space-y-1.5 text-xs">
                  <p className="font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                    Poin Pengetahuan yang Berhasil Digali ({capturedKeyPoints.length})
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-neutral-700 dark:text-[#A1A1AA]">
                    {capturedKeyPoints.map((pt, i) => (
                      <li key={i}>{pt}</li>
                    ))}
                  </ul>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleInterviewStep(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={interviewAnswer}
                  onChange={(e) => setInterviewAnswer(e.target.value)}
                  disabled={processing}
                  placeholder="Ketik jawaban narasumber di sini..."
                  className="flex-1 px-3.5 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                />
                <button
                  type="submit"
                  disabled={processing || !interviewAnswer.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Kirim Jawaban</span>
                </button>
              </form>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border)] dark:border-[#33333A]">
                <button
                  type="button"
                  onClick={() => {
                    setInterviewTranscript([]);
                    setCapturedKeyPoints([]);
                    setInterviewReady(false);
                  }}
                  className="text-xs text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-800 dark:hover:text-[#F4F4F5] cursor-pointer"
                >
                  Ulangi Wawancara
                </button>
                <button
                  type="button"
                  disabled={processing}
                  onClick={handleConvertInterviewToSop}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    interviewReady
                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                      : 'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
                  }`}
                >
                  {processing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Ubah Hasil Wawancara Menjadi Draft SOP</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Bulk Import Queue */}
      {activeTab === 'bulk' && (
        <div className="bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                Antrean Impor Massal (PDF, Word, Excel)
              </h2>
              <p className="text-xs text-neutral-600 dark:text-[#A1A1AA]">
                Pilih banyak file sekaligus, jalankan ekstraksi antrean AI, lalu tinjau setiap hasil sebelum menyimpan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                <FileUp className="w-3.5 h-3.5" />
                <span>Pilih Banyak File</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
                  onChange={handleBulkFilesSelected}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                disabled={bulkRunning || bulkQueue.every((q) => q.status !== 'Menunggu' && q.status !== 'Gagal')}
                onClick={runBulkQueue}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {bulkRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{bulkRunning ? 'Memproses Antrean...' : 'Proses Antrean AI'}</span>
              </button>
            </div>
          </div>

          {bulkProgress && (
            <div
              role="status"
              aria-live="polite"
              className={`p-4 rounded-lg border space-y-2.5 text-xs ${
                bulkProgress.phase === 'running'
                  ? 'bg-[var(--surface-3)] dark:bg-[#25252A] border-[var(--border)] dark:border-[#33333A] text-neutral-900 dark:text-[#F4F4F5]'
                  : bulkProgress.phase === 'completed'
                    ? 'bg-[var(--success-soft)] dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-800/70 text-emerald-950 dark:text-emerald-100'
                    : 'bg-[var(--warning-soft)] dark:bg-amber-950/45 border-amber-200 dark:border-amber-800/70 text-amber-950 dark:text-amber-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {bulkProgress.phase === 'running' ? (
                    <Loader2 className="w-4 h-4 text-neutral-700 dark:text-[#F4F4F5] animate-spin shrink-0 mt-0.5" />
                  ) : bulkProgress.phase === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold">
                      {bulkProgress.phase === 'running'
                        ? `Proses Antrean AI Berjalan (${bulkProgress.currentIndex}/${bulkProgress.total}): ${bulkProgress.currentFileName}`
                        : bulkProgress.phase === 'completed'
                          ? `Proses Antrean AI Selesai (${bulkProgress.succeeded}/${bulkProgress.total} Berhasil)`
                          : `Proses Antrean AI Selesai dengan Catatan (${bulkProgress.succeeded} Berhasil, ${bulkProgress.failed} Gagal)`}
                    </p>
                    <p className="opacity-90">
                      {bulkProgress.currentStage}
                      {bulkProgress.finishedAt
                        ? ` · Durasi: ${Math.max(
                            1,
                            Math.round((bulkProgress.finishedAt - bulkProgress.startedAt) / 1000)
                          )} detik`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono font-semibold tabular-nums">
                    {bulkProgress.total > 0
                      ? `${Math.round((bulkProgress.completed / bulkProgress.total) * 100)}%`
                      : '0%'}
                  </span>
                  {bulkProgress.phase !== 'running' && (
                    <button
                      type="button"
                      onClick={() => setBulkProgress(null)}
                      className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                      aria-label="Tutup status progress"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full h-2 bg-[var(--surface)]/80 dark:bg-[#131316] border border-black/10 dark:border-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    bulkProgress.phase === 'running'
                      ? 'bg-neutral-900 dark:bg-white'
                      : bulkProgress.phase === 'completed'
                        ? 'bg-emerald-600'
                        : 'bg-amber-500'
                  }`}
                  style={{
                    width: `${
                      bulkProgress.total > 0
                        ? Math.max(
                            bulkProgress.phase === 'running' ? 8 : 100,
                            Math.round((bulkProgress.completed / bulkProgress.total) * 100)
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {bulkQueue.length === 0 ? (
            <div className="p-8 border border-dashed border-[var(--border)] dark:border-[#33333A] rounded-lg text-center text-xs text-neutral-500 dark:text-[#A1A1AA]">
              Belum ada file di antrean. Klik &ldquo;Pilih Banyak File&rdquo; untuk menambahkan dokumen.
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 dark:divide-white/[0.08] border border-[var(--border)] dark:border-[#33333A] rounded-lg">
              {bulkQueue.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 flex items-center justify-between gap-4 text-xs ${
                    item.status === 'Memproses AI' ? 'bg-[var(--surface-3)]/80 dark:bg-[#25252A]' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {item.status === 'Memproses AI' ? (
                      <Loader2 className="w-4 h-4 text-neutral-700 dark:text-[#F4F4F5] animate-spin shrink-0 mt-0.5" />
                    ) : item.status === 'Siap Ditinjau' || item.status === 'Tersimpan' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : item.status === 'Gagal' ? (
                      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900 dark:text-[#F4F4F5] truncate">{item.file.name}</p>
                      <p className="text-neutral-500 dark:text-[#A1A1AA]">
                        Status:{' '}
                        <strong
                          className={
                            item.status === 'Memproses AI'
                              ? 'text-neutral-900 dark:text-[#F4F4F5]'
                              : item.status === 'Siap Ditinjau' || item.status === 'Tersimpan'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : item.status === 'Gagal'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-neutral-800 dark:text-[#F4F4F5]'
                          }
                        >
                          {item.status}
                        </strong>
                        {item.stageText && item.status === 'Memproses AI' && ` · ${item.stageText}`}
                        {item.draft && ` · Hasil: ${item.draft.docNumber} — ${item.draft.title}`}
                        {item.attachment?.visualPages?.length
                          ? ` · ${item.attachment.visualPages.length} halaman visual PDF`
                          : ''}
                        {item.error && ` · ${item.error}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'Siap Ditinjau' && item.draft && (
                      <button
                        type="button"
                        onClick={() => applyDraftToReview(item.draft!, item.attachment || null, item.id)}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-900 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Tinjau & Simpan
                      </button>
                    )}
                    {!bulkRunning && item.status !== 'Memproses AI' && (
                      <button
                        type="button"
                        onClick={() =>
                          setBulkQueue((prev) => prev.filter((q) => q.id !== item.id))
                        }
                        className="p-1.5 text-neutral-400 dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 rounded cursor-pointer"
                        title="Hapus dari antrean"
                        aria-label="Hapus dari antrean"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Human Review & Publish Panel */}
      {draft && (
        <div className="bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border-strong)] dark:border-[#33333A] rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] dark:border-[#33333A] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                Pratinjau & Peninjauan Manusia Sebelum Simpan
              </h2>
              <p className="text-xs text-neutral-600 dark:text-[#A1A1AA]">
                Periksa atau sunting hasil ekstraksi AI sebelum menyimpannya ke Repositori SOP.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5] cursor-pointer"
            >
              Tutup Pratinjau
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Nomor Dokumen
              </label>
              <input
                type="text"
                value={draft.docNumber}
                onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Judul SOP</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Divisi</label>
              <select
                value={targetDivisionId}
                onChange={(e) => {
                  const id = e.target.value;
                  setTargetDivisionId(id);
                  const firstDept = departments.find((d) => d.divisionId === id);
                  setTargetDeptId(firstDept?.id || '');
                }}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              >
                {divisions.length === 0 ? (
                  <option value="">
                    Otomatis: {draft.suggestedDivisionName || divisionHint || 'Operasional Umum'}
                  </option>
                ) : (
                  divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Departemen</label>
              <select
                value={targetDeptId}
                onChange={(e) => setTargetDeptId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              >
                {filteredDepts.length === 0 ? (
                  <option value="">
                    Otomatis: {draft.suggestedDepartmentName || 'Umum'}
                  </option>
                ) : (
                  filteredDepts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Pemilik Proses (Owner)
              </label>
              <select
                value={targetOwnerUid}
                onChange={(e) => setTargetOwnerUid(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              >
                <option value="">-- Belum ditetapkan --</option>
                {directory.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(divisions.length === 0 || filteredDepts.length === 0) && (
            <div className="p-3 bg-[var(--surface-3)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg text-xs text-neutral-800 dark:text-[#F4F4F5]">
              {user.role === 'Super Admin' || user.role === 'Admin Divisi'
                ? 'Struktur Divisi/Departemen pada pilihan ini belum terdaftar. Saat Anda menyimpan, NARA AI akan membuatnya secara otomatis.'
                : 'Divisi/Departemen belum tersedia. Hubungi Super Admin untuk menambahkan Divisi terlebih dahulu.'}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Tujuan</label>
              <textarea
                rows={3}
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Ruang Lingkup
              </label>
              <textarea
                rows={3}
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Peran Terkait (pisahkan koma)
              </label>
              <input
                type="text"
                value={relatedRolesText}
                onChange={(e) => setRelatedRolesText(e.target.value)}
                placeholder="Pemohon, Atasan, Finance AP"
                className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Tanggal Berlaku
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                Review Berikutnya
              </label>
              <input
                type="date"
                value={nextReviewDate}
                onChange={(e) => setNextReviewDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
              />
            </div>
          </div>

          <div className="p-4 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                <Lock className="w-3.5 h-3.5 text-neutral-600 dark:text-[#A1A1AA]" />
                <span>Level Hak Akses SOP</span>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-[#131316] border border-[var(--border)] dark:border-[#33333A] rounded-lg">
                {(['Umum', 'Per Divisi', 'Rahasia'] as AccessLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setTargetAccessLevel(lvl)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      targetAccessLevel === lvl
                        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 dark:shadow-sm'
                        : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
            {targetAccessLevel === 'Rahasia' && (
              <div className="flex flex-wrap gap-2">
                {directory.map((m) => {
                  const checked = targetAllowedUserUids.includes(m.uid);
                  return (
                    <label
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--surface)] dark:bg-[#1C1C20] text-neutral-800 dark:text-[#F4F4F5] border border-[var(--border)] dark:border-[#33333A] rounded-md cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTargetAllowedUserUids((prev) => [...prev, m.uid]);
                          } else {
                            setTargetAllowedUserUids((prev) => prev.filter((id) => id !== m.uid));
                          }
                        }}
                      />
                      <span>{m.displayName}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                Bagian & Langkah Prosedur ({draft.sections.length} bagian)
              </h3>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    sections: [
                      ...draft.sections,
                      {
                        title: `${draft.sections.length + 1}. Bagian Baru`,
                        content: '',
                      },
                    ],
                  })
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Bagian</span>
              </button>
            </div>
            {draft.sections.map((sec, idx) => (
              <div key={idx} className="p-3.5 border border-[var(--border)] dark:border-[#33333A] bg-[var(--surface-2)]/70 dark:bg-[#1C1C20] rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={sec.title}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.map((s, i) =>
                          i === idx ? { ...s, title: e.target.value } : s
                        ),
                      })
                    }
                    className="flex-1 px-2.5 py-1.5 text-sm font-medium bg-[var(--surface)] dark:bg-[#131316] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border)] dark:border-[#33333A] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                  />
                  {draft.sections.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sections: draft.sections.filter((_, i) => i !== idx),
                        })
                      }
                      className="p-1.5 text-neutral-400 dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                      aria-label="Hapus bagian"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={sec.content}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sections: draft.sections.map((s, i) =>
                        i === idx ? { ...s, content: e.target.value } : s
                      ),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-sm bg-[var(--surface)] dark:bg-[#131316] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border)] dark:border-[#33333A] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                />
              </div>
            ))}
          </div>

          {draftAttachment?.visualPages && draftAttachment.visualPages.length > 0 && (
            <div className="space-y-2.5 pt-2 border-t border-[var(--border)] dark:border-[#33333A]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                <ImageIcon className="w-3.5 h-3.5 text-neutral-600 dark:text-[#A1A1AA]" />
                <span>
                  Gambar Utama &amp; Cuplikan Visual PDF yang Diekstrak ({draftAttachment.visualPages.length}{' '}
                  gambar)
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-[#A1A1AA]">
                Potongan gambar utama ini akan ikut disimpan pada SOP dan dapat ditampilkan otomatis saat karyawan bertanya ke AI.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {draftAttachment.visualPages.map((vp, vIdx) => (
                  <button
                    key={`${vp.pageNumber}-${vIdx}`}
                    type="button"
                    onClick={() =>
                      setPreviewZoomImage({ url: vp.dataUrl, caption: vp.caption })
                    }
                    className="group text-left bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] hover:border-neutral-400 dark:hover:border-white/25 rounded-lg overflow-hidden transition-colors cursor-pointer"
                  >
                    <div className="aspect-[4/3] bg-[var(--surface)] overflow-hidden border-b border-[var(--border)] dark:border-[#33333A]">
                      <img
                        src={vp.dataUrl}
                        alt={vp.caption}
                        className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
                      />
                    </div>
                    <p className="p-2 text-[11px] text-neutral-700 dark:text-[#A1A1AA] line-clamp-2">{vp.caption}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {conflictReport && (
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                conflictReport.hasIssues
                  ? 'bg-[var(--warning-soft)] dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/80'
                  : 'bg-[var(--success-soft)] dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {conflictReport.hasIssues ? (
                    <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-neutral-900 dark:text-[#F4F4F5]">
                      {conflictReport.hasIssues
                        ? `Guardrail Konflik Pra-Publikasi (${conflictReport.conflicts.length} temuan)`
                        : 'Aman — Tidak Ada Konflik Terdeteksi'}
                    </h4>
                    <p className="text-xs text-neutral-700 dark:text-[#A1A1AA] mt-0.5">
                      {conflictReport.summary}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setConflictReport(null);
                    setPendingConflictStatus(null);
                  }}
                  className="p-1 text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5] cursor-pointer"
                  aria-label="Tutup laporan guardrail"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {conflictReport.hasIssues && conflictReport.conflicts.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {conflictReport.conflicts.map((item, cIdx) => (
                    <div
                      key={`${item.existingSopId}-${cIdx}`}
                      className="p-2.5 bg-[var(--surface)] dark:bg-[#131316] border border-amber-200 dark:border-amber-800/60 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                          <span className="font-mono text-neutral-700 dark:text-[#F4F4F5]">
                            {item.existingDocNumber}
                          </span>{' '}
                          — {item.existingTitle}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-[var(--surface-3)] dark:bg-[#25252A] text-neutral-700 dark:text-[#F4F4F5] rounded">
                            {item.conflictType}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                              item.severity === 'Tinggi'
                                ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300'
                                : item.severity === 'Sedang'
                                  ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                                  : 'bg-[var(--surface-3)] dark:bg-[#25252A] text-neutral-700 dark:text-[#F4F4F5]'
                            }`}
                          >
                            {item.severity}
                          </span>
                        </div>
                      </div>
                      <p className="text-neutral-700 dark:text-[#A1A1AA]">{item.description}</p>
                      <p className="text-neutral-900 dark:text-[#F4F4F5] font-medium">
                        Saran: {item.recommendation}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {conflictReport.hasIssues && pendingConflictStatus && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConflictReport(null);
                      setPendingConflictStatus(null);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] cursor-pointer"
                  >
                    Perbaiki Draft
                  </button>
                  <button
                    type="button"
                    disabled={savingDraft}
                    onClick={() => handleSaveReviewedDraft(pendingConflictStatus, true)}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer"
                  >
                    Abaikan &amp; Tetap Terbitkan ({pendingConflictStatus})
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[var(--border)] dark:border-[#33333A]">
            {hasApprovedSops && (
              <button
                type="button"
                disabled={savingDraft || checkingConflicts}
                onClick={handleManualConflictCheck}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-neutral-200 dark:hover:bg-[#2F2F36] disabled:opacity-60 cursor-pointer"
              >
                {checkingConflicts ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                <span>{checkingConflicts ? 'Memeriksa Konflik...' : 'Cek Konflik AI'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={savingDraft || checkingConflicts}
              onClick={() => handleSaveReviewedDraft('Draft')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan Draft</span>
            </button>
            <button
              type="button"
              disabled={savingDraft || checkingConflicts}
              onClick={() => handleSaveReviewedDraft('Review')}
              className="px-3.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-[var(--warning-soft)] dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/60 cursor-pointer"
            >
              Ajukan Review
            </button>
            {canApprove && (
              <button
                type="button"
                disabled={savingDraft || checkingConflicts}
                onClick={() => handleSaveReviewedDraft('Disetujui')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {checkingConflicts
                    ? 'Memeriksa Konflik...'
                    : savingDraft
                      ? 'Menyimpan & Mengindeks...'
                      : 'Setujui & Indeks AI'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {previewZoomImage && (
        <div
          onClick={() => setPreviewZoomImage(null)}
          className="fixed inset-0 z-50 bg-[var(--overlay-bg)] dark:bg-black/85 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--surface)] dark:bg-[#131316] rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-[var(--border)] dark:border-[#33333A]"
          >
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-[#33333A] flex items-center justify-between gap-3 bg-[#f9f9f9] dark:bg-[#131316]">
              <p className="text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] truncate">
                {previewZoomImage.caption}
              </p>
              <button
                type="button"
                onClick={() => setPreviewZoomImage(null)}
                className="p-1.5 text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5] rounded-md hover:bg-neutral-200/70 dark:hover:bg-[#2F2F36] cursor-pointer"
                aria-label="Tutup pratinjau gambar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[var(--surface-3)] dark:bg-[#131316] flex items-center justify-center">
              <img
                src={previewZoomImage.url}
                alt={previewZoomImage.caption}
                className="max-w-full max-h-[76vh] object-contain rounded dark:shadow-sm bg-[var(--surface)]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
