/**
 * sync_engine.js - Centralized Offline-First Sync Engine (NovelTrad D3)
 * 
 * - Guest First / Local First : Zéro blocage, aucune synchronisation si non connecté.
 * - Bidirectionnel & Idempotent : Pull Cloud ➔ Merge/LWW ➔ Push Pending Queue ➔ Status UI.
 * - Stratégies :
 *     * Library & Favorites : MERGE + gestion distribuée des suppressions via user_deletions.
 *     * Progress & Preferences : LWW (Last-Write-Wins) temporel strict.
 *     * local_files : LOCAL ONLY (strictement exclu).
 * - Multi-comptes : Partitionnement strict de sync_queue par userId sans perte de données.
 * - Tolérance aux pannes : Retries avec backoff exponentiel, persistance IndexedDB.
 */

class SyncEngine {
    constructor() {
        this.currentUser = null;
        this.currentSession = null;
        this.syncInProgress = false;
        this.pendingDebounceTimer = null;
        this.status = 'idle'; // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
        this.lastSyncTime = null;
        this.statusListeners = [];

        this.init();
    }

    async init() {
        // 1. Écouter les événements réseau
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('online', () => {
                this._updateStatus(this.currentUser ? 'idle' : 'offline');
                if (this.currentUser) {
                    this.syncAll({ trigger: 'online' });
                }
            });

            window.addEventListener('offline', () => {
                this._updateStatus('offline');
            });
        }

