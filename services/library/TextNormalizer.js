const path = require('path');

/**
 * TextNormalizer - Normalisation robuste et generique des noms de fichiers
 * pour le regroupement en series dans la bibliotheque NovelTrad.
 */

const SUBSERIES_PATTERNS = [
    /[\s\-_:]+(?:year|arc|season|part|phase|saga|serie|series|arc)\s*\d+\s*$/i,
    /[\s\-_]+[YS]\d+V\d*\s*$/i,
    /[\s\-_]+[YS]\d+\s*$/i,
];

const SPINOFF_SUFFIXES = /[\s\-_]+(alter|side[\s\-_]*stor(?:y|ies)|extra[\s\-_]*stor(?:y|ies)|hiden|gaiden|special|light[\s\-_]*novel|redundant[\s\-_]*reincarnation)$/i;

class TextNormalizer {
    static cleanMojibake(str) {
        if (!str) return '';
        return str
            // Corrupted dashes (UTF-8 en-dash/em-dash decoded as Windows-1252 / ISO-8859-1)
            .replace(/\u00E2\u0080\u0093|\u00E2\u0080\u0094|\u00E2\u20AC[\u2013\u2014\u201C\u201D]|\u2013|\u2014|\uFFFD|\?{2,}/g, ' - ')
            // Corrupted apostrophes (Sasukeâ€™s, Miss MedicÃ¢__s, etc.)
            .replace(/\u00E2\u0080\u0099|\u00E2\u20AC\u2122|\u2019|\u2018/g, "'")
            .replace(/[\u00C0-\u00C3][\u0080-\u00BF]*__s|ǽ__s/gi, "'s")
            // Residual stray mojibake high bytes
            .replace(/â[€“”’™\s]*/g, ' ')
            .replace(/[\u0080-\u009F]/g, ' ')
            .replace(/\s*-\s*-\s*/g, ' - ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    static parseFilename(filename) {
        let name = path.parse(filename).name;

        // 0. Nettoyer les encodages corrompus (Mojibake Windows CP1252 / UTF-8)
        name = TextNormalizer.cleanMojibake(name);

        // 1. Supprimer les suffixes de copie/numero entre parentheses
        name = name.replace(/\s*\(\d+\)\s*$/, '').trim();

        // 2. Supprimer les tags de langue
        name = name.replace(/[\s_-]*(?:_fr|-fr|\[fr\]|\(fr\)|vf|french)[\s_-]*/ig, ' ').replace(/\s{2,}/g, ' ').trim();

        // 3. Supprimer les tags de traduction
        name = name.replace(/[\s\-_]*(?:traduction[\s\-_]*officielle|traduction|traduit|traduc|translation|translated)[\s\-_]*/ig, ' ').replace(/\s{2,}/g, ' ').trim();

        // 4. Supprimer les suffixes PDF-Room, PDF
        name = name.replace(/[\s\-_]*(?:pdf-room|pdf)[\s\-_]*/ig, ' ').replace(/\s{2,}/g, ' ').trim();

        // 5. Supprimer les prefixes numeriques parasites (IDs Calibre, timestamps)
        name = name.replace(/^\d{5,}[\s\-_]+/, '').trim();

        // 6. Normaliser les separateurs multiples
        name = name.replace(/[-_]{2,}/g, '-').replace(/\s{2,}/g, ' ').trim();

        // 7. Detection du numero de volume
        let volumeNumber = null;
        let seriesTitle = name;

        const volRegexes = [
            /[\s\-_]+v0*(\d+(\.\d+)?)\b/i,
            /\bv0*(\d+(\.\d+)?)\b/i,
            /[\s\-_]+(?:volume|vol|tome|book|t)\.?\s*0*(\d+(\.\d+)?)\b/i,
            /\b(?:volume|vol|tome|book|t)\.?\s*0*(\d+(\.\d+)?)\b/i,
            /[\s\-_]+0*(\d+(\.\d+)?)\s*$/i,
            /\(\s*0*(\d+(\.\d+)?)\s*\)\s*$/i,
        ];

        for (const regex of volRegexes) {
            const match = name.match(regex);
            if (match) {
                volumeNumber = parseFloat(match[1]);
                seriesTitle = name.substring(0, match.index).trim();
                break;
            }
        }

        seriesTitle = seriesTitle.replace(/[\s\-_:]+$/, '').trim();
        seriesTitle = seriesTitle.replace(/\s{2,}/g, ' ');

        // 8. Supprimer le mot Volume/Vol/Tome/Book seul en fin
        seriesTitle = seriesTitle.replace(/[\s\-_]+(volume|vol|tome|book|t)\.?\s*$/i, '').replace(/[\s\-_]+$/, '').trim();
        seriesTitle = seriesTitle.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();

        // 9. Detecter et supprimer les sous-series / arcs
        let subseriesLabel = null;
        for (const pattern of SUBSERIES_PATTERNS) {
            const match = seriesTitle.match(pattern);
            if (match) {
                subseriesLabel = match[0].replace(/^[\s\-_:]+/, '').trim();
                seriesTitle = seriesTitle.substring(0, match.index).replace(/[\s\-_:]+$/, '').trim();
                break;
            }
        }

        // 10. Detecter les spin-offs
        const spinoffMatch = seriesTitle.match(SPINOFF_SUFFIXES);
        const spinoffLabel = spinoffMatch ? spinoffMatch[1].replace(/[\s\-_]+/g, ' ').trim() : null;
        const baseSeriesTitle = spinoffMatch
            ? seriesTitle.replace(SPINOFF_SUFFIXES, '').replace(/[\s\-_]+$/, '').trim()
            : seriesTitle;

        return {
            seriesTitle: baseSeriesTitle || name,
            spinoffLabel,
            subseriesLabel,
            fullSeriesTitle: seriesTitle || name,
            volumeNumber,
            cleanName: name
        };
    }

    static generateSeriesId(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[''`]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}

module.exports = TextNormalizer;