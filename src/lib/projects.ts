// Projects: a short list of pieces of work with a status, start/end dates and notes.
// Tasks link to a project through the task association columns
// (association_type 'project', association_id = project id, association_label = name).
import type { StatusTone } from '@/lib/status-tone';

export type ProjectStatus = 'in_progress' | 'paused' | 'done' | 'cancelled';

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; tone: StatusTone }[] = [
  { value: 'in_progress', label: 'In progress', tone: 'progress' },
  { value: 'paused', label: 'Paused', tone: 'idle' },
  { value: 'done', label: 'Done', tone: 'complete' },
  { value: 'cancelled', label: 'Cancelled', tone: 'issue' },
];

export function projectStatusMeta(s: string | null | undefined) {
  return PROJECT_STATUSES.find(p => p.value === s) ?? PROJECT_STATUSES[0];
}

/** Open (in progress or paused) projects are the ones tasks get linked to. */
export function isOpenProject(p: { status: string }) {
  return p.status === 'in_progress' || p.status === 'paused';
}

/** An open project whose end date has passed. */
export function isProjectOverdue(p: { status: string; end_date: string | null }, today: string) {
  return isOpenProject(p) && !!p.end_date && p.end_date < today;
}

const STATUS_RANK: Record<ProjectStatus, number> = { in_progress: 0, paused: 1, done: 2, cancelled: 3 };

/** List order: by status (in progress first), then soonest end date (none last), then name. */
export function sortProjects<T extends Pick<Project, 'status' | 'end_date' | 'name'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (s) return s;
    if (a.end_date !== b.end_date) {
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return a.end_date.localeCompare(b.end_date);
    }
    return a.name.localeCompare(b.name);
  });
}
