'use client';

/**
 * The board.
 *
 * Status is changed from a select inside the card's modal rather than by
 * dragging: dragging is pleasant on a mouse and impossible to do reliably on a
 * phone, and this board gets read on phones.
 */
import { Plus, StickyNote } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  addProjectNote,
  createProject,
  setProjectStatus,
  type ProjectResult,
} from '@/app/(app)/projects/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';

export interface BoardProject {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  dueOn: string | null;
  ownerName: string | null;
  clientName: string | null;
  notes: Array<{ id: string; body: string; author: string | null; at: string }>;
}

const COLUMNS = [
  { key: 'idea', label: 'Ideas' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
] as const;

const COLUMN_ACCENT: Record<string, string> = {
  idea: 'text-fg-subtle',
  planned: 'text-fg-muted',
  in_progress: 'text-accent',
  blocked: 'text-negative',
  done: 'text-positive',
};

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

export function ProjectBoard({
  projects,
  clients,
}: {
  projects: BoardProject[];
  clients: Array<{ id: string; name: string }>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ProjectResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const open = projects.find((project) => project.id === openId) ?? null;

  // Cancelled projects are kept but not shown as a column — the board is for
  // work that is still alive.
  const columns = COLUMNS.map((column) => ({
    ...column,
    items: projects.filter((project) => project.status === column.key),
  }));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => setCreating(true)}
        >
          New project
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {columns.map((column) => (
          <section key={column.key} className="min-w-0">
            <p
              className={cn(
                'mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide',
                COLUMN_ACCENT[column.key] ?? 'text-fg-muted',
              )}
            >
              {column.label}
              <span className="numeric text-fg-subtle">
                {column.items.length}
              </span>
            </p>

            <div className="flex flex-col gap-2">
              {column.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">
                  Nothing here
                </p>
              ) : (
                column.items.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setOpenId(project.id);
                      setResult(null);
                      setNote('');
                    }}
                    className="rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong"
                  >
                    <span className="block text-sm font-medium text-fg">
                      {project.title}
                    </span>
                    {project.clientName ? (
                      <span className="mt-0.5 block text-xs text-accent">
                        {project.clientName}
                      </span>
                    ) : null}
                    {project.summary ? (
                      <span className="mt-1 block line-clamp-2 text-xs text-fg-muted">
                        {project.summary}
                      </span>
                    ) : null}
                    <span className="mt-2 flex items-center gap-3 text-[11px] text-fg-subtle">
                      {project.dueOn ? (
                        <span className="numeric">due {project.dueOn}</span>
                      ) : null}
                      {project.notes.length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <StickyNote size={11} />
                          {project.notes.length}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      {/* Detail */}
      <Modal
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.title ?? ''}
        subtitle={
          open
            ? [open.clientName ?? 'Internal', open.ownerName ?? 'unassigned']
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        {open ? (
          <>
            {result ? (
              <p
                className={cn(
                  'mb-4 rounded-md px-3 py-2 text-sm',
                  result.ok
                    ? 'bg-positive-subtle text-positive'
                    : 'bg-negative-subtle text-negative',
                )}
              >
                {result.message}
              </p>
            ) : null}

            {open.summary ? (
              <p className="text-sm text-fg-muted">{open.summary}</p>
            ) : null}

            <label className="mt-5 flex max-w-xs flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Status</span>
              <select
                value={open.status}
                disabled={isPending}
                onChange={(event) => {
                  const status = event.target.value;
                  startTransition(async () => {
                    setResult(await setProjectStatus({ id: open.id, status }));
                  });
                }}
                className={FIELD}
              >
                {['idea', 'planned', 'in_progress', 'blocked', 'done', 'cancelled'].map(
                  (status) => (
                    <option key={status} value={status}>
                      {humanise(status)}
                    </option>
                  ),
                )}
              </select>
            </label>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Notes
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              {open.notes.length === 0 ? (
                <p className="text-sm text-fg-subtle">
                  No notes yet. The first one usually explains why this exists.
                </p>
              ) : (
                open.notes.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-md border border-line bg-surface-sunken p-3"
                  >
                    <p className="text-sm text-fg">{entry.body}</p>
                    <p className="numeric mt-1 text-[11px] text-fg-subtle">
                      {entry.author ?? 'Someone'} · {entry.at}
                    </p>
                  </article>
                ))
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a note"
                className={FIELD}
              />
              <Button
                variant="primary"
                disabled={isPending || note.trim() === ''}
                onClick={() =>
                  startTransition(async () => {
                    const outcome = await addProjectNote({
                      projectId: open.id,
                      body: note,
                    });
                    setResult(outcome);
                    if (outcome.ok) setNote('');
                  })
                }
              >
                Add
              </Button>
            </div>
          </>
        ) : null}
      </Modal>

      {/* Create */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New project"
        subtitle="Internal by default; attach a client if it is for one of them"
      >
        <form
          action={async (formData) => {
            const outcome = await createProject(formData);
            setResult(outcome);
            if (outcome.ok) setCreating(false);
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Title</span>
            <input name="title" required className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Summary</span>
            <textarea
              name="summary"
              rows={3}
              className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Due</span>
              <input name="due_on" type="date" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Client</span>
              <select name="client_group_id" className={FIELD} defaultValue="">
                <option value="">Internal</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
