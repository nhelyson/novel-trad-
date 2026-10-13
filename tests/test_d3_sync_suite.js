const { SyncEngine } = require('../public/js/sync_engine');
const { MockSupabaseClient } = require('./mock_supabase_client');

// Mock in-memory IndexedDB stores
class MockLibraryDB {
    constructor() {
        this.stores = {
            local_library: new Map(),
            favorites: new Map(),
            reading_history: new Map(),
            books: new Map(),
            preferences: new Map(),
            sync_queue: new Map()
        };
    }

    async getAllLocalLibrary() {
        return Array.from(this.stores.local_library.values());
    }

    async addToLocalLibrary(item) {
        this.stores.local_library.set(item.id || item.seriesId, item);
        return item;
    }

    async removeFromLocalLibrary(id) {
        return this.stores.local_library.delete(id);
    }

    async getFavorites() {
        return Array.from(this.stores.favorites.values());
    }

    async getAllHistory() {
        return Array.from(this.stores.reading_history.values());
    }

    async getPreferences() {
        const p = this.stores.preferences.get('reader_settings');
        return p ? p.value : null;
    }

    async savePreferences(prefs) {
        this.stores.preferences.set('reader_settings', { key: 'reader_settings', value: prefs, updatedAt: Date.now() });
    }

    async getSyncQueue(userId) {
        const list = Array.from(this.stores.sync_queue.values());
        if (userId) return list.filter(op => op.userId === userId);
        return list;
    }

    async addToSyncQueue(item) {
        this.stores.sync_queue.set(item.id, item);
        return item;
    }

    async removeSyncQueueItem(id) {
        return this.stores.sync_queue.delete(id);
    }

    async _put(storeName, item) {
        const key = item.id || item.bookId || item.key;
        this.stores[storeName].set(key, item);
        return item;
    }

    async _delete(storeName, key) {
        return this.stores[storeName].delete(key);
    }
}

