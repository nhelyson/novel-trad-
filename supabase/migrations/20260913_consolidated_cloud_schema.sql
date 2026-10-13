-- =============================================================================
-- NOVELTRAD — SCRIPT GLOBAL SUPABASE CONSOLIDÉ (D2, D3, D4 + NOTES & LIKES)
-- Projet: nhelyson's Project (ref: hhdhbxxcrfpnhvqgfpjr)
-- À exécuter dans : https://supabase.com/dashboard/project/hhdhbxxcrfpnhvqgfpjr/sql
-- =============================================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. FONCTION TRIGGER : ACTUALISATION AUTOMATIQUE DE updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. TABLE : user_library (Bibliothèque utilisateur synchronisée)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover TEXT,
  author TEXT,
  format TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_library_user_series_unique UNIQUE (user_id, series_id)
);

DROP TRIGGER IF EXISTS tr_user_library_updated_at ON public.user_library;
CREATE TRIGGER tr_user_library_updated_at
  BEFORE UPDATE ON public.user_library
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_library_series_id ON public.user_library(series_id);
CREATE INDEX IF NOT EXISTS idx_user_library_user_id ON public.user_library(user_id);

-- -----------------------------------------------------------------------------
-- 3. TABLE : user_favorites (Favoris synchronisés)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover TEXT,
  format TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_favorites_user_item_unique UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_item_id ON public.user_favorites(item_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON public.user_favorites(user_id);

-- -----------------------------------------------------------------------------
-- 4. TABLE : user_reading_progress (Progression et reprise de lecture)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_reading_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  series_id TEXT,
  chapter_id TEXT,
  title TEXT,
  format TEXT,
  position TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  status TEXT NOT NULL DEFAULT 'reading',
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_reading_progress_user_book_unique UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reading_progress_history ON public.user_reading_progress(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reading_progress_book_id ON public.user_reading_progress(book_id);

-- -----------------------------------------------------------------------------
-- 5. TABLE : user_preferences (Préférences du lecteur)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'dark',
  font_size TEXT DEFAULT '18px',
  font_family TEXT DEFAULT 'Inter, sans-serif',
  line_height TEXT DEFAULT '1.8',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tr_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER tr_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 6. TABLE : user_deletions (Anti-résurrection distribuée D3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'library', 'favorite', 'progress'
  entity_id TEXT NOT NULL,   -- series_id, item_id, book_id
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_deletions_unique UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_user_deletions_user_time ON public.user_deletions(user_id, deleted_at DESC);

-- -----------------------------------------------------------------------------
-- 7. TABLE : series_ratings (Notes des utilisateurs de 1 à 5 étoiles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,
  rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_series_rating_unique UNIQUE (user_id, series_id)
);

DROP TRIGGER IF EXISTS tr_series_ratings_updated_at ON public.series_ratings;
CREATE TRIGGER tr_series_ratings_updated_at
  BEFORE UPDATE ON public.series_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_series_ratings_series_id ON public.series_ratings(series_id);
CREATE INDEX IF NOT EXISTS idx_series_ratings_user_id ON public.series_ratings(user_id);

-- -----------------------------------------------------------------------------
-- 8. TABLE : series_likes (Coups de cœur / Likes uniques par utilisateur)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_series_like_unique UNIQUE (user_id, series_id)
);

CREATE INDEX IF NOT EXISTS idx_series_likes_series ON public.series_likes(series_id);
CREATE INDEX IF NOT EXISTS idx_series_likes_user ON public.series_likes(user_id);

-- -----------------------------------------------------------------------------
-- 9. VUE STATISTIQUES PUBLIQUES : series_stats (Moyennes & Totaux automatiques)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.series_stats AS
SELECT 
  s.series_id,
  COALESCE(ROUND(AVG(r.rating), 2), 4.8) AS average_rating,
  COUNT(DISTINCT r.id) AS total_ratings,
  COUNT(DISTINCT l.id) AS total_likes
FROM (
  SELECT DISTINCT series_id FROM public.series_ratings
  UNION
  SELECT DISTINCT series_id FROM public.series_likes
) s
LEFT JOIN public.series_ratings r ON r.series_id = s.series_id
LEFT JOIN public.series_likes l ON l.series_id = s.series_id
GROUP BY s.series_id;

-- -----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) - ACTIVATION & POLITIQUES
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_likes ENABLE ROW LEVEL SECURITY;

-- POLICIES : user_library
DROP POLICY IF EXISTS "Users manage own library" ON public.user_library;
CREATE POLICY "Users manage own library" ON public.user_library
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : user_favorites
DROP POLICY IF EXISTS "Users manage own favorites" ON public.user_favorites;
CREATE POLICY "Users manage own favorites" ON public.user_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : user_reading_progress
DROP POLICY IF EXISTS "Users manage own reading progress" ON public.user_reading_progress;
CREATE POLICY "Users manage own reading progress" ON public.user_reading_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : user_preferences
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_preferences;
CREATE POLICY "Users manage own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : user_deletions
DROP POLICY IF EXISTS "Users manage own deletions" ON public.user_deletions;
CREATE POLICY "Users manage own deletions" ON public.user_deletions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : series_ratings (Lecture publique, gestion par l'auteur)
DROP POLICY IF EXISTS "Public can view ratings" ON public.series_ratings;
CREATE POLICY "Public can view ratings" ON public.series_ratings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users manage own ratings" ON public.series_ratings;
CREATE POLICY "Users manage own ratings" ON public.series_ratings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLICIES : series_likes (Lecture publique, gestion par l'auteur)
DROP POLICY IF EXISTS "Public can view likes" ON public.series_likes;
CREATE POLICY "Public can view likes" ON public.series_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users manage own likes" ON public.series_likes;
CREATE POLICY "Users manage own likes" ON public.series_likes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
