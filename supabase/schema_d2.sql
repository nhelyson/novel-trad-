-- =============================================================================
-- NOVELTRAD — SCHÉMA SUPABASE D2 (DONNÉES UTILISATEUR + RLS)
-- Projet: nhelyson's Project (ref: hhdhbxxcrfpnhvqgfpjr)
-- =============================================================================

-- 1. FONCTION TRIGGER : ACTUALISATION AUTOMATIQUE DE updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. TABLE : user_library (Bibliothèque cloud de l'utilisateur)
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

-- Trigger updated_at pour user_library
DROP TRIGGER IF EXISTS tr_user_library_updated_at ON public.user_library;
CREATE TRIGGER tr_user_library_updated_at
  BEFORE UPDATE ON public.user_library
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Index pour user_library
CREATE INDEX IF NOT EXISTS idx_user_library_series_id ON public.user_library(series_id);

-- 3. TABLE : user_favorites (Favoris cloud de l'utilisateur)
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

-- Index pour user_favorites
CREATE INDEX IF NOT EXISTS idx_user_favorites_item_id ON public.user_favorites(item_id);

-- 4. TABLE : user_reading_progress (Progression et historique de lecture cloud)
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

-- Index pour user_reading_progress
CREATE INDEX IF NOT EXISTS idx_user_reading_progress_history ON public.user_reading_progress(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reading_progress_book_id ON public.user_reading_progress(book_id);

-- 5. TABLE : user_preferences (Préférences utilisateur & lecteur)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'dark',
  font_size TEXT DEFAULT '18px',
  font_family TEXT DEFAULT 'Inter, sans-serif',
  line_height TEXT DEFAULT '1.8',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at pour user_preferences
DROP TRIGGER IF EXISTS tr_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER tr_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) - ACTIVATION ET POLITIQUES
-- =============================================================================

-- Activation RLS sur les 4 tables
ALTER TABLE public.user_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- POLICIES : user_library
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own library" ON public.user_library;
CREATE POLICY "Users can view own library"
  ON public.user_library FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own library" ON public.user_library;
CREATE POLICY "Users can insert own library"
  ON public.user_library FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own library" ON public.user_library;
CREATE POLICY "Users can update own library"
  ON public.user_library FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own library" ON public.user_library;
CREATE POLICY "Users can delete own library"
  ON public.user_library FOR DELETE
  USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- POLICIES : user_favorites
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own favorites" ON public.user_favorites;
CREATE POLICY "Users can view own favorites"
  ON public.user_favorites FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own favorites" ON public.user_favorites;
CREATE POLICY "Users can insert own favorites"
  ON public.user_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own favorites" ON public.user_favorites;
CREATE POLICY "Users can update own favorites"
  ON public.user_favorites FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own favorites" ON public.user_favorites;
CREATE POLICY "Users can delete own favorites"
  ON public.user_favorites FOR DELETE
  USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- POLICIES : user_reading_progress
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own reading progress" ON public.user_reading_progress;
CREATE POLICY "Users can view own reading progress"
  ON public.user_reading_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own reading progress" ON public.user_reading_progress;
CREATE POLICY "Users can insert own reading progress"
  ON public.user_reading_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reading progress" ON public.user_reading_progress;
CREATE POLICY "Users can update own reading progress"
  ON public.user_reading_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reading progress" ON public.user_reading_progress;
CREATE POLICY "Users can delete own reading progress"
  ON public.user_reading_progress FOR DELETE
  USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- POLICIES : user_preferences
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;
CREATE POLICY "Users can delete own preferences"
  ON public.user_preferences FOR DELETE
  USING (auth.uid() = user_id);
