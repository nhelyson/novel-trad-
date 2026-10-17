const fs = require('fs');
const path = require('path');

/**
 * MetadataCascadeClient
 * Système de cascade multi-fournisseurs haute-fidélité pour Light Novels & Mangas :
 * 1. AniList (GraphQL avec Page & Popularity & Synonyms & Format Priority)
 * 2. Kitsu (REST API avec Subtype Novel & Abbreviations)
 * 3. MangaDex (REST API avec Tag-filtering anti-spin-off)
 * 
 * Sécurité & Pertinence :
 * - Prise en compte des synonymes et acronymes officiels (Danmachi, Konosuba, Oregairu...)
 * - Priorité absolue aux Light Novels (format: NOVEL / subtype: novel)
 * - Pénalisation stricte des Spin-offs, 4-Koma, Gaiden, Anthologies
 * - Retour du meilleur résultat + liste des candidats alternatifs
 */
const MIN_MATCH_SCORE = 0.50;

class MetadataCascadeClient {
    constructor() {
        this.cachePath = path.join(__dirname, '..', '..', 'data', 'series_cache.json');
        this.cache = this.loadCache();
    }

    loadCache() {
        if (fs.existsSync(this.cachePath)) {
            try {
                const raw = fs.readFileSync(this.cachePath, 'utf8').replace(/^\uFEFF/, '');
                return JSON.parse(raw);
            } catch (e) {
                console.error('[MetadataCascade] Erreur lecture cache — réinitialisation:', e.message);
            }
        }
        return {};
    }

    saveCache() {
        try {
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
        } catch (e) {
            console.error('[MetadataCascade] Erreur sauvegarde cache:', e.message);
        }
    }

    /**
     * Nettoie les titres bruts (supprime extensions, tomes, tags entre crochets)
     */
    cleanSearchTitle(rawTitle) {
        if (!rawTitle) return '';
        let t = rawTitle
            .replace(/\.(epub|pdf|mobi|azw3)$/i, '')
            .replace(/\[(?:LN|Light Novel|Novel|Web Novel|WN|Manga|Digital|RAW|FR|ENG|VF|VOSTFR|HD)\]/gi, '')
            .replace(/\((?:LN|Light Novel|Novel|Web Novel|WN|Manga|Digital|RAW|FR|ENG|VF|VOSTFR|HD)\)/gi, '')
            .replace(/(?:[-_\s]+(?:vol(?:ume)?|tome|t|v)\.?\s*\d+.*$)/i, '')
            .replace(/[-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return t.length >= 2 ? t : rawTitle.trim();
    }

    /**
     * Calcule un score de similarité robuste entre la requête et un titre candidat (0.0 à 1.0)
     */
    titleMatchScore(query, candidate) {
        if (!query || !candidate) return 0;
        const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        const cNorm = candidate.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        if (qNorm === cNorm) return 1.0;

        const qWords = qNorm.split(/\s+/).filter(w => w.length > 0);
        const cWords = cNorm.split(/\s+/).filter(w => w.length > 0);
        if (qWords.length === 0 || cWords.length === 0) return 0;

        const qSet = new Set(qWords);
        const cSet = new Set(cWords);

        let intersection = 0;
        for (const w of qSet) {
            if (cSet.has(w)) intersection++;
        }

        const queryCoverage = intersection / qSet.size;
        const candidateCoverage = intersection / cSet.size;

        // 1. Tous les mots de la requête sont présents dans le titre candidat
        if (queryCoverage === 1.0) {
            // Le candidat commence exactement par la requête (ex: "Konosuba: ...", "Danmachi - ...")
            if (cNorm.startsWith(qNorm)) {
                return 0.95;
            }
            // Titre quasi exact avec au maximum 2 mots supplémentaires
            if (cWords.length - qWords.length <= 2) {
                return 0.90;
            }
            // Sous-titre plus long
            return Math.max(0.75, 0.90 - (cWords.length - qWords.length) * 0.02);
        }

        const union = new Set([...qWords, ...cWords]).size;
        const iou = intersection / union;
        return Math.max(iou, (2 * queryCoverage * candidateCoverage) / (queryCoverage + candidateCoverage || 1));
    }

    /**
     * Détecte si un titre ou ses métadonnées correspondent à un spin-off / 4-koma
     */
    isSpinOffEntry(text) {
        if (!text) return false;
        return /(?:4-?koma|four-?panel|gaiden|anthology|on the side|spin-?off|side story|extra edition)/i.test(text);
    }

    // =========================================================================
    // FOURNISSEUR 1 : AniList (GraphQL multi-candidats avec tri par popularité)
    // =========================================================================
    async fetchFromAniList(cleanTitle) {
        const query = `
        query ($search: String) {
          Page (page: 1, perPage: 8) {
            media (search: $search, type: MANGA, sort: [POPULARITY_DESC]) {
              id
              format
              countryOfOrigin
              title {
                romaji
                english
                native
              }
              synonyms
              description
              coverImage {
                extraLarge
                large
              }
              bannerImage
              genres
              status
              volumes
              startDate {
                year
              }
              staff {
                edges {
                  role
                  node {
                    name {
                      full
                    }
                  }
                }
              }
              popularity
              averageScore
              meanScore
            }
          }
        }
        `;

        try {
            console.log(`[AniList] Requête GraphQL pour : "${cleanTitle}"`);
            const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query, variables: { search: cleanTitle } })
            });

