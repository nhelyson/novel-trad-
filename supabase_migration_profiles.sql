-- =============================================================================
-- NOVELTRAD — SYNCHRONISATION DES UTILISATEURS SUPABASE VERS LA TABLE PROFILES
-- =============================================================================

-- 1. Création de la table profiles liée à auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'USER',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activer RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Politiques RLS (Lecture pour tous les utilisateurs authentifiés et administrateurs)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'ADMIN' OR email LIKE 'admin@%')
    )
  );

-- 4. Rétro-synchronisation (Backfill) de TOUS les utilisateurs existants dans auth.users
INSERT INTO public.profiles (id, email, display_name, role, created_at)
SELECT 
  id,
  email,
  COALESCE(
    raw_user_meta_data->>'display_name',
    raw_user_meta_data->>'full_name',
    split_part(email, '@', 1),
    'Utilisateur'
  ),
  COALESCE(
    raw_app_meta_data->>'role',
    raw_user_meta_data->>'role',
    CASE 
      WHEN email LIKE 'admin@%' THEN 'ADMIN'
      ELSE 'USER'
    END
  ),
  created_at
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = COALESCE(profiles.display_name, EXCLUDED.display_name),
  updated_at = now();

-- 5. Fonction et Déclencheur (Trigger) automatique lors de chaque inscription/connexion
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1),
      'Utilisateur'
    ),
    COALESCE(
      NEW.raw_app_meta_data->>'role',
      NEW.raw_user_meta_data->>'role',
      CASE 
        WHEN NEW.email LIKE 'admin@%' THEN 'ADMIN'
        ELSE 'USER'
      END
    ),
    NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Index pour la performance
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
