const fs = require('fs');
const path = require('path');
let createClient = null;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {}

const COMMENTS_FILE = path.join(__dirname, '..', '..', 'data', 'comments_db.json');

class CommentService {
  static supabase = null;

  static initSupabase() {
    if (this.supabase) return this.supabase;
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (createClient && url && key) {
      try {
        this.supabase = createClient(url, key);
        console.log('[CommentService] Connecté à Supabase Cloud.');
      } catch (e) {
        console.warn('[CommentService] Impossible d\'initialiser Supabase:', e.message);
      }
    }
    return this.supabase;
  }

  static loadLocalData() {
    if (!fs.existsSync(COMMENTS_FILE)) {
      return { comments: [] };
    }
    try {
      const raw = fs.readFileSync(COMMENTS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[CommentService] Error reading local database:', e.message);
      return { comments: [] };
    }
  }

  static saveLocalData(data) {
    try {
      const dir = path.dirname(COMMENTS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[CommentService] Error saving local database:', e.message);
      return false;
    }
  }

  static getLocalCounts(bookKey, chapter) {
    const data = this.loadLocalData();
    const counts = {};
    if (!bookKey) return counts;

    const prefix = (chapter !== undefined && chapter !== null && chapter !== '') ? `c${chapter}_` : '';
    (data.comments || []).forEach(c => {
      if (c.book_key === bookKey) {
        if (!prefix || (c.paragraph_id && c.paragraph_id.startsWith(prefix))) {
          counts[c.paragraph_id] = (counts[c.paragraph_id] || 0) + 1;
        }
      }
    });
    return counts;
  }

  static getLocalComments(bookKey, paragraphId) {
    const data = this.loadLocalData();
    if (!bookKey || !paragraphId) return [];

    return (data.comments || [])
      .filter(c => c.book_key === bookKey && c.paragraph_id === paragraphId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  static async getCounts(bookKey, chapter) {
    this.initSupabase();
    if (this.supabase && bookKey) {
      try {
        let query = this.supabase.from('comments').select('paragraph_id').eq('book_key', String(bookKey));
        if (chapter !== undefined && chapter !== null && chapter !== '') {
          query = query.like('paragraph_id', `c${chapter}_%`);
        }
        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          const counts = {};
          data.forEach(row => {
            counts[row.paragraph_id] = (counts[row.paragraph_id] || 0) + 1;
          });
          return counts;
        }
      } catch (err) {
        // Fallback silently to local
      }
    }
    return this.getLocalCounts(bookKey, chapter);
  }

  static async getComments(bookKey, paragraphId) {
    this.initSupabase();
    if (this.supabase && bookKey && paragraphId) {
      try {
        const { data, error } = await this.supabase
          .from('comments')
          .select('*')
          .eq('book_key', String(bookKey))
          .eq('paragraph_id', String(paragraphId))
          .order('created_at', { ascending: true });

        if (!error && Array.isArray(data)) {
          return data;
        }
      } catch (err) {
        // Fallback silently to local
      }
    }
    return this.getLocalComments(bookKey, paragraphId);
  }

  static async addComment({ bookKey, paragraphId, excerpt, userId, userName, userAvatar, userRole, content, isSpoiler, parentId }) {
    if (!bookKey || !paragraphId) throw new Error('bookKey et paragraphId requis.');
    const cleanContent = String(content || '').trim().replace(/[<>]/g, '');
    if (cleanContent.length < 2) throw new Error('Le commentaire doit comporter au moins 2 caractères.');
    if (cleanContent.length > 1000) throw new Error('Le commentaire ne doit pas dépasser 1000 caractères.');

    const newComment = {
      id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      parent_id: (parentId && String(parentId).trim()) ? String(parentId).trim() : null,
      book_key: String(bookKey),
      paragraph_id: String(paragraphId),
      excerpt: String(excerpt || '').slice(0, 300),
      user_id: String(userId || 'guest'),
      user_name: String(userName || 'Lecteur'),
      user_avatar: String(userAvatar || ''),
      user_role: String(userRole || 'USER'),
      content: cleanContent,
      is_spoiler: Boolean(isSpoiler),
      likes: 0,
      liked_by: [],
      created_at: new Date().toISOString()
    };

    // 1. Save to local storage (instant cache & offline assurance)
    const local = this.loadLocalData();
    if (!Array.isArray(local.comments)) local.comments = [];
    local.comments.push(newComment);
    this.saveLocalData(local);

    // 2. Persist to Supabase Cloud
    this.initSupabase();
    if (this.supabase) {
      try {
        const { error } = await this.supabase.from('comments').insert([{
          id: newComment.id,
          book_key: newComment.book_key,
          paragraph_id: newComment.paragraph_id,
          parent_id: newComment.parent_id || null,
          excerpt: newComment.excerpt,
          user_id: (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(newComment.user_id)) ? newComment.user_id : null,
          user_name: newComment.user_name,
          user_avatar: newComment.user_avatar,
          user_role: newComment.user_role,
          content: newComment.content,
          is_spoiler: newComment.is_spoiler,
          likes: newComment.likes,
          liked_by: newComment.liked_by,
          created_at: newComment.created_at
        }]);
        if (error) {
          console.warn('[CommentService] Supabase insert notice:', error.message);
        } else {
          console.log('[CommentService] Commentaire synchronisé sur Supabase:', newComment.id);
        }
      } catch (err) {
        console.warn('[CommentService] Supabase write error:', err.message);
      }
    }

    return newComment;
  }

  static async toggleLike(commentId, userIdentifier) {
    const local = this.loadLocalData();
    const comment = (local.comments || []).find(c => c.id === commentId);
    if (!comment) throw new Error('Commentaire introuvable.');

    if (!Array.isArray(comment.liked_by)) comment.liked_by = [];
    const idx = comment.liked_by.indexOf(userIdentifier);
    let liked = false;

    if (idx > -1) {
      comment.liked_by.splice(idx, 1);
      comment.likes = Math.max(0, (comment.likes || 1) - 1);
      liked = false;
    } else {
      comment.liked_by.push(userIdentifier);
      comment.likes = (comment.likes || 0) + 1;
      liked = true;
    }

    this.saveLocalData(local);

    // Sync like to Supabase
    this.initSupabase();
    if (this.supabase) {
      try {
        await this.supabase.from('comments').update({
          likes: comment.likes,
          liked_by: comment.liked_by
        }).eq('id', commentId);
      } catch (err) {}
    }

    return { likes: comment.likes, liked };
  }

  static async deleteComment(commentId, requestingUser) {
    const local = this.loadLocalData();
    const idx = (local.comments || []).findIndex(c => c.id === commentId);
    if (idx === -1) throw new Error('Commentaire introuvable.');

    const c = local.comments[idx];
    const isAdmin = (requestingUser.role || '').toUpperCase() === 'ADMIN';
    const isAuthor = requestingUser.id && (requestingUser.id === c.user_id);

    if (!isAdmin && !isAuthor) {
      throw new Error('Vous n\'êtes pas autorisé à supprimer ce commentaire.');
    }

    local.comments.splice(idx, 1);
    this.saveLocalData(local);

    // Sync delete to Supabase
    this.initSupabase();
    if (this.supabase) {
      try {
        await this.supabase.from('comments').delete().eq('id', commentId);
      } catch (err) {}
    }

    return { success: true };
  }
}

module.exports = CommentService;
