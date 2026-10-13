const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const TextNormalizer = require('./TextNormalizer');

class LibraryWatcher {
    constructor() {
        this.watcher = null;
        this.watchedFolders = new Set();
        this.clients = new Set();
        this.anilistTranslator = null;
        this.debounceTimers = new Map();
    }

    setAnilistTranslator(translator) {
        this.anilistTranslator = translator;
    }

    init(folders = []) {
        const validFolders = folders.filter(f => fs.existsSync(f));
        this.watchedFolders = new Set(validFolders);

        console.log(`[LibraryWatcher] Initialisation de la surveillance sur ${validFolders.length} dossier(s)...`);

        this.watcher = chokidar.watch(Array.from(this.watchedFolders), {
            depth: 4,
            persistent: true,
            ignoreInitial: true,
            ignored: [/(^|[\/\\])\../, /node_modules/, /cache/],
            awaitWriteFinish: {
                stabilityThreshold: 1500,
                pollInterval: 200
            }
        });

        this.watcher
            .on('add', (filePath) => this.handleFileChange('add', filePath))
            .on('unlink', (filePath) => this.handleFileChange('unlink', filePath))
            .on('error', (err) => console.warn('[LibraryWatcher] Erreur:', err.message));
    }

    updateWatchedFolders(folders = []) {
        if (!this.watcher) {
            this.init(folders);
            return;
        }

        const newSet = new Set(folders.filter(f => fs.existsSync(f)));

        // Remove old folders no longer in list
        for (const oldFolder of this.watchedFolders) {
            if (!newSet.has(oldFolder)) {
                this.watcher.unwatch(oldFolder);
                console.log(`[LibraryWatcher] Désabonnement de : ${oldFolder}`);
            }
        }

        // Add new folders
        for (const newFolder of newSet) {
            if (!this.watchedFolders.has(newFolder)) {
                this.watcher.add(newFolder);
                console.log(`[LibraryWatcher] Nouveau dossier surveillé : ${newFolder}`);
            }
        }

        this.watchedFolders = newSet;
    }

    handleFileChange(event, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.epub' && ext !== '.pdf') return;

        const filename = path.basename(filePath);
        console.log(`[LibraryWatcher] Détection temps réel [${event.toUpperCase()}]: ${filename}`);

        // Debounce notifications (500ms) pour éviter les rafales
        if (this.debounceTimers.has(filePath)) {
            clearTimeout(this.debounceTimers.get(filePath));
        }

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(filePath);

            // Si c'est un ajout, pré-enrichir les métadonnées AniList en tâche de fond
            if (event === 'add' && this.anilistTranslator) {
                try {
                    const parsed = TextNormalizer.parseFilename(filename);
                    const seriesId = TextNormalizer.generateSeriesId(parsed.seriesTitle);
                    this.anilistTranslator.get(seriesId, parsed.seriesTitle).catch(() => {});
                } catch(e) {}
            }

            // Diffuser à tous les navigateurs connectés
            this.broadcast('library-updated', {
                event,
                filename,
                path: filePath,
                timestamp: Date.now()
            });
        }, 500);

        this.debounceTimers.set(filePath, timer);
    }

    // Gestion Server-Sent Events (SSE)
    addClient(res) {
        this.clients.add(res);
        res.on('close', () => {
            this.clients.delete(res);
        });

        // Envoi d'un événement de connexion initiale
        res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);
    }

    broadcast(event, data) {
        const payload = `data: ${JSON.stringify({ event, ...data })}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(payload);
            } catch(e) {
                this.clients.delete(client);
            }
        }
    }

    close() {
        if (this.watcher) {
            this.watcher.close();
        }
        for (const client of this.clients) {
            try { client.end(); } catch(e) {}
        }
        this.clients.clear();
    }
}

module.exports = new LibraryWatcher();