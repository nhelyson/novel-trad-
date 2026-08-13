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
      const charactersRemaining = Math.max(0, characterLimit - characterCount);
      const percentUsed = (characterCount / characterLimit) * 100;

      return {
        characterCount,
        characterLimit,
        charactersRemaining,
        percentUsed: Math.round(percentUsed * 10) / 10,
        maskedKey: this.maskApiKey(apiKey)
      };
    } catch (err) {
      console.warn(`[QuotaGuard] Impossible de vérifier le quota DeepL: ${err.message}`);
      return null;
    }
  }

  /**
   * Vérification STRICTE du Quota DeepL AVANT le lancement de la traduction.
   * Ne s'applique UNIQUEMENT qu'au provider 'deepl'. Les moteurs locaux (nllb, libretranslate, etc.) sont ignorés.
   *
   * CALCUL DOCUMENTÉ :
   * - quotaAvailable = limit - count
   * - Pour PDF / EPUB / Text : DeepL comptabilise le texte brut + balises/espaces.
   * - Marge de sécurité appliquée = +10% pour PDF/Document API, +5% pour Text API.
   * - estimatedConsumption = rawCharacters * (1 + safetyMargin)
   */
  static async checkPreTranslationQuota(providerName, apiKey, rawCharacters, documentType = 'pdf') {
    const normProvider = (providerName || '').toLowerCase();
    
    // Règle Provider : Les moteurs locaux ou sans quota (nllb, libretranslate...) ne sont jamais bloqués par le QuotaGuard DeepL
    if (normProvider !== 'deepl') {
      return {
        canProceed: true,
        reason: 'PROVIDER_NO_QUOTA',
        message: `Le moteur "${providerName}" ne possède pas de restriction de quota DeepL.`
      };
    }

    if (!apiKey) {
      return {
        canProceed: false,
        reason: 'MISSING_API_KEY',
        message: "Clé API DeepL manquante pour effectuer la vérification de quota."
      };
    }

    const usageInfo = await this.getDeepLUsage(apiKey);
    if (!usageInfo) {
      // Si l'API /usage est indisponible (problème réseau), on autorise avec avertissement
      return {
        canProceed: true,
        warning: true,
        reason: 'USAGE_API_UNAVAILABLE',
        message: "Impossible de contacter l'API DeepL /usage. Traduction autorisée sous réserve."
      };
    }

    // 1. Quota restant direct
    const availableQuota = usageInfo.charactersRemaining;

    // 2. Marge de sécurité (10% pour PDF/EPUB document API, 5% pour Text API)
    const safetyMarginRatio = (documentType === 'pdf' || documentType === 'epub') ? 0.10 : 0.05;
    const safetyMarginChars = Math.ceil(rawCharacters * safetyMarginRatio);
    const estimatedTotalConsumption = rawCharacters + safetyMarginChars;

    // 3. Document surdimensionné vs Quota disponible
    if (estimatedTotalConsumption > availableQuota) {
      const message = `⚠️ Quota DeepL insuffisant !\n\n` +
        `Ce document contient environ ${rawCharacters.toLocaleString()} caractères.\n` +
        `Avec la marge de sécurité technique (${Math.round(safetyMarginRatio * 100)}%), la consommation estimée est de ${estimatedTotalConsumption.toLocaleString()} caractères.\n\n` +
        `Quota DeepL disponible : ${availableQuota.toLocaleString()} / ${usageInfo.characterLimit.toLocaleString()} caractères.\n\n` +
        `La traduction a été stoppée AVANT envoi pour préserver votre quota.`;

      return {
        canProceed: false,
        reason: 'INSUFFICIENT_QUOTA',
        rawCharacters,
        safetyMarginChars,
        estimatedTotalConsumption,
        availableQuota,
        characterLimit: usageInfo.characterLimit,
        message
      };
    }

    return {
      canProceed: true,
      reason: 'QUOTA_OK',
      rawCharacters,
      estimatedTotalConsumption,
      availableQuota,
      message: `Quota OK (${availableQuota.toLocaleString()} caractères disponibles pour ${estimatedTotalConsumption.toLocaleString()} estimés).`
    };
  }

  /**
   * Évalue le statut du quota pendant le traitement batch
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
    if (pct >= 99) {
      return {
        canProceed: false,
        warningLevel: 'AUTO_STOP_99',
        percentUsed: pct,
        message: `Seuil critique atteint (${pct}%). La traduction est automatiquement mise en pause.`
      };
    }
    return { canProceed: true, warningLevel: 'NORMAL', percentUsed: pct, message: `Quota OK (${pct}% utilisé).` };
  }
}

module.exports = QuotaGuard;
