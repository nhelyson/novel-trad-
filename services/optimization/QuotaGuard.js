const axios = require('axios');

class QuotaGuard {
  /**
   * Masque la clé API pour l'affichage (ex: "••••••••:fx")
   */
  static maskApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return '••••••••';
    const trimmed = apiKey.trim();
    const isFree = trimmed.endsWith(':fx');
    const suffix = isFree ? ':fx' : '';
    return '••••••••' + suffix;
  }

  /**
   * Récupère l'utilisation officielle du quota DeepL via l'API /v2/usage.
   * Ne possède AUCUNE valeur de secours codée en dur (ni 500 000 ni 1 000 000).
   */
  static async getDeepLUsage(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { error: true, reason: 'MISSING_API_KEY', message: 'Clé API DeepL manquante.' };
    }
    const trimmedKey = apiKey.trim();
    const isFree = trimmedKey.endsWith(':fx');
    const baseUrl = isFree ? 'https://api-free.deepl.com/v2' : 'https://api.deepl.com/v2';

    try {
      const res = await axios.get(`${baseUrl}/usage`, {
        headers: { 'Authorization': `DeepL-Auth-Key ${trimmedKey}` },
        timeout: 10000
      });

      if (!res.data || typeof res.data.character_count !== 'number' || typeof res.data.character_limit !== 'number') {
        return {
          error: true,
          reason: 'INVALID_DEEPL_RESPONSE',
          message: 'Format de réponse invalide retourné par l\'API DeepL.'
        };
      }

      const characterCount = res.data.character_count;
      const characterLimit = res.data.character_limit;
      const charactersRemaining = Math.max(0, characterLimit - characterCount);
      const percentUsed = characterLimit > 0 ? (characterCount / characterLimit) * 100 : 0;

      return {
        error: false,
        characterCount,
        characterLimit,
        charactersRemaining,
        percentUsed: Math.round(percentUsed * 10) / 10,
        maskedKey: this.maskApiKey(trimmedKey),
        lastChecked: new Date().toISOString()
      };
    } catch (err) {
      if (err.response) {
        if (err.response.status === 401 || err.response.status === 403) {
          return {
            error: true,
            reason: 'INVALID_API_KEY',
            status: err.response.status,
            message: 'Clé DeepL invalide ou refusée par l\'API.'
          };
        }
        return {
          error: true,
          reason: 'DEEPL_API_ERROR',
          status: err.response.status,
          message: `L'API DeepL a retourné une erreur (HTTP ${err.response.status}).`
        };
      }
      return {
        error: true,
        reason: 'NETWORK_ERROR',
        message: `Impossible de contacter l'API DeepL (${err.message}).`
      };
    }
  }

  /**
   * Vérification STRICTE du Quota DeepL AVANT le lancement de la traduction.
   * S'applique UNIQUEMENT au provider 'deepl'. Les moteurs locaux (nllb, libretranslate...) sont ignorés.
   *
   * SÉPARATION NETTE :
   * - Taille de fichier : Gérée séparément par Multer / DocumentAnalyzer.
   * - Caractères du document : rawCharacters.
   * - Marge de sécurité : +10% (PDF/EPUB), +5% (Texte).
   * - Quota réel restant : Provient exclusivement de l'API DeepL /v2/usage.
   */
  static async checkPreTranslationQuota(providerName, apiKey, rawCharacters, documentType = 'pdf') {
    const normProvider = (providerName || '').toLowerCase();
    
    // 1. Providers locaux ou sans quota
    if (normProvider !== 'deepl') {
      return {
        canProceed: true,
        reason: 'PROVIDER_NO_QUOTA',
        message: `Le moteur "${providerName}" ne possède pas de restriction de quota DeepL.`
      };
    }

    if (!apiKey || !apiKey.trim()) {
      return {
        canProceed: false,
        reason: 'MISSING_API_KEY',
        message: "Clé API DeepL manquante pour effectuer la vérification de quota."
      };
    }

    const usageInfo = await this.getDeepLUsage(apiKey);
    if (usageInfo.error) {
      if (usageInfo.reason === 'INVALID_API_KEY') {
        return {
          canProceed: false,
          reason: 'INVALID_API_KEY',
          message: "❌ Clé DeepL invalide ou refusée par l'API."
        };
      }
      return {
        canProceed: false,
        reason: 'USAGE_CHECK_FAILED',
        message: `❌ Impossible de vérifier le quota DeepL.\n\nVérifiez :\n- votre clé API ;\n- votre connexion Internet ;\n- la disponibilité de l'API DeepL.`
      };
    }

    // 2. Extrait des métriques réelles de DeepL
    const availableQuota = usageInfo.charactersRemaining;
    const characterLimit = usageInfo.characterLimit;
    const characterCount = usageInfo.characterCount;

    // 3. Application de la marge de sécurité (10% pour PDF/EPUB document API, 5% pour Text API)
    const safetyMarginRatio = (documentType === 'pdf' || documentType === 'epub') ? 0.10 : 0.05;
    const safetyMarginChars = Math.ceil(rawCharacters * safetyMarginRatio);
    const estimatedTotalConsumption = rawCharacters + safetyMarginChars;

        // 4. Comparaison entre la consommation estimée et le quota réellement disponible
    if (estimatedTotalConsumption > availableQuota) {
      const missingCharacters = estimatedTotalConsumption - availableQuota;

      if (availableQuota <= 0) {
        const message = `❌ Quota DeepL totalement épuisé !

` +
          `Quota DeepL total : ${characterLimit.toLocaleString()} caractères
` +
          `Quota utilisé : ${characterCount.toLocaleString()} caractères (100%)
` +
          `Quota restant : 0 caractère

` +
          `Veuillez saisir une autre clé API ou utiliser le mode NLLB Local.`;

        return {
          canProceed: false,
          reason: 'ZERO_QUOTA',
          rawCharacters,
          safetyMarginChars,
          estimatedTotalConsumption,
          availableQuota: 0,
          characterLimit,
          characterCount,
          missingCharacters: estimatedTotalConsumption,
          message,
          usageInfo
        };
      }

      // Mode Relais Multi-Clés (Quota Partiel Autorisé) : CAN PROCEED = TRUE
      const partialPercent = Math.min(99, Math.max(1, Math.round((availableQuota / estimatedTotalConsumption) * 100)));
      const estimatedTraducableChars = Math.min(rawCharacters, availableQuota);

      const message = `⚡ Mode Relais Multi-Clés activé !

` +
        `Votre clé possède ${availableQuota.toLocaleString()} caractères restants sur ${characterLimit.toLocaleString()}.
` +
        `Elle permettra de traduire environ ${partialPercent}% du document (${estimatedTraducableChars.toLocaleString()} / ${rawCharacters.toLocaleString()} caractères).

` +
        `La traduction consommera le quota de cette clé jusqu'à épuisement, puis se mettra en pause pour demander la clé suivante.`;

      return {
        canProceed: true,
        isPartial: true,
        partialPercent,
        estimatedTraducableChars,
        reason: 'PARTIAL_QUOTA_ALLOWED',
        rawCharacters,
        safetyMarginChars,
        estimatedTotalConsumption,
        availableQuota,
        characterLimit,
        characterCount,
        missingCharacters,
        message,
        usageInfo
      };
    }

    return {
      canProceed: true,
      reason: 'QUOTA_OK',
      rawCharacters,
      safetyMarginChars,
      estimatedTotalConsumption,
      availableQuota,
      characterLimit,
      characterCount,
      message: `✓ Quota DeepL disponible : ${availableQuota.toLocaleString()} / ${characterLimit.toLocaleString()} (Consommation estimée : ${estimatedTotalConsumption.toLocaleString()} chars).`,
      usageInfo
    };
  }

  /**
   * Évalue le statut du quota pendant le traitement batch
   */
  static evaluateQuotaStatus(usageInfo) {
    if (!usageInfo || usageInfo.error) {
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

