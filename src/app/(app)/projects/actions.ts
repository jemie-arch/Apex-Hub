'use server';

/**
 * The internal project board.
 *
 * Notes are append-only: a project's history is the argument for why it is
 * where it is, and an editable note would let that history be rewritten.
 */
import { revalidatePath } from 'next/cache';

import { currentCaller, requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'idea',
  'planned',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];

export interface ProjectResult {
  ok: boolean;
  message: string;
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createProject(formData: FormData): Promise<ProjectResult> {
  const caller = await requireAdmin();

  const title = clean(formData.get('title'));
  if (title === null) return { ok: false, message: 'Give the project a title.' };

  const groupId = clean(formData.get('client_group_id'));

  const written = await serviceClient()
    .from('projects')
    .insert({
      title,
      summary: clean(formData.get('summary')),
      due_on: clean(formData.get('due_on')),
      client_group_id: groupId,
      owner_user_id: caller.id,
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/projects');
  return { ok: true, message: 'Project created.' };
}

export async function setProjectStatus(input: {
  id: string;
  status: string;
}): Promise<ProjectResult> {
  await requireAdmin();

  if (!(PROJECT_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: `"${input.status}" is not a status.` };
  }

  const written = await serviceClient()
    .from('projects')
    .update({ status: input.status as ProjectStatus })
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/projects');
  return { ok: true, message: 'Moved.' };
}

export async function addProjectNote(input: {
  projectId: string;
  body: string;
}): Promise<ProjectResult> {
  const caller = await currentCaller();
  if (!caller) return { ok: false, message: 'Sign in again.' };

  const body = input.body.trim();
  if (body === '') return { ok: false, message: 'Write something first.' };

  const written = await serviceClient()
    .from('project_notes')
    .insert({
      project_id: input.projectId,
      author_user_id: caller.id,
      body,
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/projects');
  return { ok: true, message: 'Note added.' };
}
