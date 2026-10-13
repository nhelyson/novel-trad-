-- =============================================================================
-- NOVELTRAD — SCHÉMA SUPABASE D4 (RÔLES, PROFILES, CATALOGUE & PERMISSIONS)
-- Projet: nhelyson's Project
-- Date: 2026-09-11
-- =============================================================================

-- 1. ENUMS : user_role_enum & novel_status_enum
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('USER', 'CONTRIBUTOR', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE novel_status_enum AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. TABLE : profiles (Profils utilisateurs & Rôles sécurisés)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role user_role_enum NOT NULL DEFAULT 'USER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Trigger updated_at pour profiles
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Trigger automatique de création de profil à l'inscription auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'USER'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. TABLE : catalog_novels (Catalogue Cloud & Gestion par les Contributeurs/Admins)
CREATE TABLE IF NOT EXISTS public.catalog_novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  author TEXT NOT NULL,
  illustrator TEXT,
  translator TEXT,
  origin TEXT NOT NULL DEFAULT 'JP', -- 'JP', 'KR', 'CN', 'OTHER'
  type TEXT NOT NULL DEFAULT 'light_novel', -- 'light_novel', 'webnovel'
  status TEXT NOT NULL DEFAULT 'releasing',
  status_fr TEXT NOT NULL DEFAULT 'En cours',
  publication_status novel_status_enum NOT NULL DEFAULT 'DRAFT',
  genres TEXT[] DEFAULT '{}',
  genres_fr TEXT[] DEFAULT '{}',
  synopsis TEXT,
  synopsis_fr TEXT,
  cover_url TEXT,
  banner_url TEXT,
  rating NUMERIC(3, 2) DEFAULT 4.8,
  views_count BIGINT DEFAULT 0,
  likes_count BIGINT DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_novels_status ON public.catalog_novels(publication_status);
CREATE INDEX IF NOT EXISTS idx_catalog_novels_creator ON public.catalog_novels(created_by);
CREATE INDEX IF NOT EXISTS idx_catalog_novels_origin ON public.catalog_novels(origin);

-- Trigger updated_at pour catalog_novels
DROP TRIGGER IF EXISTS tr_catalog_novels_updated_at ON public.catalog_novels;
CREATE TRIGGER tr_catalog_novels_updated_at
  BEFORE UPDATE ON public.catalog_novels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 4. TABLE : catalog_volumes (Volumes et Fichiers rattachés aux Novels)
CREATE TABLE IF NOT EXISTS public.catalog_volumes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES public.catalog_novels(id) ON DELETE CASCADE,
  volume_number NUMERIC NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'epub', -- 'epub', 'pdf', 'webnovel'
  file_url TEXT,
  file_size BIGINT,
  cover_url TEXT,
  publication_status novel_status_enum NOT NULL DEFAULT 'DRAFT',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_volumes_novel_id ON public.catalog_volumes(novel_id);
CREATE INDEX IF NOT EXISTS idx_catalog_volumes_creator ON public.catalog_volumes(created_by);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) ET POLITIQUES DE SÉCURITÉ
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_novels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_volumes ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- POLICIES : profiles
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view basic profiles" ON public.profiles;
CREATE POLICY "Public can view basic profiles"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update own display profile" ON public.profiles;
CREATE POLICY "Users can update own display profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id 
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- -----------------------------------------------------------------------------
-- POLICIES : catalog_novels
-- -----------------------------------------------------------------------------
-- 1. Lecture publique : Tout le monde (y compris invités) peut lire les novels PUBLISHED
DROP POLICY IF EXISTS "Public can view published novels" ON public.catalog_novels;
CREATE POLICY "Public can view published novels"
  ON public.catalog_novels FOR SELECT
  USING (publication_status = 'PUBLISHED');

-- 2. Contributeurs : Peuvent voir, créer et modifier leurs propres novels
DROP POLICY IF EXISTS "Contributors can view own novels" ON public.catalog_novels;
CREATE POLICY "Contributors can view own novels"
  ON public.catalog_novels FOR SELECT
  USING (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
  );

DROP POLICY IF EXISTS "Contributors can insert own novels" ON public.catalog_novels;
CREATE POLICY "Contributors can insert own novels"
  ON public.catalog_novels FOR INSERT
  WITH CHECK (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
    AND publication_status IN ('DRAFT', 'PENDING_REVIEW')
  );

DROP POLICY IF EXISTS "Contributors can update own drafts" ON public.catalog_novels;
CREATE POLICY "Contributors can update own drafts"
  ON public.catalog_novels FOR UPDATE
  USING (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
    AND publication_status IN ('DRAFT', 'PENDING_REVIEW')
  )
  WITH CHECK (
    auth.uid() = created_by
    AND publication_status IN ('DRAFT', 'PENDING_REVIEW')
  );

-- 3. Administrateurs : Contrôle total sur tous les novels
DROP POLICY IF EXISTS "Admins can manage all catalog novels" ON public.catalog_novels;
CREATE POLICY "Admins can manage all catalog novels"
  ON public.catalog_novels FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- -----------------------------------------------------------------------------
-- POLICIES : catalog_volumes
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view published volumes" ON public.catalog_volumes;
CREATE POLICY "Public can view published volumes"
  ON public.catalog_volumes FOR SELECT
  USING (publication_status = 'PUBLISHED');

DROP POLICY IF EXISTS "Contributors can view own volumes" ON public.catalog_volumes;
CREATE POLICY "Contributors can view own volumes"
  ON public.catalog_volumes FOR SELECT
  USING (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
  );

DROP POLICY IF EXISTS "Contributors can insert own volumes" ON public.catalog_volumes;
CREATE POLICY "Contributors can insert own volumes"
  ON public.catalog_volumes FOR INSERT
  WITH CHECK (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
  );

DROP POLICY IF EXISTS "Contributors can update own volumes" ON public.catalog_volumes;
CREATE POLICY "Contributors can update own volumes"
  ON public.catalog_volumes FOR UPDATE
  USING (
    auth.uid() = created_by 
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('CONTRIBUTOR', 'ADMIN'))
  )
  WITH CHECK (
    auth.uid() = created_by
  );

DROP POLICY IF EXISTS "Admins can manage all catalog volumes" ON public.catalog_volumes;
CREATE POLICY "Admins can manage all catalog volumes"
  ON public.catalog_volumes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );
