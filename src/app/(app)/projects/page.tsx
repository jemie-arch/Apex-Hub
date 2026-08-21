import { ProjectBoard, type BoardProject } from '@/components/projects/ProjectBoard';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant } from '@/config/tenant.config';
import { formatDateInZone } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Projects' };

/** The internal board: what the agency is building for itself and for clients. */
export default async function ProjectsPage() {
  const db = serviceClient();

  const [projects, notes, people, groups] = await Promise.all([
    db
      .from('projects')
      .select(
        'id, title, summary, status, due_on, owner_user_id, client_group_id, position',
      )
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(300),
    db
      .from('project_notes')
      .select('id, project_id, body, author_user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('user_profiles').select('id, full_name, email'),
    db.from('client_groups').select('id, name').order('name'),
  ]);

  if (projects.error) throw projects.error;
  if (notes.error) throw notes.error;
  if (people.error) throw people.error;
  if (groups.error) throw groups.error;

  const nameById = new Map(
    (people.data ?? []).map((row) => [row.id, row.full_name ?? row.email]),
  );
  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row.name]));
  const zone = tenant.defaultTimezone;

  const notesByProject = new Map<
    string,
    BoardProject['notes']
  >();
  for (const note of notes.data ?? []) {
    const existing = notesByProject.get(note.project_id) ?? [];
    existing.push({
      id: note.id,
      body: note.body,
      author: note.author_user_id
        ? nameById.get(note.author_user_id) ?? null
        : null,
      at: formatDateInZone(note.created_at, zone),
    });
    notesByProject.set(note.project_id, existing);
  }

  const board: BoardProject[] = (projects.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    dueOn: row.due_on,
    ownerName: row.owner_user_id ? nameById.get(row.owner_user_id) ?? null : null,
    clientName: row.client_group_id
      ? groupById.get(row.client_group_id) ?? null
      : null,
    notes: notesByProject.get(row.id) ?? [],
  }));

  return (
    <>
      <PageHeader
        title="Projects"
        description="What we are building — for ourselves and for clients"
      />
      <ProjectBoard
        projects={board}
        clients={(groups.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
        }))}
      />
    </>
  );
}
