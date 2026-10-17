const fs = require('fs');
const path = require('path');

// Helper date réelle de parution (dernier volume ou publication de l'oeuvre)
const getReleaseTime = (s) => {
    let t = s.approved_at || s.created_at || (s.releaseDate ? new Date(s.releaseDate).getTime() : 0) || 0;
    if (Array.isArray(s.volumes) && s.volumes.length > 0) {
        for (const v of s.volumes) {
            const vt = v.uploaded_at || v.created_at || (v.release_date ? new Date(v.release_date).getTime() : 0) || 0;
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
        const published = (this.data.series || []).filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED');

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

    getExplore({ q = '', genre = '', status = '', format = '', origin = '', sort = 'popular', page = 1, limit = 24 } = {}) {
        this.data = this.loadData();
        // Sécurité stricte : seuls les romans validés et publiés sont visibles au public
        let list = (this.data.series || []).filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED');

        // Helper normalisation sans accents
        const normStr = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

        // 1. Live Search (Title, alternative titles, author, translator, genres)
        if (q && q.trim().length > 0) {
            const queryNorm = normStr(q);
            list = list.filter(s => {
                const matchTitle = normStr(s.title).includes(queryNorm);
                const matchAlt = normStr(s.originalTitle).includes(queryNorm);
                const matchAuthor = normStr(s.author).includes(queryNorm);
                const matchTrans = normStr(s.translator).includes(queryNorm);
                const matchGenres = (s.genres || []).some(g => normStr(g).includes(queryNorm)) ||
                                    (s.genres_fr || []).some(g => normStr(g).includes(queryNorm));
                return matchTitle || matchAlt || matchAuthor || matchTrans || matchGenres;
            });
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
            const isJP = oUpper === 'JP' || oUpper.includes('JAPON') || oUpper.includes('JAPAN');
            const isKR = oUpper === 'KR' || oUpper.includes('CORÉE') || oUpper.includes('COREE') || oUpper.includes('KOREA');
            const isCN = oUpper === 'CN' || oUpper.includes('CHINE') || oUpper.includes('CHINA');

            list = list.filter(s => {
                const sOrig = (s.origin || '').toUpperCase();
                if (isJP) return sOrig.includes('JAPON') || sOrig.includes('JP') || sOrig.includes('JAPAN');
                if (isKR) return sOrig.includes('CORÉE') || sOrig.includes('COREE') || sOrig.includes('KOREA') || sOrig.includes('KR');
                if (isCN) return sOrig.includes('CHINE') || sOrig.includes('CHINA') || sOrig.includes('CN');
                return sOrig.includes(oUpper);
            });
        }

        // 5. Sort Order (popular, rating, latest, az / title, za)
        if (sort === 'popular') {
            const now = Date.now();
            const getScore = (s) => {
                const views = s.views || 0;
                const relTime = getReleaseTime(s);
                const daysAgo = Math.max(0, (now - relTime) / (1000 * 60 * 60 * 24));
                // Bonus de visibilité pour les nouveautés : +35 points aujourd'hui, dégressif sur 14 jours
                const recencyBoost = daysAgo < 14 ? Math.round((14 - daysAgo) * 2.5) : 0;
                return views + recencyBoost;
            };

            list.sort((a, b) => {
                const diff = getScore(b) - getScore(a);
                if (diff !== 0) return diff;
                // En cas d'égalité, les parutions récentes passent systématiquement DEVANT
                const timeDiff = getReleaseTime(b) - getReleaseTime(a);
                if (timeDiff !== 0) return timeDiff;
                const rA = (parseFloat(a.rating) || 4.0) * 10 + ((a.volumes || []).length * 2);
                const rB = (parseFloat(b.rating) || 4.0) * 10 + ((b.volumes || []).length * 2);
                return rB - rA;
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
            cover: s.cover || '',
            formats: s.formats || [],
            volume_count: s.volume_count || (Array.isArray(s.volumes) ? s.volumes.length : 1),
            synopsis: s.synopsis || '',
            synopsis_fr: s.synopsis_fr || s.synopsis || '',
            created_at: s.created_at || 0,
            approved_at: s.approved_at || 0,
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
