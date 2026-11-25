import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  GitBranch,
  History,
  Image as ImageIcon,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  RotateCcw,
  Save,
  ScanText,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import {
  compressImageFileToDataUrl,
  estimateSopMediaBytes,
  MAX_TOTAL_SOP_MEDIA_BYTES,
} from '../lib/imageCompressor';
import { extractPdfVisualPages } from '../lib/pdfVisuals';
import {
  deleteSopAndChunks,
  ensureDivisionAndDepartment,
  fetchSopVersions,
  makeSafeId,
  markQueryGapResolved,
  runPrePublishConflictCheck,
  saveSopWithVersionAndIndex,
  stripSopMediaForAi,
} from '../lib/sopService';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import type {
  AccessLevel,
  Department,
  DirectoryMember,
  Division,
  PrePublishConflictReport,
  QueryLog,
  SopAttachment,
  SopDocument,
  SopFeedbackRevisionResult,
  SopSection,
  SopSectionImage,
  SopStatus,
  SopVersionSnapshot,
  UserProfile,
} from '../types/sop';

interface SopDetailModalProps {
  sop: SopDocument | null;
  initialMode: 'read' | 'edit';
  highlightSection?: string;
  user: UserProfile;
  idToken: string;
  divisions: Division[];
  departments: Department[];
  directory: DirectoryMember[];
  allSops?: SopDocument[];
  revisionContext?: { feedbackLogs: QueryLog[] } | null;
  onFeedbackLogsResolved?: (logIds: string[], sopId: string) => void;
  onClose: () => void;
  onSaved: (saved: SopDocument) => void;
  onDeleted: (sopId: string) => void;
  onOrgUpdated?: () => Promise<void>;
}

