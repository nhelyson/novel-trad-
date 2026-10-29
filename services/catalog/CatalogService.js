
// --- SMART FUZZY & TOKENIZED SEARCH HELPERS ---
function levenshteinDist(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function normalizeSearchText(str) {
    return (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function extractSearchTokens(str) {
    return normalizeSearchText(str)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function compactSearchText(str) {
    return normalizeSearchText(str).replace(/[^\p{L}\p{N}]+/gu, '');
}

function isTokenMatch(token, wordList) {
    if (wordList.includes(token)) return true;
    for (const w of wordList) {
        if (w.includes(token)) return true;
        if (token.length >= 4 && w.length >= 4) {
            const maxDiff = token.length >= 7 ? 2 : 1;
            if (levenshteinDist(token, w) <= maxDiff) return true;
        }
    }
    return false;
}

const fs = require('fs');
const path = require('path');

// Helper parsing timestamp unifié (number ou string ISO/date)
const parseTime = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
};

// Helper date réelle de parution (dernier volume ou publication de l'oeuvre)
const getReleaseTime = (s) => {
    let t = Math.max(
        parseTime(s.approved_at),
        parseTime(s.updated_at),
        parseTime(s.created_at),
        parseTime(s.releaseDate)
    );
    if (Array.isArray(s.volumes) && s.volumes.length > 0) {
        for (const v of s.volumes) {
            const vt = Math.max(
                parseTime(v.uploaded_at),
                parseTime(v.created_at),
                parseTime(v.release_date)
            );
            if (vt > t) t = vt;
        }
    }
    return t;
};

class CatalogService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', '..', 'data', 'catalog_db.json');
        this.data = null;
        this.lastMtime = 0;
        this.loadData();
    }

    loadData(forceReload = false) {
        try {
            if (fs.existsSync(this.dbPath)) {
                const stat = fs.statSync(this.dbPath);
                if (!forceReload && this.data && this.lastMtime === stat.mtimeMs) {
                    return this.data;
                }
                const raw = fs.readFileSync(this.dbPath, 'utf8').replace(/^\uFEFF/, '');
                this.data = JSON.parse(raw);
                if (!this.data || !Array.isArray(this.data.series)) {
                    this.data = { series: [], updatedAt: Date.now() };
                }
                this.lastMtime = stat.mtimeMs;
                return this.data;
            }
        } catch (e) {
            console.error('[CatalogService] Erreur lecture catalog_db.json:', e.message);
        }
        if (!this.data) {
            this.data = { series: [], updatedAt: Date.now() };
        }
        return this.data;
    }

    saveData(customData = null) {
        try {
            if (customData) {
                this.data = customData;
            }
            if (!this.data) {
                this.data = { series: [] };
            }
            this.data.updatedAt = Date.now();
            fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
            try {
                const stat = fs.statSync(this.dbPath);
                this.lastMtime = stat.mtimeMs;
            } catch (_) {}
        } catch (e) {
            console.error('[CatalogService] Erreur sauvegarde catalog_db.json:', e.message);
        }
    }

    getFeatured() {
        this.data = this.loadData();
        const published = (this.data.series || []).filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED' && s.is_mature !== true);

        // Helper date dernière activité (volume récent ou modif)
        const getActivityTime = (s) => {
            let t = s.updated_at || s.approved_at || s.created_at || 0;
            if (Array.isArray(s.volumes) && s.volumes.length > 0) {
                for (const v of s.volumes) {
                    const vt = v.uploaded_at || v.created_at || (v.release_date ? new Date(v.release_date).getTime() : 0) || 0;
                    if (vt > t) t = vt;
                }
            }
            return t;
        };

        const hasValidCover = (s) => {
            if (!s.cover || typeof s.cover !== 'string') return false;
            const c = s.cover.trim();
            return c.length > 5 && !c.includes('placeholder') && !c.includes('placehold.co');
        };

        // 1. Priorité aux romans "À la une" (featured === true) choisis par l'admin
        const manualFeatured = published
            .filter(s => s.featured === true)
            .sort((a, b) => ((b.featured_at || getActivityTime(b)) - (a.featured_at || getActivityTime(a))));

        const result = [...manualFeatured.slice(0, 5)];

        // 2. Remplissage automatique par les nouveautés / dernières sorties (avec couverture valide)
        if (result.length < 5) {
            const recentNovels = published
                .filter(s => !result.some(r => r.id === s.id))
                .filter(s => hasValidCover(s))
                .sort((a, b) => getActivityTime(b) - getActivityTime(a));

            for (const s of recentNovels) {
                if (result.length >= 5) break;
                result.push(s);
            }
        }

        // 3. Fallback de sécurité au cas où il y a moins de 5 couvertures valides
        if (result.length < 5) {
            for (const s of published) {
                if (result.length >= 5) break;
                if (!result.some(r => r.id === s.id)) {
                    result.push(s);
                }
            }
        }

        return result.slice(0, 5);
    }

    toggleOriginal(id) {
        this.data = this.loadData();
        const series = (this.data.series || []).find(s => s.id === id || s.id.toLowerCase() === (id || '').toLowerCase());
        if (!series) return null;
        series.is_original = !series.is_original;
        this.saveData();
        return { id: series.id, is_original: series.is_original, title: series.title };
    }

    toggleFeatured(id) {
        this.data = this.loadData();
        const series = (this.data.series || []).find(s => s.id === id || s.id.toLowerCase() === (id || '').toLowerCase());
        if (!series) return null;
        series.featured = !series.featured;
        if (series.featured) {
            series.featured_at = Date.now();
        } else {
            delete series.featured_at;
        }
        // Ne pas altérer updated_at pour préserver l'ordre naturel des Dernières Sorties
        this.saveData();
        return { id: series.id, featured: series.featured, title: series.title };
    }

        toggleMature(id) {
        this.data = this.loadData();
        const series = (this.data.series || []).find(s => s.id === id || s.id.toLowerCase() === (id || '').toLowerCase());
        if (!series) return null;
        series.is_mature = !series.is_mature;
        if (series.is_mature) {
            series.mature_flagged_at = Date.now();
        } else {
            delete series.mature_flagged_at;
        }
        this.saveData();
        return { id: series.id, is_mature: series.is_mature, title: series.title };
    }

    getMatureCatalog({ sort = 'ranking', page = 1, limit = 20, period = 'week', q = '' } = {}) {
        this.data = this.loadData();
        let list = (this.data.series || []).filter(s => 
            (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED' && 
            s.is_mature === true
        );

        const normStr = str => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

        if (q && q.trim().length > 0) {
            const queryNorm = normStr(q);
            list = list.filter(s => 
                normStr(s.title).includes(queryNorm) || 
                normStr(s.author).includes(queryNorm) ||
                (s.genres || []).some(g => normStr(g).includes(queryNorm))
            );
        }

        // Leaderboard ranking logic: note, vues et likes
        list.sort((a, b) => {
            const ratingA = typeof a.rating === 'number' ? a.rating : parseFloat(a.rating) || 4.5;
            const ratingB = typeof b.rating === 'number' ? b.rating : parseFloat(b.rating) || 4.5;
            const viewsA = a.views || 0;
            const viewsB = b.views || 0;
            const likesA = a.likes || 0;
            const likesB = b.likes || 0;

            const scoreB = (ratingB * 100) + Math.log10(Math.max(10, viewsB)) * 50 + (likesB * 5);
            const scoreA = (ratingA * 100) + Math.log10(Math.max(10, viewsA)) * 50 + (likesA * 5);

            if (scoreB !== scoreA) return scoreB - scoreA;
            return viewsB - viewsA;
        });

        const rankedList = list.map((item, index) => ({
            ...item,
            rank: index + 1
        }));

        const latest = [...list].sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0)).slice(0, 10);
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const startIndex = (pageNum - 1) * limitNum;

        return {
            rankings: rankedList.slice(startIndex, startIndex + limitNum),
            podium: rankedList.slice(0, 3),
            latest,
            total: rankedList.length,
            page: pageNum,
            totalPages: Math.ceil(rankedList.length / limitNum) || 1
        };
    }

    getExplore({ q = '', genre = '', status = '', format = '', origin = '', sort = 'popular', page = 1, limit = 24, mature = 'false' } = {}) {
        this.data = this.loadData();
        // Sécurité stricte : seuls les romans validés et publiés sont visibles au public
        let list = (this.data.series || []).filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED');
        if (mature === 'true') { list = list.filter(s => s.is_mature === true); } else if (mature !== 'all') { list = list.filter(s => s.is_mature !== true); }

        // Helper normalisation sans accents
        const normStr = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

                // 1. Live Search (Smart Multi-Word Tokenized, Punctuation-Agnostic & Fuzzy Typo Tolerance)
        if (q && q.trim().length > 0) {
            const rawQ = q.trim();
            const qTokens = extractSearchTokens(rawQ);
            const qCompact = compactSearchText(rawQ);

            if (qTokens.length > 0) {
                const scoredList = [];

                for (const s of list) {
                    const titleNorm = normalizeSearchText(s.title);
                    const titleTokens = extractSearchTokens(s.title);
                    const titleCompact = compactSearchText(s.title);

                    const altStr = `${s.originalTitle || ''} ${s.title_romaji || ''} ${s.romaji || ''} ${s.metadata?.title_romaji || ''}`;
                    const altNorm = normalizeSearchText(altStr);
                    const altTokens = extractSearchTokens(altStr);
                    const altCompact = compactSearchText(altStr);

                    const authorNorm = normalizeSearchText(s.author || '');
                    const authorTokens = extractSearchTokens(authorNorm);

                    const transNorm = normalizeSearchText(s.translator || '');
                    const genresTokens = extractSearchTokens((s.genres || []).concat(s.genres_fr || []).join(' '));
                    const tagsTokens = extractSearchTokens((s.tags || []).join(' '));
                    const synopsisNorm = normalizeSearchText(`${s.synopsis || ''} ${s.synopsis_fr || ''}`);

                    const allCorpus = `${titleNorm} ${altNorm} ${authorNorm} ${transNorm} ${genresTokens.join(' ')} ${tagsTokens.join(' ')}`;
                    const allCompact = `${titleCompact}${altCompact}${compactSearchText(authorNorm)}`;
                    const allWords = [...new Set([...titleTokens, ...altTokens, ...authorTokens, ...genresTokens, ...tagsTokens])];

                    let isMatch = false;
                    let relevance = 0;

                    // A. Exact or Prefix Compact Match (ex: "re zero" matches "Re:Zero", "danmachi" matches "DanMachi...")
                    if (titleCompact === qCompact) {
                        isMatch = true;
                        relevance += 1000;
                    } else if (titleCompact.startsWith(qCompact)) {
                        isMatch = true;
                        relevance += 500;
                    } else if (titleCompact.includes(qCompact)) {
                        isMatch = true;
                        relevance += 300;
                    } else if (allCompact.includes(qCompact)) {
                        isMatch = true;
                        relevance += 150;
                    }

                    // B. Multi-word Token Matching (ex: "mushoku jobless" matches "Mushoku Tensei: Jobless...")
                    const allTokensFound = qTokens.every(tok => 
                        allCorpus.includes(tok) || allCompact.includes(tok) || isTokenMatch(tok, allWords)
                    );

                    if (allTokensFound) {
                        isMatch = true;
                        const allTokensInTitle = qTokens.every(tok => 
                            titleNorm.includes(tok) || titleCompact.includes(tok) || isTokenMatch(tok, titleTokens)
                        );
                        if (allTokensInTitle) {
                            relevance += 250;
                        } else {
                            relevance += 100;
                        }
                    }

                    // C. Fallback: single specific word in synopsis
                    if (!isMatch && qTokens.length === 1 && qTokens[0].length >= 4 && synopsisNorm.includes(qTokens[0])) {
                        isMatch = true;
                        relevance += 30;
                    }

                    if (isMatch) {
                        scoredList.push({ series: s, relevance });
                    }
                }

                // Trier par pertinence si recherche active (puis par vues)
                scoredList.sort((a, b) => b.relevance - a.relevance || (b.series.views || 0) - (a.series.views || 0));
                list = scoredList.map(item => item.series);
            }
        }

        // 2. Filter by Genre
        if (genre && genre !== 'all' && genre !== '') {
            const genreNorm = normStr(genre);
            list = list.filter(s => {
                return (s.genres || []).some(g => normStr(g) === genreNorm || normStr(g).includes(genreNorm)) ||
                       (s.genres_fr || []).some(g => normStr(g) === genreNorm || normStr(g).includes(genreNorm));
            });
        }

        // 3. Filter by Status (RELEASING, FINISHED, COMPLETED, CANCELLED / En cours, Terminé)
        if (status && status !== 'all' && status !== '') {
            const statusNorm = normStr(status);
            list = list.filter(s => {
                const s1 = normStr(s.status);
                const s2 = normStr(s.status_fr);
                if (statusNorm === 'releasing' || statusNorm === 'ongoing' || statusNorm.includes('cours')) {
                    return s1 === 'releasing' || s1 === 'ongoing' || s2.includes('cours');
                }
                if (statusNorm === 'finished' || statusNorm === 'completed' || statusNorm.includes('termin')) {
                    return s1 === 'finished' || s1 === 'completed' || s2.includes('termin');
                }
                if (statusNorm === 'cancelled' || statusNorm.includes('abandon') || statusNorm.includes('annul')) {
                    return s1 === 'cancelled' || s2.includes('abandon') || s2.includes('annul');
                }
                return s1.includes(statusNorm) || s2.includes(statusNorm);
            });
        }

        // 4. Filter by Format (epub, pdf, webnovel)
        if (format && format !== 'all' && format !== '') {
            const formatNorm = format.toLowerCase().trim();
            list = list.filter(s => {
                if (formatNorm === 'webnovel') {
                    return (s.type || '').toLowerCase() === 'webnovel' ||
                           (s.formats || []).some(f => (f || '').toLowerCase() === 'webnovel');
                }
                const hasFormat = (s.formats || []).some(f => (f || '').toLowerCase() === formatNorm);
                const hasVolExt = Array.isArray(s.volumes) && s.volumes.some(v => 
                    (v.file || v.path || v.download_url || '').toLowerCase().endsWith('.' + formatNorm)
                );
                return hasFormat || hasVolExt;
            });
        }

        // 4.5 Filter by Origin (JP, KR, CN, Japon, Corée, Chine)
        if (origin && origin !== 'all' && origin !== '') {
            const oUpper = origin.toUpperCase().trim();
            const isOriginal = oUpper === 'ORIGINAL' || oUpper.includes('ORIGIN');
            const isJP = oUpper === 'JP' || oUpper.includes('JAPON') || oUpper.includes('JAPAN');
            const isKR = oUpper === 'KR' || oUpper.includes('CORÉE') || oUpper.includes('COREE') || oUpper.includes('KOREA');
            const isCN = oUpper === 'CN' || oUpper.includes('CHINE') || oUpper.includes('CHINA');

            list = list.filter(s => {
                if (isOriginal) return s.is_original === true || (s.origin || '').toUpperCase().includes('ORIGINAL');
                const sOrig = (s.origin || '').toUpperCase();
                if (isJP) return sOrig.includes('JAPON') || sOrig.includes('JP') || sOrig.includes('JAPAN');
                if (isKR) return sOrig.includes('CORÉE') || sOrig.includes('COREE') || sOrig.includes('KOREA') || sOrig.includes('KR');
                if (isCN) return sOrig.includes('CHINE') || sOrig.includes('CHINA') || sOrig.includes('CN');
                return sOrig.includes(oUpper);
            });
        }

        // 5. Sort Order (popular, rating, latest, az / title, za)
        if (sort === 'popular') {
            list.sort((a, b) => {
                // 1. Critère primaire : Vues réelles (la série avec le plus de lectures passe en tête)
                const vA = a.views || 0;
                const vB = b.views || 0;
                if (vB !== vA) return vB - vA;

                // 2. Critère secondaire : Note / Appréciation (en cas d'égalité de vues)
                const rA = parseFloat(a.rating) || 4.0;
                const rB = parseFloat(b.rating) || 4.0;
                if (rB !== rA) return rB - rA;

                // 3. Critère tertiaire : Nombre de volumes disponibles
                const volA = (a.volumes || []).length;
                const volB = (b.volumes || []).length;
                if (volB !== volA) return volB - volA;

                // 4. Dernier recours : Ordre alphabétique stable
                return (a.title || '').localeCompare(b.title || '');
            });
        } else if (sort === 'rating') {
            list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        } else if (sort === 'latest') {
            list.sort((a, b) => getReleaseTime(b) - getReleaseTime(a));
        } else if (sort === 'az' || sort === 'title') {
            list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        } else if (sort === 'za') {
            list.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        }

        // 6. Pagination & Data Projection (optimisation payload réseau)
        const total = list.length;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 24);
        const startIndex = (pageNum - 1) * limitNum;
        const rawPaginated = list.slice(startIndex, startIndex + limitNum);

        // Projection légère : conserve uniquement les champs utiles, volumes allégés
        const paginated = rawPaginated.map(s => ({
            id: s.id,
            title: s.title,
            originalTitle: s.originalTitle || '',
            author: s.author || '',
            translator: s.translator || '',
            origin: s.origin || '',
            type: s.type || '',
            status: s.status || '',
            status_fr: s.status_fr || '',
            publication_status: s.publication_status || 'PUBLISHED',
            genres: s.genres || [],
            genres_fr: s.genres_fr || [],
            rating: s.rating || 4.8,
            views: s.views || 0,
            likes: s.likes || 0,
            featured: !!s.featured,
            is_original: !!s.is_original,
            cover: s.cover || '',
            formats: s.formats || [],
            volume_count: (Array.isArray(s.volumes) && s.volumes.length > 0) ? s.volumes.length : (s.volume_count || 1),
            synopsis: s.synopsis || '',
            synopsis_fr: s.synopsis_fr || s.synopsis || '',
            created_at: s.created_at || 0,
            approved_at: s.approved_at || 0,
            updated_at: s.updated_at || 0,
            releaseDate: s.releaseDate || '',
            release_time: getReleaseTime(s),
            is_new: (Date.now() - getReleaseTime(s)) < (7 * 24 * 60 * 60 * 1000),
            volumes: Array.isArray(s.volumes) ? s.volumes.map(v => ({
                id: v.id,
                volume_number: v.volume_number || v.volumeNumber || 1,
                title: v.title || `Volume ${v.volume_number || 1}`,
                uploaded_at: v.uploaded_at || v.created_at || 0,
                created_at: v.created_at || 0,
                release_date: v.release_date || ''
            })) : []
        }));

        return {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            series: paginated
        };
    }

    getSeries(id, requester = null) {
        this.data = this.loadData();
        const series = (this.data.series || []).find(s => s.id === id || s.id.toLowerCase() === (id || '').toLowerCase()) || null;
        if (!series) return null;

        const pubStatus = (series.publication_status || 'PUBLISHED').toUpperCase();
        if (pubStatus !== 'PUBLISHED') {
            // Seuls l'administrateur ou l'auteur peuvent consulter une œuvre non publiée
            if (!requester) return null;
            const reqRole = (requester.role || '').toUpperCase();
            const isOwner = requester.id && series.created_by && requester.id === series.created_by;
            if (reqRole !== 'ADMIN' && !isOwner) {
                return null;
            }
        }
        return series;
    }

    getChapter(seriesId, chapterNum) {
        const series = this.getSeries(seriesId);
        if (!series || !series.chapters) return null;
        const num = parseInt(chapterNum);
        return series.chapters.find(c => c.chapterNumber === num) || null;
    }

    likeSeries(id) {
        const series = this.getSeries(id);
        if (series) {
            series.likes = (series.likes || 0) + 1;
            this.saveData();
            return series.likes;
        }
        return 0;
    }

    incrementViews(id) {
        const series = this.getSeries(id);
        if (series) {
            series.views = (series.views || 0) + 1;
            this.saveData();
            return series.views;
        }
        return 0;
    }

    addRating(id, score, voterId, voterName = '', reviewText = '') {
        const series = this.getSeries(id);
        if (!series) return null;

        const numScore = Math.min(5, Math.max(1, Math.round(Number(score))));
        if (!numScore || isNaN(numScore)) return null;

        if (!series.ratings_data) {
            series.ratings_data = {
                count: 0,
                total_score: 0,
                distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                user_votes: {},
                recent_reviews: []
            };
        }

        const rd = series.ratings_data;
        if (!rd.distribution) rd.distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        if (!rd.user_votes) rd.user_votes = {};
        if (!Array.isArray(rd.recent_reviews)) rd.recent_reviews = [];

        const voterKey = String(voterId || ('anon_' + Date.now()));
        const previousVote = rd.user_votes[voterKey];

        if (previousVote) {
            const prevScore = previousVote.score;
            rd.total_score = Math.max(0, (rd.total_score || 0) - prevScore + numScore);
            if (rd.distribution[prevScore] > 0) rd.distribution[prevScore]--;
            rd.distribution[numScore] = (rd.distribution[numScore] || 0) + 1;
            previousVote.score = numScore;
            previousVote.updated_at = Date.now();
            if (reviewText && reviewText.trim()) {
                previousVote.review = reviewText.trim().substring(0, 300);
            }
        } else {
            rd.count = (rd.count || 0) + 1;
            rd.total_score = (rd.total_score || 0) + numScore;
            rd.distribution[numScore] = (rd.distribution[numScore] || 0) + 1;
            rd.user_votes[voterKey] = {
                score: numScore,
                name: voterName ? String(voterName).substring(0, 50) : 'Lecteur',
                review: reviewText ? String(reviewText).trim().substring(0, 300) : '',
                created_at: Date.now()
            };
        }

        if (reviewText && reviewText.trim()) {
            const cleanRev = String(reviewText).trim().substring(0, 300);
            const existingRevIdx = rd.recent_reviews.findIndex(r => r.voterKey === voterKey);
            const reviewObj = {
                voterKey,
                name: voterName ? String(voterName).substring(0, 50) : 'Lecteur',
                score: numScore,
                text: cleanRev,
                created_at: Date.now()
            };
            if (existingRevIdx !== -1) {
                rd.recent_reviews[existingRevIdx] = reviewObj;
            } else {
                rd.recent_reviews.unshift(reviewObj);
                if (rd.recent_reviews.length > 20) rd.recent_reviews.pop();
            }
        }

        // Bayesian smoothed rating: with C=2 prior weight around baseline 4.8
        const C = 2;
        const m = 4.8;
        const avg = ((C * m) + rd.total_score) / (C + rd.count);
        series.rating = Math.round(avg * 10) / 10;
        series.rating_count = rd.count;

        this.saveData();
        return {
            rating: series.rating,
            rating_count: series.rating_count,
            user_score: numScore
        };
    }

    deleteReview(id, voterKey) {
        const series = this.getSeries(id);
        if (!series || !series.ratings_data) return false;

        const rd = series.ratings_data;
        if (Array.isArray(rd.recent_reviews)) {
            rd.recent_reviews = rd.recent_reviews.filter(r => r.voterKey !== voterKey);
        }
        if (rd.user_votes && rd.user_votes[voterKey]) {
            delete rd.user_votes[voterKey].review;
        }
        this.saveData();
        return true;
    }
}

module.exports = new CatalogService();
