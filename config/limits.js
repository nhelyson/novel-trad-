// Configuration des limites de taille pour la traduction de PDF
const DEEPL_MAX_DOCUMENT_SIZE = parseInt(process.env.DEEPL_MAX_DOCUMENT_SIZE, 10) || 10 * 1024 * 1024; // 10 MB limit DeepL API
const DEEPL_SAFE_DOCUMENT_SIZE = parseInt(process.env.DEEPL_SAFE_DOCUMENT_SIZE, 10) || 9 * 1024 * 1024; // 9 MB safe internal limit

module.exports = {
  DEEPL_MAX_DOCUMENT_SIZE,
  DEEPL_SAFE_DOCUMENT_SIZE
};