export const SopDetailModal: React.FC<SopDetailModalProps> = ({
  sop,
  initialMode,
  highlightSection,
  user,
  idToken,
  divisions,
  departments,
  directory,
  allSops = [],
  revisionContext = null,
  onFeedbackLogsResolved,
  onClose,
  onSaved,
  onDeleted,
  onOrgUpdated,
}) => {
  const isNew = !sop;
  const [mode, setMode] = useState<'read' | 'flowchart' | 'edit' | 'history'>(initialMode);
  const [focusReading, setFocusReading] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [versions, setVersions] = useState<SopVersionSnapshot[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadingSectionIdx, setUploadingSectionIdx] = useState<number | null>(null);
  const [scanningImageId, setScanningImageId] = useState<string | null>(null);
  const [revisingWithAi, setRevisingWithAi] = useState(false);
  const [revisionBanner, setRevisionBanner] = useState<string | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictReport, setConflictReport] = useState<PrePublishConflictReport | null>(null);
  const [pendingConflictStatus, setPendingConflictStatus] = useState<SopStatus | null>(null);
  const [copiedSop, setCopiedSop] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [zoomedPage, setZoomedPage] = useState<{ url: string; caption: string } | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isFocusReading = focusReading && mode === 'read' && Boolean(sop);

  useEffect(() => {
    if (mode !== 'read') {
      setFocusReading(false);
    }
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoomedPage) {
        setZoomedPage(null);
      } else if (isFocusReading) {
        setFocusReading(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedPage, isFocusReading]);

  const updateReadProgress = () => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    setReadProgress(
      maxScroll > 0 ? Math.min(100, Math.round((el.scrollTop / maxScroll) * 100)) : 100
    );
  };

  useEffect(() => {
    if (isFocusReading) {
      requestAnimationFrame(updateReadProgress);
    }
  }, [isFocusReading]);

  const defaultDiv = divisions[0] || { id: '', name: '', code: 'GEN' };
  const defaultDept = departments.find((d) => d.divisionId === defaultDiv.id) || departments[0] || { id: '', name: '' };
  const defaultCode = (defaultDiv.code || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';

  const [docNumber, setDocNumber] = useState(sop?.docNumber || `SOP-${defaultCode}-${String(Math.floor(Math.random() * 900) + 100)}`);
  const [title, setTitle] = useState(sop?.title || '');
  const [divisionId, setDivisionId] = useState(sop?.divisionId || defaultDiv.id);
  const [departmentId, setDepartmentId] = useState(sop?.departmentId || defaultDept.id);
  const [purpose, setPurpose] = useState(sop?.purpose || '');
  const [scope, setScope] = useState(sop?.scope || '');
  const [ownerUid, setOwnerUid] = useState(sop?.ownerUid || user.uid);
  const [relatedRolesText, setRelatedRolesText] = useState((sop?.relatedRoles || []).join(', '));
  const [sections, setSections] = useState<SopSection[]>(
    sop?.sections?.length
      ? sop.sections
      : [{ id: 'sec_1', order: 1, title: '1. Langkah Pelaksanaan', content: '' }]
  );
  const [attachments, setAttachments] = useState<SopAttachment[]>(sop?.attachments || []);
  const [effectiveDate, setEffectiveDate] = useState(sop?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [nextReviewDate, setNextReviewDate] = useState(
    sop?.nextReviewDate ||
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [status, setStatus] = useState<SopStatus>(sop?.status || 'Draft');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(sop?.accessLevel || 'Umum');
  const [allowedUserUids, setAllowedUserUids] = useState<string[]>(sop?.allowedUserUids || [user.uid]);

  const canApprove =
    user.role === 'Super Admin' ||
    (user.role === 'Admin Divisi' && user.divisionId === divisionId);

  const canEdit =
    isNew ||
    canApprove ||
    (user.role === 'Penulis' &&
      (sop?.createdByUid === user.uid || sop?.ownerUid === user.uid) &&
      (sop?.status === 'Draft' || sop?.status === 'Review'));

  useEffect(() => {
    if (!sop || mode !== 'history') return;
    setLoadingVersions(true);
    fetchSopVersions(sop, user)
      .then(setVersions)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat riwayat versi.'))
      .finally(() => setLoadingVersions(false));
  }, [sop, mode, user]);

  useEffect(() => {
    if (!isNew) return;
    if (divisions.length > 0 && !divisions.some((d) => d.id === divisionId)) {
      const firstDiv = divisions[0];
      setDivisionId(firstDiv.id);
      const firstDept = departments.find((dp) => dp.divisionId === firstDiv.id);
      setDepartmentId(firstDept?.id || '');
    } else if (
      divisionId &&
      !departments.some((dp) => dp.id === departmentId && dp.divisionId === divisionId)
    ) {
      const firstDept = departments.find((dp) => dp.divisionId === divisionId);
      setDepartmentId(firstDept?.id || '');
    }
  }, [isNew, divisions, departments, divisionId, departmentId]);

  const filteredDepts = departments.filter((d) => d.divisionId === divisionId);

  const handleDivisionChange = (newDivId: string) => {
    setDivisionId(newDivId);
    const firstDept = departments.find((d) => d.divisionId === newDivId);
    setDepartmentId(firstDept?.id || '');
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    e.target.value = '';
    if (!rawFile) return;
    setErrorMsg(null);
    setUploadingAttachment(true);
    try {
      const buf = await rawFile.arrayBuffer();
      const file = new File([buf], rawFile.name, {
        type: rawFile.type || 'application/octet-stream',
        lastModified: rawFile.lastModified,
      });
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const freshToken = await getFreshIdToken(idToken);
      const form = new FormData();
      form.append('file', file);
      form.append('extractOnly', 'true');
      form.append('divisions', JSON.stringify(divisions));

      const [data, pdfVisuals] = await Promise.all([
        fetchApiJson<{
          attachmentInfo?: { name: string; fileType: string; sizeLabel: string; extractedText: string };
        }>(
          '/api/ai/import-sop',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${freshToken}` },
            body: form,
          },
          'Gagal memproses file lampiran.'
        ),
        isPdf
          ? extractPdfVisualPages(file)
          : Promise.resolve({ totalPages: 0, visualPages: [] }),
      ]);

      if (data.attachmentInfo) {
        setAttachments((prev) => [
          ...prev,
          {
            id: makeSafeId('att'),
            ...data.attachmentInfo!,
            ...(pdfVisuals.visualPages.length > 0
              ? { visualPages: pdfVisuals.visualPages }
              : {}),
          },
        ]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca lampiran.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleCopySopText = async () => {
    if (!sop) return;
    const text = [
      `${sop.docNumber} — ${sop.title} (v${sop.version})`,
      `Divisi: ${sop.divisionName} · Departemen: ${sop.departmentName}`,
      `Owner: ${sop.ownerName || '-'} · Berlaku: ${sop.effectiveDate || '-'}`,
      '',
      `Tujuan:\n${sop.purpose || '-'}`,
      '',
      `Ruang Lingkup:\n${sop.scope || '-'}`,
      '',
      ...sop.sections.map((s) => `${s.order}. ${s.title}\n${s.content}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSop(true);
      setTimeout(() => setCopiedSop(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const analyzeImageWithVisionAi = async (params: {
    dataUrl: string;
    moduleTitle: string;
    fileName?: string;
  }) => {
    const match = /^data:([^;]+);base64,(.+)$/.exec(params.dataUrl);
    if (!match) return null;
    const [, mimeType, imageBase64] = match;
    const freshToken = await getFreshIdToken(idToken);
    return fetchApiJson<{
      suggestedCaption: string;
      ocrText: string;
      matchesModule: boolean;
      mismatchWarning: string;
    }>(
      '/api/ai/analyze-module-image',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          moduleTitle: params.moduleTitle,
          sopTitle: title.trim(),
          fileName: params.fileName || '',
        }),
      },
      'Gagal memindai isi dan kesesuaian gambar modul.'
    );
  };

  const handleSectionImageUpload = async (
    sectionIdx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;

    const targetSec = sections[sectionIdx];
    if (!targetSec) return;

    setErrorMsg(null);
    setUploadingSectionIdx(sectionIdx);
    try {
      let currentMediaBytes = estimateSopMediaBytes({ sections, attachments });
      const addedImages: SopSectionImage[] = [];
      const moduleTitle = targetSec.title.trim() || `Bagian ${sectionIdx + 1}`;

      for (const file of fileList) {
        if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
          throw new Error(`File "${file.name}" bukan format gambar yang didukung (PNG, JPG, WEBP).`);
        }
        const remainingBudget = MAX_TOTAL_SOP_MEDIA_BYTES - currentMediaBytes;
        if (remainingBudget < 14 * 1024) {
          throw new Error(
            'Kapasitas total foto/gambar pada SOP ini sudah mendekati batas penyimpanan dokumen. Hapus gambar yang tidak perlu terlebih dahulu.'
          );
        }
        const perImageTarget = Math.min(55 * 1024, Math.max(18 * 1024, Math.floor(remainingBudget / Math.max(1, fileList.length - addedImages.length))));
        const { dataUrl, bytes } = await compressImageFileToDataUrl(file, {
          maxDimension: 960,
          targetBytes: perImageTarget,
        });
        currentMediaBytes += bytes;

        let suggestedCaption = moduleTitle;
        let ocrText = '';
        let aiWarning = '';
        try {
          const visionRes = await analyzeImageWithVisionAi({
            dataUrl,
            moduleTitle,
            fileName: file.name,
          });
          if (visionRes) {
            if (visionRes.suggestedCaption?.trim()) {
              suggestedCaption = visionRes.suggestedCaption.trim();
            }
            if (visionRes.ocrText?.trim()) {
              ocrText = visionRes.ocrText.trim();
            }
            if (!visionRes.matchesModule && visionRes.mismatchWarning?.trim()) {
              aiWarning = visionRes.mismatchWarning.trim();
            }
          }
        } catch {
          // Abaikan jika Vision AI gagal agar unggahan foto tetap berhasil
        }

        addedImages.push({
          id: makeSafeId('simg'),
          caption: suggestedCaption,
          dataUrl,
          fileName: file.name,
          ...(ocrText ? { ocrText } : {}),
          ...(aiWarning ? { aiWarning } : {}),
        });
      }

      if (addedImages.length > 0) {
        setSections((prev) =>
          prev.map((item, i) =>
            i === sectionIdx
              ? { ...item, images: [...(item.images || []), ...addedImages] }
              : item
          )
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses unggahan foto modul.');
    } finally {
      setUploadingSectionIdx(null);
    }
  };

  const handleRescanModuleImage = async (sectionIdx: number, img: SopSectionImage) => {
    const targetSec = sections[sectionIdx];
    if (!targetSec || !img.dataUrl) return;
    setScanningImageId(img.id);
    setErrorMsg(null);
    try {
      const moduleTitle = targetSec.title.trim() || `Bagian ${sectionIdx + 1}`;
      const visionRes = await analyzeImageWithVisionAi({
        dataUrl: img.dataUrl,
        moduleTitle,
        fileName: img.fileName,
      });
      if (visionRes) {
        setSections((prev) =>
          prev.map((sItem, sIdx) =>
            sIdx === sectionIdx
              ? {
                  ...sItem,
                  images: (sItem.images || []).map((im) =>
                    im.id === img.id
                      ? {
                          ...im,
                          caption:
                            visionRes.suggestedCaption?.trim() || im.caption || moduleTitle,
                          ocrText: visionRes.ocrText?.trim() || im.ocrText || '',
                          aiWarning:
                            !visionRes.matchesModule && visionRes.mismatchWarning?.trim()
                              ? visionRes.mismatchWarning.trim()
                              : '',
                        }
                      : im
                  ),
                }
              : sItem
          )
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memindai ulang OCR AI.');
    } finally {
      setScanningImageId(null);
    }
  };

  const buildCandidatePayload = (
    targetStatus: SopStatus,
    resolvedDivId: string,
    resolvedDivName: string,
    resolvedDeptId: string,
    resolvedDeptName: string
  ): SopDocument => {
    const ownerObj = directory.find((m) => m.uid === ownerUid);
    const nextVersion = isNew ? 1 : (sop?.version || 1) + 1;
    return {
      id: sop?.id || makeSafeId('sop'),
      docNumber: docNumber.trim(),
      title: title.trim(),
      divisionId: resolvedDivId,
      divisionName: resolvedDivName,
      departmentId: resolvedDeptId,
      departmentName: resolvedDeptName,
      purpose: purpose.trim(),
      scope: scope.trim(),
      ownerUid: ownerUid || '',
      ownerName: ownerObj?.displayName || (ownerUid === user.uid ? user.displayName : ''),
      relatedRoles: relatedRolesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sections: sections.map((s, idx) => ({
        ...s,
        order: idx + 1,
        title: s.title.trim() || `Bagian ${idx + 1}`,
      })),
      attachments,
      effectiveDate,
      nextReviewDate,
      status: targetStatus,
      accessLevel,
      allowedUserUids: accessLevel === 'Rahasia' ? allowedUserUids : [],
      viewerUids: sop?.viewerUids || [user.uid],
      version: nextVersion,
      createdByUid: sop?.createdByUid || user.uid,
      createdByName: sop?.createdByName || user.displayName,
      approvedByUid: targetStatus === 'Disetujui' ? user.uid : sop?.approvedByUid || '',
      approvedByName: targetStatus === 'Disetujui' ? user.displayName : sop?.approvedByName || '',
    };
  };

  const handleApplyFeedbackRevision = async () => {
    if (!revisionContext?.feedbackLogs?.length) return;
    setRevisingWithAi(true);
    setErrorMsg(null);
    try {
      const resolvedDivName =
        divisions.find((d) => d.id === divisionId)?.name || sop?.divisionName || 'Umum';
      const resolvedDeptName =
        departments.find((d) => d.id === departmentId)?.name || sop?.departmentName || 'Umum';
      const currentCandidate = buildCandidatePayload(
        status,
        divisionId || sop?.divisionId || '',
        resolvedDivName,
        departmentId || sop?.departmentId || '',
        resolvedDeptName
      );
      const freshToken = await getFreshIdToken(idToken);
      const { revision } = await fetchApiJson<{ revision: SopFeedbackRevisionResult }>(
        '/api/ai/revise-sop-from-feedback',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            sop: stripSopMediaForAi(currentCandidate),
            feedbackItems: revisionContext.feedbackLogs.map((l) => ({
              question: l.question,
              feedback: l.feedback,
              feedbackNote: l.feedbackNote || '',
              userName: l.userName,
            })),
          }),
        },
        'Gagal menyusun draf revisi SOP dari umpan balik.'
      );

      if (revision.title?.trim()) setTitle(revision.title.trim());
      if (revision.purpose?.trim()) setPurpose(revision.purpose.trim());
      if (revision.scope?.trim()) setScope(revision.scope.trim());
      if (Array.isArray(revision.relatedRoles) && revision.relatedRoles.length > 0) {
        setRelatedRolesText(revision.relatedRoles.join(', '));
      }
      if (Array.isArray(revision.sections) && revision.sections.length > 0) {
        setSections((prev) =>
          revision.sections.map((revSec, idx) => {
            const matched =
              (revSec.id ? prev.find((p) => p.id === revSec.id) : undefined) || prev[idx];
            return {
              id: matched?.id || revSec.id || makeSafeId('sec'),
              order: idx + 1,
              title: revSec.title?.trim() || matched?.title || `Bagian ${idx + 1}`,
              content: revSec.content || matched?.content || '',
              ...(matched?.images?.length ? { images: matched.images } : {}),
            };
          })
        );
      }
      if (revision.changeSummary?.trim()) {
        setChangeNote(revision.changeSummary.trim());
      }
      setRevisionBanner(
        revision.revisionNotes?.trim() ||
          'Draf revisi AI berhasil diterapkan dengan tetap mempertahankan lampiran & foto modul yang ada. Silakan tinjau sebelum menyimpan.'
      );
      setConflictReport(null);
      setPendingConflictStatus(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menerapkan draf revisi AI dari umpan balik.'
      );
    } finally {
      setRevisingWithAi(false);
    }
  };

  const hasOtherApprovedSops = allSops.some(
    (s) => s.status === 'Disetujui' && s.id !== sop?.id
  );

  const handleManualConflictCheck = async () => {
    if (!title.trim() || !docNumber.trim()) {
      setErrorMsg('Judul dan Nomor Dokumen wajib diisi sebelum memeriksa konflik.');
      return;
    }
    setCheckingConflicts(true);
    setErrorMsg(null);
    setPendingConflictStatus(null);
    try {
      const resolvedDivName =
        divisions.find((d) => d.id === divisionId)?.name || sop?.divisionName || 'Umum';
      const resolvedDeptName =
        departments.find((d) => d.id === departmentId)?.name || sop?.departmentName || 'Umum';
      const candidate = buildCandidatePayload(
        status,
        divisionId || sop?.divisionId || '',
        resolvedDivName,
        departmentId || sop?.departmentId || '',
        resolvedDeptName
      );
      const freshToken = await getFreshIdToken(idToken);
      const report = await runPrePublishConflictCheck({
        candidateSop: candidate,
        allSops,
        idToken: freshToken,
      });
      setConflictReport(report);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memeriksa konflik antar SOP.'
      );
    } finally {
      setCheckingConflicts(false);
    }
  };

  const handleSave = async (targetStatus: SopStatus, skipConflictCheck = false) => {
    if (!title.trim() || !docNumber.trim()) {
      setErrorMsg('Judul dan Nomor Dokumen wajib diisi.');
      return;
    }
    if (!sections.length || sections.every((s) => !s.title.trim() && !s.content.trim())) {
      setErrorMsg('Minimal harus terdapat 1 bagian prosedur yang terisi.');
      return;
    }
    const totalMediaBytes = estimateSopMediaBytes({ sections, attachments });
    if (totalMediaBytes > MAX_TOTAL_SOP_MEDIA_BYTES) {
      setErrorMsg(
        'Ukuran total foto/gambar pada dokumen SOP melebihi batas penyimpanan. Mohon kurangi jumlah foto atau lampiran visual.'
      );
      return;
    }
    setErrorMsg(null);

    try {
      let resolvedDivId = divisionId;
      let resolvedDivName = divisions.find((d) => d.id === divisionId)?.name || sop?.divisionName || 'Umum';
      let resolvedDeptId = departmentId;
      let resolvedDeptName = departments.find((d) => d.id === departmentId)?.name || sop?.departmentName || 'Umum';

      if (isNew && (!resolvedDivId || !resolvedDeptId)) {
        setSaving(true);
        const ensured = await ensureDivisionAndDepartment({
          actor: user,
          divisions,
          departments,
          preferredDivisionId: divisionId || undefined,
          preferredDepartmentId: departmentId || undefined,
        });
        resolvedDivId = ensured.division.id;
        resolvedDivName = ensured.division.name;
        resolvedDeptId = ensured.department.id;
        resolvedDeptName = ensured.department.name;
        if (ensured.created) {
          setDivisionId(resolvedDivId);
          setDepartmentId(resolvedDeptId);
          await onOrgUpdated?.();
        }
        setSaving(false);
      }

      if (!resolvedDivId || !resolvedDeptId) {
        setErrorMsg('Divisi dan Departemen wajib diisi.');
        setSaving(false);
        return;
      }

      const payload = buildCandidatePayload(
        targetStatus,
        resolvedDivId,
        resolvedDivName,
        resolvedDeptId,
        resolvedDeptName
      );
      const freshToken = await getFreshIdToken(idToken);

      if (
        !skipConflictCheck &&
        (targetStatus === 'Review' || targetStatus === 'Disetujui') &&
        hasOtherApprovedSops
      ) {
        setCheckingConflicts(true);
        try {
          const report = await runPrePublishConflictCheck({
            candidateSop: payload,
            allSops,
            idToken: freshToken,
          });
          setConflictReport(report);
          if (report.hasIssues) {
            setPendingConflictStatus(targetStatus);
            setCheckingConflicts(false);
            return;
          }
        } catch (conflictErr) {
          setErrorMsg(
            conflictErr instanceof Error
              ? conflictErr.message
              : 'Gagal memeriksa guardrail konflik AI sebelum penyimpanan.'
          );
          setCheckingConflicts(false);
          return;
        } finally {
          setCheckingConflicts(false);
        }
      }

      setSaving(true);
      setConflictReport(null);
      setPendingConflictStatus(null);
      const saved = await saveSopWithVersionAndIndex({
        sop: payload,
        isNew,
        changeNote: changeNote.trim() || (targetStatus === 'Disetujui' ? 'Disetujui & diindeks ke AI' : 'Pembaruan dokumen'),
        actor: user,
        directory,
        idToken: freshToken,
      });

      if (
        revisionContext?.feedbackLogs?.length &&
        (targetStatus === 'Review' || targetStatus === 'Disetujui')
      ) {
        const logIds = revisionContext.feedbackLogs.map((l) => l.id);
        await Promise.allSettled(
          logIds.map((lid) => markQueryGapResolved(lid, saved.id))
        );
        onFeedbackLogsResolved?.(logIds, saved.id);
      }

      onSaved(saved);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan SOP.');
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async (snap: SopVersionSnapshot) => {
    if (!sop) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const nextVersion = sop.version + 1;
      const restored: SopDocument = {
        ...sop,
        docNumber: snap.docNumber,
        title: snap.title,
        purpose: snap.purpose,
        scope: snap.scope,
        relatedRoles: snap.relatedRoles,
        sections: snap.sections,
        attachments: snap.attachments,
        effectiveDate: snap.effectiveDate,
        nextReviewDate: snap.nextReviewDate,
        status: canApprove ? snap.status : 'Review',
        accessLevel: snap.accessLevel,
        version: nextVersion,
      };
      const freshToken = await getFreshIdToken(idToken);
      const saved = await saveSopWithVersionAndIndex({
        sop: restored,
        isNew: false,
        changeNote: `Rollback ke versi v${snap.version}`,
        actor: user,
        directory,
        idToken: freshToken,
      });
      onSaved(saved);
      setMode('read');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal melakukan rollback versi.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!sop || !canApprove) return;
    setSaving(true);
    try {
      await deleteSopAndChunks(sop, user, directory);
      setConfirmDeleteOpen(false);
      onDeleted(sop.id);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus SOP.');
      setSaving(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-colors ${
        isFocusReading
          ? 'bg-[var(--overlay-bg)] dark:bg-black/85 p-2 sm:p-4'
          : 'bg-[var(--overlay-bg)] dark:bg-black/75 p-3 sm:p-6'
      }`}
    >
      <div
        className={`border border-[var(--border)] dark:border-[#33333A] rounded-2xl w-full flex flex-col overflow-hidden transition-all ${
          isFocusReading
            ? 'bg-[var(--surface)] dark:bg-[#131316] max-w-5xl h-[94vh] max-h-[94vh] shadow-[var(--modal-shadow)] dark:shadow-2xl'
            : 'bg-[var(--surface)] dark:bg-[#131316] max-w-4xl max-h-[92vh]'
        }`}
      >
        {/* Header */}
        {isFocusReading && sop ? (
          <div className="relative bg-[var(--surface)]/95 dark:bg-[#131316]/95 backdrop-blur-sm border-b border-[var(--border)] dark:border-[#33333A] px-5 sm:px-6 py-2.5 flex items-center justify-between gap-4 shrink-0">
            <div className="min-w-0 flex items-center gap-2.5">
              <BookOpen className="w-4 h-4 text-neutral-600 dark:text-[#A1A1AA] shrink-0" />
              <span className="font-mono text-xs font-semibold text-neutral-900 dark:text-[#F4F4F5] shrink-0">
                {sop.docNumber}
              </span>
              <span className="text-neutral-300 dark:text-[#555555] shrink-0">·</span>
              <h2 className="font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5] truncate">
                {sop.title}
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline font-mono text-[11px] text-neutral-400 dark:text-[#A1A1AA] tabular-nums">
                {readProgress}%
              </span>
              <button
                type="button"
                onClick={() => setFocusReading(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Keluar Mode Fokus</span>
                <span className="hidden sm:inline text-[10px] text-neutral-400 dark:text-[#A1A1AA] font-mono">
                  (Esc)
                </span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-neutral-400 dark:text-[#A1A1AA] hover:text-neutral-700 dark:hover:text-[#F4F4F5] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] transition-colors cursor-pointer"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div
              className="absolute bottom-0 left-0 h-[2px] bg-neutral-900 dark:bg-white transition-[width] duration-150"
              style={{ width: `${readProgress}%` }}
            />
          </div>
        ) : (
          <div className="px-6 py-4 border-b border-[var(--border)] dark:border-[#33333A] bg-[var(--surface)] dark:bg-[#131316] flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-[#A1A1AA]">
                <span className="font-mono font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                  {isNew ? 'SOP BARU' : docNumber}
                </span>
                {!isNew && (
                  <>
                    <span>·</span>
                    <span className="font-mono tabular-nums">v{sop.version}</span>
                    <span>·</span>
                    <span
                      className={`font-medium ${
                        sop.status === 'Disetujui'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : sop.status === 'Review'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-neutral-600 dark:text-[#A1A1AA]'
                      }`}
                    >
                      {sop.status}
                    </span>
                    <span>·</span>
                    <span>{sop.accessLevel}</span>
                  </>
                )}
              </div>
              <h2 className="font-display text-lg font-semibold text-neutral-900 dark:text-[#F4F4F5] truncate mt-0.5">
                {isNew ? 'Buat Dokumen SOP Baru' : title}
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isNew && (
                <div className="flex items-center gap-1 p-1 bg-[var(--surface-3)] dark:bg-[#131316] border border-[var(--border)] dark:border-[#33333A] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setMode('read')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'read'
                        ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                        : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                    }`}
                  >
                    Baca
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('flowchart')}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'flowchart'
                        ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                        : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                    }`}
                  >
                    <GitBranch className="w-3 h-3" />
                    <span>Alur</span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        mode === 'edit'
                          ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                          : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                      }`}
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMode('history')}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      mode === 'history'
                        ? 'bg-[var(--surface)] dark:bg-[#25252A] text-neutral-900 dark:text-[#F4F4F5] dark:shadow-sm'
                        : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                    }`}
                  >
                    <History className="w-3 h-3" />
                    <span>Versi</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-neutral-400 dark:text-[#A1A1AA] hover:text-neutral-700 dark:hover:text-[#F4F4F5] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] transition-colors cursor-pointer"
                aria-label="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div
          ref={bodyScrollRef}
          onScroll={isFocusReading ? updateReadProgress : undefined}
          className={`flex-1 overflow-y-auto ${
            isFocusReading ? 'px-5 sm:px-10 py-8 sm:py-10' : 'p-6 space-y-6'
          }`}
        >
          {errorMsg && (
            <div className="p-3 bg-[var(--danger-soft)] dark:bg-rose-950/45 border border-rose-200 dark:border-rose-800/70 rounded-lg text-xs text-rose-800 dark:text-rose-200">
              {errorMsg}
            </div>
          )}

          {mode === 'read' && sop && (
            <div className={isFocusReading ? 'max-w-2xl mx-auto space-y-8' : 'space-y-6'}>
              {!isFocusReading && (
                <>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFocusReading(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md transition-colors cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Mode Fokus Baca</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopySopText}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-md transition-colors cursor-pointer"
                    >
                      {copiedSop ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedSop ? 'Teks SOP Tersalin' : 'Salin Teks SOP'}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-xl text-xs">
                    <div>
                      <span className="block text-neutral-500 dark:text-[#A1A1AA]">Divisi / Departemen</span>
                      <span className="font-medium text-neutral-900 dark:text-[#F4F4F5]">
                        {sop.divisionName} · {sop.departmentName}
                      </span>
                    </div>
                    <div>
                      <span className="block text-neutral-500 dark:text-[#A1A1AA]">Pemilik Proses (Owner)</span>
                      <span className="font-medium text-neutral-900 dark:text-[#F4F4F5]">
                        {sop.ownerName || 'Belum ditetapkan'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-neutral-500 dark:text-[#A1A1AA]">Tanggal Berlaku</span>
                      <span className="font-mono font-medium text-neutral-900 dark:text-[#F4F4F5] tabular-nums">
                        {sop.effectiveDate || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-neutral-500 dark:text-[#A1A1AA]">Review Berikutnya</span>
                      <span className="font-mono font-medium text-neutral-900 dark:text-[#F4F4F5] tabular-nums">
                        {sop.nextReviewDate || '-'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-500 dark:text-[#A1A1AA] uppercase tracking-wider mb-1">
                        Tujuan
                      </h3>
                      <p className="text-sm text-neutral-800 dark:text-[#F4F4F5] leading-relaxed">{sop.purpose || '-'}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-500 dark:text-[#A1A1AA] uppercase tracking-wider mb-1">
                        Ruang Lingkup
                      </h3>
                      <p className="text-sm text-neutral-800 dark:text-[#F4F4F5] leading-relaxed">{sop.scope || '-'}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-500 dark:text-[#A1A1AA] uppercase tracking-wider mb-1">
                        Peran Terkait
                      </h3>
                      <p className="text-sm text-neutral-800 dark:text-[#F4F4F5]">
                        {sop.relatedRoles.length ? sop.relatedRoles.join(' · ') : '-'}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {isFocusReading && (
                <header className="pb-6 border-b border-[var(--border)] dark:border-[#33333A] space-y-2">
                  <p className="font-mono text-xs font-semibold text-neutral-700 dark:text-[#A1A1AA] tracking-wide">
                    {sop.docNumber} · v{sop.version}
                  </p>
                  <h1 className="font-display text-2xl font-bold text-neutral-900 dark:text-[#F4F4F5] leading-snug">
                    {sop.title}
                  </h1>
                  {sop.purpose && (
                    <p className="text-sm text-neutral-600 dark:text-[#A1A1AA] leading-relaxed pt-1">{sop.purpose}</p>
                  )}
                </header>
              )}

              <div
                className={
                  isFocusReading
                    ? 'space-y-7'
                    : 'space-y-4 pt-4 border-t border-[var(--border)] dark:border-[#33333A]'
                }
              >
                {!isFocusReading && (
                  <h3 className="font-display text-base font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                    Langkah-Langkah & Ketentuan
                  </h3>
                )}
                {sop.sections.map((sec, idx) => {
                  const isHighlighted =
                    highlightSection &&
                    sec.title.toLowerCase().includes(highlightSection.toLowerCase());
                  return (
                    <div
                      key={sec.id || idx}
                      className={
                        isFocusReading
                          ? `pb-7 border-b border-[var(--border)]/80 dark:border-[#33333A] last:border-b-0 space-y-3 ${
                              isHighlighted
                                ? 'border-l-2 border-l-neutral-900 dark:border-l-white pl-4 bg-[var(--surface-2)] dark:bg-[#25252A] rounded-r-lg py-3 pr-3'
                                : ''
                            }`
                          : `p-4 rounded-xl border ${
                              isHighlighted
                                ? 'bg-[var(--surface-3)] dark:bg-[#25252A] border-neutral-400 dark:border-white/25'
                                : 'bg-[var(--surface)] dark:bg-[#1C1C20] border-[var(--border)] dark:border-[#33333A]'
                            } space-y-2`
                      }
                    >
                      <h4
                        className={
                          isFocusReading
                            ? 'font-display text-base font-semibold text-neutral-900 dark:text-[#F4F4F5]'
                            : 'font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]'
                        }
                      >
                        {sec.order}. {sec.title}
                      </h4>
                      <div
                        className={
                          isFocusReading
                            ? 'text-[15px] text-neutral-800 dark:text-[#F4F4F5] leading-[1.85] whitespace-pre-line'
                            : 'text-sm text-neutral-700 dark:text-[#F4F4F5] leading-relaxed whitespace-pre-line'
                        }
                      >
                        {sec.content}
                      </div>
                      {sec.images && sec.images.length > 0 && (
                        <div className="pt-2 space-y-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-[#A1A1AA]">
                            <ImageIcon className="w-3.5 h-3.5 text-neutral-500 dark:text-[#A1A1AA]" />
                            <span>Gambar Panduan Modul ({sec.images.length})</span>
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {sec.images.map((img, imIdx) => (
                              <button
                                key={img.id || imIdx}
                                type="button"
                                onClick={() =>
                                  setZoomedPage({
                                    url: img.dataUrl,
                                    caption: `${sec.title} · ${img.caption}`,
                                  })
                                }
                                className="group text-left bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] hover:border-neutral-400 dark:hover:border-white/25 rounded-lg overflow-hidden transition-colors cursor-pointer"
                              >
                                <div className="aspect-[16/10] bg-[var(--surface)] overflow-hidden border-b border-[var(--border)] dark:border-[#33333A] p-1">
                                  <img
                                    src={img.dataUrl}
                                    alt={img.caption || sec.title}
                                    className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
                                  />
                                </div>
                                <p className="px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 dark:text-[#F4F4F5] truncate">
                                  {img.caption || sec.title}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {isFocusReading && (
                <div className="pt-4 border-t border-[var(--border)] dark:border-[#33333A] flex items-center justify-between text-xs text-neutral-500 dark:text-[#A1A1AA]">
                  <span>Akhir dokumen ({sop.sections.length} bagian)</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        bodyScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] hover:text-neutral-900 dark:hover:text-white bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-md cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      <span>Kembali ke Atas</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFocusReading(false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md cursor-pointer"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span>Tampilkan Info Lengkap</span>
                    </button>
                  </div>
                </div>
              )}

              {!isFocusReading && sop.attachments.length > 0 && (
                <div className="pt-4 border-t border-[var(--border)] dark:border-[#33333A] space-y-2">
                  <h3 className="font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                    Formulir & Lampiran
                  </h3>
                  <div className="space-y-2">
                    {sop.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="p-3 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 font-medium text-neutral-900 dark:text-[#F4F4F5]">
                          <span className="flex items-center gap-1.5">
                            <Paperclip className="w-3.5 h-3.5 text-neutral-500 dark:text-[#A1A1AA]" />
                            {att.name}
                          </span>
                          <span className="font-mono text-neutral-500 dark:text-[#A1A1AA]">
                            {att.fileType} · {att.sizeLabel}
                          </span>
                        </div>
                        {att.extractedText && (
                          <p className="text-neutral-600 dark:text-[#A1A1AA] line-clamp-3">{att.extractedText}</p>
                        )}
                        {att.visualPages && att.visualPages.length > 0 && (
                          <div className="pt-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {att.visualPages.map((vp, vIdx) => (
                              <button
                                key={`${vp.pageNumber}-${vIdx}`}
                                type="button"
                                onClick={() =>
                                  setZoomedPage({ url: vp.dataUrl, caption: vp.caption })
                                }
                                className="group text-left bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] hover:border-neutral-400 dark:hover:border-white/25 rounded-md overflow-hidden transition-colors cursor-pointer"
                              >
                                <div className="aspect-[4/3] bg-[var(--surface)] overflow-hidden border-b border-[var(--border)] dark:border-[#33333A]">
                                  <img
                                    src={vp.dataUrl}
                                    alt={vp.caption}
                                    className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
                                  />
                                </div>
                                <p className="p-1.5 text-[11px] text-neutral-700 dark:text-[#F4F4F5] line-clamp-2">
                                  {vp.caption}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'flowchart' && sop && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)] dark:border-[#33333A]">
                <div>
                  <h3 className="font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                    Flowchart Otomatis Langkah Prosedur
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-[#A1A1AA]">
                    Dibangkitkan otomatis dari struktur bagian dan aturan keputusan pada {sop.docNumber}.
                  </p>
                </div>
                <span className="text-xs text-neutral-500 dark:text-[#A1A1AA] font-mono tabular-nums">
                  {sop.sections.length} Tahap
                </span>
              </div>

              <div className="max-w-2xl mx-auto flex flex-col items-center py-2">
                {/* Start Node */}
                <div className="px-5 py-2 rounded-full border border-emerald-300 dark:border-emerald-700/70 bg-[var(--success-soft)] dark:bg-emerald-950/50 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  Mulai · {sop.relatedRoles[0] || 'Pemohon / Pelaksana'}
                </div>

                {sop.sections.map((sec, secIdx) => {
                  const subSteps = sec.content
                    .split('\n')
                    .map((line) => line.replace(/^(\d+\.|[-*])\s*/, '').trim())
                    .filter(Boolean);
                  const matchedRoles = sop.relatedRoles.filter((role) =>
                    sec.content.toLowerCase().includes(role.split('(')[0].trim().toLowerCase())
                  );

                  return (
                    <React.Fragment key={sec.id || secIdx}>
                      <div className="py-1.5 text-neutral-400 dark:text-[#A1A1AA]">
                        <ArrowDown className="w-4 h-4" />
                      </div>
                      <div className="w-full bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-neutral-900 dark:text-[#F4F4F5] tabular-nums">
                              TAHAP {String(sec.order || secIdx + 1).padStart(2, '0')}
                            </span>
                            <span className="text-neutral-300 dark:text-[#555555]">·</span>
                            <h4 className="font-display text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                              {sec.title}
                            </h4>
                          </div>
                          {matchedRoles.length > 0 && (
                            <span className="text-xs text-neutral-500 dark:text-[#A1A1AA]">
                              PIC: {matchedRoles.join(', ')}
                            </span>
                          )}
                        </div>

                        <div className="space-y-2">
                          {subSteps.map((stepText, stepIdx) => {
                            const isDecision = /\b(jika|bila|kalau|apabila|maksimal|wajib|di atas)\b/i.test(
                              stepText
                            );
                            return (
                              <div
                                key={stepIdx}
                                className={`p-2.5 rounded-lg border text-xs leading-relaxed flex items-start gap-2.5 ${
                                  isDecision
                                    ? 'bg-[var(--warning-soft)] dark:bg-amber-950/35 border-amber-200 dark:border-amber-800/60 text-neutral-800 dark:text-[#F4F4F5]'
                                    : 'bg-[var(--surface-2)] dark:bg-[#1C1C20] border-[var(--border)] dark:border-[#33333A] text-neutral-700 dark:text-[#F4F4F5]'
                                }`}
                              >
                                <span className="font-mono font-semibold text-neutral-500 dark:text-[#A1A1AA] tabular-nums shrink-0 mt-0.5">
                                  {secIdx + 1}.{stepIdx + 1}
                                </span>
                                <span className="min-w-0">
                                  {isDecision && (
                                    <span className="font-semibold text-amber-800 dark:text-amber-300 mr-1">
                                      [Ketentuan / Keputusan]
                                    </span>
                                  )}
                                  {stepText.replace(/\*\*/g, '')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}

                <div className="py-1.5 text-neutral-400 dark:text-[#A1A1AA]">
                  <ArrowDown className="w-4 h-4" />
                </div>
                <div className="px-5 py-2 rounded-full border border-[var(--border-strong)] dark:border-[#33333A] bg-[var(--surface-3)] dark:bg-[#25252A] text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                  Selesai · Terdokumentasi ({sop.docNumber} v{sop.version})
                </div>
              </div>
            </div>
          )}

          {mode === 'history' && sop && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-600 dark:text-[#A1A1AA]">
                Riwayat perubahan dokumen. Admin Divisi atau Super Admin dapat mengembalikan (rollback) ke versi sebelumnya.
              </p>
              {loadingVersions ? (
                <div className="p-4 text-xs text-neutral-500 dark:text-[#A1A1AA]">Memuat riwayat versi...</div>
              ) : versions.length === 0 ? (
                <div className="p-4 text-xs text-neutral-500 dark:text-[#A1A1AA]">Belum ada riwayat versi tersimpan.</div>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="p-4 bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-xl flex items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-neutral-900 dark:text-[#F4F4F5] tabular-nums">
                          v{v.version}
                        </span>
                        <span className="text-neutral-400 dark:text-[#A1A1AA]">·</span>
                        <span className="font-medium text-neutral-700 dark:text-[#A1A1AA]">{v.status}</span>
                        <span className="text-neutral-400 dark:text-[#A1A1AA]">·</span>
                        <span className="text-neutral-600 dark:text-[#A1A1AA]">Oleh {v.editedByName}</span>
                      </div>
                      <p className="text-sm text-neutral-800 dark:text-[#F4F4F5]">{v.changeNote}</p>
                    </div>
                    {canEdit && v.version !== sop.version && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleRollback(v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rollback ke v{v.version}</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {mode === 'edit' && (
            <div className="space-y-5">
              {revisionContext?.feedbackLogs && revisionContext.feedbackLogs.length > 0 && (
                <div className="p-4 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Sparkles className="w-4 h-4 text-neutral-700 dark:text-[#F4F4F5] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-neutral-900 dark:text-[#F4F4F5]">
                          Asisten AI Revisi dari Umpan Balik Karyawan ({revisionContext.feedbackLogs.length} laporan)
                        </h3>
                        <p className="text-[11px] text-neutral-600 dark:text-[#A1A1AA] mt-0.5">
                          AI akan menyempurnakan pasal terkait tanpa menghapus foto modul yang sudah terpasang. Laporan umpan balik otomatis ditandai selesai saat SOP disimpan untuk Review/Persetujuan.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={revisingWithAi || saving}
                      onClick={handleApplyFeedbackRevision}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {revisingWithAi ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {revisingWithAi ? 'Menyusun Revisi AI...' : 'Terapkan Draf Revisi AI'}
                      </span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {revisionContext.feedbackLogs.map((log) => (
                      <div
                        key={log.id}
                        className="px-2.5 py-2 bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-lg text-[11px] space-y-0.5"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-rose-700 dark:text-rose-400">
                            {log.feedback === 'outdated' ? 'SOP Sudah Usang' : 'Tidak Akurat'}
                          </span>
                          <span className="text-neutral-400 dark:text-[#A1A1AA]">·</span>
                          <span className="text-neutral-600 dark:text-[#A1A1AA]">{log.userName}</span>
                        </div>
                        <p className="font-medium text-neutral-900 dark:text-[#F4F4F5]">
                          Pertanyaan: &ldquo;{log.question}&rdquo;
                        </p>
                        {log.feedbackNote && (
                          <p className="text-neutral-600 dark:text-[#A1A1AA]">
                            Catatan: {log.feedbackNote}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {revisionBanner && (
                <div className="p-3 bg-[var(--success-soft)] dark:bg-emerald-950/45 border border-emerald-200 dark:border-emerald-800/70 rounded-lg flex items-start justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200">
                  <div className="flex items-start gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{revisionBanner}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRevisionBanner(null)}
                    className="p-0.5 text-emerald-700 dark:text-emerald-300 hover:opacity-75 cursor-pointer shrink-0"
                    aria-label="Tutup catatan revisi AI"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Nomor Dokumen
                  </label>
                  <input
                    type="text"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Judul SOP
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Contoh: Prosedur Pengajuan Reimbursement Perjalanan Dinas"
                    className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Divisi</label>
                  <select
                    value={divisionId}
                    onChange={(e) => handleDivisionChange(e.target.value)}
                    disabled={!isNew}
                    className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] disabled:bg-[var(--surface-3)] dark:disabled:bg-[#2a2a2a] dark:disabled:text-[#8e8e8e]"
                  >
                    {divisions.length === 0 ? (
                      <option value="">Otomatis: Operasional Umum</option>
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
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Departemen
                  </label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5]"
                  >
                    {filteredDepts.length === 0 ? (
                      <option value="">Otomatis: Umum</option>
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
                    value={ownerUid}
                    onChange={(e) => setOwnerUid(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5]"
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

              {isNew && (divisions.length === 0 || filteredDepts.length === 0) && (
                <div className="p-3 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg text-xs text-neutral-700 dark:text-[#F4F4F5]">
                  {user.role === 'Super Admin' || user.role === 'Admin Divisi'
                    ? 'Divisi/Departemen pada pilihan ini belum terdaftar. Saat Anda menyimpan, NARA AI akan membuatnya secara otomatis.'
                    : 'Divisi/Departemen belum tersedia. Hubungi Super Admin untuk menambahkan Divisi terlebih dahulu.'}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">Tujuan</label>
                  <textarea
                    rows={3}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Ruang Lingkup
                  </label>
                  <textarea
                    rows={3}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
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
                    placeholder="Pemohon, Manager, Finance AP"
                    className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
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
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Tanggal Review Berikutnya
                  </label>
                  <input
                    type="date"
                    value={nextReviewDate}
                    onChange={(e) => setNextReviewDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
                  />
                </div>
              </div>

              {/* Access Level */}
              <div className="p-4 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                    <Lock className="w-3.5 h-3.5 text-neutral-600 dark:text-[#A1A1AA]" />
                    <span>Level Hak Akses SOP</span>
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-lg">
                    {(['Umum', 'Per Divisi', 'Rahasia'] as AccessLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setAccessLevel(lvl)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          accessLevel === lvl
                            ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                            : 'text-neutral-600 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5]'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
                {accessLevel === 'Rahasia' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-neutral-600 dark:text-[#A1A1AA]">
                      Pilih pengguna yang diizinkan membaca dan menanyakan SOP ini ke AI:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {directory.map((m) => {
                        const checked = allowedUserUids.includes(m.uid);
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
                                  setAllowedUserUids((prev) => [...prev, m.uid]);
                                } else {
                                  setAllowedUserUids((prev) => prev.filter((id) => id !== m.uid));
                                }
                              }}
                            />
                            <span>{m.displayName}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Logical Sections Editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                    Bagian & Langkah Prosedur (Dipecah per Bagian untuk AI RAG)
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setSections((prev) => [
                        ...prev,
                        {
                          id: makeSafeId('sec'),
                          order: prev.length + 1,
                          title: `${prev.length + 1}. Bagian Baru`,
                          content: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Bagian</span>
                  </button>
                </div>

                {sections.map((sec, idx) => (
                  <div key={sec.id} className="p-4 border border-[var(--border)] dark:border-[#33333A] bg-[var(--surface)] dark:bg-[#1C1C20] rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-500 dark:text-[#A1A1AA] tabular-nums">
                        #{idx + 1}
                      </span>
                      <input
                        type="text"
                        value={sec.title}
                        onChange={(e) =>
                          setSections((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, title: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Judul bagian / langkah"
                        className="flex-1 px-2.5 py-1.5 text-sm font-medium bg-[var(--surface)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-neutral-400 dark:placeholder:text-[#6B7280] border border-[var(--border)] dark:border-[#33333A] rounded-md"
                      />
                      {sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSections((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 text-neutral-400 dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          aria-label="Hapus bagian"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={4}
                      value={sec.content}
                      onChange={(e) =>
                        setSections((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, content: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Tuliskan langkah kerja terperinci, penanggung jawab, SLA, atau angka batas..."
                      className="w-full px-3 py-2 text-sm bg-[var(--surface)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-neutral-400 dark:placeholder:text-[#6B7280] border border-[var(--border)] dark:border-[#33333A] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900/15 dark:focus:ring-white/20"
                    />

                    {/* Per-Module Photo Upload */}
                    <div className="pt-2 border-t border-neutral-100 dark:border-white/[0.06] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-[#A1A1AA]">
                          <ImageIcon className="w-3.5 h-3.5 text-neutral-500 dark:text-[#A1A1AA]" />
                          <span>
                            Foto / Gambar Modul: <strong className="text-neutral-900 dark:text-[#F4F4F5]">{sec.title || `Bagian ${idx + 1}`}</strong>
                            {sec.images?.length ? ` (${sec.images.length})` : ''}
                          </span>
                        </span>
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                          {uploadingSectionIdx === idx ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {uploadingSectionIdx === idx ? 'Memproses Foto...' : 'Unggah Foto Modul'}
                          </span>
                          <input
                            type="file"
                            multiple
                            disabled={uploadingSectionIdx !== null}
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={(e) => handleSectionImageUpload(idx, e)}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {sec.images && sec.images.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {sec.images.map((img, imIdx) => (
                            <div
                              key={img.id || imIdx}
                              className="bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg p-2 space-y-2"
                            >
                              <div className="relative aspect-[16/10] bg-[var(--surface)] border border-[var(--border)] dark:border-[#33333A] rounded overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setZoomedPage({
                                      url: img.dataUrl,
                                      caption: img.caption || sec.title,
                                    })
                                  }
                                  className="w-full h-full cursor-zoom-in block"
                                  title="Perbesar foto"
                                >
                                  <img
                                    src={img.dataUrl}
                                    alt={img.caption || sec.title}
                                    className="w-full h-full object-contain"
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setZoomedPage({
                                      url: img.dataUrl,
                                      caption: img.caption || sec.title,
                                    })
                                  }
                                  className="absolute top-1.5 right-1.5 p-1 bg-[var(--surface)]/90 dark:bg-[#131316]/90 hover:bg-[var(--surface)] dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded text-neutral-700 dark:text-[#F4F4F5] cursor-pointer"
                                  aria-label="Perbesar foto"
                                >
                                  <Maximize2 className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={img.caption}
                                  onChange={(e) => {
                                    const nextCap = e.target.value;
                                    setSections((prev) =>
                                      prev.map((sItem, sIdx) =>
                                        sIdx === idx
                                          ? {
                                              ...sItem,
                                              images: (sItem.images || []).map((im, j) =>
                                                j === imIdx ? { ...im, caption: nextCap } : im
                                              ),
                                            }
                                          : sItem
                                      )
                                    );
                                  }}
                                  placeholder="Keterangan gambar (sesuai modul)"
                                  className="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--surface)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-neutral-400 dark:placeholder:text-[#6B7280] border border-[var(--border)] dark:border-[#33333A] rounded focus:outline-none focus:ring-1 focus:ring-neutral-900/20 dark:focus:ring-white/25"
                                />
                                <button
                                  type="button"
                                  disabled={scanningImageId === img.id}
                                  onClick={() => handleRescanModuleImage(idx, img)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] border border-[var(--border)] dark:border-[#33333A] rounded cursor-pointer disabled:opacity-60 shrink-0"
                                  title="Pindai teks OCR & cek kesesuaian modul dengan AI Vision"
                                >
                                  {scanningImageId === img.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ScanText className="w-3 h-3" />
                                  )}
                                  <span>OCR AI</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSections((prev) =>
                                      prev.map((sItem, sIdx) =>
                                        sIdx === idx
                                          ? {
                                              ...sItem,
                                              images: (sItem.images || []).filter(
                                                (_, j) => j !== imIdx
                                              ),
                                            }
                                          : sItem
                                      )
                                    )
                                  }
                                  className="p-1 text-neutral-400 dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-[var(--danger-soft)] dark:hover:bg-rose-950/50 cursor-pointer shrink-0"
                                  title="Hapus foto modul"
                                  aria-label="Hapus foto modul"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {img.aiWarning && (
                                <div className="px-2 py-1.5 bg-[var(--warning-soft)] dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 rounded text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>{img.aiWarning}</span>
                                </div>
                              )}
                              {img.ocrText && (
                                <div className="px-2 py-1.5 bg-[var(--surface-3)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded text-[11px] text-neutral-700 dark:text-[#A1A1AA]">
                                  <span className="font-semibold text-neutral-900 dark:text-[#F4F4F5]">AI OCR: </span>
                                  <span className="line-clamp-2">{img.ocrText}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* File Attachments */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-800 dark:text-[#F4F4F5]">
                    Lampiran / Formulir (PDF, Word, Excel)
                  </span>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] hover:bg-neutral-200 dark:hover:bg-[#2F2F36] rounded-md cursor-pointer">
                    {uploadingAttachment ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>{uploadingAttachment ? 'Membaca Lampiran...' : 'Unggah Lampiran'}</span>
                    <input
                      type="file"
                      disabled={uploadingAttachment}
                      accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
                      onChange={handleAttachmentUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--surface-2)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-md text-xs text-neutral-800 dark:text-[#F4F4F5]"
                  >
                    <span className="truncate">
                      {att.name} ({att.fileType} · {att.sizeLabel}
                      {att.visualPages?.length ? ` · ${att.visualPages.length} halaman visual` : ''})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                      }
                      className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer shrink-0"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>

              {!isNew && (
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-[#A1A1AA] mb-1">
                    Catatan Perubahan (untuk riwayat versi)
                  </label>
                  <input
                    type="text"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    placeholder="Contoh: Pembaruan plafon hotel luar kota dan SLA pencairan"
                    className="w-full px-3 py-2 text-sm bg-[var(--input-bg)] dark:bg-[#1C1C20] text-neutral-900 dark:text-[#F4F4F5] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[#6B7280] border border-[var(--border-strong)] dark:border-[#33333A] rounded-lg"
                  />
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
                        <p className="text-xs text-neutral-700 dark:text-[#F4F4F5] mt-0.5">
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
                      className="p-1 text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-800 dark:hover:text-[#F4F4F5] cursor-pointer"
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
                          className="p-2.5 bg-[var(--surface)] dark:bg-[#1C1C20] border border-amber-200 dark:border-amber-800/60 rounded-lg text-xs space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-neutral-900 dark:text-[#F4F4F5]">
                              <span className="font-mono text-neutral-900 dark:text-[#F4F4F5]">
                                {item.existingDocNumber}
                              </span>{' '}
                              — {item.existingTitle}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-[var(--surface-3)] dark:bg-[#25252A] text-neutral-700 dark:text-[#A1A1AA] rounded">
                                {item.conflictType}
                              </span>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                                  item.severity === 'Tinggi'
                                    ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300'
                                    : item.severity === 'Sedang'
                                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                                    : 'bg-[var(--surface-3)] dark:bg-[#25252A] text-neutral-700 dark:text-[#A1A1AA]'
                                }`}
                              >
                                {item.severity}
                              </span>
                            </div>
                          </div>
                          <p className="text-neutral-700 dark:text-[#F4F4F5]">{item.description}</p>
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
                        className="px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] cursor-pointer"
                      >
                        Perbaiki Isi SOP
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSave(pendingConflictStatus, true)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer"
                      >
                        Abaikan &amp; Tetap Simpan ({pendingConflictStatus})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {mode === 'edit' && (
          <div className="px-6 py-4 border-t border-[var(--border)] dark:border-[#33333A] bg-[var(--surface-2)] dark:bg-[#131316] flex flex-wrap items-center justify-between gap-3">
            <div>
              {!isNew && canApprove && (
                <button
                  type="button"
                  disabled={saving || checkingConflicts}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--danger)] dark:text-rose-400 hover:bg-[var(--danger-soft)] dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus SOP</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasOtherApprovedSops && (
                <button
                  type="button"
                  disabled={saving || checkingConflicts}
                  onClick={handleManualConflictCheck}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] bg-[var(--surface-3)] dark:bg-[#25252A] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-neutral-200 dark:hover:bg-[#2F2F36] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                disabled={saving || checkingConflicts}
                onClick={() => handleSave('Draft')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-[#323232] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan Draft</span>
              </button>
              <button
                type="button"
                disabled={saving || checkingConflicts}
                onClick={() => handleSave('Review')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 bg-[var(--warning-soft)] dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Ajukan Review</span>
              </button>
              {canApprove && (
                <>
                  {!isNew && status !== 'Arsip' && (
                    <button
                      type="button"
                      disabled={saving || checkingConflicts}
                      onClick={() => handleSave('Arsip')}
                      className="px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-[#F4F4F5] bg-neutral-200 dark:bg-[#25252A] rounded-lg hover:bg-neutral-300 dark:hover:bg-[#2F2F36] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Arsipkan
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving || checkingConflicts}
                    onClick={() => handleSave('Disetujui')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {checkingConflicts
                        ? 'Memeriksa Konflik...'
                        : saving
                          ? 'Menyimpan & Mengindeks...'
                          : 'Setujui & Indeks AI'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {zoomedPage && (
        <div
          onClick={() => setZoomedPage(null)}
          className="fixed inset-0 z-[60] bg-[var(--overlay-bg)] dark:bg-black/85 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--surface)] dark:bg-[#131316] rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-[var(--border)] dark:border-[#33333A]"
          >
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-[#33333A] bg-[var(--surface)] dark:bg-[#131316] flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-neutral-800 dark:text-[#F4F4F5] truncate">{zoomedPage.caption}</p>
              <button
                type="button"
                onClick={() => setZoomedPage(null)}
                className="p-1.5 text-neutral-500 dark:text-[#A1A1AA] hover:text-neutral-900 dark:hover:text-[#F4F4F5] rounded-md hover:bg-[var(--surface-2)] dark:hover:bg-[#2F2F36] cursor-pointer"
                aria-label="Tutup gambar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[var(--surface-3)] dark:bg-[#141414] flex items-center justify-center">
              <img
                src={zoomedPage.url}
                alt={zoomedPage.caption}
                className="max-w-full max-h-[76vh] object-contain rounded dark:shadow-sm bg-[var(--surface)]"
              />
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={confirmDeleteOpen && Boolean(sop)}
        title={sop ? `Hapus SOP ${sop.docNumber}?` : 'Hapus Dokumen SOP?'}
        description={
          sop ? (
            <>
              Dokumen SOP <strong>{sop.title}</strong> beserta seluruh indeks pencarian AI dan
              lampiran terkait akan dihapus permanen dari repositori.
            </>
          ) : null
        }
        details={
          sop
            ? [
                { label: 'Nomor Dokumen', value: sop.docNumber },
                { label: 'Judul SOP', value: sop.title },
                {
                  label: 'Divisi & Versi',
                  value: `${sop.divisionName || '-'} · v${sop.version || 1}`,
                },
              ]
            : undefined
        }
        confirmLabel="Hapus SOP"
        loading={saving}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
};
