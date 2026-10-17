const fs = require('fs');
const path = require('path');
const MetadataCascadeClient = require('./MetadataCascadeClient');

// ============================================================
// Dictionnaire statique complet : Genres EN -> FR
// ============================================================
const GENRES_FR = {
    'Action': 'Action',
    'Adventure': 'Aventure',
    'Comedy': 'Comédie',
    'Drama': 'Drame',
    'Ecchi': 'Ecchi',
    'Fantasy': 'Fantaisie',
    'Horror': 'Horreur',
    'Mahou Shoujo': 'Magical Girl',
    'Mecha': 'Mecha',
    'Music': 'Musique',
    'Mystery': 'Mystère',
    'Psychological': 'Psychologique',
    'Romance': 'Romance',
    'Sci-Fi': 'Science-Fiction',
    'Science Fiction': 'Science-Fiction',
    'Slice of Life': 'Tranche de vie',
    'Sports': 'Sport',
    'Supernatural': 'Surnaturel',
    'Thriller': 'Thriller',
    'Harem': 'Harem',
    'Isekai': 'Isekai',
    'Historical': 'Historique',
    'Military': 'Militaire',
    'School': 'Scolaire',
    'School Life': 'Vie scolaire',
    'Shounen': 'Shōnen',
    'Shoujo': 'Shōjo',
    'Josei': 'Josei',
    'Seinen': 'Seinen',
    'Demons': 'Démons',
    'Magic': 'Magie',
    'Super Power': 'Super-pouvoirs',
    'Vampire': 'Vampire',
    'Martial Arts': 'Arts martiaux',
    'Game': 'Jeu',
    'Parody': 'Parodie',
    'Samurai': 'Samouraï',
    'Space': 'Espace',
    'Cars': 'Voitures',
    'Police': 'Police',
    'Reincarnation': 'Réincarnation',
    'Monsters': 'Monstres',
    'Survival': 'Survie',
    'Tragedy': 'Tragédie',
    'Web Comic': 'Webtoon'
};

// ============================================================
// Dictionnaire statique : Status EN -> FR
// ============================================================
const STATUS_FR = {
    'FINISHED': 'Terminé',
    'RELEASING': 'En cours',
    'NOT_YET_RELEASED': 'À paraître',
    'CANCELLED': 'Annulé',
    'HIATUS': 'En pause',
    'UNKNOWN': 'Inconnu'
};

class AnilistMetadataTranslator {
    constructor() {
        this.cachePath = path.join(__dirname, '..', '..', 'data', 'series_cache.json');
    }

    isEnglishText(text) {
        if (!text || typeof text !== 'string') return false;
        const enWords = ['the', 'and', 'is', 'in', 'to', 'of', 'with', 'was', 'for', 'from', 'her', 'his', 'after', 'lives', 'series', 'world', 'when'];
        const frWords = ['le', 'la', 'les', 'un', 'une', 'des', 'et', 'dans', 'est', 'pour', 'qui', 'avec', 'son', 'sa', 'sur', 'vie', 'lorsque', 'monde'];
        const lower = text.toLowerCase();
        let enCount = 0;
        let frCount = 0;
        enWords.forEach(w => {
            const m = lower.match(new RegExp('\\b' + w + '\\b', 'g'));
            if (m) enCount += m.length;
        });
        frWords.forEach(w => {
            const m = lower.match(new RegExp('\\b' + w + '\\b', 'g'));
            if (m) frCount += m.length;
        });
        return enCount > frCount;
    }

    translateGenre(genre) {
        if (!genre) return '';
        return GENRES_FR[genre] || genre;
    }

    translateStatus(status) {
        if (!status) return 'Inconnu';
        return STATUS_FR[status] || status;
    }

