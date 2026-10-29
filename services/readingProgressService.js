const fs = require('fs');
const path = require('path');
let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {}

const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'reading_progress_db.json');

class ReadingProgressService {
  static supabase = null;

  static initSupabase() {
    if (this.supabase) return this.supabase;
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (createClient && url && key) {
      try {
        this.supabase = createClient(url, key);
      } catch (e) {
        console.warn('[ReadingProgressService] Supabase init warning:', e.message);
      }
    }
    return this.supabase;
  }

  static loadLocalData() {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return { users: {} };
    }
    try {
      const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return { users: {} };
    }
  }

  static saveLocalData(data) {
    try {
      const dir = path.dirname(PROGRESS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[ReadingProgressService] Error saving local DB:', e.message);
      return false;
    }
  }

  static async saveProgress(userId, data = {}) {
    if (!userId) return null;

    const bookId = data.bookId || data.id || data.fileKey;
    if (!bookId) return null;

    const record = {
      user_id: String(userId),
      book_id: String(bookId),
      series_id: String(data.seriesId || data.series_id || ''),
      chapter_id: data.chapterId || data.chapterNumber || data.chapterNum || 1,
      title: String(data.title || ''),
      cover: String(data.cover || ''),
      format: String(data.format || 'epub'),
      position: data.position || data.location || null,
      progress_pct: Math.max(0, Math.min(100, Math.round(data.progressPct !== undefined ? data.progressPct : (data.progress || 0)))),
      status: (data.progressPct >= 100 || data.progress >= 100) ? 'completed' : 'reading',
      last_read_at: new Date(data.lastReadAt || Date.now()).toISOString(),
      updated_at: Date.now()
    };

    // 1. Sauvegarde locale (Garantie 100% sans latence)
    const local = this.loadLocalData();
    if (!local.users) local.users = {};
    if (!local.users[userId]) local.users[userId] = {};
    local.users[userId][bookId] = record;
    // Marquer comme dernière lecture globale de cet utilisateur
    local.users[userId]._latest = record;
    this.saveLocalData(local);

    // 2. Synchronisation Supabase Cloud en arrière-plan
    this.initSupabase();
    if (this.supabase && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      try {
        await this.supabase.from('user_reading_progress').upsert({
          user_id: record.user_id,
          book_id: record.book_id,
          series_id: record.series_id,
          chapter_id: record.chapter_id,
          title: record.title,
          format: record.format,
          position: record.position,
          progress_pct: record.progress_pct,
          status: record.status,
          last_read_at: record.last_read_at
        }, { onConflict: 'user_id,book_id' });
      } catch (cloudErr) {
        // Silently continue (offline first)
      }
    }

    return record;
  }

  static async getLatestProgress(userId) {
    if (!userId) return null;

    // 1. Check Cloud en priorité si connecté Supabase
    this.initSupabase();
    if (this.supabase && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      try {
        const { data, error } = await this.supabase
          .from('user_reading_progress')
          .select('*')
          .eq('user_id', userId)
          .order('last_read_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          return {
            userId: data.user_id,
            bookId: data.book_id,
            seriesId: data.series_id,
            chapterId: data.chapter_id,
            title: data.title,
            cover: data.cover || '',
            format: data.format || 'epub',
            position: data.position,
            progressPct: data.progress_pct || 0,
            status: data.status || 'reading',
            lastReadAt: new Date(data.last_read_at).getTime()
          };
        }
      } catch (e) {}
    }

    // 2. Fallback Local
    const local = this.loadLocalData();
    if (local.users && local.users[userId]) {
      const u = local.users[userId];
      if (u._latest) {
        return {
          userId: u._latest.user_id,
          bookId: u._latest.book_id,
          seriesId: u._latest.series_id,
          chapterId: u._latest.chapter_id,
          title: u._latest.title,
          cover: u._latest.cover || '',
          format: u._latest.format || 'epub',
          position: u._latest.position,
          progressPct: u._latest.progress_pct || 0,
          status: u._latest.status || 'reading',
          lastReadAt: new Date(u._latest.last_read_at).getTime()
        };
      }
    }

    return null;
  }
}

module.exports = ReadingProgressService;
