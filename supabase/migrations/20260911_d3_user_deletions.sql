-- =============================================================================
-- NOVELTRAD — SCHÉMA SUPABASE D3 (TABLE DE SUPPRESSIONS DISTRIBUÉES + RLS)
-- Projet: nhelyson's Project (ref: hhdhbxxcrfpnhvqgfpjr)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'library', 'favorite', 'progress'
  entity_id TEXT NOT NULL,   -- series_id, item_id, book_id
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_deletions_unique UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_user_deletions_user_time ON public.user_deletions(user_id, deleted_at DESC);

ALTER TABLE public.user_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own deletions" ON public.user_deletions;
CREATE POLICY "Users can manage own deletions"
  ON public.user_deletions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
