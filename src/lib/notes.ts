// Learnings (ideas/issues/lessons) and HR Notes: own tables, own forms — never tasks.
import { supabase } from '@/integrations/supabase/client';

export const LEARNING_STATUSES = ['Idea', 'In Progress', 'Review', 'Done', 'Cancelled'] as const;
export type LearningStatus = typeof LEARNING_STATUSES[number];
export const HR_STATUSES = ['Active', 'Resolved', 'Cancelled'] as const;
export type HrStatus = typeof HR_STATUSES[number];

export interface OdooEmployee { id: number; name: string; job: string; department: string }

export async function searchOdooEmployees(search: string): Promise<OdooEmployee[]> {
  const { data, error } = await supabase.functions.invoke('odoo-employee-search', { body: { search: search.trim() || null, limit: 30 } });
  if (error) {
    let msg = error.message || 'Odoo request failed';
    try { msg = (await (error as { context?: Response }).context?.json())?.error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return ((data as { employees?: OdooEmployee[] })?.employees) ?? [];
}

/** Upload photos to the shared photo bucket; returns public URLs. */
export async function uploadNotePhotos(files: FileList | null, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const file of Array.from(files ?? []).filter(f => f.type.startsWith('image/'))) {
    if (file.size > 10 * 1024 * 1024) continue;
    const path = `${folder}/${crypto.randomUUID()}.${file.name.split('.').pop() || 'jpg'}`;
    const { error } = await supabase.storage.from('task-photos').upload(path, file, { contentType: file.type });
    if (error) throw error;
    out.push(supabase.storage.from('task-photos').getPublicUrl(path).data.publicUrl);
  }
  return out;
}
