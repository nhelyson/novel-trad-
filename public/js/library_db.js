// library_db.js - Ultra-High Precision IndexedDB Storage (Guest First, No Account Required)
const DB_NAME = 'NovelTradLibrary';
const DB_VERSION = 7;
const STORE_NAME = 'books';
const FILES_STORE = 'local_files';
const HISTORY_STORE = 'reading_history';
const FAVORITES_STORE = 'favorites';
const LIBRARY_STORE = 'local_library';
const PREFS_STORE = 'preferences';
const SYNC_QUEUE_STORE = 'sync_queue';

class LibraryDB {
    constructor(userId = null) {
        this.db = null;
        this.currentDbName = userId && userId !== 'guest' ? `NovelTradLibrary_${userId}` : DB_NAME;
        this.initPromise = this.init(this.currentDbName);
    }

    async switchUser(userId = 'guest') {
        const targetDbName = userId && userId !== 'guest' ? `NovelTradLibrary_${userId}` : DB_NAME;
        if (this.currentDbName === targetDbName && this.db) {
            return this.db;
        }
        if (this.db) {
            try { this.db.close(); } catch(e) {}
            this.db = null;
        }
        this.currentDbName = targetDbName;
        // log silenced
        this.initPromise = this.init(targetDbName);
        return this.initPromise;
    }

    init(dbName = this.currentDbName || DB_NAME) {
        this.currentDbName = dbName;
        return new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                return resolve();
            }

            const request = indexedDB.open(dbName, DB_VERSION);