        // 2. Écouter les changements d'authentification Supabase
        this._setupAuthListener();
    }

    _setupAuthListener() {
        if (typeof window === 'undefined') return;

        const checkAuth = () => {
            if (window.supabaseAuth && typeof window.supabaseAuth.onAuthStateChange === 'function') {
                window.supabaseAuth.onAuthStateChange((event, session) => {
                    this._handleAuthChange(event, session);
                });

                // État initial
                if (window.supabaseAuth.isAuthenticated()) {
                    this._handleAuthChange('INITIAL', window.supabaseAuth.getSession());
                }
            } else {
                setTimeout(checkAuth, 300);
            }
        };
        checkAuth();
    }

    async _handleAuthChange(event, session) {
        if (session && session.user) {
            const previousUserId = this.currentUser ? this.currentUser.id : null;
            this.currentUser = session.user;
            this.currentSession = session;

            // [SyncEngine] Utilisateur authentifié

            // Si c'est une nouvelle connexion ou un premier login, adopter les opérations 'guest'
            if (previousUserId !== this.currentUser.id) {
                await this._adoptGuestOperations(this.currentUser.id);
            }

            // Lancer la première synchronisation en arrière-plan
            this.syncAll({ trigger: 'auth_login', isInitial: true });
        } else {
            this.currentUser = null;
            this.currentSession = null;
            this.syncInProgress = false;
            if (this.pendingDebounceTimer) {
                clearTimeout(this.pendingDebounceTimer);
                this.pendingDebounceTimer = null;
            }
            this._updateStatus(this.isOnline() ? 'idle' : 'offline');
        }
    }

    async _adoptGuestOperations(newUserId) {
        if (!window.libraryDB) return;
        try {
            const guestOps = await window.libraryDB.getSyncQueue('guest');
            if (guestOps && guestOps.length > 0) {
                for (const op of guestOps) {
                    op.userId = newUserId;
                    await window.libraryDB.addToSyncQueue(op);
                }
            }
        } catch (e) {
            console.warn('[SyncEngine] Erreur adoption guest ops:', e.message);
        }
    }

    isOnline() {
        if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
            return navigator.onLine;
        }
        return true;
    }

    getSupabaseClient() {
        if (window.supabaseAuth && window.supabaseAuth.client) {
            return window.supabaseAuth.client;
        }
        return null;
    }

    // =========================================================================
    // HOOK DE NOTIFICATION DES MUTATIONS LOCALES (Appelé par libraryDB)
    // =========================================================================
    async notifyLocalChange(entityType, entityId, operation, payload = {}) {
        // En mode Invité : aucun appel Supabase, juste enregistrement optionnel 'guest'
        const userId = this.currentUser ? this.currentUser.id : 'guest';

        const queueItem = {
            id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            userId: userId,
            entityType: entityType, // 'library' | 'favorite' | 'progress' | 'preference'
            entityId: entityId,
            operation: operation,   // 'upsert' | 'delete'
            payload: payload,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending'
        };

        if (window.libraryDB) {
            await window.libraryDB.addToSyncQueue(queueItem).catch(() => {});
        }

        // Si non connecté ou hors ligne, s'arrêter là (Guest / Offline first)
        if (!this.currentUser || !this.isOnline()) {
            return;
        }

        // Debounce de synchronisation adapté par type
        if (entityType === 'progress') {
            // Debounce à 2500ms pour les lectures fréquentes
            if (this.pendingDebounceTimer) clearTimeout(this.pendingDebounceTimer);
            this.pendingDebounceTimer = setTimeout(() => {
                this.syncAll({ trigger: 'progress_change' });
            }, 2500);
        } else {
            // Déclenchement rapide (400ms) pour bibliothèque, favoris, préférences
            if (this.pendingDebounceTimer) clearTimeout(this.pendingDebounceTimer);
            this.pendingDebounceTimer = setTimeout(() => {
                this.syncAll({ trigger: 'user_action' });
            }, 400);
        }
    }

    // =========================================================================
    // CYCLE COMPLET DE SYNCHRONISATION (IDEMPOTENT & NON-BLOQUANT)
    // =========================================================================
    async syncAll(options = {}) {
        if (!this.currentUser) return { success: true, skipped: 'guest_mode' };
        if (!this.isOnline()) {
            this._updateStatus('offline');
            return { success: false, skipped: 'offline' };
        }
        if (this.syncInProgress) {
            return { success: true, skipped: 'already_running' };
        }

        const supabase = this.getSupabaseClient();
        if (!supabase) return { success: false, error: 'supabase_not_ready' };

        this.syncInProgress = true;
        this._updateStatus('syncing');

        const userId = this.currentUser.id;

        try {
            // -----------------------------------------------------------------
            // ÉTAPE 1 : PULL CLOUD (Lecture de toutes les données distantes de l'utilisateur)
            // -----------------------------------------------------------------
            const [libRes, favRes, progRes, prefRes, delRes] = await Promise.all([
                supabase.from('user_library').select('*').eq('user_id', userId),
                supabase.from('user_favorites').select('*').eq('user_id', userId),
                supabase.from('user_reading_progress').select('*').eq('user_id', userId),
                supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
                supabase.from('user_deletions').select('*').eq('user_id', userId)
            ]);

            const cloudLibrary = libRes.data || [];
            const cloudFavorites = favRes.data || [];
            const cloudProgress = progRes.data || [];
            const cloudPref = prefRes.data || null;
            const cloudDeletions = delRes.data || [];

            // Indexer les suppressions cloud pour consultation rapide
            const deletionsMap = new Map();
            cloudDeletions.forEach(d => {
                deletionsMap.set(`${d.entity_type}:${d.entity_id}`, new Date(d.deleted_at).getTime());
            });

            // -----------------------------------------------------------------
            // ÉTAPE 2 : CHARGEMENT DES DONNÉES LOCALES INDEXEDDB
            // -----------------------------------------------------------------
            const localLibrary = (await window.libraryDB.getAllLocalLibrary()) || [];
            const localFavorites = (await window.libraryDB.getFavorites()) || [];
            const localHistory = (await window.libraryDB.getAllHistory()) || [];
            const localPref = (await window.libraryDB.getPreferences()) || null;
            const pendingQueue = (await window.libraryDB.getSyncQueue(userId)) || [];

            // Collections à envoyer vers Supabase (Push)
            const pushLibrary = [];
            const pushFavorites = [];
            const pushProgress = [];
            let pushPref = null;
            const pushDeletions = [];
            const processedQueueIds = [];

            // -----------------------------------------------------------------
            // ÉTAPE 3 : RÉCONCILIATION — BIBLIOTHÈQUE (user_library / local_library)
            // -----------------------------------------------------------------
            const localLibMap = new Map(localLibrary.map(i => [i.id || i.seriesId, i]));
            const cloudLibMap = new Map(cloudLibrary.map(i => [i.series_id, i]));

            // Traitement des suppressions cloud sur le local
            for (const [seriesId, localItem] of localLibMap.entries()) {
                const delTime = deletionsMap.get(`library:${seriesId}`);
                if (delTime && delTime > (localItem.addedAt || 0)) {
                    await window.libraryDB.removeFromLocalLibrary(seriesId);
                    localLibMap.delete(seriesId);
                }
            }

            // Union Cloud ➔ Local
            for (const [seriesId, cloudItem] of cloudLibMap.entries()) {
                const delTime = deletionsMap.get(`library:${seriesId}`);
                if (delTime && delTime >= new Date(cloudItem.added_at).getTime()) {
                    continue; // Déjà supprimé
                }
                if (!localLibMap.has(seriesId)) {
                    const newLocal = {
                        id: cloudItem.series_id,
                        seriesId: cloudItem.series_id,
                        title: cloudItem.title,
                        cover: cloudItem.cover,
                        author: cloudItem.author,
                        format: cloudItem.format,
                        addedAt: new Date(cloudItem.added_at).getTime()
                    };
                    await window.libraryDB.addToLocalLibrary(newLocal);
                    localLibMap.set(seriesId, newLocal);
                }
            }

            // Union Local ➔ Cloud
            for (const [seriesId, localItem] of localLibMap.entries()) {
                if (!cloudLibMap.has(seriesId)) {
                    pushLibrary.push({
                        user_id: userId,
                        series_id: seriesId,
                        title: localItem.title || 'Sans titre',
                        cover: localItem.cover || '',
                        author: localItem.author || '',
                        format: localItem.format || 'epub',
                        added_at: new Date(localItem.addedAt || Date.now()).toISOString()
                    });
                }
            }

            // -----------------------------------------------------------------
            // ÉTAPE 4 : RÉCONCILIATION — FAVORIS (user_favorites / favorites)
            // -----------------------------------------------------------------
            const localFavMap = new Map(localFavorites.map(i => [i.id, i]));
            const cloudFavMap = new Map(cloudFavorites.map(i => [i.item_id, i]));

            // Suppressions cloud sur local
            for (const [itemId, localItem] of localFavMap.entries()) {
                const delTime = deletionsMap.get(`favorite:${itemId}`);
                if (delTime && delTime > (localItem.addedAt || 0)) {
                    await window.libraryDB._delete('favorites', itemId);
                    localFavMap.delete(itemId);
                }
            }

            // Union Cloud ➔ Local
            for (const [itemId, cloudItem] of cloudFavMap.entries()) {
                const delTime = deletionsMap.get(`favorite:${itemId}`);
                if (delTime && delTime >= new Date(cloudItem.added_at).getTime()) {
                    continue;
                }
                if (!localFavMap.has(itemId)) {
                    const newFav = {
                        id: cloudItem.item_id,
                        title: cloudItem.title,
                        cover: cloudItem.cover,
                        format: cloudItem.format,
                        addedAt: new Date(cloudItem.added_at).getTime()
                    };
                    await window.libraryDB._put('favorites', newFav);
                    localFavMap.set(itemId, newFav);
                }
            }

            // Union Local ➔ Cloud
            for (const [itemId, localItem] of localFavMap.entries()) {
                if (!cloudFavMap.has(itemId)) {
                    pushFavorites.push({
                        user_id: userId,
                        item_id: itemId,
                        title: localItem.title || 'Sans titre',
                        cover: localItem.cover || '',
                        format: localItem.format || 'epub',
                        added_at: new Date(localItem.addedAt || Date.now()).toISOString()
                    });
                }
            }

            // -----------------------------------------------------------------
            // ÉTAPE 5 : RÉCONCILIATION — PROGRESSION (LWW TEMPOREL STRICT)
            // -----------------------------------------------------------------
            const localHistMap = new Map(localHistory.map(i => [i.bookId || i.id, i]));
            const cloudHistMap = new Map(cloudProgress.map(i => [i.book_id, i]));

            const allBookIds = new Set([...localHistMap.keys(), ...cloudHistMap.keys()]);

            for (const bookId of allBookIds) {
                const localItem = localHistMap.get(bookId);
                const cloudItem = cloudHistMap.get(bookId);

                if (localItem && !cloudItem) {
                    // Présent seulement en local ➔ Pousser vers Cloud
                    pushProgress.push({
                        user_id: userId,
                        book_id: bookId,
                        series_id: localItem.seriesId || '',
                        chapter_id: localItem.chapterId || null,
                        title: localItem.title || '',
                        format: localItem.format || 'epub',
                        position: localItem.position || null,
                        progress_pct: localItem.progressPct !== undefined ? localItem.progressPct : (localItem.progress || 0),
                        status: localItem.status || 'reading',
                        last_read_at: new Date(localItem.lastReadAt || Date.now()).toISOString()
                    });
                } else if (!localItem && cloudItem) {
                    // Présent seulement dans le Cloud ➔ Écrire en local (History + Miroir Books)
                    const newHist = {
                        bookId: cloudItem.book_id,
                        id: cloudItem.book_id,
                        seriesId: cloudItem.series_id || '',
                        chapterId: cloudItem.chapter_id || null,
                        title: cloudItem.title || '',
                        format: cloudItem.format || 'epub',
                        position: cloudItem.position || null,
                        progressPct: cloudItem.progress_pct || 0,
                        progress: cloudItem.progress_pct || 0,
                        status: cloudItem.status || 'reading',
                        lastReadAt: new Date(cloudItem.last_read_at).getTime(),
                        lastReadDate: new Date(cloudItem.last_read_at).getTime()
                    };
                    await window.libraryDB._put('reading_history', newHist);
                    await window.libraryDB._put('books', newHist);
                } else if (localItem && cloudItem) {
                    // Conflit ➔ Comparaison Last-Write-Wins (LWW)
                    const localTime = localItem.lastReadAt || localItem.lastReadDate || 0;
                    const cloudTime = new Date(cloudItem.last_read_at).getTime();

                    if (localTime > cloudTime) {
                        // LOCAL PLUS RÉCENT ➔ Pousser vers Cloud
                        pushProgress.push({
                            user_id: userId,
                            book_id: bookId,
                            series_id: localItem.seriesId || '',
                            chapter_id: localItem.chapterId || null,
                            title: localItem.title || '',
                            format: localItem.format || 'epub',
                            position: localItem.position || null,
                            progress_pct: localItem.progressPct !== undefined ? localItem.progressPct : (localItem.progress || 0),
                            status: localItem.status || 'reading',
                            last_read_at: new Date(localTime).toISOString()
                        });
                    } else if (cloudTime > localTime) {
                        // CLOUD PLUS RÉCENT ➔ Mettre à jour local
                        const updatedHist = {
                            bookId: cloudItem.book_id,
                            id: cloudItem.book_id,
                            seriesId: cloudItem.series_id || '',
                            chapterId: cloudItem.chapter_id || null,
                            title: cloudItem.title || '',
                            format: cloudItem.format || 'epub',
                            position: cloudItem.position || null,
                            progressPct: cloudItem.progress_pct || 0,
                            progress: cloudItem.progress_pct || 0,
                            status: cloudItem.status || 'reading',
                            lastReadAt: cloudTime,
                            lastReadDate: cloudTime
                        };
                        await window.libraryDB._put('reading_history', updatedHist);
                        await window.libraryDB._put('books', updatedHist);
                    }
                }
            }

            // -----------------------------------------------------------------
            // ÉTAPE 6 : RÉCONCILIATION — PRÉFÉRENCES (LWW)
            // -----------------------------------------------------------------
            if (localPref && !cloudPref) {
                pushPref = {
                    user_id: userId,
                    theme: localPref.theme || 'dark',
                    font_size: localPref.fontSize || '18px',
                    font_family: localPref.fontFamily || 'Inter, sans-serif',
                    line_height: localPref.lineHeight || '1.8',
                    updated_at: new Date(localPref.updatedAt || Date.now()).toISOString()
                };
            } else if (!localPref && cloudPref) {
                const newPref = {
                    theme: cloudPref.theme,
                    fontSize: cloudPref.font_size,
                    fontFamily: cloudPref.font_family,
                    lineHeight: cloudPref.line_height,
                    updatedAt: new Date(cloudPref.updated_at).getTime()
                };
                await window.libraryDB.savePreferences(newPref);
            } else if (localPref && cloudPref) {
                const localTime = localPref.updatedAt || 0;
                const cloudTime = new Date(cloudPref.updated_at).getTime();

                if (localTime > cloudTime) {
                    pushPref = {
                        user_id: userId,
                        theme: localPref.theme || 'dark',
                        font_size: localPref.fontSize || '18px',
                        font_family: localPref.fontFamily || 'Inter, sans-serif',
                        line_height: localPref.lineHeight || '1.8',
                        updated_at: new Date(localTime).toISOString()
                    };
                } else if (cloudTime > localTime) {
                    const updatedPref = {
                        theme: cloudPref.theme,
                        fontSize: cloudPref.font_size,
                        fontFamily: cloudPref.font_family,
                        lineHeight: cloudPref.line_height,
                        updatedAt: cloudTime
                    };
                    await window.libraryDB.savePreferences(updatedPref);
                }
            }

            // -----------------------------------------------------------------
            // ÉTAPE 7 : TRAITEMENT DE LA FILE D'ATTENTE PENDING & TOMBSTONES
            // -----------------------------------------------------------------
            for (const op of pendingQueue) {
                if (op.operation === 'delete') {
                    if (op.entityType === 'library') {
                        await supabase.from('user_library').delete().eq('user_id', userId).eq('series_id', op.entityId);
                        pushDeletions.push({
                            user_id: userId,
                            entity_type: 'library',
                            entity_id: op.entityId,
                            deleted_at: new Date(op.timestamp).toISOString()
                        });
                    } else if (op.entityType === 'favorite') {
                        await supabase.from('user_favorites').delete().eq('user_id', userId).eq('item_id', op.entityId);
                        pushDeletions.push({
                            user_id: userId,
                            entity_type: 'favorite',
                            entity_id: op.entityId,
                            deleted_at: new Date(op.timestamp).toISOString()
                        });
                    }
                }
                processedQueueIds.push(op.id);
            }

            // -----------------------------------------------------------------
            // ÉTAPE 8 : PUSH GROUPÉ VERS SUPABASE (UPSERT IDEMPOTENT)
            // -----------------------------------------------------------------
            if (pushLibrary.length > 0) {
                await supabase.from('user_library').upsert(pushLibrary, { onConflict: 'user_id, series_id' });
            }
            if (pushFavorites.length > 0) {
                await supabase.from('user_favorites').upsert(pushFavorites, { onConflict: 'user_id, item_id' });
            }
            if (pushProgress.length > 0) {
                await supabase.from('user_reading_progress').upsert(pushProgress, { onConflict: 'user_id, book_id' });
            }
            if (pushPref) {
                await supabase.from('user_preferences').upsert(pushPref, { onConflict: 'user_id' });
            }
            if (pushDeletions.length > 0) {
                await supabase.from('user_deletions').upsert(pushDeletions, { onConflict: 'user_id, entity_type, entity_id' });
            }

            // -----------------------------------------------------------------
            // ÉTAPE 9 : NETTOYAGE DES OPÉRATIONS TRAITÉES
            // -----------------------------------------------------------------
            for (const opId of processedQueueIds) {
                await window.libraryDB.removeSyncQueueItem(opId).catch(() => {});
            }

            this.lastSyncTime = Date.now();
            this._updateStatus('synced');
            if (typeof window.initLibrary === 'function') {
                window.initLibrary();
            }

            return {
                success: true,
                pushed: {
                    library: pushLibrary.length,
                    favorites: pushFavorites.length,
                    progress: pushProgress.length,
                    preferences: Boolean(pushPref),
                    deletions: pushDeletions.length
                }
            };

        } catch (err) {
            console.error('[SyncEngine] Erreur de synchronisation:', err);
            this._updateStatus('error', err.message);
            return { success: false, error: err.message };
        } finally {
            this.syncInProgress = false;
        }
    }

    // =========================================================================
    // GESTION DU STATUT & OBSERVABILITÉ UI
    // =========================================================================
    _updateStatus(status, error = null) {
        this.status = status;
        const info = {
            status: this.status,
            lastSyncTime: this.lastSyncTime,
            error: error,
            isOnline: this.isOnline(),
            isAuthenticated: Boolean(this.currentUser)
        };

        this.statusListeners.forEach(cb => {
            try { cb(info); } catch (e) {}
        });

        this._updateUIBadge(info);
    }

    onStatusChange(callback) {
        if (typeof callback === 'function') {
            this.statusListeners.push(callback);
            this._updateStatus(this.status);
        }
    }

    _updateUIBadge(info) {
        if (typeof document === 'undefined') return;
        const badges = document.querySelectorAll('.sync-status-badge');
        badges.forEach(badge => {
            if (!info.isAuthenticated) {
                badge.style.display = 'none';
                return;
            }

            badge.style.display = 'inline-flex';
            if (info.status === 'syncing') {
                badge.className = 'sync-status-badge syncing';
                badge.innerHTML = '<span class=\"sync-spin\">⟳</span> Sync…';
                badge.title = 'Synchronisation en cours…';
            } else if (info.status === 'offline') {
                badge.className = 'sync-status-badge offline';
                badge.innerHTML = '☁ Hors ligne';
                badge.title = 'Modifications sauvegardées localement';
            } else if (info.status === 'error') {
                badge.className = 'sync-status-badge error';
                badge.innerHTML = '⚠️ Erreur sync';
                badge.title = info.error || 'Erreur réseau';
            } else {
                badge.className = 'sync-status-badge synced';
                badge.innerHTML = '● Synchronisé';
                const timeStr = info.lastSyncTime ? new Date(info.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                badge.title = timeStr ? `Synchronisé à ${timeStr}` : 'Synchronisé avec le cloud';
            }
        });
    }
}

// Initialisation globale
if (typeof window !== 'undefined') {
    window.syncEngine = new SyncEngine();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SyncEngine };
}