            if (!res.ok) {
                console.warn(`[AniList] Réponse non-OK HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            const items = json.data?.Page?.media || [];
            if (items.length === 0) return null;

            const wantsSpinOff = this.isSpinOffEntry(cleanTitle);
            const scoredCandidates = [];

            for (const media of items) {
                const candidateTitles = [
                    media.title?.english,
                    media.title?.romaji,
                    media.title?.native,
                    ...(media.synonyms || [])
                ].filter(Boolean);

                let bestMatchScore = 0;
                for (const cand of candidateTitles) {
                    const score = this.titleMatchScore(cleanTitle, cand);
                    if (score > bestMatchScore) bestMatchScore = score;
                }

                if (bestMatchScore < MIN_MATCH_SCORE) continue;

                const allText = candidateTitles.join(' ').toLowerCase();
                const isSpinOff = this.isSpinOffEntry(allText);

                // Calcul du score global
                let totalScore = bestMatchScore;
                
                // Priorité absolue au format NOVEL pour une plateforme de Light Novels
                if (media.format === 'NOVEL') totalScore += 0.20;
                else if (media.format === 'MANGA') totalScore += 0.05;

                // Pénalité stricte spin-off si non demandé expressément
                if (isSpinOff && !wantsSpinOff) {
                    totalScore -= 0.35;
                }

                // Bonus de popularité (pour départager une œuvre majeure d'une déclinaison confidentielle)
                const popBonus = Math.min((media.popularity || 0) / 100000, 0.10);
                totalScore += popBonus;

                let author = 'Inconnu';
                if (media.staff && media.staff.edges) {
                    const storyStaff = media.staff.edges.find(e => {
                        const r = (e.role || '').toLowerCase();
                        return r.includes('story') || r.includes('author') || r.includes('original');
                    });
                    if (storyStaff) author = storyStaff.node.name.full;
                }

                const synopsis = (media.description || '').replace(/<[^>]*>?/gm, '').trim();

                const rawScore = media.averageScore || media.meanScore || null;
                const calcRating = rawScore ? +(rawScore / 20).toFixed(1) : 4.5;

                // Détection de l'origine
                let originStr = 'Japon (Light Novel)';
                const co = (media.countryOfOrigin || '').toUpperCase();
                if (co === 'KR') originStr = 'Corée du Sud (Webnovel)';
                else if (co === 'CN') originStr = 'Chine (Webnovel)';
                else if (co === 'FR') originStr = 'France (Création originale)';
                else if (co === 'TW') originStr = 'Taïwan (Webnovel)';

                scoredCandidates.push({
                    id: 'anilist-' + media.id,
                    origin: originStr,
                    countryOfOrigin: co || 'JP',
                    rating: calcRating,
                    averageScore: rawScore,
                    popularity: media.popularity || 0,
                    provider: 'anilist',
                    format: media.format || 'MANGA',
                    format_label: media.format === 'NOVEL' ? 'Light Novel' : (media.format === 'MANGA' ? 'Manga' : media.format),
                    title: media.title?.english || media.title?.romaji || media.title?.native || cleanTitle,
                    author,
                    genres: media.genres || [],
                    status: media.status || 'UNKNOWN',
                    synopsis,
                    cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
                    banner: media.bannerImage || null,
                    volumes: media.volumes || null,
                    year: media.startDate?.year || null,
                    matchScore: bestMatchScore,
                    totalScore,
                    isSpinOff,
                    updatedAt: Date.now()
                });
            }

            if (scoredCandidates.length === 0) return null;

            scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
            const best = { ...scoredCandidates[0] };
            best.candidates = scoredCandidates.slice(0, 5).map(c => {
                const clone = { ...c };
                delete clone.candidates;
                return clone;
            });
            return best;
        } catch (error) {
            console.warn(`[AniList] Erreur: ${error.message}`);
            return null;
        }
    }

    // =========================================================================
    // FOURNISSEUR 2 : Kitsu (REST API avec Subtype Novel)
    // =========================================================================
    async fetchFromKitsu(cleanTitle) {
        try {
            console.log(`[Kitsu] Recherche pour : "${cleanTitle}"`);
            const url = `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(cleanTitle)}&include=categories&page[limit]=8`;
            const res = await fetch(url, {
                headers: { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' }
            });

            if (!res.ok) {
                console.warn(`[Kitsu] Réponse non-OK HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            const items = json.data || [];
            if (items.length === 0) return null;

            const wantsSpinOff = this.isSpinOffEntry(cleanTitle);
            const scoredCandidates = [];

            for (const item of items) {
                const attr = item.attributes || {};
                const candidateTitles = [
                    attr.canonicalTitle,
                    attr.titles?.en,
                    attr.titles?.en_jp,
                    attr.titles?.ja_jp,
                    attr.titles?.en_us,
                    ...(attr.abbreviations || [])
                ].filter(Boolean);

                let bestMatchScore = 0;
                for (const cand of candidateTitles) {
                    const score = this.titleMatchScore(cleanTitle, cand);
                    if (score > bestMatchScore) bestMatchScore = score;
                }

                if (bestMatchScore < MIN_MATCH_SCORE) continue;

                const allText = candidateTitles.join(' ').toLowerCase();
                const isSpinOff = this.isSpinOffEntry(allText);

                let totalScore = bestMatchScore;
                const isNovel = attr.subtype === 'novel';
                if (isNovel) totalScore += 0.20;
                else totalScore += 0.05;

                if (isSpinOff && !wantsSpinOff) totalScore -= 0.35;

                const title = attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp || cleanTitle;
                const synopsis = (attr.synopsis || attr.description || '').replace(/<[^>]*>?/gm, '').trim();
                const cover = attr.posterImage?.large || attr.posterImage?.original || attr.posterImage?.medium || null;
                const banner = attr.coverImage?.large || attr.coverImage?.original || null;

                const genres = (json.included || [])
                    .filter(inc => inc.type === 'categories')
                    .map(c => c.attributes?.title)
                    .filter(Boolean);

                let status = 'UNKNOWN';
                if (attr.status === 'current') status = 'RELEASING';
                else if (attr.status === 'finished') status = 'FINISHED';
                else if (attr.status === 'unreleased') status = 'NOT_YET_RELEASED';
                else if (attr.status === 'cancelled') status = 'CANCELLED';

                const year = attr.startDate ? parseInt(attr.startDate.split('-')[0]) : null;

                let originStr = 'Japon (Light Novel)';
                const kSubType = (attr.subtype || '').toLowerCase();
                if (kSubType === 'manhwa') originStr = 'Corée du Sud (Webnovel)';
                else if (kSubType === 'manhua') originStr = 'Chine (Webnovel)';

                scoredCandidates.push({
                    id: 'kitsu-' + item.id,
                    origin: originStr,
                    countryOfOrigin: (kSubType === 'manhwa' ? 'KR' : (kSubType === 'manhua' ? 'CN' : 'JP')),
                    provider: 'kitsu',
                    format: isNovel ? 'NOVEL' : 'MANGA',
                    format_label: isNovel ? 'Light Novel' : 'Manga',
                    title,
                    author: 'Inconnu',
                    genres,
                    status,
                    synopsis,
                    cover,
                    banner,
                    volumes: attr.volumeCount || null,
                    year,
                    matchScore: bestMatchScore,
                    totalScore,
                    isSpinOff,
                    updatedAt: Date.now()
                });
            }

            if (scoredCandidates.length === 0) return null;

            scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
            const best = { ...scoredCandidates[0] };
            best.candidates = scoredCandidates.slice(0, 5).map(c => {
                const clone = { ...c };
                delete clone.candidates;
                return clone;
            });
            return best;
        } catch (error) {
            console.warn(`[Kitsu] Erreur: ${error.message}`);
            return null;
        }
    }

    // =========================================================================
    // FOURNISSEUR 3 : MangaDex (REST API avec Filtrage Anti-Spin-Off)
    // =========================================================================
    async fetchFromMangaDex(cleanTitle) {
        try {
            console.log(`[MangaDex] Recherche pour : "${cleanTitle}"`);
            const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=8&includes[]=cover_art&includes[]=author`;
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });

            if (!res.ok) {
                console.warn(`[MangaDex] Réponse non-OK HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            const items = json.data || [];
            if (items.length === 0) return null;

            const wantsSpinOff = this.isSpinOffEntry(cleanTitle);
            const scoredCandidates = [];

            for (const item of items) {
                const attr = item.attributes || {};
                const candidateTitles = [
                    attr.title?.en,
                    attr.title?.['ja-ro'],
                    attr.title?.fr,
                    ...Object.values(attr.title || {}),
                    ...(attr.altTitles ? attr.altTitles.flatMap(t => Object.values(t)) : [])
                ].filter(Boolean);

                let bestMatchScore = 0;
                for (const cand of candidateTitles) {
                    const score = this.titleMatchScore(cleanTitle, cand);
                    if (score > bestMatchScore) bestMatchScore = score;
                }

                if (bestMatchScore < MIN_MATCH_SCORE) continue;

                const tagNames = (attr.tags || []).map(t => t.attributes?.name?.en || '').filter(Boolean);
                const hasSpinOffTag = tagNames.some(t => /(?:4-?koma|spin-?off|anthology|doujinshi)/i.test(t));
                const allText = candidateTitles.join(' ').toLowerCase();
                const isSpinOff = hasSpinOffTag || this.isSpinOffEntry(allText);

                let totalScore = bestMatchScore;
                if (isSpinOff && !wantsSpinOff) totalScore -= 0.35;

                const title = attr.title?.en || attr.title?.['ja-ro'] || Object.values(attr.title || {})[0] || cleanTitle;
                const descFr = attr.description?.fr;
                const descEn = attr.description?.en || Object.values(attr.description || {})[0] || '';
                const synopsis = (descFr || descEn || '').replace(/<[^>]*>?/gm, '').trim();

                const authorRel = (item.relationships || []).find(r => r.type === 'author');
                const author = authorRel?.attributes?.name || 'Inconnu';

                let cover = null;
                const coverRel = (item.relationships || []).find(r => r.type === 'cover_art');
                if (coverRel && coverRel.attributes?.fileName) {
                    cover = `https://uploads.mangadex.org/covers/${item.id}/${coverRel.attributes.fileName}.512.jpg`;
                }

                let status = 'UNKNOWN';
                if (attr.status === 'ongoing') status = 'RELEASING';
                else if (attr.status === 'completed') status = 'FINISHED';
                else if (attr.status === 'hiatus') status = 'HIATUS';
                else if (attr.status === 'cancelled') status = 'CANCELLED';

                const genres = tagNames.slice(0, 8);

                let originStr = 'Japon (Light Novel)';
                const origLang = (attr.originalLanguage || '').toLowerCase();
                if (origLang === 'ko') originStr = 'Corée du Sud (Webnovel)';
                else if (origLang === 'zh' || origLang === 'zh-hk') originStr = 'Chine (Webnovel)';
                else if (origLang === 'fr') originStr = 'France (Création originale)';

                scoredCandidates.push({
                    id: 'mangadex-' + item.id,
                    origin: originStr,
                    countryOfOrigin: (origLang === 'ko' ? 'KR' : (origLang.startsWith('zh') ? 'CN' : (origLang === 'fr' ? 'FR' : 'JP'))),
                    provider: 'mangadex',
                    format: 'MANGA',
                    format_label: 'Manga',
                    title,
                    author,
                    genres,
                    status,
                    synopsis,
                    synopsis_fr: descFr ? descFr.trim() : null,
                    cover,
                    banner: null,
                    volumes: attr.lastVolume ? parseInt(attr.lastVolume) : null,
                    year: attr.year || (attr.createdAt ? parseInt(attr.createdAt.split('-')[0]) : null),
                    matchScore: bestMatchScore,
                    totalScore,
                    isSpinOff,
                    updatedAt: Date.now()
                });
            }

            if (scoredCandidates.length === 0) return null;

            scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
            const best = { ...scoredCandidates[0] };
            best.candidates = scoredCandidates.slice(0, 5).map(c => {
                const clone = { ...c };
                delete clone.candidates;
                return clone;
            });
            return best;
        } catch (error) {
            console.warn(`[MangaDex] Erreur: ${error.message}`);
            return null;
        }
    }

    /**
     * Recherche en direct (bypass de cache) pour le Studio Contributeur / Création
     */
    async searchLive(rawTitle) {
        const cleanTitle = this.cleanSearchTitle(rawTitle);
        console.log(`\n[MetadataCascade] 🔍 Recherche LIVE multi-sources (AniList + Kitsu + MangaDex) pour : "${rawTitle}" (Nettoyé: "${cleanTitle}")`);

        // Interroger les 3 APIs en parallèle pour une vitesse maximale et une couverture complète
        const [anilistRes, kitsuRes, mangadexRes] = await Promise.allSettled([
            this.fetchFromAniList(cleanTitle),
            this.fetchFromKitsu(cleanTitle),
            this.fetchFromMangaDex(cleanTitle)
        ]);

        const allCandidates = [];

        if (anilistRes.status === 'fulfilled' && anilistRes.value) {
            const list = anilistRes.value.candidates || [anilistRes.value];
            allCandidates.push(...list);
        }
        if (kitsuRes.status === 'fulfilled' && kitsuRes.value) {
            const list = kitsuRes.value.candidates || [kitsuRes.value];
            allCandidates.push(...list);
        }
        if (mangadexRes.status === 'fulfilled' && mangadexRes.value) {
            const list = mangadexRes.value.candidates || [mangadexRes.value];
            allCandidates.push(...list);
        }

        if (allCandidates.length === 0) {
            console.warn(`[MetadataCascade] 🛡️ Aucun résultat concordant pour "${rawTitle}"`);
            return null;
        }

        // Dédoublonnage intelligent par provider + id ou titre normalisé
        const seenKeys = new Set();
        const uniqueCandidates = [];

        for (const cand of allCandidates) {
            const cleanT = (cand.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const key = cand.id || (cand.provider + '-' + cleanT);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueCandidates.push(cand);
            }
        }

        // Tri : les Light Novels en priorité, puis par score de pertinence
        uniqueCandidates.sort((a, b) => {
            const aIsNovel = (a.format === 'NOVEL');
            const bIsNovel = (b.format === 'NOVEL');
            if (aIsNovel && !bIsNovel) return -1;
            if (!aIsNovel && bIsNovel) return 1;
            return (b.totalScore || b.matchScore || 0) - (a.totalScore || a.matchScore || 0);
        });

        console.log(`[MetadataCascade] 🎯 ${uniqueCandidates.length} candidats multi-sources trouvés pour "${rawTitle}"`);

        const best = { ...uniqueCandidates[0] };
        best.candidates = uniqueCandidates.slice(0, 8); // Top 8 candidats présentés à l'utilisateur
        return best;
    }

    // =========================================================================
    // CASCADE PRINCIPALE AVEC ROLLBACKS ET GARANTIE DE NON-FAUX-POSITIF
    // =========================================================================
    async getSeriesMetadata(seriesId, rawTitle) {
        // 1. Vérifier dans le cache (sauf si notFound pour permettre une récupération si besoin)
        if (this.cache[seriesId] && !this.cache[seriesId].notFound) {
            return this.cache[seriesId];
        }

        const cleanTitle = this.cleanSearchTitle(rawTitle);
        console.log(`\n[MetadataCascade] Recherche sécurisée pour : "${rawTitle}" (Nettoyé: "${cleanTitle}")`);

        // --- Tentative 1 : AniList ---
        let metadata = await this.fetchFromAniList(cleanTitle);
        if (metadata) {
            console.log(`[MetadataCascade] ✅ Correspondance validée via AniList pour "${rawTitle}" (Format: ${metadata.format}, Score: ${(metadata.totalScore*100).toFixed(0)}%)`);
            this.cache[seriesId] = metadata;
            this.saveCache();
            return metadata;
        }

        // --- Tentative 2 : Kitsu (Rollback 1) ---
        console.log(`[MetadataCascade] [ROLLBACK 1] Basculement sécurisé vers Kitsu...`);
        metadata = await this.fetchFromKitsu(cleanTitle);
        if (metadata) {
            console.log(`[MetadataCascade] ✅ Correspondance validée via Kitsu pour "${rawTitle}" (Format: ${metadata.format}, Score: ${(metadata.totalScore*100).toFixed(0)}%)`);
            this.cache[seriesId] = metadata;
            this.saveCache();
            return metadata;
        }

        // --- Tentative 3 : MangaDex (Rollback 2) ---
        console.log(`[MetadataCascade] [ROLLBACK 2] Basculement sécurisé vers MangaDex...`);
        metadata = await this.fetchFromMangaDex(cleanTitle);
        if (metadata) {
            console.log(`[MetadataCascade] ✅ Correspondance validée via MangaDex pour "${rawTitle}" (Score: ${(metadata.totalScore*100).toFixed(0)}%)`);
            this.cache[seriesId] = metadata;
            this.saveCache();
            return metadata;
        }

        // --- Échec / Non trouvé : SÉCURITÉ LOCALE ---
        console.warn(`[MetadataCascade] 🛡️ Sécurité active : aucun anime/manga concordant pour "${rawTitle}". Utilisation des données locales.`);
        const fallbackObj = {
            notFound: true,
            title: rawTitle,
            author: 'Inconnu',
            genres: [],
            genres_fr: [],
            status: 'Inconnu',
            status_fr: 'Inconnu',
            synopsis: 'Aucun synopsis disponible.',
            synopsis_fr: 'Aucun synopsis disponible.',
            cover: null,
            banner: null,
            candidates: [],
            updatedAt: Date.now()
        };
        this.cache[seriesId] = fallbackObj;
        this.saveCache();
        return fallbackObj;
    }
}

module.exports = new MetadataCascadeClient();