            request.onerror = (event) => {
                console.warn('[LibraryDB] Database open warning:', event.target.error);
                resolve();
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // 1. Books store
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    objectStore.createIndex('lastReadDate', 'lastReadDate', { unique: false });
                    objectStore.createIndex('format', 'format', { unique: false });
                    objectStore.createIndex('status', 'status', { unique: false });
                }
                // 2. Local files store
                if (!db.objectStoreNames.contains(FILES_STORE)) {
                    const filesStore = db.createObjectStore(FILES_STORE, { keyPath: 'id' });
                    filesStore.createIndex('filename', 'filename', { unique: false });
                    filesStore.createIndex('addedAt', 'addedAt', { unique: false });
                }
                // 3. Reading History store
                if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                    const histStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'bookId' });
                    histStore.createIndex('lastReadAt', 'lastReadAt', { unique: false });
                    histStore.createIndex('seriesId', 'seriesId', { unique: false });
                }
                // 4. Favorites store
                if (!db.objectStoreNames.contains(FAVORITES_STORE)) {
                    const favStore = db.createObjectStore(FAVORITES_STORE, { keyPath: 'id' });
                    favStore.createIndex('addedAt', 'addedAt', { unique: false });
                }
                // 5. Local Library store (Saved from catalog)
                if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
                    const libStore = db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
                    libStore.createIndex('addedAt', 'addedAt', { unique: false });
                }
                // 6. Reader Preferences store
                if (!db.objectStoreNames.contains(PREFS_STORE)) {
                    db.createObjectStore(PREFS_STORE, { keyPath: 'key' });
                }
                // 7. Sync Queue store (D3)
                if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
                    const qStore = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
                    qStore.createIndex('userId', 'userId', { unique: false });
                    qStore.createIndex('timestamp', 'timestamp', { unique: false });
                    qStore.createIndex('status', 'status', { unique: false });
                }
            };
        });
    }

    _notifySyncEngine(entityType, entityId, operation, payload) {
        if (typeof window !== 'undefined' && window.syncEngine && typeof window.syncEngine.notifyLocalChange === 'function') {
            window.syncEngine.notifyLocalChange(entityType, entityId, operation, payload).catch(() => {});
        }
    }

    // =========================================================================
    // HIGH-PRECISION READING PROGRESS & HISTORY (DEBOUNCED & STABLE)
    // =========================================================================
    async saveProgress(data) {
        await this.initPromise;
        if (!this.db) return;
        
        const bookId = data.bookId || data.id;
        if (!bookId) return;

        const progressPct = Math.max(0, Math.min(100, Math.round(data.progressPct !== undefined ? data.progressPct : (data.progress || 0))));
        const status = progressPct >= 100 ? 'completed' : (progressPct > 0 ? 'reading' : 'new');

        const record = {
            bookId: bookId,
            id: bookId,
            seriesId: data.seriesId || '',
            chapterId: data.chapterId || null,
            volumeNumber: data.volumeNumber !== undefined ? data.volumeNumber : null,
            title: data.title || '',
            format: data.format || 'epub',
            cover: data.cover || '',
            position: data.position || data.location || null, // CFI for EPUB, page/scroll for PDF/Webnovel
            progressPct: progressPct,
            progress: progressPct,
            status: status,
            lastReadAt: Date.now(),
            lastReadDate: Date.now()
        };

        // 1. Save in history store
        await this._put(HISTORY_STORE, record).catch(() => {});
        // 2. Also update in books store for compatibility with library_logic.js
        await this._put(STORE_NAME, record).catch(() => {});

        // 3. Notifier SyncEngine (non-bloquant)
        this._notifySyncEngine('progress', bookId, 'upsert', record);

        return record;
    }

    async getProgress(bookId) {
        await this.initPromise;
        if (!this.db) return null;
        let p = await this._get(HISTORY_STORE, bookId);
        if (!p) {
            p = await this._get(STORE_NAME, bookId);
        }
        return p;
    }

    async getAllHistory() {
        await this.initPromise;
        if (!this.db) return [];
        const list = await this._getAll(HISTORY_STORE);
        // Sort descending by lastReadAt
        list.sort((a, b) => (b.lastReadAt || b.lastReadDate || 0) - (a.lastReadAt || a.lastReadDate || 0));
        return list;
    }

    // =========================================================================
    // LOCAL FAVORITES
    // =========================================================================
    async toggleFavorite(item) {
        await this.initPromise;
        if (!this.db) return false;
        const id = item.id || item.seriesId || item.bookId;
        const existing = await this._get(FAVORITES_STORE, id);
        if (existing) {
            await this._delete(FAVORITES_STORE, id);
            this._notifySyncEngine('favorite', id, 'delete', { id });
            return false;
        } else {
            const favRecord = {
                id: id,
                ...item,
                addedAt: Date.now()
            };
            await this._put(FAVORITES_STORE, favRecord);
            this._notifySyncEngine('favorite', id, 'upsert', favRecord);
            return true;
        }
    }

    async isFavorite(id) {
        await this.initPromise;
        if (!this.db) return false;
        const f = await this._get(FAVORITES_STORE, id);
        return !!f;
    }

    async getFavorites() {
        await this.initPromise;
        if (!this.db) return [];
        return this._getAll(FAVORITES_STORE);
    }

    // =========================================================================
    // LOCAL LIBRARY ("Ajouter à ma bibliothèque" sans compte)
    // =========================================================================
    async addToLocalLibrary(seriesOrBook) {
        await this.initPromise;
        if (!this.db) return;
        const id = seriesOrBook.id || seriesOrBook.seriesId;
        const record = {
            id: id,
            ...seriesOrBook,
            savedLocally: true,
            addedAt: seriesOrBook.addedAt || Date.now()
        };
        await this._put(LIBRARY_STORE, record);
        this._notifySyncEngine('library', id, 'upsert', record);
        return record;
    }

    async removeFromLocalLibrary(id) {
        await this.initPromise;
        if (!this.db) return;
        const res = await this._delete(LIBRARY_STORE, id);
        this._notifySyncEngine('library', id, 'delete', { id });
        return res;
    }

    async isInLocalLibrary(id) {
        await this.initPromise;
        if (!this.db) return false;
        const item = await this._get(LIBRARY_STORE, id);
        return !!item;
    }

    async getAllLocalLibrary() {
        await this.initPromise;
        if (!this.db) return [];
        return this._getAll(LIBRARY_STORE);
    }

    // =========================================================================
    // READER PREFERENCES
    // =========================================================================
    async savePreferences(prefs) {
        await this.initPromise;
        if (!this.db) return;
        const prefRecord = { key: 'reader_settings', value: prefs, updatedAt: Date.now() };
        await this._put(PREFS_STORE, prefRecord);
        this._notifySyncEngine('preference', 'reader_settings', 'upsert', prefRecord);
    }

    async getPreferences() {
        await this.initPromise;
        if (!this.db) return null;
        const res = await this._get(PREFS_STORE, 'reader_settings');
        return res ? res.value : null;
    }

    // =========================================================================
    // SYNC QUEUE OPERATIONS (D3)
    // =========================================================================
    async addToSyncQueue(item) {
        await this.initPromise;
        if (!this.db || !this.db.objectStoreNames.contains(SYNC_QUEUE_STORE)) return;
        return this._put(SYNC_QUEUE_STORE, item);
    }

    async getSyncQueue(userId) {
        await this.initPromise;
        if (!this.db || !this.db.objectStoreNames.contains(SYNC_QUEUE_STORE)) return [];
        const list = await this._getAll(SYNC_QUEUE_STORE);
        if (userId) {
            return list.filter(op => op.userId === userId);
        }
        return list;
    }

    async removeSyncQueueItem(id) {
        await this.initPromise;
        if (!this.db || !this.db.objectStoreNames.contains(SYNC_QUEUE_STORE)) return;
        return this._delete(SYNC_QUEUE_STORE, id);
    }

    // =========================================================================
    // BACKWARD COMPATIBILITY METHODS
    // =========================================================================
    async saveBook(bookData) {
        return this.saveProgress(bookData);
    }

    async getBook(id) {
        return this.getProgress(id);
    }

    async getAllBooks() {
        return this.getAllHistory();
    }

    async saveLocalFile(fileRecord) {
        await this.initPromise;
        if (!this.db) return fileRecord;
        return this._put(FILES_STORE, fileRecord);
    }

    async getLocalFile(id) {
        await this.initPromise;
        if (!this.db) return null;
        return this._get(FILES_STORE, id);
    }

    async getAllLocalFiles() {
        await this.initPromise;
        if (!this.db) return [];
        return this._getAll(FILES_STORE);
    }

    async deleteLocalFile(id) {
        await this.initPromise;
        if (!this.db) return;
        return this._delete(FILES_STORE, id);
    }

    // =========================================================================
    // INTERNAL PROMISE HELPERS
    // =========================================================================
    _put(storeName, item) {
        return new Promise((resolve) => {
            if (!this.db || !this.db.objectStoreNames.contains(storeName)) return resolve();
            try {
                const tx = this.db.transaction([storeName], 'readwrite');
                const store = tx.objectStore(storeName);
                const req = store.put(item);
                req.onsuccess = () => resolve(item);
                req.onerror = () => resolve();
            } catch(e) {
                resolve();
            }
        });
    }

    _get(storeName, key) {
        return new Promise((resolve) => {
            if (!this.db || !this.db.objectStoreNames.contains(storeName)) return resolve(null);
            try {
                const tx = this.db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch(e) {
                resolve(null);
            }
        });
    }

    _getAll(storeName) {
        return new Promise((resolve) => {
            if (!this.db || !this.db.objectStoreNames.contains(storeName)) return resolve([]);
            try {
                const tx = this.db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch(e) {
                resolve([]);
            }
        });
    }

    _delete(storeName, key) {
        return new Promise((resolve) => {
            if (!this.db || !this.db.objectStoreNames.contains(storeName)) return resolve();
            try {
                const tx = this.db.transaction([storeName], 'readwrite');
                const store = tx.objectStore(storeName);
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch(e) {
                resolve();
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.libraryDB = new LibraryDB();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LibraryDB };
}
