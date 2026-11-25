import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  FolderTree,
  Lock,
  Plus,
  Search,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { Department, Division, SopDocument, SopStatus, UserProfile } from '../types/sop';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';

interface SopRepositoryViewProps {
  user: UserProfile;
  divisions: Division[];
  departments: Department[];
  sops: SopDocument[];
  onSelectSop: (sop: SopDocument, mode: 'read' | 'edit') => void;
  onCreateNewSop: () => void;
}

export const SopRepositoryView: React.FC<SopRepositoryViewProps> = ({
  user,
  divisions,
  departments,
  sops,
  onSelectSop,
  onCreateNewSop,
}) => {
  const { t, formatNumber } = useI18n();
  const [selectedDivId, setSelectedDivId] = useState<string>('all');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'Semua' | SopStatus>('Semua');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const canCreate = user.role !== 'Karyawan';
  const today = new Date().toISOString().slice(0, 10);

  const filteredSops = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sops
      .filter((sop) => {
        if (selectedDivId !== 'all' && sop.divisionId !== selectedDivId) return false;
        if (selectedDeptId !== 'all' && sop.departmentId !== selectedDeptId) return false;
        if (statusFilter !== 'Semua' && sop.status !== statusFilter) return false;
        if (onlyAttention) {
          const missingOwner = !sop.ownerUid || !sop.ownerName;
          const pastReview =
            sop.status === 'Disetujui' && Boolean(sop.nextReviewDate) && sop.nextReviewDate < today;
          if (!missingOwner && !pastReview) return false;
        }
        if (q) {
          const haystack = [
            sop.docNumber,
            sop.title,
            sop.purpose,
            sop.scope,
            sop.ownerName,
            sop.divisionName,
            sop.departmentName,
            ...sop.sections.map((s) => `${s.title} ${s.content}`),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.docNumber.localeCompare(b.docNumber));
  }, [sops, selectedDivId, selectedDeptId, statusFilter, onlyAttention, searchQuery, today]);

  const sopPaging = useTablePagination(filteredSops, {
    defaultPageSize: 15,
    storageKey: 'sop_repository',
  });

  const hasActiveFilter =
    selectedDivId !== 'all' ||
    selectedDeptId !== 'all' ||
    statusFilter !== 'Semua' ||
    onlyAttention ||
    Boolean(searchQuery.trim());

  const resetFilters = () => {
    setSelectedDivId('all');
    setSelectedDeptId('all');
    setStatusFilter('Semua');
    setOnlyAttention(false);
    setSearchQuery('');
  };

  const getStatusLabel = (st: 'Semua' | SopStatus): string => {
    switch (st) {
      case 'Semua':
        return t('sop.statusAll');
      case 'Disetujui':
        return t('sop.statusApproved');
      case 'Review':
        return t('sop.statusReview');
      case 'Draft':
        return t('sop.statusDraft');
      case 'Arsip':
        return t('sop.statusArchive');
    }
  };

  const getAccessLabel = (level: SopDocument['accessLevel']): string => {
    if (level === 'Umum') return t('sop.accessGeneral');
    if (level === 'Rahasia') return t('sop.accessConfidential');
    return t('sop.accessDivision');
  };

  const statusIcon = (st: SopStatus) => {
    if (st === 'Disetujui') return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />;
    if (st === 'Review') return <Clock className="w-3.5 h-3.5 text-[var(--warning)] shrink-0" />;
    return <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col lg:flex-row bg-[var(--bg)]">
      {/* Left Structure Tree: Divisi > Departemen */}
      <aside className="lg:w-72 border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-4 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-[var(--text)] flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
            <span>{t('sop.orgStructure')}</span>
          </h2>
          <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
            {t('sop.sopCount', { count: formatNumber(sops.length) })}
          </span>
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => {
              setSelectedDivId('all');
              setSelectedDeptId('all');
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${
              selectedDivId === 'all'
                ? 'bg-[var(--accent-soft)] text-[var(--text)] font-semibold'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
            }`}
          >
            <span>{t('sop.allDivisions')}</span>
            <span className="font-mono tabular-nums text-[var(--text-muted)]">
              {formatNumber(sops.length)}
            </span>
          </button>

          {divisions.map((div) => {
            const divDepts = departments.filter((d) => d.divisionId === div.id);
            const divCount = sops.filter((s) => s.divisionId === div.id).length;
            const isDivActive = selectedDivId === div.id;

            return (
              <div key={div.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDivId(div.id);
                    setSelectedDeptId('all');
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${
                    isDivActive && selectedDeptId === 'all'
                      ? 'bg-[var(--accent-soft)] text-[var(--text)] font-semibold'
                      : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <span className="truncate text-left">{div.name}</span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0 ml-2">
                    {formatNumber(divCount)}
                  </span>
                </button>

                {divDepts.map((dept) => {
                  const deptCount = sops.filter((s) => s.departmentId === dept.id).length;
                  const isDeptActive = selectedDeptId === dept.id;
                  return (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => {
                        setSelectedDivId(div.id);
                        setSelectedDeptId(dept.id);
                      }}
                      className={`w-full flex items-center justify-between pl-6 pr-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                        isDeptActive
                          ? 'bg-[var(--accent-soft)] text-[var(--text)] font-semibold'
                          : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                      }`}
                    >
                      <span className="truncate text-left flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                        <span className="truncate">{dept.name}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[var(--text-muted)] shrink-0 ml-2">
                        {formatNumber(deptCount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Repository List */}
      <section className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 min-w-0 max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold text-[var(--text)]">
              {t('sop.title')}
            </h1>
            <div className="w-10 h-[3px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <p className="text-xs sm:text-sm text-[var(--text-muted)] pt-0.5">
              {t('sop.subtitle')}
            </p>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={onCreateNewSop}
              className="inline-flex items-center gap-2 h-10 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('sop.createNew')}</span>
            </button>
          )}
        </div>

        {/* Search & Status Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sop.searchPlaceholder')}
              className="w-full h-10 pl-10 pr-4 text-sm bg-[var(--surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-x-auto">
              {(['Semua', 'Disetujui', 'Review', 'Draft', 'Arsip'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {getStatusLabel(st)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOnlyAttention((v) => !v)}
              className={`h-10 px-3.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                onlyAttention
                  ? 'bg-[var(--warning)]/14 border-[var(--warning)]/50 text-[var(--warning)] font-semibold'
                  : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {t('sop.needsAttention')}
            </button>
          </div>
        </div>

        {/* High-Density SOP List */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          {filteredSops.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-[var(--text)]">
                {t('sop.emptyTitle')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {t('sop.emptyDesc')}
              </p>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center h-9 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
                >
                  {t('common.resetFilter')}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="divide-y divide-[var(--border)]">
                {sopPaging.paginatedItems.map((sop) => {
                const isOverdue =
                  sop.status === 'Disetujui' &&
                  sop.nextReviewDate &&
                  sop.nextReviewDate < today;

                return (
                  <div
                    key={sop.id}
                    onClick={() => onSelectSop(sop, 'read')}
                    className="p-4 hover:bg-[var(--surface-2)]/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span className="font-mono font-semibold text-[var(--accent-text)]">
                          {sop.docNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">v{sop.version}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {sop.divisionName} / {sop.departmentName}
                        </span>
                        {sop.accessLevel !== 'Umum' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-[var(--text)] font-medium">
                              <Lock className="w-3 h-3" />
                              {getAccessLabel(sop.accessLevel)}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-[var(--text)] truncate">
                        {sop.title}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] line-clamp-1">{sop.purpose}</p>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1.5 shrink-0 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-[var(--text)]">
                        {statusIcon(sop.status)}
                        <span>{getStatusLabel(sop.status)}</span>
                      </div>
                      <div className="text-[var(--text-muted)] font-mono tabular-nums">
                        {sop.ownerName ? sop.ownerName : t('sop.noOwner')}
                        {isOverdue && (
                          <span className="ml-2 text-[var(--danger)] font-sans font-medium">
                            · {t('sop.overdueReview')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <TablePaginationBar {...sopPaging.paginationProps} />
            </>
          )}
        </div>
      </section>
    </div>
  );
};
