const { createClient } = require('C:/Users/japhet/Downloads/novel_trad/node_modules/@supabase/supabase-js');
require('C:/Users/japhet/Downloads/novel_trad/node_modules/dotenv').config({ path: 'C:/Users/japhet/Downloads/novel_trad/.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hhdhbxxcrfpnhvqgfpjr.supabase.co';
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function runD2SecurityTestSuite() {
    console.log('================================================================');
    console.log('🛡️ NOVELTRAD — SUITE DE TESTS SÉCURITÉ & RLS D2 (SUPABASE)');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;
    const testResults = [];

    async function runTest(name, fn) {
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
            testResults.push({ name, status: 'PASS' });
        } catch (e) {
            console.error(`❌ [FAIL] ${name} — ${e.message}`);
            failed++;
            testResults.push({ name, status: 'FAIL', error: e.message });
        }
    }

    // 1. Initialiser le client Anonyme
    const anonClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

    // 2. Créer 2 utilisateurs de test isolés (User A et User B)
    const timestamp = Date.now();
    const emailA = `test_user_a_${timestamp}@noveltrad.test`;
    const emailB = `test_user_b_${timestamp}@noveltrad.test`;
    const password = 'Password123!SecureNovel';

    console.log(`👤 Création Utilisateur A: ${emailA}`);
    const { data: authDataA, error: errA } = await anonClient.auth.signUp({
        email: emailA,
        password: password
    });

    if (errA) {
        console.error('Erreur inscription User A:', errA.message);
    }

    console.log(`👤 Création Utilisateur B: ${emailB}`);
    const { data: authDataB, error: errB } = await anonClient.auth.signUp({
        email: emailB,
        password: password
    });

    if (errB) {
        console.error('Erreur inscription User B:', errB.message);
    }

    const userA = authDataA?.user;
    const sessionA = authDataA?.session;
    const userB = authDataB?.user;
    const sessionB = authDataB?.session;

    if (!sessionA || !sessionB) {
        console.log('⚠️ Sessions directes non créées. Tentative de login explicite...');
    }

    // Client authentifié pour User A
    const clientA = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false }
    });
    if (sessionA) {
        await clientA.auth.setSession({
            access_token: sessionA.access_token,
            refresh_token: sessionA.refresh_token
        });
    } else {
        const { data: loginA } = await clientA.auth.signInWithPassword({ email: emailA, password });
        if (loginA?.session) {
            await clientA.auth.setSession(loginA.session);
        }
    }

    // Client authentifié pour User B
    const clientB = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false }
    });
    if (sessionB) {
        await clientB.auth.setSession({
            access_token: sessionB.access_token,
            refresh_token: sessionB.refresh_token
        });
    } else {
        const { data: loginB } = await clientB.auth.signInWithPassword({ email: emailB, password });
        if (loginB?.session) {
            await clientB.auth.setSession(loginB.session);
        }
    }

    const userA_id = userA?.id || (await clientA.auth.getUser()).data.user?.id;
    const userB_id = userB?.id || (await clientB.auth.getUser()).data.user?.id;

    console.log(`\n🔑 User A ID: ${userA_id}`);
    console.log(`🔑 User B ID: ${userB_id}\n`);

    // =========================================================================
    // TESTS RLS & ISOLATION
    // =========================================================================

    // Test 1: User A peut insérer dans user_library
    await runTest('RLS User A: INSERT dans user_library', async () => {
        const { data, error } = await clientA.from('user_library').insert({
            user_id: userA_id,
            series_id: '86-eighty-six',
            title: '86 - Eighty Six',
            format: 'epub'
        }).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Aucune ligne insérée retournée');
    });

    // Test 2: User A peut lire sa propre bibliothèque
    await runTest('RLS User A: SELECT sa propre bibliothèque', async () => {
        const { data, error } = await clientA.from('user_library').select('*').eq('series_id', '86-eighty-six');
        if (error) throw error;
        if (!data || data.length === 0 || data[0].series_id !== '86-eighty-six') {
            throw new Error('Données non trouvées pour User A');
        }
    });

    // Test 3: User B NE PEUT PAS lire la bibliothèque de User A (RLS)
    await runTest('RLS Isolation: User B ne voit PAS la bibliothèque de User A', async () => {
        const { data, error } = await clientB.from('user_library').select('*').eq('user_id', userA_id);
        if (error) throw error;
        if (data && data.length > 0) {
            throw new Error(`FUITE DE SÉCURITÉ: User B a pu lire ${data.length} lignes de User A`);
        }
    });

    // Test 4: User Anonyme NE PEUT PAS lire la bibliothèque
    await runTest('RLS Isolation: Utilisateur Anonyme ne voit aucune donnée', async () => {
        const { data, error } = await anonClient.from('user_library').select('*');
        if (error && !error.message.includes('permission denied') && !error.message.includes('PGRST')) {
            throw error;
        }
        if (data && data.length > 0) {
            throw new Error(`FUITE DE SÉCURITÉ: Anonyme a pu lire ${data.length} lignes privées`);
        }
    });

    // Test 5: User A ne peut PAS insérer pour User B (Falsification user_id)
    await runTest('RLS Anti-Forgery: User A ne peut PAS insérer avec user_id = User B', async () => {
        const { data, error } = await clientA.from('user_library').insert({
            user_id: userB_id,
            series_id: 'forged-series',
            title: 'Forged Title'
        }).select();
        if (!error) {
            throw new Error('La tentative d\'insertion falsifiée a réussi (échec RLS WITH CHECK)');
        }
    });

    // Test 6: User B ne peut PAS modifier la ligne de User A
    await runTest('RLS Isolation: User B ne peut PAS modifier la bibliothèque de User A', async () => {
        const { data, error } = await clientB.from('user_library')
            .update({ title: 'Modified by Hacker B' })
            .eq('user_id', userA_id)
            .select();
        if (data && data.length > 0) {
            throw new Error('User B a pu modifier la bibliothèque de User A !');
        }
    });

    // Test 7: User B ne peut PAS supprimer la ligne de User A
    await runTest('RLS Isolation: User B ne peut PAS supprimer la bibliothèque de User A', async () => {
        const { data, error } = await clientB.from('user_library')
            .delete()
            .eq('user_id', userA_id)
            .select();
        if (data && data.length > 0) {
            throw new Error('User B a pu supprimer la ligne de User A !');
        }
    });

    // =========================================================================
    // TESTS DES CONTRAINTES & TABLES
    // =========================================================================

    // Test 8: Favoris (user_favorites)
    await runTest('user_favorites: INSERT & SELECT par User A', async () => {
        const { data, error } = await clientA.from('user_favorites').insert({
            user_id: userA_id,
            item_id: 'vol-11',
            title: '86 Volume 11',
            format: 'epub'
        }).select();
        if (error) throw error;
    });

    // Test 9: Favoris Contrainte UNIQUE (même user_id + même item_id deux fois)
    await runTest('user_favorites: Contrainte UNIQUE (doublon rejeté)', async () => {
        const { error } = await clientA.from('user_favorites').insert({
            user_id: userA_id,
            item_id: 'vol-11',
            title: '86 Volume 11 (Doublon)',
            format: 'epub'
        });
        if (!error) {
            throw new Error('Le doublon a été accepté (échec de la contrainte UNIQUE)');
        }
    });

    // Test 10: Progression de lecture (user_reading_progress) avec CHECK 0..100
    await runTest('user_reading_progress: CHECK constraint progress_pct >= 0 et <= 100', async () => {
        // Valide: 50%
        const { error: okErr } = await clientA.from('user_reading_progress').insert({
            user_id: userA_id,
            book_id: 'book-valid',
            title: 'Valid Book',
            progress_pct: 50,
            status: 'reading'
        });
        if (okErr) throw okErr;

        // Invalide: -5%
        const { error: negErr } = await clientA.from('user_reading_progress').insert({
            user_id: userA_id,
            book_id: 'book-invalid-neg',
            progress_pct: -5
        });
        if (!negErr) throw new Error('progress_pct = -5 n\'a pas été rejeté');

        // Invalide: 105%
        const { error: overErr } = await clientA.from('user_reading_progress').insert({
            user_id: userA_id,
            book_id: 'book-invalid-over',
            progress_pct: 105
        });
        if (!overErr) throw new Error('progress_pct = 105 n\'a pas été rejeté');
    });

    // Test 11: Préférences utilisateur (user_preferences)
    await runTest('user_preferences: INSERT / UPDATE par User A', async () => {
        const { error: insErr } = await clientA.from('user_preferences').insert({
            user_id: userA_id,
            theme: 'dark',
            font_size: '19px',
            line_height: '1.9'
        });
        if (insErr) throw insErr;

        const { data, error: selErr } = await clientA.from('user_preferences').select('*').eq('user_id', userA_id);
        if (selErr) throw selErr;
        if (!data || data.length === 0 || data[0].font_size !== '19px') {
            throw new Error('Préférences non enregistrées correctement');
        }
    });

    // Nettoyage des données de test
    console.log('\n🧹 Nettoyage des données de test...');
    await clientA.from('user_library').delete().eq('user_id', userA_id);
    await clientA.from('user_favorites').delete().eq('user_id', userA_id);
    await clientA.from('user_reading_progress').delete().eq('user_id', userA_id);
    await clientA.from('user_preferences').delete().eq('user_id', userA_id);

    console.log('\n================================================================');
    console.log(`📊 RÉSULTATS TESTS D2 SUPABASE RLS: ${passed} PASS, ${failed} FAIL`);
    console.log('================================================================\n');

    return { passed, failed, testResults };
}

if (require.main === module) {
    runD2SecurityTestSuite().then(res => {
        if (res.failed > 0) process.exit(1);
        process.exit(0);
    }).catch(err => {
        console.error('Fatal test runner error:', err);
        process.exit(1);
    });
}

module.exports = { runD2SecurityTestSuite };
