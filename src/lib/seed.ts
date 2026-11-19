import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PROFILES, type SeedProfile } from './syllabi';

export async function ensureUserSeeded(supabase: SupabaseClient, userId: string) {
  const { data: existing, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  if (error || (existing && existing.length > 0)) {
    return;
  }

  for (let pIdx = 0; pIdx < DEFAULT_PROFILES.length; pIdx++) {
    const p: SeedProfile = DEFAULT_PROFILES[pIdx];
    const { data: createdProfile, error: pErr } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        slug: p.slug,
        name: p.name,
        role_title: p.role_title,
        icon: p.icon,
        color: p.color,
        salary_base: p.salary_base,
        vale_alimentacao: p.vale_alimentacao,
        workload: p.workload,
        extras: p.extras,
        status_text: p.status_text,
        exam_date: p.exam_date,
        daily_hours_goal: p.daily_hours_goal,
        target_accuracy: p.target_accuracy,
        sort_order: pIdx,
      })
      .select('id')
      .single();

    if (pErr || !createdProfile) continue;

    for (let sIdx = 0; sIdx < p.subjects.length; sIdx++) {
      const s = p.subjects[sIdx];
      const { data: createdSubject, error: sErr } = await supabase
        .from('subjects')
        .insert({
          user_id: userId,
          profile_id: createdProfile.id,
          name: s.name,
          category: s.category,
          color: s.color,
          cycle_hours: s.cycle_hours,
          cycle_minutes: s.cycle_minutes,
          cycle_order: sIdx,
        })
        .select('id')
        .single();

      if (sErr || !createdSubject) continue;

      if (s.topics.length > 0) {
        await supabase.from('topics').insert(
          s.topics.map((title, tIdx) => ({
            user_id: userId,
            profile_id: createdProfile.id,
            subject_id: createdSubject.id,
            title,
            studied: false,
            is_priority: false,
            sort_order: tIdx,
          }))
        );
      }
    }
  }
}
