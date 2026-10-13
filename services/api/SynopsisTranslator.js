const axios = require('axios');
const fs = require('fs');
const path = require('path');

class SynopsisTranslator {
    constructor() {
        this.cachePath = path.join(__dirname, '..', '..', 'data', 'synopsis_cache.json');
        this.cache = this.loadCache();
        // Public instance of LibreTranslate or a local one if the user runs one
        this.libreTranslateUrl = process.env.LIBRETRANSLATE_URL || 'https://translate.terraprint.co/translate'; 
        // NOTE: Many public LibreTranslate instances require an API key or limit requests. 
        // We will use a reliable fallback or allow configuration.
    }

    loadCache() {
        if (fs.existsSync(this.cachePath)) {
            try {
                return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
            } catch (e) {
                console.error('Error loading Synopsis cache', e);
            }
        }
        return {};
    }

    saveCache() {
        try {
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
        } catch (e) {
            console.error('Error saving Synopsis cache', e);
        }
    }

    async translate(text, targetLang = 'fr') {
        if (!text) return '';
        
        // Use a hash of the text for caching to avoid huge keys, or just use the text itself if it's small enough.
        // For simplicity and to avoid collisions, we'll use a simple base64 or just first 50 chars + length as key
        const key = Buffer.from(text.substring(0, 50)).toString('base64') + '_' + text.length + '_' + targetLang;
        
        if (this.cache[key]) {
            return this.cache[key];
        }

        try {
            console.log('[LibreTranslate] Translating synopsis to', targetLang);
            
            // Try LibreTranslate
            const response = await axios.post(this.libreTranslateUrl, {
                q: text,
                source: 'en',
                target: targetLang,
                format: 'text'
            }, { 
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 
            });

            if (response.data && response.data.translatedText) {
                this.cache[key] = response.data.translatedText;
                this.saveCache();
                return response.data.translatedText;
            }
            
            return text; // fallback to original if API succeeds but format is wrong

        } catch (error) {
            console.error('[LibreTranslate] Error translating synopsis:', error.message);
            // Don't cache the error, return original text as fallback
            return text;
        }
    }
}

module.exports = new SynopsisTranslator();
