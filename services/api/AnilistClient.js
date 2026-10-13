const MetadataCascadeClient = require('./MetadataCascadeClient');

/**
 * AnilistClient (Wrapper rétrocompatible vers MetadataCascadeClient)
 */
class AnilistClient {
    get cache() {
        return MetadataCascadeClient.cache;
    }
    set cache(val) {
        MetadataCascadeClient.cache = val;
    }

    loadCache() {
        return MetadataCascadeClient.loadCache();
    }

    saveCache() {
        return MetadataCascadeClient.saveCache();
    }

    async getSeriesMetadata(seriesId, title) {
        return MetadataCascadeClient.getSeriesMetadata(seriesId, title);
    }
}

module.exports = new AnilistClient();
