const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class DatabaseService {
  constructor() {
    this.dbPath = path.join(__dirname, '..', '..', 'data', 'database.sqlite');
    this.db = null;
    this.isReady = false;
    this.initPromise = this.init();
  }

  async init() {
    try {
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const SQL = await initSqlJs();

      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
      }

      // Create Schema
      this.db.run(`
        CREATE TABLE IF NOT EXISTS translation_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_hash TEXT UNIQUE,
          source_text TEXT,
          normalized_text TEXT,
          source_lang TEXT,
          target_lang TEXT,
          translated_text TEXT,
          provider TEXT,
          created_at TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          filename TEXT,
          status TEXT,
          total_chapters INTEGER DEFAULT 0,
          total_segments INTEGER DEFAULT 0,
          translated_segments INTEGER DEFAULT 0,
          raw_characters INTEGER DEFAULT 0,
          cleaned_characters INTEGER DEFAULT 0,
          saved_characters INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          document_id TEXT,
          chapter_index INTEGER,
          title TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS segments (
          id TEXT PRIMARY KEY,
          document_id TEXT,
          chapter_id TEXT,
          segment_index INTEGER,
          source_text TEXT,
          normalized_text TEXT,
          source_hash TEXT,
          translated_text TEXT,
          status TEXT,
          error_message TEXT,
          characters_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS character_usage_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT,
          document_id TEXT,
          chapter_id TEXT,
          segment_id TEXT,
          characters_sent INTEGER,
          provider TEXT,
          status TEXT
        );
      `);

      this.saveDisk();
      this.isReady = true;
      console.log('[DatabaseService] Persistent SQLite Storage initialized cleanly at:', this.dbPath);
    } catch (err) {
      console.error('[DatabaseService] Failed to initialize SQLite storage:', err.message);
      throw err;
    }
  }

  saveDisk() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err) {
      console.error('[DatabaseService] Disk sync error:', err.message);
    }
  }

  async ensureReady() {
    if (!this.isReady) {
      await this.initPromise;
    }
  }

  // --- TRANSLATION MEMORY ---

  async findInMemory(sourceHash, targetLang) {
    await this.ensureReady();
    const stmt = this.db.prepare(
      `SELECT * FROM translation_memory WHERE source_hash = :hash AND target_lang = :targetLang LIMIT 1`
    );
    stmt.bind({ ':hash': sourceHash, ':targetLang': targetLang.toUpperCase() });
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  async saveToMemory(sourceHash, sourceText, normalizedText, sourceLang, targetLang, translatedText, provider) {
    await this.ensureReady();
    const now = new Date().toISOString();
    try {
      this.db.run(
        `INSERT OR REPLACE INTO translation_memory 
         (source_hash, source_text, normalized_text, source_lang, target_lang, translated_text, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sourceHash,
          sourceText,
          normalizedText,
          (sourceLang || 'AUTO').toUpperCase(),
          targetLang.toUpperCase(),
          translatedText,
          provider,
          now,
          now
        ]
      );
      this.saveDisk();
    } catch (err) {
      console.error('[DatabaseService] Error saving translation memory entry:', err.message);
    }
  }

  async getMemoryStats() {
    await this.ensureReady();
    const res = this.db.exec(`SELECT COUNT(*) as total FROM translation_memory`);
    const total = res.length > 0 && res[0].values.length > 0 ? res[0].values[0][0] : 0;
    return { totalEntries: total };
  }

  // --- DOCUMENTS ---

  async saveDocument(doc) {
    await this.ensureReady();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT OR REPLACE INTO documents 
       (id, filename, status, total_chapters, total_segments, translated_segments, raw_characters, cleaned_characters, saved_characters, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.id,
        doc.filename,
        doc.status,
        doc.total_chapters || 0,
        doc.total_segments || 0,
        doc.translated_segments || 0,
        doc.raw_characters || 0,
        doc.cleaned_characters || 0,
        doc.saved_characters || 0,
        doc.created_at || now,
        now
      ]
    );
    this.saveDisk();
  }

  async getDocument(docId) {
    await this.ensureReady();
    const stmt = this.db.prepare(`SELECT * FROM documents WHERE id = :id`);
    stmt.bind({ ':id': docId });
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  // --- CHAPTERS & SEGMENTS ---

  async saveChapter(chapter) {
    await this.ensureReady();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT OR REPLACE INTO chapters (id, document_id, chapter_index, title, created_at) VALUES (?, ?, ?, ?, ?)`,
      [chapter.id, chapter.document_id, chapter.chapter_index, chapter.title, now]
    );
    this.saveDisk();
  }

  async saveSegments(segments) {
    await this.ensureReady();
    for (const seg of segments) {
      this.db.run(
        `INSERT OR REPLACE INTO segments 
         (id, document_id, chapter_id, segment_index, source_text, normalized_text, source_hash, translated_text, status, error_message, characters_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seg.id,
          seg.document_id,
          seg.chapter_id,
          seg.segment_index,
          seg.source_text,
          seg.normalized_text,
          seg.source_hash,
          seg.translated_text || null,
          seg.status || 'PENDING',
          seg.error_message || null,
          seg.characters_count || 0
        ]
      );
    }
    this.saveDisk();
  }

  async getDocumentSegments(docId) {
    await this.ensureReady();
    const stmt = this.db.prepare(`SELECT * FROM segments WHERE document_id = :docId ORDER BY segment_index ASC`);
    stmt.bind({ ':docId': docId });
    const segments = [];
    while (stmt.step()) {
      segments.push(stmt.getAsObject());
    }
    stmt.free();
    return segments;
  }

  async updateSegmentStatus(segmentId, status, translatedText = null, errorMessage = null) {
    await this.ensureReady();
    this.db.run(
      `UPDATE segments SET status = ?, translated_text = COALESCE(?, translated_text), error_message = ? WHERE id = ?`,
      [status, translatedText, errorMessage, segmentId]
    );
    this.saveDisk();
  }

  // --- CHARACTER USAGE LOG ---

  async logCharacterUsage(docId, chapterId, segmentId, charactersSent, provider, status) {
    await this.ensureReady();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO character_usage_log (timestamp, document_id, chapter_id, segment_id, characters_sent, provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [now, docId || null, chapterId || null, segmentId || null, charactersSent, provider, status]
    );
    this.saveDisk();
  }

  async getGlobalUsageStats() {
    await this.ensureReady();
    const resSent = this.db.exec(`SELECT SUM(characters_sent) FROM character_usage_log WHERE status = 'SUCCESS'`);
    const totalSent = resSent.length > 0 && resSent[0].values.length > 0 && resSent[0].values[0][0] ? resSent[0].values[0][0] : 0;

    const resSaved = this.db.exec(`SELECT SUM(saved_characters) FROM documents`);
    const totalSaved = resSaved.length > 0 && resSaved[0].values.length > 0 && resSaved[0].values[0][0] ? resSaved[0].values[0][0] : 0;

    const memoryStats = await this.getMemoryStats();

    return {
      totalCharactersSent: totalSent,
      totalCharactersSaved: totalSaved,
      cacheEntries: memoryStats.totalEntries,
      hitRatePercent: (totalSent + totalSaved) > 0 ? ((totalSaved / (totalSent + totalSaved)) * 100).toFixed(1) : '0.0'
    };
  }
}

module.exports = new DatabaseService();
