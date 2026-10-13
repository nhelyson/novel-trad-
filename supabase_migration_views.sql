-- =============================================================================
-- NOVELTRAD — SYNCHRONISATION DES VUES (VIEWS) DANS SUPABASE
-- =============================================================================

-- 1. Table des vues par série
CREATE TABLE IF NOT EXISTS public.series_views (
  series_id TEXT PRIMARY KEY,
  views BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_series_views_updated_at ON public.series_views;
CREATE TRIGGER tr_series_views_updated_at
  BEFORE UPDATE ON public.series_views
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Index pour requêtes rapides
CREATE INDEX IF NOT EXISTS idx_series_views_views ON public.series_views(views DESC);

-- 2. Sécurité Row Level Security (RLS)
ALTER TABLE public.series_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view series_views" ON public.series_views;
CREATE POLICY "Public can view series_views" ON public.series_views
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can upsert series_views" ON public.series_views;
CREATE POLICY "Anyone can upsert series_views" ON public.series_views
  FOR ALL USING (true) WITH CHECK (true);

-- 3. Mise à jour de la VUE series_stats (avec total_views et security_invoker = true)
CREATE OR REPLACE VIEW public.series_stats
WITH (security_invoker = true) AS
SELECT 
  s.series_id,
  COALESCE(ROUND(AVG(r.rating), 2), 4.8) AS average_rating,
  COUNT(DISTINCT r.id) AS total_ratings,
  COUNT(DISTINCT l.id) AS total_likes,
  COALESCE(v.views, 0) AS total_views
FROM (
  SELECT DISTINCT series_id FROM public.series_ratings
  UNION
  SELECT DISTINCT series_id FROM public.series_likes
  UNION
  SELECT DISTINCT series_id FROM public.series_views
) s
LEFT JOIN public.series_ratings r ON r.series_id = s.series_id
LEFT JOIN public.series_likes l ON l.series_id = s.series_id
LEFT JOIN public.series_views v ON v.series_id = s.series_id
GROUP BY s.series_id, v.views;
