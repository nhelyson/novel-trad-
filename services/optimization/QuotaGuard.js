const axios = require('axios');

class QuotaGuard {
  /**
   * Masque la clé API pour l'affichage (ex: "••••••••••••:fx")
   */
  static maskApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return '••••••••';
    const trimmed = apiKey.trim();
    const isFree = trimmed.endsWith(':fx');
    const suffix = isFree ? ':fx' : '';
    return '••••••••' + suffix;
  }

  /**
   * Récupère l'utilisation officielle du quota DeepL via l'API /v2/usage
   */
  static async getDeepLUsage(apiKey) {
    if (!apiKey) return null;
    const isFree = apiKey.endsWith(':fx');
    const baseUrl = isFree ? 'https://api-free.deepl.com/v2' : 'https://api.deepl.com/v2';

    try {
      const res = await axios.get(`${baseUrl}/usage`, {
        headers: { 'Authorization': `DeepL-Auth-Key ${apiKey.trim()}` },
        timeout: 10000
      });

      const characterCount = res.data.character_count || 0;
      const characterLimit = res.data.character_limit || 500000;
      const percentUsed = (characterCount / characterLimit) * 100;

      return {
        characterCount,
        characterLimit,
        charactersRemaining: Math.max(0, characterLimit - characterCount),
        percentUsed: Math.round(percentUsed * 10) / 10,
        maskedKey: this.maskApiKey(apiKey)
      };
    } catch (err) {
      console.warn(`[QuotaGuard] Impossible de vérifier le quota DeepL: ${err.message}`);
      return null;
    }
  }

  /**
   * Évalue le niveau de risque par rapport au quota DeepL
   * Revoie { canProceed, warningLevel, percentUsed, message }
   */
  static evaluateQuotaStatus(usageInfo) {
    if (!usageInfo) {
      return { canProceed: true, warningLevel: 'UNKNOWN', message: 'Quota indéterminé' };
    }

    const pct = usageInfo.percentUsed;

    if (pct >= 100) {
      return {
        canProceed: false,
        warningLevel: 'BLOCKED_100',
        percentUsed: pct,
        message: 'Quota DeepL totalement épuisé (100%). Les nouvelles requêtes sont bloquées.'
      };
    }

    if (pct >= 98) {
      return {
        canProceed: false,
        warningLevel: 'AUTO_STOP_98',
        percentUsed: pct,
        message: `Seuil critique atteint (${pct}% >= 98%). La traduction est automatiquement mise en pause pour préserver votre quota.`
      };
    }

    if (pct >= 95) {
      return {
        canProceed: true,
        warningLevel: 'ECONOMY_95',
        percentUsed: pct,
        message: `Quota très bas (${pct}%). Mode économie renforcé activé.`
      };
    }

    if (pct >= 90) {
      return {
        canProceed: true,
        warningLevel: 'HIGH_WARNING_90',
        percentUsed: pct,
        message: `Attention : ${pct}% de votre quota mensuel DeepL consommé.`
      };
    }

    if (pct >= 80) {
      return {
        canProceed: true,
        warningLevel: 'WARNING_80',
        percentUsed: pct,
        message: `Information : ${pct}% du quota DeepL utilisé.`
      };
    }

    return {
      canProceed: true,
      warningLevel: 'NORMAL',
      percentUsed: pct,
      message: `Quota OK (${pct}% utilisé).`
    };
  }
}

module.exports = QuotaGuard;