async function runD3SyncTestSuite() {
    console.log('================================================================');
    console.log('🔄 NOVELTRAD — SUITE DE TESTS COMPLÈTE SYNC ENGINE D3');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } catch (e) {
            console.error(`❌ [FAIL] ${name} — ${e.message}`);
            failed++;
        }
    }

    const userA = { id: 'user_a_uuid_123', email: 'user_a@test.com' };
    const userB = { id: 'user_b_uuid_456', email: 'user_b@test.com' };

    // -------------------------------------------------------------------------
    // Test 1: Guest First — Zéro appel sans session
    // -------------------------------------------------------------------------
    await test('Guest First: syncAll() s\'arrête silencieusement en mode Invité', async () => {
        const mockDB = new MockLibraryDB();
        global.window = { libraryDB: mockDB, supabaseAuth: { client: null, isAuthenticated: () => false } };
        global.navigator = { onLine: true };
        global.document = { querySelectorAll: () => [] };

        const engine = new SyncEngine();
        const res = await engine.syncAll();
        if (!res.success || res.skipped !== 'guest_mode') {
            throw new Error(`Comportement guest inattendu: ${JSON.stringify(res)}`);
        }
    });

    // -------------------------------------------------------------------------
    // Test 2: Library MERGE (Union Local + Cloud)
    // -------------------------------------------------------------------------
    await test('Library: MERGE (Local A + Cloud B ➔ Union A+B sans doublon)', async () => {
        const mockDB = new MockLibraryDB();
        await mockDB.addToLocalLibrary({ id: 'solo-leveling', seriesId: 'solo-leveling', title: 'Solo Leveling', addedAt: 1000 });

        const mockSupabase = new MockSupabaseClient(userA.id);
        await mockSupabase.from('user_library').insert({
            user_id: userA.id,
            series_id: 'eighty-six',
            title: '86 - Eighty Six',
            format: 'epub',
            added_at: new Date(2000).toISOString()
        });

        global.window = {
            libraryDB: mockDB,
            supabaseAuth: { client: mockSupabase, isAuthenticated: () => true, getSession: () => ({ user: userA }) }
        };
        const engine = new SyncEngine();
        engine.currentUser = userA;
        engine.currentSession = { user: userA };

        const res = await engine.syncAll();
        if (!res.success) throw new Error(res.error);

        // Vérifier Local
        const finalLocal = await mockDB.getAllLocalLibrary();
        const localIds = finalLocal.map(i => i.id || i.seriesId);
        if (!localIds.includes('solo-leveling') || !localIds.includes('eighty-six')) {
            throw new Error(`Union locale incomplète: ${localIds.join(', ')}`);
        }

        // Vérifier Cloud
        const cloudData = mockSupabase.from('user_library').rows.filter(r => r.user_id === userA.id);
        const cloudIds = cloudData.map(i => i.series_id);
        if (!cloudIds.includes('solo-leveling') || !cloudIds.includes('eighty-six')) {
            throw new Error(`Union cloud incomplète: ${cloudIds.join(', ')}`);
        }
    });

    // -------------------------------------------------------------------------
    // Test 3: Favorites MERGE (Union Local + Cloud)
    // -------------------------------------------------------------------------
    await test('Favorites: MERGE (Local Fav 1 + Cloud Fav 2 ➔ Union 1+2)', async () => {
        const mockDB = new MockLibraryDB();
        await mockDB._put('favorites', { id: 'fav-1', title: 'Favori 1', format: 'epub', addedAt: 1000 });

        const mockSupabase = new MockSupabaseClient(userA.id);
        await mockSupabase.from('user_favorites').insert({
            user_id: userA.id,
            item_id: 'fav-2',
            title: 'Favori 2',
            format: 'epub',
            added_at: new Date(2000).toISOString()
        });

        global.window = {
            libraryDB: mockDB,
            supabaseAuth: { client: mockSupabase, isAuthenticated: () => true, getSession: () => ({ user: userA }) }
        };
        const engine = new SyncEngine();
        engine.currentUser = userA;

        const res = await engine.syncAll();
        if (!res.success) throw new Error(res.error);

        const localFavs = (await mockDB.getFavorites()).map(f => f.id);
        if (!localFavs.includes('fav-1') || !localFavs.includes('fav-2')) {
            throw new Error(`Union favoris locale échouée: ${localFavs}`);
        }
    });

    // -------------------------------------------------------------------------
    // Test 4: Progress LWW (Comparaison temporelle stricte)
    // -------------------------------------------------------------------------
    await test('Progress: LWW (Cloud plus récent gagne indépendamment du %)', async () => {
        const mockDB = new MockLibraryDB();
        const now = Date.now();

        // Local a page 80 à 10:00 (ancien)
        await mockDB._put('reading_history', {
            bookId: 'book-conflit',
            id: 'book-conflit',
            progressPct: 80,
            lastReadAt: now - 10000
        });

        const mockSupabase = new MockSupabaseClient(userA.id);
        // Cloud a page 40 à 10:05 (plus récent)
        await mockSupabase.from('user_reading_progress').insert({
            user_id: userA.id,
            book_id: 'book-conflit',
            progress_pct: 40,
            last_read_at: new Date(now - 1000).toISOString()
        });

        global.window = {
            libraryDB: mockDB,
            supabaseAuth: { client: mockSupabase, isAuthenticated: () => true, getSession: () => ({ user: userA }) }
        };
        const engine = new SyncEngine();
        engine.currentUser = userA;

        await engine.syncAll();

        const localItems = await mockDB.getAllHistory();
        const resBook = localItems.find(i => i.bookId === 'book-conflit');
        if (!resBook || resBook.progressPct !== 40) {
            throw new Error(`LWW Échec: Attendu progressPct = 40, obtenu ${resBook?.progressPct}`);
        }
    });

    // -------------------------------------------------------------------------
    // Test 5: Distributed Deletions (user_deletions & Tombstones)
    // -------------------------------------------------------------------------
    await test('Deletions: Propagation distribuée sans résurrection', async () => {
        const mockDB_DeviceB = new MockLibraryDB();
        // Device B possède encore l'élément 'solo-leveling' ajouté à t = 1000
        await mockDB_DeviceB.addToLocalLibrary({ id: 'solo-leveling', seriesId: 'solo-leveling', addedAt: 1000 });

        const mockSupabase = new MockSupabaseClient(userA.id);
        // Device A l'a supprimé à t = 2000 (enregistré dans user_deletions)
        await mockSupabase.from('user_deletions').insert({
            user_id: userA.id,
            entity_type: 'library',
            entity_id: 'solo-leveling',
            deleted_at: new Date(2000).toISOString()
        });

        // Device B synchronise
        global.window = {
            libraryDB: mockDB_DeviceB,
            supabaseAuth: { client: mockSupabase, isAuthenticated: () => true, getSession: () => ({ user: userA }) }
        };
        const engineB = new SyncEngine();
        engineB.currentUser = userA;

        await engineB.syncAll();

        // Vérifier que Device B a supprimé l'élément localement et ne l'a pas ré-inséré dans Supabase
        const bItems = await mockDB_DeviceB.getAllLocalLibrary();
        if (bItems.some(i => i.id === 'solo-leveling')) {
            throw new Error('RÉSURRECTION DÉTECTÉE: Device B n\'a pas appliqué la suppression');
        }

        const cloudCheck = mockSupabase.from('user_library').rows.filter(r => r.user_id === userA.id && r.series_id === 'solo-leveling');
        if (cloudCheck.length > 0) {
            throw new Error('RÉSURRECTION CLOUD DÉTECTÉE: Device B a ré-injecté l\'élément dans Supabase');
        }
    });

    // -------------------------------------------------------------------------
    // Test 6: Multi-account Queue Partitioning
    // -------------------------------------------------------------------------
    await test('Multi-account: Partitionnement strict de sync_queue sans fuite ni purge accidentelle', async () => {
        const mockDB = new MockLibraryDB();
        // User A a une opération en attente
        await mockDB.addToSyncQueue({
            id: 'op_a_1',
            userId: userA.id,
            entityType: 'favorite',
            entityId: 'secret_a_fav',
            operation: 'upsert'
        });

        const mockSupabaseB = new MockSupabaseClient(userB.id);

        // User B se connecte
        global.window = {
            libraryDB: mockDB,
            supabaseAuth: { client: mockSupabaseB, isAuthenticated: () => true, getSession: () => ({ user: userB }) }
        };
        const engineB = new SyncEngine();
        engineB.currentUser = userB;

        await engineB.syncAll();

        // 1. L'opération de A n'a PAS été envoyée au cloud de B
        const cloudBData = mockSupabaseB.from('user_favorites').rows.filter(r => r.user_id === userB.id && r.item_id === 'secret_a_fav');
        if (cloudBData.length > 0) {
            throw new Error('FUITE INTER-UTILISATEUR: L\'opération de A a été exécutée sous le compte B !');
        }

        // 2. L'opération de A est TOUJOURS dans la queue locale pour User A
        const remainingQueueA = await mockDB.getSyncQueue(userA.id);
        if (remainingQueueA.length === 0 || remainingQueueA[0].id !== 'op_a_1') {
            throw new Error('PERTE DE DONNÉES: La file d\'attente de User A a été purgée à tort !');
        }
    });

    // -------------------------------------------------------------------------
    // Test 7: Preferences LWW
    // -------------------------------------------------------------------------
    await test('Preferences: LWW (Cloud plus récent ➔ écriture locale)', async () => {
        const mockDB = new MockLibraryDB();
        const now = Date.now();

        // Local a 18px à 10:00
        await mockDB.savePreferences({ theme: 'dark', fontSize: '18px', fontFamily: 'Inter', lineHeight: '1.8' });

        const mockSupabase = new MockSupabaseClient(userA.id);
        // Cloud a 22px à 10:05
        await mockSupabase.from('user_preferences').insert({
            user_id: userA.id,
            theme: 'dark',
            font_size: '22px',
            font_family: 'Inter',
            line_height: '1.8',
            updated_at: new Date(now + 5000).toISOString()
        });

        global.window = {
            libraryDB: mockDB,
            supabaseAuth: { client: mockSupabase, isAuthenticated: () => true, getSession: () => ({ user: userA }) }
        };
        const engine = new SyncEngine();
        engine.currentUser = userA;

        await engine.syncAll();

        const updatedLocal = await mockDB.getPreferences();
        if (!updatedLocal || updatedLocal.fontSize !== '22px') {
            throw new Error(`Préférences LWW Échec: Attendu fontSize = '22px', obtenu ${updatedLocal?.fontSize}`);
        }
    });

    console.log('\n================================================================');
    console.log(`📊 RÉSULTATS SUITE DE TESTS D3 SYNC ENGINE: ${passed} PASS, ${failed} FAIL`);
    console.log('================================================================\n');

    return { passed, failed };
}

if (require.main === module) {
    runD3SyncTestSuite().then(res => {
        if (res.failed > 0) process.exit(1);
        process.exit(0);
    }).catch(err => {
        console.error('Fatal test runner error:', err);
        process.exit(1);
    });
}

module.exports = { runD3SyncTestSuite };
