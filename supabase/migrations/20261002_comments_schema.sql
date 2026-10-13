-- =============================================================================
-- NOVELTRAD — SCHÉMA SUPABASE DES COMMENTAIRES PAR PARAGRAPHE
-- Projet Supabase : nhelyson's Project (ref: hhdhbxxcrfpnhvqgfpjr)
-- Aligné sur le schéma consolidé 20260913_consolidated_cloud_schema.sql
-- =============================================================================

-- 1. Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Fonction trigger pour updated_at (si pas déjà créée)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 3. Table des commentaires par paragraphe
CREATE TABLE IF NOT EXISTS public.comments (
  id TEXT PRIMARY KEY,                           -- ex: cmt_1790972620285_30ju0
  book_key TEXT NOT NULL,                        -- series_id ou fileKey du roman
  paragraph_id TEXT NOT NULL,                    -- identifiant du paragraphe (ex: c1_p4)
  excerpt TEXT,                                  -- extrait du paragraphe commenté
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- lien vers le compte Supabase (NULL si invité)
  user_name TEXT NOT NULL,                       -- pseudo de l'auteur
  user_avatar TEXT DEFAULT '',                   -- URL ou avatar sélectionné
  user_role TEXT DEFAULT 'USER',                 -- 'ADMIN', 'MODERATOR', 'USER', 'GUEST'
  content TEXT NOT NULL,                         -- contenu textuel du commentaire
  is_spoiler BOOLEAN DEFAULT false,              -- masque spoiler interactif
  likes INTEGER DEFAULT 0,                       -- compteur de mentions j'aime
  liked_by JSONB DEFAULT '[]'::jsonb,            -- identifiants des utilisateurs ayant liké
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Trigger d'actualisation updated_at
DROP TRIGGER IF EXISTS tr_comments_updated_at ON public.comments;
CREATE TRIGGER tr_comments_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. Index optimisés pour les requêtes de lecture et de décompte par chapitre
CREATE INDEX IF NOT EXISTS idx_comments_book_key ON public.comments(book_key);
CREATE INDEX IF NOT EXISTS idx_comments_paragraph_id ON public.comments(paragraph_id);
CREATE INDEX IF NOT EXISTS idx_comments_book_paragraph ON public.comments(book_key, paragraph_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON public.comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON public.comments(user_id);

-- 6. Sécurité Row Level Security (RLS)
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Lecture publique : tous les visiteurs peuvent lire les commentaires
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
CREATE POLICY "Comments are viewable by everyone" ON public.comments
  FOR SELECT USING (true);

-- Insertion : utilisateurs authentifiés ou service backend
DROP POLICY IF EXISTS "Comments can be inserted by everyone" ON public.comments;
CREATE POLICY "Comments can be inserted by everyone" ON public.comments
  FOR INSERT WITH CHECK (true);

-- Mise à jour : pour les likes et modifications
DROP POLICY IF EXISTS "Comments can be updated" ON public.comments;
CREATE POLICY "Comments can be updated" ON public.comments
  FOR UPDATE USING (true);

-- Suppression : l'auteur du commentaire ou un administrateur
DROP POLICY IF EXISTS "Authors or Admins can delete comments" ON public.comments;
CREATE POLICY "Authors or Admins can delete comments" ON public.comments
  FOR DELETE USING (
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'ADMIN' OR email LIKE 'admin@%')
    )
  );