    /**
     * Traduit un texte en français via Google Translate / MyMemory API
     */
    async translateText(text, targetLang = 'fr') {
        if (!text || text.trim().length === 0) return '';

        // --- Tentative 1 : @vitalets/google-translate-api avec timeout de sécurité ---
        try {
            const { translate } = await import('@vitalets/google-translate-api');
            const result = await Promise.race([
                translate(text, { to: targetLang }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 9s')), 9000))
            ]);
            if (result && result.text) {
                console.log('[Translator] Synopsis traduit avec succès en français (Google Translate API)');
                return result.text;
            }
        } catch (e) {
            console.warn('[Translator] Google Translate wrapper warning:', e.message);
        }

        // --- Tentative 2 : MyMemory API (fallback gratuit) ---
        try {
            const encoded = encodeURIComponent(text.substring(0, 500));
            const url = 'https://api.mymemory.translated.net/get?q=' + encoded + '&langpair=en|' + targetLang;
            const response = await fetch(url);
            const json = await response.json();
            const translated = json?.responseData?.translatedText;
            if (translated && translated !== text && !translated.includes('MYMEMORY WARNING')) {
                console.log('[Translator] Synopsis traduit via MyMemory API');
                return translated;
            }
        } catch (e) {
            console.warn('[Translator] MyMemory API non disponible:', e.message);
        }

        // --- Fallback : texte original ---
        return text;
    }

    /**
     * Recherche en direct traduite pour le Studio Contributeur (pas de blocage par cache obsolète)
     */
    async searchLive(query) {
        const raw = await MetadataCascadeClient.searchLive(query);
        if (!raw) return null;

        const updated = { ...raw };

        // Genres FR
        if (raw.genres) {
            updated.genres_fr = raw.genres.map(g => this.translateGenre(g));
        }

        // Status FR
        if (raw.status) {
            updated.status_fr = this.translateStatus(raw.status);
        }

        // Synopsis FR
        if (raw.synopsis && raw.synopsis.trim().length > 0) {
            updated.synopsis_fr = await this.translateText(raw.synopsis, 'fr');
        } else {
            updated.synopsis_fr = 'Aucun synopsis disponible.';
        }

        // Traduire également les métadonnées ET le synopsis des candidats pour le Studio
        if (Array.isArray(updated.candidates)) {
            for (let i = 0; i < updated.candidates.length; i++) {
                const cand = updated.candidates[i];
                cand.status_fr = this.translateStatus(cand.status);
                cand.genres_fr = (cand.genres || []).map(g => this.translateGenre(g));
                cand.format_label = cand.format === 'NOVEL' ? 'Light Novel' : (cand.format === 'MANGA' ? 'Manga' : cand.format);
                
                if (i === 0 && updated.synopsis_fr) {
                    cand.synopsis_fr = updated.synopsis_fr;
                } else if (cand.synopsis && cand.synopsis.trim()) {
                    try {
                        cand.synopsis_fr = await this.translateText(cand.synopsis, 'fr');
                    } catch(_) {
                        cand.synopsis_fr = cand.synopsis;
                    }
                } else {
                    cand.synopsis_fr = 'Aucun synopsis disponible.';
                }
            }
        }

        return updated;
    }

    /**
     * Point d'entrée principal : récupère les métadonnées via Cascade (AniList -> Kitsu -> MangaDex)
     * et traduit automatiquement les champs en français.
     */
    async get(seriesId, title) {
        // 1. Récupération via le client cascade multi-fournisseurs
        const raw = await MetadataCascadeClient.getSeriesMetadata(seriesId, title);
        if (!raw) return null;

        const updated = { ...raw };

        // Genres FR
        if (raw.genres && !raw.genres_fr) {
            updated.genres_fr = raw.genres.map(g => this.translateGenre(g));
        }

        // Status FR
        if (raw.status && !raw.status_fr) {
            updated.status_fr = this.translateStatus(raw.status);
        }

        // Synopsis FR (vérifie également si synopsis_fr est actuellement en anglais)
        if (!updated.synopsis_fr || this.isEnglishText(updated.synopsis_fr)) {
            const sourceText = raw.synopsis || updated.synopsis || '';
            if (sourceText && sourceText.trim().length > 0) {
                updated.synopsis_fr = await this.translateText(sourceText, 'fr');
            } else {
                updated.synopsis_fr = 'Aucun synopsis disponible.';
            }
        }

        // Traduire également les métadonnées rapides des candidats pour le sélecteur
        if (Array.isArray(updated.candidates)) {
            updated.candidates = updated.candidates.map(cand => ({
                ...cand,
                status_fr: this.translateStatus(cand.status),
                genres_fr: (cand.genres || []).map(g => this.translateGenre(g)),
                format_label: cand.format === 'NOVEL' ? 'Light Novel' : (cand.format === 'MANGA' ? 'Manga' : cand.format)
            }));
        }

        // 3. Mise à jour du cache persistant
        MetadataCascadeClient.cache[seriesId] = updated;
        MetadataCascadeClient.saveCache();

        return updated;
    }
}

module.exports = new AnilistMetadataTranslator();
