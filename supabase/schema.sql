-- ============================================================
-- Karelia Build AI — Supabase Schema
-- Запустить в: Supabase Dashboard → SQL Editor
-- ============================================================

-- Профили пользователей
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  company     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Анализы
CREATE TABLE IF NOT EXISTS public.analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Без названия',
  notes         TEXT,
  photo_urls    TEXT[]  DEFAULT '{}',
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed', 'error')),
  result        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- Индексы
CREATE INDEX IF NOT EXISTS analyses_user_id_idx ON public.analyses(user_id);
CREATE INDEX IF NOT EXISTS analyses_created_at_idx ON public.analyses(created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

-- profiles: только свои
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- analyses: только свои
CREATE POLICY "analyses_select_own" ON public.analyses
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "analyses_insert_own" ON public.analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "analyses_update_own" ON public.analyses
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "analyses_delete_own" ON public.analyses
  FOR DELETE USING (auth.uid() = user_id);

-- ─── AUTO-PROFILE при регистрации ────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── STORAGE BUCKET ────────────────────────────────────────
-- Запустить отдельно или через Dashboard:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('analysis-photos', 'analysis-photos', true);

-- Storage RLS: только владелец читает/пишет свою папку
CREATE POLICY "storage_owner_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'analysis-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "storage_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'analysis-photos');

CREATE POLICY "storage_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'analysis-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
