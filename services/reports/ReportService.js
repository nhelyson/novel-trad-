/**
 * ReportService.js - NovelTrad Translation Error & Patch Management Service
 * Gère les signalements d'erreurs de traduction faits par les lecteurs
 * et l'application automatique de patchs de correction en direct.
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DB_PATH = path.join(__dirname, '..', '..', 'data', 'reports_db.json');

class ReportService {
  static loadData() {
    if (!fs.existsSync(REPORTS_DB_PATH)) {
      return { reports: [], patches: [] };
    }
    try {
      const raw = fs.readFileSync(REPORTS_DB_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data.reports)) data.reports = [];
      if (!Array.isArray(data.patches)) data.patches = [];
      return data;
    } catch (e) {
      console.warn('[ReportService] Erreur lors de la lecture de reports_db.json:', e.message);
      return { reports: [], patches: [] };
    }
  }

  static saveData(data) {
    try {
      const dir = path.dirname(REPORTS_DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(REPORTS_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[ReportService] Erreur lors de la sauvegarde de reports_db.json:', e.message);
      return false;
    }
  }

  /**
   * Créer un nouveau signalement de traduction
   */
  static createReport(payload = {}) {
    const data = this.loadData();
    const id = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const selectedText = (payload.selectedText || '').trim();
    if (!selectedText) {
      throw new Error('L\'extrait de texte à signaler est obligatoire.');
    }

    const report = {
      id,
      seriesId: String(payload.seriesId || '').trim(),
      seriesTitle: String(payload.seriesTitle || '').trim() || 'Œuvre Inconnue',
      volumeTitle: String(payload.volumeTitle || '').trim() || '',
      chapterNum: parseInt(payload.chapterNum, 10) || 1,
      chapterTitle: String(payload.chapterTitle || '').trim() || `Chapitre ${payload.chapterNum || 1}`,
      selectedText: selectedText.substring(0, 2000),
      suggestedCorrection: String(payload.suggestedCorrection || '').trim().substring(0, 2000),
      reason: String(payload.reason || 'contresens').trim(),
      comment: String(payload.comment || '').trim().substring(0, 1000),
      userId: payload.userId || null,
      userEmail: payload.userEmail || null,
      userName: payload.userName || 'Lecteur NovelTrad',
      status: 'PENDING', // PENDING | RESOLVED | REJECTED
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      correctedText: null
    };

    data.reports.unshift(report);
    this.saveData(data);
    return report;
  }

  /**
   * Obtenir tous les rapports avec filtres facultatifs
   */
  static getReports(filters = {}) {
    const data = this.loadData();
    let results = data.reports || [];

    if (filters.status && filters.status !== 'ALL') {
      const s = String(filters.status).toUpperCase();
      results = results.filter(r => (r.status || 'PENDING').toUpperCase() === s);
    }

    if (filters.seriesId) {
      const sid = String(filters.seriesId).toLowerCase();
      results = results.filter(r => String(r.seriesId).toLowerCase() === sid);
    }

    return results;
  }

  /**
   * Nombre de rapports en attente
   */
  static getPendingCount() {
    const data = this.loadData();
    return (data.reports || []).filter(r => (r.status || 'PENDING').toUpperCase() === 'PENDING').length;
  }

  /**
   * Valider et appliquer une correction par l'administrateur
   */
  static resolveReport(reportId, { correctedText, adminUser, applyPatch = true } = {}) {
    const data = this.loadData();
    const report = (data.reports || []).find(r => r.id === reportId);
    if (!report) {
      throw new Error('Signalement introuvable.');
    }

    const finalText = (correctedText !== undefined ? correctedText : (report.suggestedCorrection || report.selectedText)).trim();
    if (!finalText) {
      throw new Error('Le texte de correction ne peut pas être vide.');
    }

    report.status = 'RESOLVED';
    report.correctedText = finalText;
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = adminUser?.email || adminUser?.id || 'admin';

    // Application du patch en mémoire/disque pour le chapitre
    if (applyPatch) {
      data.patches = (data.patches || []).filter(p => p.reportId !== reportId);

      const patch = {
        id: `pat_${reportId}`,
        reportId,
        seriesId: report.seriesId,
        chapterNum: report.chapterNum,
        originalText: report.selectedText,
        correctedText: finalText,
        createdAt: new Date().toISOString()
      };
      data.patches.push(patch);
    }

    this.saveData(data);
    return { success: true, report };
  }

  /**
   * Rejeter un signalement
   */
  static rejectReport(reportId, { adminUser, reason = '' } = {}) {
    const data = this.loadData();
    const report = (data.reports || []).find(r => r.id === reportId);
    if (!report) {
      throw new Error('Signalement introuvable.');
    }

    report.status = 'REJECTED';
    report.rejectionReason = String(reason).trim();
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = adminUser?.email || adminUser?.id || 'admin';

    data.patches = (data.patches || []).filter(p => p.reportId !== reportId);

    this.saveData(data);
    return { success: true, report };
  }

  /**
   * Supprimer un signalement
   */
  static deleteReport(reportId) {
    const data = this.loadData();
    data.reports = (data.reports || []).filter(r => r.id !== reportId);
    data.patches = (data.patches || []).filter(p => p.reportId !== reportId);
    this.saveData(data);
    return { success: true };
  }

  /**
   * Obtenir tous les patchs actifs pour un roman/volume et numéro de chapitre
   */
  static getActivePatches(seriesIdOrKey, chapterNum) {
    const data = this.loadData();
    if (!data.patches || data.patches.length === 0) return [];

    const targetKey = String(seriesIdOrKey || '').toLowerCase().replace(/\.(epub|pdf)$/i, '').trim();
    const targetChapter = parseInt(chapterNum, 10);

    return data.patches.filter(p => {
      const pKey = String(p.seriesId || '').toLowerCase().replace(/\.(epub|pdf)$/i, '').trim();
      const pChapter = parseInt(p.chapterNum, 10);
      return (pKey === targetKey || targetKey.includes(pKey) || pKey.includes(targetKey)) && pChapter === targetChapter;
    });
  }

  /**
   * Appliquer les patchs sur le contenu HTML d'un chapitre
   */
  static applyPatchesToHtml(htmlContent, seriesIdOrKey, chapterNum) {
    if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
    const patches = this.getActivePatches(seriesIdOrKey, chapterNum);
    if (!patches || patches.length === 0) return htmlContent;

    let modified = htmlContent;
    for (const patch of patches) {
      if (patch.originalText && patch.correctedText && patch.originalText !== patch.correctedText) {
        if (modified.includes(patch.originalText)) {
          modified = modified.split(patch.originalText).join(patch.correctedText);
        } else {
          const cleanOriginal = patch.originalText.replace(/\s+/g, ' ').trim();
          if (cleanOriginal && modified.includes(cleanOriginal)) {
            modified = modified.split(cleanOriginal).join(patch.correctedText);
          }
        }
      }
    }
    return modified;
  }
}

module.exports = ReportService;
