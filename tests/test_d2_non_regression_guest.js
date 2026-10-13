const http = require('http');

const BASE = 'http://127.0.0.1:3000';

function fetchUrl(path) {
    return new Promise((resolve, reject) => {
        http.get(BASE + path, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, json, text: data });
                } catch(e) {
                    resolve({ status: res.statusCode, text: data });
                }
            });
        }).on('error', reject);
    });
}

async function runGuestNonRegressionTests() {
    console.log('================================================================');
    console.log('📖 NOVELTRAD — SUITE DE NON-RÉGRESSION GUEST FIRST & CATALOGUE');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    async function runTest(name, fn) {
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } catch (e) {
            console.error(`❌ [FAIL] ${name} — ${e.message}`);
            failed++;
        }
    }

    // 1. Accès Accueil sans session
    await runTest('Guest First: Page d\'accueil / accessible (HTTP 200)', async () => {
        const res = await fetchUrl('/');
        if (res.status !== 200 || !res.text.includes('NovelTrad')) {
            throw new Error(`Accueil inaccessible ou code ${res.status}`);
        }
    });

    // 2. Catalogue public accessible sans auth
    await runTest('Guest First: API Catalogue /api/catalog/explore accessible sans auth', async () => {
        const res = await fetchUrl('/api/catalog/explore');
        if (res.status !== 200 || !res.json || !res.json.series) {
            throw new Error(`Catalogue explore non fonctionnel: status ${res.status}`);
        }
    });

    await runTest('Guest First: API Catalogue /api/catalog/featured accessible sans auth', async () => {
        const res = await fetchUrl('/api/catalog/featured');
        if (res.status !== 200 || !res.json || !res.json.featured) {
            throw new Error(`Catalogue featured non fonctionnel: status ${res.status}`);
        }
    });

    // 3. Fiche série publique accessible sans auth
    await runTest('Guest First: API Série /api/catalog/series/:id accessible sans auth', async () => {
        const exploreRes = await fetchUrl('/api/catalog/explore');
        const seriesId = (exploreRes.json && exploreRes.json.series && exploreRes.json.series[0]) ? exploreRes.json.series[0].id : 'clockwork-planet-mtyejjp6';
        const res = await fetchUrl('/api/catalog/series/' + encodeURIComponent(seriesId));
        if (res.status !== 200 || !res.json || (!res.json.series || !res.json.series.id)) {
            throw new Error(`Détails série inaccessibles: status ${res.status}`);
        }
    });

    // 4. Page série HTML accessible
    await runTest('Guest First: Page série /series.html?id=eighty-six accessible', async () => {
        const res = await fetchUrl('/series.html?id=eighty-six');
        if (res.status !== 200) {
            throw new Error(`Page série inaccessible: status ${res.status}`);
        }
    });

    // 5. Lecteurs EPUB / PDF / Webnovel autonomes
    await runTest('Guest First: Lecteur EPUB /reader_epub.html accessible sans auth', async () => {
        const res = await fetchUrl('/reader_epub.html');
        if (res.status !== 200) throw new Error(`Lecteur EPUB inaccessible: ${res.status}`);
    });

    await runTest('Guest First: Lecteur PDF /reader_pdf.html accessible sans auth', async () => {
        const res = await fetchUrl('/reader_pdf.html');
        if (res.status !== 200) throw new Error(`Lecteur PDF inaccessible: ${res.status}`);
    });

    await runTest('Guest First: Lecteur Webnovel /reader_webnovel.html accessible sans auth', async () => {
        const res = await fetchUrl('/reader_webnovel.html');
        if (res.status !== 200) throw new Error(`Lecteur Webnovel inaccessible: ${res.status}`);
    });

    // 6. Manifest & Service Worker PWA
    await runTest('PWA: Manifest et Service Worker accessibles', async () => {
        const resManifest = await fetchUrl('/manifest.json');
        if (resManifest.status !== 200) throw new Error('manifest.json inaccessible');
        const resSw = await fetchUrl('/sw.js');
        if (resSw.status !== 200) throw new Error('sw.js inaccessible');
    });

    // 7. Supabase Public Config endpoint
    await runTest('Auth: Endpoint public /api/config/supabase fournit l\'URL sans secret_key', async () => {
        const res = await fetchUrl('/api/config/supabase');
        if (res.status !== 200 || !res.json || !res.json.supabaseUrl) {
            throw new Error('Endpoint config Supabase en échec');
        }
        if (res.text.includes('service_role') || res.text.includes('sb_secret_')) {
            throw new Error('SÉCURITÉ: Une clé de service secrète a été divulguée');
        }
    });

    console.log('\n================================================================');
    console.log(`📊 RÉSULTATS NON-RÉGRESSION GUEST FIRST: ${passed} PASS, ${failed} FAIL`);
    console.log('================================================================\n');

    return { passed, failed };
}

if (require.main === module) {
    runGuestNonRegressionTests().then(res => {
        if (res.failed > 0) process.exit(1);
        process.exit(0);
    }).catch(err => {
        console.error('Fatal non-regression test runner error:', err);
        process.exit(1);
    });
}

module.exports = { runGuestNonRegressionTests };
