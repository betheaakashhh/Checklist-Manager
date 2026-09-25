import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk, useUser } from '@clerk/react';
import {
  Check,
  ClipboardList,
  Clock3,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Unlink,
  Zap,
} from 'lucide-react';
import { useLocation } from 'wouter';
import {
  useCreateChecklistItem,
  getListCollectionsQueryKey,
  getGetChecklistQueryKey,
  getGetChecklistStatsQueryKey,
  getListChecklistsQueryKey,
  useCreateChecklist,
  useListCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useCreateCollectionChecklist,
  useAddChecklistToCollection,
  useRemoveChecklistFromCollection,
  useDeleteChecklist,
  useGetChecklist,
  useGetChecklistStats,
  useListChecklists,
  useUpdateChecklist,
  useUpdateChecklistItem,
} from '@workspace/api-client-react';
import type { Checklist, ChecklistActivity, ChecklistItem, ChecklistStatus, Collection } from '@workspace/api-client-react';

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
  queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey() });
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
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [mutationMessage, setMutationMessage] = useState('');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [addItemMessage, setAddItemMessage] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [collectionDialog, setCollectionDialog] = useState<'create' | 'rename' | 'delete' | 'attach' | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState('');
  const [collectionMessage, setCollectionMessage] = useState('');

  const lists = useListChecklists();
  const collectionsQuery = useListCollections();
  const stats = useGetChecklistStats();
  const selectedQuery = useGetChecklist(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetChecklistQueryKey(selectedId ?? 0) },
  });
  const createChecklist = useCreateChecklist();
  const createCollectionChecklist = useCreateCollectionChecklist();
  const createChecklistItem = useCreateChecklistItem();
  const updateChecklist = useUpdateChecklist();
  const deleteChecklist = useDeleteChecklist();
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const addChecklistToCollection = useAddChecklistToCollection();
  const removeChecklistFromCollection = useRemoveChecklistFromCollection();

  const selected = selectedQuery.data;
  const summaries = lists.data ?? [];
  const collections = collectionsQuery.data ?? [];
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId);
  const visibleSummaries = activeCollection
    ? activeCollection.checklists
    : activeCollectionId === null
      ? summaries
      : [];
  const activity = stats.data?.recentActivity ?? [];
  const completionRate = stats.data?.completionRate ?? 0;
  const isListError = Boolean(lists.error);
  const hasItems = Boolean(selected?.items?.length);

  const listCountLabel = useMemo(() => `${summaries.length} ${summaries.length === 1 ? 'list' : 'lists'}`, [summaries.length]);
  const firstSummaryId = visibleSummaries[0]?.id ?? null;
  const firstSummaryTitle = visibleSummaries[0]?.title ?? '';
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

  const invalidateCollections = () =>
    queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey() });

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceText.trim()) return;
    setMutationMessage('');
    const data = { sourceText: normalizedSourceText, ...(newTitle.trim() ? { title: newTitle.trim() } : {}) };
    const onSuccess = (created: Checklist) => {
        setSourceText('');
        setNewTitle('');
        setSelectedId(created.id);
        setTitleDraft(created.title);
        setMutationMessage('List created and ready to work.');
        queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
        if (activeCollectionId !== null) void invalidateCollections();
    };
    const onError = () => setMutationMessage('Could not create the list. Check the pasted text and try again.');
    if (activeCollectionId !== null) {
      createCollectionChecklist.mutate({ id: activeCollectionId, data }, { onSuccess, onError });
    } else {
      createChecklist.mutate({ data }, { onSuccess, onError });
    }
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
        void invalidateCollections();
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
        queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChecklistStatsQueryKey() });
        setNewItemTitle('');
        setAddItemMessage('');
        setIsAddItemOpen(false);
      },
      onError: () => setAddItemMessage('Could not add that item. Try again.'),
    });
  };

  const openCollectionDialog = (mode: 'create' | 'rename' | 'delete' | 'attach') => {
    setCollectionMessage('');
    if (mode === 'create') setCollectionNameDraft('');
    if (mode === 'rename') setCollectionNameDraft(activeCollection?.name ?? '');
    setCollectionDialog(mode);
  };

  const handleSaveCollection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = collectionNameDraft.trim();
    if (!name) return;
    setCollectionMessage('');
    if (collectionDialog === 'create') {
      createCollection.mutate({ data: { name } }, {
        onSuccess: (created) => {
          void invalidateCollections();
          setActiveCollectionId(created.id);
          setActiveSection('checklists');
          setSelectedId(null);
          setCollectionDialog(null);
          setCollectionNameDraft('');
        },
        onError: () => setCollectionMessage('Could not create the collection. Try again.'),
      });
    } else if (collectionDialog === 'rename' && activeCollection) {
      updateCollection.mutate({ id: activeCollection.id, data: { name } }, {
        onSuccess: () => {
          void invalidateCollections();
          setCollectionDialog(null);
        },
        onError: () => setCollectionMessage('Could not rename this collection. Try again.'),
      });
    }
  };

  const handleDeleteCollection = () => {
    if (!activeCollection) return;
    deleteCollection.mutate({ id: activeCollection.id }, {
      onSuccess: () => {
        void invalidateCollections();
        setActiveCollectionId(null);
        setCollectionDialog(null);
      },
      onError: () => setCollectionMessage('Could not delete this collection. Its checklists are still safe.'),
    });
  };

  const handleAttachChecklist = (checklistId: number) => {
    if (!activeCollection) return;
    addChecklistToCollection.mutate(
      { id: activeCollection.id, checklistId },
      {
        onSuccess: () => {
          void invalidateCollections();
          queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
          setCollectionMessage('Checklist added to this collection.');
        },
        onError: () => setCollectionMessage('Could not add that checklist. Try again.'),
      },
    );
  };

  const handleRemoveChecklist = (checklistId: number) => {
    if (!activeCollection) return;
    removeChecklistFromCollection.mutate(
      { id: activeCollection.id, checklistId },
      {
        onSuccess: () => {
          const nextId = activeCollection.checklists.find((item) => item.id !== checklistId)?.id ?? null;
          if (selectedId === checklistId) setSelectedId(nextId);
          void invalidateCollections();
          queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
        },
        onError: () => setCollectionMessage('Could not remove that checklist from the collection.'),
      },
    );
  };

  const selectCollection = (collection: Collection) => {
    setActiveSection('checklists');
    setActiveCollectionId(collection.id);
    setSelectedId(collection.checklists[0]?.id ?? null);
    setTitleDraft(collection.checklists[0]?.title ?? '');
    setMutationMessage('');
  };

  const sectionCopy = {
    overview: { eyebrow: 'Monday planning desk', title: 'Make a dent.', subtitle: 'A clear read on the work that matters today.' },
    checklists: activeCollection
      ? { eyebrow: 'Collection', title: activeCollection.name, subtitle: `${activeCollection.checklists.length} ${activeCollection.checklists.length === 1 ? 'checklist' : 'checklists'} grouped in this folder.` }
      : { eyebrow: 'Work queue', title: 'Get to clear.', subtitle: 'Paste the rough version, then move each item forward.' },
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
          <button className={`side-nav-item${activeSection === 'checklists' ? ' active' : ''}`} onClick={() => { setActiveSection('checklists'); setActiveCollectionId(null); }} aria-current={activeSection === 'checklists' ? 'page' : undefined} data-testid="button-nav-checklists"><ClipboardList size={16} /><span>Checklists</span></button>
          <button className={`side-nav-item${activeSection === 'activity' ? ' active' : ''}`} onClick={() => setActiveSection('activity')} aria-current={activeSection === 'activity' ? 'page' : undefined} data-testid="button-nav-recent"><Clock3 size={16} /><span>Recent activity</span></button>
        </nav>
        <div className="collection-nav" aria-label="Checklist collections">
          <div className="collection-nav-header">
            <span>Collections</span>
            <button className="collection-add-button" onClick={() => openCollectionDialog('create')} aria-label="Create collection" title="Create collection" data-testid="button-create-collection"><FolderPlus size={14} /></button>
          </div>
          {collectionsQuery.isLoading ? (
            <div className="collection-nav-loading" aria-label="Loading collections"><span /><span /></div>
          ) : collectionsQuery.error ? (
            <button className="collection-retry" onClick={() => collectionsQuery.refetch()} data-testid="button-retry-collections"><RefreshCw size={12} /> Retry folders</button>
          ) : collections.length === 0 ? (
            <div className="collection-nav-empty">Make a folder for related checklists.</div>
          ) : (
            <div className="collection-nav-list">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  className={`collection-nav-item${activeCollectionId === collection.id && activeSection === 'checklists' ? ' active' : ''}`}
                  onClick={() => selectCollection(collection)}
                  title={collection.name}
                  data-testid={`button-open-collection-${collection.id}`}
                >
                  {activeCollectionId === collection.id && activeSection === 'checklists' ? <FolderOpen size={15} /> : <Folder size={15} />}
                  <span>{collection.name}</span>
                  <small>{collection.checklists.length}</small>
                </button>
              ))}
            </div>
          )}
        </div>
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
              {activeCollection && (
                <div className="collection-banner" data-testid={`panel-collection-${activeCollection.id}`}>
                  <div className="collection-banner-mark"><FolderOpen size={19} /></div>
                  <div className="collection-banner-copy">
                    <span className="collection-banner-label">Collection folder</span>
                    <strong>{activeCollection.name}</strong>
                    <small>{activeCollection.checklists.length} {activeCollection.checklists.length === 1 ? 'checklist' : 'checklists'}</small>
                  </div>
                  <div className="collection-banner-actions">
                    <button className="quiet-button" onClick={() => openCollectionDialog('rename')} data-testid="button-rename-collection"><Pencil size={13} /> Rename</button>
                    <button className="quiet-button" onClick={() => openCollectionDialog('attach')} data-testid="button-attach-checklist"><FolderPlus size={13} /> Add existing</button>
                    <button className="danger-button" onClick={() => openCollectionDialog('delete')} data-testid="button-delete-collection"><Trash2 size={13} /> Delete folder</button>
                  </div>
                </div>
              )}
              <div className="paste-panel">
                <div className="paste-heading">
                  <div className="paste-icon"><Zap size={15} /></div>
                  <div className="paste-copy">
                    <h2>{activeCollection ? `Add a checklist to ${activeCollection.name}.` : 'Drop in the messy version.'}</h2>
                    <p>Paste bullets on separate lines, or drop in a compact workflow line. We’ll turn it into a queue you can move through.</p>
                  </div>
                </div>
                <form className="paste-form" onSubmit={handleCreate}>
                  <div>
                    <label className="field-label" htmlFor="new-list-title">Checklist name <span style={{ opacity: .55 }}>(optional)</span></label>
                    <input id="new-list-title" className="text-input" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={activeCollection ? 'e.g. Fruits' : 'e.g. Tuesday launch prep'} data-testid="input-new-checklist-title" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="source-text">Your bullets</label>
                    <textarea id="source-text" className="text-area" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={'Confirm launch date\nSend the revised deck\nAsk Priya for the numbers'} data-testid="textarea-source-text" />
                  </div>
                  <div className="button-row">
                    <span className="inline-message">{sourceText.trim() ? `${sourceLineCount} ${sourceLineCount === 1 ? 'item' : 'items'} ready` : 'Nothing queued yet'}</span>
                    <button type="submit" className="primary-button" disabled={!sourceText.trim() || createChecklist.isPending || createCollectionChecklist.isPending} data-testid="button-create-checklist">
                      {createChecklist.isPending || createCollectionChecklist.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Creating…</> : <><FilePlus2 size={13} /> {activeCollection ? 'Create checklist' : 'Create list'}</>}
                    </button>
                  </div>
                </form>
              </div>

              <div className="surface list-panel">
                <div className="surface-header">
                  <h2 className="section-title">{activeCollection ? `Checklists in ${activeCollection.name}` : 'Your checklists'}</h2>
                  <span className="section-meta" data-testid="text-checklist-count">{activeCollection ? `${visibleSummaries.length} ${visibleSummaries.length === 1 ? 'list' : 'lists'}` : listCountLabel}</span>
                </div>
                {lists.isLoading ? (
                  <div className="skeleton-list" data-testid="status-checklists-loading">
                    {[1, 2, 3, 4].map((item) => <div key={item}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" style={{ marginTop: 8 }} /></div>)}
                  </div>
                ) : isListError ? (
                  <div className="empty-state"><TriangleAlert size={23} /><strong>Couldn’t load your lists</strong><p>Refresh the workspace and we’ll try again.</p><button className="quiet-button" style={{ marginTop: 14 }} onClick={() => lists.refetch()} data-testid="button-retry-checklists"><RefreshCw size={13} /> Retry</button></div>
                ) : visibleSummaries.length === 0 ? (
                  <div className="empty-state" data-testid="status-checklists-empty">
                    {activeCollection ? <FolderOpen size={24} /> : <ClipboardList size={24} />}
                    <strong>{activeCollection ? 'This folder is ready for its first checklist.' : 'Your next clear win starts here.'}</strong>
                    <p>{activeCollection ? 'Create a new checklist above or add one you already have.' : 'Paste a rough list above and it will appear in this space.'}</p>
                  </div>
                ) : (
                  <div className="list-body">
                    {visibleSummaries.map((summary) => (
                      <div className="checklist-entry" key={summary.id}>
                        <button className={`checklist-row${selectedId === summary.id ? ' selected' : ''}`} onClick={() => handleSelect(summary.id)} data-testid={`button-select-checklist-${summary.id}`}>
                          <span><span className="row-title">{summary.title}</span><span className="row-meta">{summary.completedItems}/{summary.totalItems} done · {formatRelative(summary.updatedAt)}</span></span>
                          <span className="row-progress">{Math.round(summary.progress)}%</span>
                        </button>
                        {activeCollection && (
                          <button className="collection-remove-checklist" onClick={() => handleRemoveChecklist(summary.id)} title={`Remove ${summary.title} from ${activeCollection.name}`} aria-label={`Remove ${summary.title} from collection`} disabled={removeChecklistFromCollection.isPending} data-testid={`button-remove-checklist-from-collection-${summary.id}`}><Unlink size={14} /></button>
                        )}
                      </div>
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
      {collectionDialog && (
        <Modal
          title={
            collectionDialog === 'create' ? 'Create a collection'
              : collectionDialog === 'rename' ? 'Rename this collection'
                : collectionDialog === 'delete' ? 'Delete this folder?'
                  : 'Add an existing checklist'
          }
          description={
            collectionDialog === 'create' ? 'Group related checklists together in a named folder.'
              : collectionDialog === 'rename' ? 'Choose a name that makes this folder easy to find.'
                : collectionDialog === 'delete' ? `The folder will be removed${activeCollection ? `, but its ${activeCollection.checklists.length} checklists will stay safe` : ''}.`
                  : `Choose a checklist to add to “${activeCollection?.name ?? 'this collection'}”.`
          }
          onClose={() => setCollectionDialog(null)}
        >
          {(collectionDialog === 'create' || collectionDialog === 'rename') && (
            <form className="modal-form" onSubmit={handleSaveCollection}>
              <label className="field-label" htmlFor="collection-name-input">Collection name</label>
              <input
                id="collection-name-input"
                className="text-input"
                value={collectionNameDraft}
                onChange={(event) => setCollectionNameDraft(event.target.value)}
                placeholder="e.g. Grocery"
                autoFocus
                maxLength={80}
                data-testid="input-collection-name"
              />
              {collectionMessage && <div className="error-message" data-testid="status-collection-message">{collectionMessage}</div>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setCollectionDialog(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={!collectionNameDraft.trim() || createCollection.isPending || updateCollection.isPending} data-testid="button-save-collection">
                  {createCollection.isPending || updateCollection.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Saving…</> : <><Check size={13} /> {collectionDialog === 'create' ? 'Create folder' : 'Save name'}</>}
                </button>
              </div>
            </form>
          )}
          {collectionDialog === 'delete' && (
            <>
              {collectionMessage && <div className="error-message collection-modal-message" data-testid="status-collection-message">{collectionMessage}</div>}
              <div className="modal-actions modal-actions-delete">
                <button type="button" className="quiet-button" onClick={() => setCollectionDialog(null)} disabled={deleteCollection.isPending}>Keep folder</button>
                <button type="button" className="danger-button danger-confirm" onClick={handleDeleteCollection} disabled={deleteCollection.isPending} data-testid="button-confirm-delete-collection">
                  {deleteCollection.isPending ? <><LoaderCircle size={13} className="animate-spin" /> Deleting…</> : <><Trash2 size={13} /> Delete folder</>}
                </button>
              </div>
            </>
          )}
          {collectionDialog === 'attach' && (
            <div className="modal-form attach-list" data-testid="collection-attach-list">
              {collectionMessage && <div className="inline-message" role="status" data-testid="status-collection-message">{collectionMessage}</div>}
              {lists.isLoading ? (
                <div className="skeleton-list"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>
              ) : summaries.filter((item) => !activeCollection?.checklists.some((attached) => attached.id === item.id)).length === 0 ? (
                <div className="empty-state"><ClipboardList size={22} /><strong>Everything is already in this folder.</strong><p>Create a new checklist above or choose a different folder.</p></div>
              ) : summaries.filter((item) => !activeCollection?.checklists.some((attached) => attached.id === item.id)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="attach-checklist-row"
                  onClick={() => handleAttachChecklist(item.id)}
                  disabled={addChecklistToCollection.isPending}
                  data-testid={`button-attach-checklist-${item.id}`}
                >
                  <span className="attach-checklist-icon"><ClipboardList size={15} /></span>
                  <span className="attach-checklist-copy"><strong>{item.title}</strong><small>{item.completedItems}/{item.totalItems} complete</small></span>
                  {addChecklistToCollection.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={15} />}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

export default Home;