import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useUser } from '@clerk/react';
import {
  Check,
  ClipboardList,
  Clock3,
  FilePlus2,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useLocation } from 'wouter';
import {
  useCreateChecklistItem,
  getGetChecklistQueryKey,
  getGetChecklistStatsQueryKey,
  getListChecklistsQueryKey,
  useCreateChecklist,
  useDeleteChecklist,
  useGetChecklist,
  useGetChecklistStats,
  useListChecklists,
  useUpdateChecklist,
  useUpdateChecklistItem,
} from '@workspace/api-client-react';
import type { Checklist, ChecklistActivity, ChecklistItem, ChecklistStatus } from '@workspace/api-client-react';

const statuses: ChecklistStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const statusLabels: Record<ChecklistStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

function normalizeSourceText(value: string) {
  const trimmed = value.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const looksLikeWorkflowIdentifiers = tokens.length > 1 && tokens.every((token) => /^\d{3}_[\w-]+$/.test(token));
  return looksLikeWorkflowIdentifiers ? tokens.join('\n') : trimmed;
}

function formatRelative(dateValue: string) {
  const seconds = Math.round((Date.now() - new Date(dateValue).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(dateValue).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDate(dateValue: string) {
  return new Date(dateValue).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function patchChecklistItem(queryClient: ReturnType<typeof useQueryClient>, checklistId: number, updatedItem: ChecklistItem) {
  queryClient.setQueryData<Checklist | undefined>(getGetChecklistQueryKey(checklistId), (old) => {
    if (!old?.items) return old;
    const items = old.items.map((current) => current.id === updatedItem.id ? updatedItem : current);
    const completedItems = items.filter((item) => item.status === 'done').length;
    return {
      ...old,
      items,
      totalItems: items.length,
      completedItems,
      progress: items.length ? (completedItems / items.length) * 100 : 0,
    };
  });
  queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
}

function StatCard({ label, value, foot, primary = false }: { label: string; value: string | number; foot: string; primary?: boolean }) {
  return (
    <div className={`stat-card${primary ? ' primary-stat' : ''}`} data-testid={`stat-card-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" data-testid={`text-stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div>
      <div className="stat-foot">{foot}</div>
    </div>
  );
}

function StatusSelect({ item, checklistId, onError }: { item: ChecklistItem; checklistId: number; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const updateItem = useUpdateChecklistItem();
  const updateStatus = (status: ChecklistStatus) => {
    onError('');
    updateItem.mutate({ checklistId, itemId: item.id, data: { status } }, {
      onSuccess: (nextItem) => {
        patchChecklistItem(queryClient, checklistId, nextItem);
      },
      onError: () => onError('Could not update that item. Try again.'),
    });
  };
  return (
    <select
      className={`status-select status-${item.status}`}
      value={item.status}
      disabled={updateItem.isPending}
      onChange={(event) => updateStatus(event.target.value as ChecklistStatus)}
      aria-label={`Status for ${item.title}`}
      data-testid={`select-status-${item.id}`}
    >
      {statuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
    </select>
  );
}

function ChecklistItemRow({ item, checklistId, onError }: { item: ChecklistItem; checklistId: number; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const updateItem = useUpdateChecklistItem();
  const toggleDone = () => {
    onError('');
    const status: ChecklistStatus = item.status === 'done' ? 'todo' : 'done';
    updateItem.mutate({ checklistId, itemId: item.id, data: { status } }, {
      onSuccess: (nextItem) => {
        patchChecklistItem(queryClient, checklistId, nextItem);
      },
      onError: () => onError('Could not update that item. Try again.'),
    });
  };
  return (
    <div className={`item-row status-row-${item.status}`} data-testid={`row-checklist-item-${item.id}`}>
      <button
        className={`check-button${item.status === 'done' ? ' done' : ''}`}
        onClick={toggleDone}
        disabled={updateItem.isPending}
        aria-label={item.status === 'done' ? `Mark ${item.title} as to do` : `Mark ${item.title} as done`}
        data-testid={`button-toggle-item-${item.id}`}
      >
        {updateItem.isPending ? <LoaderCircle size={13} className="animate-spin" /> : item.status === 'done' ? <Check size={14} strokeWidth={3} /> : null}
      </button>
      <div className="item-copy">
        <div className={`item-title${item.status === 'done' ? ' done' : ''}`} data-testid={`text-item-title-${item.id}`}>{item.title}</div>
        <div className={`item-sub item-status-${item.status}`}>{statusLabels[item.status]}</div>
      </div>
      <StatusSelect item={item} checklistId={checklistId} onError={onError} />
    </div>
  );
}

function AuthControl() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  if (!isLoaded) return <div className="auth-skeleton" aria-label="Loading account" />;
  if (!isSignedIn) {
    return (
      <div className="auth-control" data-testid="auth-signed-out">
        <button className="auth-button auth-button-quiet" onClick={() => setLocation('/sign-in')} data-testid="button-auth-login">Log in</button>
        <button className="auth-button auth-button-primary" onClick={() => setLocation('/sign-up')} data-testid="button-auth-signup">Sign up</button>
      </div>
    );
  }

  const displayName = user.firstName?.trim() || user.primaryEmailAddress?.emailAddress || 'Account';
  return (
    <div className="auth-control" data-testid="auth-signed-in">
      <span className="auth-greeting" title={user.primaryEmailAddress?.emailAddress}>{displayName}</span>
      <button className="auth-button auth-button-quiet" onClick={() => void signOut()} data-testid="button-auth-signout">Sign out</button>
    </div>
  );
}

function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
    children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Daymark workspace</p>
            <h2 id="modal-title" className="modal-title">{title}</h2>
            <p className="modal-description">{description}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActivityFeed({ activity, isLoading, hasError }: { activity: ChecklistActivity[]; isLoading: boolean; hasError: boolean }) {
  return (
    <div className="surface activity-panel activity-page-panel">
      <div className="surface-header">
        <div>
          <h2 className="section-title">Recent movement</h2>
          <p className="insight-caption">A running record of what changed across your queues.</p>
        </div>
        <MoreHorizontal size={16} color="hsl(var(--muted-foreground))" />
      </div>
      {isLoading ? (
        <div className="skeleton-list" data-testid="status-activity-loading"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>
      ) : hasError ? (
        <div className="empty-state" data-testid="status-activity-error"><TriangleAlert size={20} /><strong>Activity is taking a moment.</strong><p>Refresh the workspace to try again.</p></div>
      ) : activity.length === 0 ? (
        <div className="empty-state" data-testid="status-activity-empty"><Clock3 size={22} /><strong>Quiet so far.</strong><p>Status changes will show up here.</p></div>
      ) : (
        <div className="activity-list">{activity.map((entry, index) => <div className="activity-row" key={`${entry.checklistId}-${entry.updatedAt}-${index}`}><span className={`activity-dot ${entry.status}`} /><div><div className="activity-title">{entry.itemTitle}</div><div className="activity-context">{entry.checklistTitle} · {statusLabels[entry.status]}</div></div><span className="activity-time">{formatRelative(entry.updatedAt)}</span></div>)}</div>
      )}
    </div>
  );
}

function Home() {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<'overview' | 'checklists' | 'activity'>('checklists');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [mutationMessage, setMutationMessage] = useState('');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [addItemMessage, setAddItemMessage] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const lists = useListChecklists();
  const stats = useGetChecklistStats();
  const selectedQuery = useGetChecklist(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetChecklistQueryKey(selectedId ?? 0) },
  });
  const createChecklist = useCreateChecklist();
  const createChecklistItem = useCreateChecklistItem();
  const updateChecklist = useUpdateChecklist();
  const deleteChecklist = useDeleteChecklist();

  const selected = selectedQuery.data;
  const summaries = lists.data ?? [];
  const activity = stats.data?.recentActivity ?? [];
  const completionRate = stats.data?.completionRate ?? 0;
  const isListError = Boolean(lists.error);
  const hasItems = Boolean(selected?.items?.length);

  const listCountLabel = useMemo(() => `${summaries.length} ${summaries.length === 1 ? 'list' : 'lists'}`, [summaries.length]);
  const firstSummaryId = summaries[0]?.id ?? null;
  const firstSummaryTitle = summaries[0]?.title ?? '';
  const normalizedSourceText = useMemo(() => normalizeSourceText(sourceText), [sourceText]);
  const sourceLineCount = normalizedSourceText ? normalizedSourceText.split('\n').filter(Boolean).length : 0;
  const statusTotals = useMemo(() => [
    { key: 'todo' as const, label: statusLabels.todo, value: stats.data?.todoItems ?? 0 },
    { key: 'in_progress' as const, label: statusLabels.in_progress, value: stats.data?.inProgressItems ?? 0 },
    { key: 'done' as const, label: statusLabels.done, value: stats.data?.completedItems ?? 0 },
    { key: 'blocked' as const, label: statusLabels.blocked, value: stats.data?.blockedItems ?? 0 },
  ], [stats.data?.blockedItems, stats.data?.completedItems, stats.data?.inProgressItems, stats.data?.todoItems]);
  const statusTotal = statusTotals.reduce((sum, item) => sum + item.value, 0);

  useEffect(() => {
    if (selectedId === null && firstSummaryId !== null) {
      setSelectedId(firstSummaryId);
      setTitleDraft(firstSummaryTitle);
    }
  }, [firstSummaryId, firstSummaryTitle, selectedId]);

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceText.trim()) return;
    setMutationMessage('');
    createChecklist.mutate({ data: { sourceText: normalizedSourceText, ...(newTitle.trim() ? { title: newTitle.trim() } : {}) } }, {
      onSuccess: (created) => {
        setSourceText('');
        setNewTitle('');
        setSelectedId(created.id);
        setTitleDraft(created.title);
        setMutationMessage('List created and ready to work.');
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
      },
      onError: () => setMutationMessage('Could not create the list. Check the pasted text and try again.'),
    });
  };

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setMutationMessage('');
    const summary = summaries.find((item) => item.id === id);
    setTitleDraft(summary?.title ?? '');
  };

  const handleSaveTitle = () => {
    if (!selected || !titleDraft.trim() || titleDraft.trim() === selected.title) return;
    setMutationMessage('');
    updateChecklist.mutate({ id: selected.id, data: { title: titleDraft.trim() } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetChecklistQueryKey(updated.id), updated);
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        setMutationMessage('Title saved.');
      },
      onError: () => setMutationMessage('Could not save the title. Try again.'),
    });
  };

  const handleDelete = () => {
    if (!selected) return;
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (!selected) return;
    setMutationMessage('');
    const removedId = selected.id;
    deleteChecklist.mutate({ id: removedId }, {
      onSuccess: () => {
        setIsDeleteConfirmOpen(false);
        const next = summaries.find((item) => item.id !== removedId);
        setSelectedId(next?.id ?? null);
        setTitleDraft(next?.title ?? '');
        queryClient.removeQueries({ queryKey: getGetChecklistQueryKey(removedId) });
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
      },
      onError: () => setMutationMessage('Could not delete the list. Try again.'),
    });
  };

  const handleAddItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !newItemTitle.trim()) return;
    setAddItemMessage('');
    createChecklistItem.mutate({ id: selected.id, data: { title: newItemTitle.trim() } }, {
      onSuccess: (createdItem) => {
        queryClient.setQueryData<Checklist | undefined>(getGetChecklistQueryKey(selected.id), (old) => {
          if (!old) return old;
          const items = [...old.items, createdItem].sort((a, b) => a.position - b.position);
          const completedItems = items.filter((item) => item.status === 'done').length;
          return {
            ...old,
            items,
            totalItems: items.length,
            completedItems,
            progress: items.length ? (completedItems / items.length) * 100 : 0,
          };
        });
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
        setNewItemTitle('');
        setAddItemMessage('');
        setIsAddItemOpen(false);
      },
      onError: () => setAddItemMessage('Could not add that item. Try again.'),
    });
  };

  const sectionCopy = {
    overview: { eyebrow: 'Monday planning desk', title: 'Make a dent.', subtitle: 'A clear read on the work that matters today.' },
    checklists: { eyebrow: 'Work queue', title: 'Get to clear.', subtitle: 'Paste the rough version, then move each item forward.' },
    activity: { eyebrow: 'Workspace pulse', title: 'Keep the motion visible.', subtitle: 'A quick record of what changed across your queues.' },
  }[activeSection];

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">do</div>
          <div className="brand-name">daymark</div>
        </div>
        <div className="sidebar-kicker">Workspace</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={`side-nav-item${activeSection === 'overview' ? ' active' : ''}`} onClick={() => setActiveSection('overview')} aria-current={activeSection === 'overview' ? 'page' : undefined} data-testid="button-nav-overview"><ListChecks size={16} /><span>Overview</span></button>
          <button className={`side-nav-item${activeSection === 'checklists' ? ' active' : ''}`} onClick={() => setActiveSection('checklists')} aria-current={activeSection === 'checklists' ? 'page' : undefined} data-testid="button-nav-checklists"><ClipboardList size={16} /><span>Checklists</span></button>
          <button className={`side-nav-item${activeSection === 'activity' ? ' active' : ''}`} onClick={() => setActiveSection('activity')} aria-current={activeSection === 'activity' ? 'page' : undefined} data-testid="button-nav-recent"><Clock3 size={16} /><span>Recent activity</span></button>
        </nav>
        <div className="sidebar-note">
          <strong>Small steps, visible.</strong>
          Turn the noisy list into the next clear move.
        </div>
      </aside>

      <main className="app-main">
        <div className="content-wrap" id="overview-top">
          <header className="topbar">
            <div>
              <p className="eyebrow">{sectionCopy.eyebrow}</p>
              <h1 className="page-title" data-testid="text-page-title">{sectionCopy.title}</h1>
              <p className="page-subtitle">{sectionCopy.subtitle}</p>
            </div>
            <div className="topbar-right">
              <div className="date-stamp" data-testid="text-current-date">{formatDate(new Date().toISOString())}</div>
              <AuthControl />
            </div>
          </header>

          {activeSection === 'overview' && <section className="overview-page" aria-label="Checklist overview">
          <section className="stats-grid" aria-label="Checklist statistics">
            {stats.isLoading ? (
              [1, 2, 3, 4].map((item) => <div className="stat-card" key={item}><div className="skeleton skeleton-line short" /><div className="skeleton skeleton-line" style={{ marginTop: 18 }} /></div>)
            ) : stats.error ? (
              <div className="error-message" style={{ gridColumn: '1 / -1' }} data-testid="status-stats-error">Stats are taking a moment to load. The workspace is still available.</div>
            ) : (
              <>
                <StatCard label="Completion" value={`${Math.round(completionRate)}%`} foot={`${stats.data?.completedItems ?? 0} of ${stats.data?.totalItems ?? 0} items cleared`} primary />
                <StatCard label="In progress" value={stats.data?.inProgressItems ?? 0} foot="Items moving right now" />
                <StatCard label="Blocked" value={stats.data?.blockedItems ?? 0} foot="Need a decision or handoff" />
                <StatCard label="Lists" value={stats.data?.totalChecklists ?? 0} foot="Your active work queues" />
              </>
            )}
          </section>

          <section className="visual-summary-grid" aria-label="Progress visual summaries">
            <div className="surface insight-panel" data-testid="panel-status-distribution">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Status balance</h2>
                  <p className="insight-caption">Where the work is sitting now</p>
                </div>
                <span className="section-meta">{statusTotal} items</span>
              </div>
              {stats.isLoading ? (
                <div className="insight-loading"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>
              ) : stats.error ? (
                <div className="insight-empty">Status distribution is unavailable while stats reconnect.</div>
              ) : statusTotal === 0 ? (
                <div className="insight-empty" data-testid="status-distribution-empty">Add a checklist to see the work spread.</div>
              ) : (
                <div className="insight-content">
                  <div className="distribution-bar" aria-label="Status distribution">
                    {statusTotals.map((item) => item.value > 0 && <div key={item.key} className={`distribution-segment segment-${item.key}`} style={{ width: `${(item.value / statusTotal) * 100}%` }} title={`${item.label}: ${item.value}`} data-testid={`segment-status-${item.key}`} />)}
                  </div>
                  <div className="status-legend">
                    {statusTotals.map((item) => <div className="legend-item" key={item.key} data-testid={`legend-status-${item.key}`}><span className={`legend-dot dot-${item.key}`} /><span>{item.label}</span><strong>{item.value}</strong></div>)}
                  </div>
                </div>
              )}
            </div>
            <div className="surface insight-panel" data-testid="panel-checklist-comparison">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">List momentum</h2>
                  <p className="insight-caption">Progress by checklist</p>
                </div>
                <span className="section-meta">{listCountLabel}</span>
              </div>
              {lists.isLoading ? (
                <div className="insight-loading"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>
              ) : isListError ? (
                <div className="insight-empty">Checklist comparison is unavailable while lists reconnect.</div>
              ) : summaries.length === 0 ? (
                <div className="insight-empty" data-testid="checklist-comparison-empty">Your checklist progress will compare here.</div>
              ) : (
                <div className="comparison-list">
                  {summaries.slice(0, 6).map((summary) => <div className="comparison-row" key={summary.id} data-testid={`comparison-checklist-${summary.id}`}>
                    <div className="compare-label"><span title={summary.title}>{summary.title}</span><strong>{Math.round(summary.progress)}%</strong></div>
                    <div className="compare-track"><div className="compare-fill" style={{ width: `${Math.min(100, Math.max(0, summary.progress))}%` }} /></div>
                  </div>)}
                </div>
              )}
            </div>
          </section>
          </section>}

          {activeSection === 'checklists' && <div className="workspace-grid checklist-page" id="checklists-page">
            <section>
              <div className="paste-panel">
                <div className="paste-heading">
                  <div className="paste-icon"><Zap size={15} /></div>
                  <div className="paste-copy">
                    <h2>Drop in the messy version.</h2>
                    <p>Paste bullets on separate lines, or drop in a compact workflow line. We’ll turn it into a queue you can move through.</p>
                  </div>
                </div>
                <form className="paste-form" onSubmit={handleCreate}>
                  <div>
                    <label className="field-label" htmlFor="new-list-title">Name it <span style={{ opacity: .55 }}>(optional)</span></label>
                    <input id="new-list-title" className="text-input" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="e.g. Tuesday launch prep" data-testid="input-new-checklist-title" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="source-text">Your bullets</label>
                    <textarea id="source-text" className="text-area" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={'Confirm launch date\nSend the revised deck\nAsk Priya for the numbers'} data-testid="textarea-source-text" />
                  </div>
                  <div className="button-row">
                    <span className="inline-message">{sourceText.trim() ? `${sourceLineCount} ${sourceLineCount === 1 ? 'item' : 'items'} ready` : 'Nothing queued yet'}</span>
                    <button type="submit" className="primary-button" disabled={!sourceText.trim() || createChecklist.isPending} data-testid="button-create-checklist">
                      {createChecklist.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Creating…</> : <><FilePlus2 size={13} /> Create list</>}
                    </button>
                  </div>
                </form>
              </div>

              <div className="surface list-panel">
                <div className="surface-header">
                  <h2 className="section-title">Your lists</h2>
                  <span className="section-meta" data-testid="text-checklist-count">{listCountLabel}</span>
                </div>
                {lists.isLoading ? (
                  <div className="skeleton-list" data-testid="status-checklists-loading">
                    {[1, 2, 3, 4].map((item) => <div key={item}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" style={{ marginTop: 8 }} /></div>)}
                  </div>
                ) : isListError ? (
                  <div className="empty-state"><TriangleAlert size={23} /><strong>Couldn’t load your lists</strong><p>Refresh the workspace and we’ll try again.</p><button className="quiet-button" style={{ marginTop: 14 }} onClick={() => lists.refetch()} data-testid="button-retry-checklists"><RefreshCw size={13} /> Retry</button></div>
                ) : summaries.length === 0 ? (
                  <div className="empty-state" data-testid="status-checklists-empty"><ClipboardList size={24} /><strong>Your next clear win starts here.</strong><p>Paste a rough list above and it will appear in this space.</p></div>
                ) : (
                  <div className="list-body">
                    {summaries.map((summary) => (
                      <button key={summary.id} className={`checklist-row${selectedId === summary.id ? ' selected' : ''}`} onClick={() => handleSelect(summary.id)} data-testid={`button-select-checklist-${summary.id}`}>
                        <span><span className="row-title">{summary.title}</span><span className="row-meta">{summary.completedItems}/{summary.totalItems} done · {formatRelative(summary.updatedAt)}</span></span>
                        <span className="row-progress">{Math.round(summary.progress)}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="surface detail-panel">
                {!selectedId ? (
                  <div className="empty-state" style={{ padding: '86px 25px' }} data-testid="status-detail-empty"><ListChecks size={30} /><strong>Select a list to get moving.</strong><p>Your items, status, and progress will stay in view here.</p></div>
                ) : selectedQuery.isLoading ? (
                  <div className="skeleton-list" style={{ padding: 28 }} data-testid="status-detail-loading"><div className="skeleton skeleton-line" style={{ width: '60%', height: 24 }} /><div className="skeleton skeleton-line short" /><div className="skeleton skeleton-line" style={{ marginTop: 30 }} /><div className="skeleton skeleton-line" style={{ marginTop: 12 }} /></div>
                ) : selectedQuery.error || !selected ? (
                  <div className="empty-state"><TriangleAlert size={24} /><strong>That list couldn’t open.</strong><p>Try selecting it again from your lists.</p><button className="quiet-button" style={{ marginTop: 14 }} onClick={() => selectedQuery.refetch()} data-testid="button-retry-detail"><RefreshCw size={13} /> Retry</button></div>
                ) : (
                  <>
                    <div className="detail-header">
                      <div className="detail-heading">
                        <input className="text-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={handleSaveTitle} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleSaveTitle(); } }} aria-label="Checklist title" data-testid="input-checklist-title" />
                        <div className="detail-date">Updated {formatRelative(selected.updatedAt)} · started {new Date(selected.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                      </div>
                      <div className="detail-actions">
                        <button className="danger-button" onClick={handleDelete} disabled={deleteChecklist.isPending} data-testid="button-delete-checklist"><Trash2 size={13} /> <span className="sr-only">Delete list</span></button>
                        <button className="quiet-button" onClick={() => { setNewItemTitle(''); setAddItemMessage(''); setIsAddItemOpen(true); }} disabled={!selected} data-testid="button-add-checklist-item"><Plus size={13} /> <span className="sr-only">Add item</span></button>
                        <button className="quiet-button" onClick={() => selectedQuery.refetch()} data-testid="button-refresh-checklist"><RefreshCw size={13} /></button>
                      </div>
                    </div>
                    <div className="progress-cluster">
                      <div className="progress-line"><span><strong>{selected.completedItems}</strong> of {selected.totalItems} items complete</span><span className="progress-number">{Math.round(selected.progress)}%</span></div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, selected.progress))}%` }} /></div>
                    </div>
                    <div className="items-header"><h3>Work queue</h3><span className="section-meta">{hasItems ? `${selected.items.length} items` : 'clear'}</span></div>
                    {mutationMessage && <div className="inline-message" style={{ padding: '0 21px 9px' }} data-testid="status-mutation-message">{mutationMessage}</div>}
                    {selectedQuery.error && <div className="error-message" style={{ margin: '0 21px 12px' }} data-testid="status-item-error">{mutationMessage}</div>}
                    {hasItems ? <div className="items-list">{selected.items.map((item) => <ChecklistItemRow key={item.id} item={item} checklistId={selected.id} onError={setMutationMessage} />)}</div> : <div className="empty-state"><Check size={24} /><strong>Nothing left to do.</strong><p>This queue is clear. Add another list when the next one lands.</p></div>}
                  </>
                )}
              </div>

            </section>
          </div>
          }

          {activeSection === 'activity' && <section className="activity-page" id="recent-activity" aria-label="Recent activity">
            <ActivityFeed activity={activity} isLoading={stats.isLoading} hasError={Boolean(stats.error)} />
          </section>}
        </div>
      </main>
      {isAddItemOpen && selected && (
        <Modal
          title="Add one more move"
          description={`Add a new item to “${selected.title}”. It will start as To do.`}
          onClose={() => { if (!createChecklistItem.isPending) setIsAddItemOpen(false); }}
        >
          <form className="modal-form" onSubmit={handleAddItem}>
            <label className="field-label" htmlFor="new-item-title">Item name</label>
            <input
              id="new-item-title"
              className="text-input"
              value={newItemTitle}
              onChange={(event) => setNewItemTitle(event.target.value)}
              placeholder="e.g. Review the signed agreement"
              autoFocus
              data-testid="input-new-checklist-item"
            />
            {addItemMessage && <div className="error-message" data-testid="status-add-item-error">{addItemMessage}</div>}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setIsAddItemOpen(false)} disabled={createChecklistItem.isPending}>Cancel</button>
              <button type="submit" className="primary-button" disabled={!newItemTitle.trim() || createChecklistItem.isPending} data-testid="button-submit-checklist-item">
                {createChecklistItem.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Adding…</> : <><Plus size={13} /> Add item</>}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {isDeleteConfirmOpen && selected && (
        <Modal
          title="Delete this checklist?"
          description={`“${selected.title}” and its items will be removed. This cannot be undone.`}
          onClose={() => { if (!deleteChecklist.isPending) setIsDeleteConfirmOpen(false); }}
        >
          <div className="modal-actions modal-actions-delete">
            <button type="button" className="quiet-button" onClick={() => setIsDeleteConfirmOpen(false)} disabled={deleteChecklist.isPending}>Keep it</button>
            <button type="button" className="danger-button danger-confirm" onClick={confirmDelete} disabled={deleteChecklist.isPending}>
              {deleteChecklist.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Deleting…</> : <><Trash2 size={13} /> Delete checklist</>}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Home;