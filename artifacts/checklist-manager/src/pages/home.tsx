import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ClipboardList,
  Clock3,
  FilePlus2,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import {
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
import type { ChecklistItem, ChecklistStatus } from '@workspace/api-client-react';

const statuses: ChecklistStatus[] = ['todo', 'in_progress', 'done', 'blocked'];
const statusLabels: Record<ChecklistStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

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
        queryClient.setQueryData(getGetChecklistQueryKey(checklistId), (old: { items?: ChecklistItem[] } | undefined) => {
          if (!old?.items) return old;
          return { ...old, items: old.items.map((current) => current.id === nextItem.id ? nextItem : current) };
        });
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
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
        queryClient.setQueryData(getGetChecklistQueryKey(checklistId), (old: { items?: ChecklistItem[] } | undefined) => {
          if (!old?.items) return old;
          return { ...old, items: old.items.map((current) => current.id === nextItem.id ? nextItem : current) };
        });
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
      },
      onError: () => onError('Could not update that item. Try again.'),
    });
  };
  return (
    <div className="item-row" data-testid={`row-checklist-item-${item.id}`}>
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
        <div className="item-sub">{statusLabels[item.status]}</div>
      </div>
      <StatusSelect item={item} checklistId={checklistId} onError={onError} />
    </div>
  );
}

function Home() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [mutationMessage, setMutationMessage] = useState('');

  const lists = useListChecklists();
  const stats = useGetChecklistStats();
  const selectedQuery = useGetChecklist(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetChecklistQueryKey(selectedId ?? 0) },
  });
  const createChecklist = useCreateChecklist();
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
    createChecklist.mutate({ data: { sourceText: sourceText.trim(), ...(newTitle.trim() ? { title: newTitle.trim() } : {}) } }, {
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
    if (!selected || !window.confirm(`Delete "${selected.title}"? This cannot be undone.`)) return;
    setMutationMessage('');
    const removedId = selected.id;
    deleteChecklist.mutate({ id: removedId }, {
      onSuccess: () => {
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

  const jumpTo = (targetId: string) => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">do</div>
          <div className="brand-name">daymark</div>
        </div>
        <div className="sidebar-kicker">Workspace</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className="side-nav-item active" onClick={() => jumpTo('overview-top')} data-testid="button-nav-overview"><ListChecks size={16} /><span>Overview</span></button>
          <button className="side-nav-item" onClick={() => jumpTo('recent-activity')} data-testid="button-nav-recent"><Clock3 size={16} /><span>Recent activity</span></button>
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
              <p className="eyebrow">Monday planning desk</p>
              <h1 className="page-title" data-testid="text-page-title">Make a dent.</h1>
              <p className="page-subtitle">A clear queue for the work that matters today.</p>
            </div>
            <div className="date-stamp" data-testid="text-current-date">{formatDate(new Date().toISOString())}</div>
          </header>

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

          <div className="workspace-grid">
            <section>
              <div className="paste-panel">
                <div className="paste-heading">
                  <div className="paste-icon"><Zap size={15} /></div>
                  <div className="paste-copy">
                    <h2>Drop in the messy version.</h2>
                    <p>Paste bullets, one per line. We’ll turn them into a queue you can actually move through.</p>
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
                    <span className="inline-message">{sourceText.trim() ? `${sourceText.trim().split(/\n+/).filter(Boolean).length} lines ready` : 'Nothing queued yet'}</span>
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

              <div className="surface activity-panel" id="recent-activity">
                <div className="surface-header"><h2 className="section-title">Recent movement</h2><MoreHorizontal size={16} color="hsl(var(--muted-foreground))" /></div>
                {stats.isLoading ? <div className="skeleton-list"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div> : activity.length === 0 ? <div className="empty-state" style={{ padding: '25px 18px' }}><Clock3 size={20} /><strong>Quiet so far.</strong><p>Status changes will show up here.</p></div> : <div className="activity-list">{activity.slice(0, 5).map((entry, index) => <div className="activity-row" key={`${entry.checklistId}-${entry.updatedAt}-${index}`}><span className={`activity-dot ${entry.status}`} /><div><div className="activity-title">{entry.itemTitle}</div><div className="activity-context">{entry.checklistTitle} · {statusLabels[entry.status]}</div></div><span className="activity-time">{formatRelative(entry.updatedAt)}</span></div>)}</div>}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Home;