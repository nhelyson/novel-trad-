/**
 * api-client.js
 * 
 * Couche d'abstraction réseau pour Novel Trad.
 * Ne contient aucune dépendance au DOM (document.getElementById, etc.).
 * Gère uniquement la communication avec l'API backend et les SSE.
 */

const ApiClient = {
  // ==========================================
  // STATUS & STATS
  // ==========================================

  async checkStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  },

  async getDashboardStats(apiKey = '') {
    const res = await fetch(`/api/dashboard-stats?apiKey=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  },

  // ==========================================
  // DOCUMENTS (PDF/EPUB)
  // ==========================================

  async analyzeNovel(formData) {
    const res = await fetch('/api/analyze-novel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) throw new Error(data.message);
    return data;
  },

  async translateDocument(formData) {
    const res = await fetch('/api/translate-document', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let errText = 'Erreur lors de la traduction.';
      try {
        const errData = await res.json();
        errText = errData.message || errText;
      } catch (e) {}
      throw new Error(errText);
    }
    return await res.json();
  },

  async convertEpubToPdf(formData) {
    const res = await fetch('/api/convert-epub-to-pdf', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let errText = 'Erreur lors de la conversion PDF.';
      try {
        const errData = await res.json();
        errText = errData.message || errText;
      } catch (e) {}
      throw new Error(errText);
    }
    return await res.blob();
  },

  // ==========================================
  
  // ==========================================
  // RESUME & HISTORY
  // ==========================================

  async resumeTranslation(payload) {
    const res = await fetch('/api/resume-translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errText = 'Erreur de reprise.';
      try {
        const errData = await res.json();
        errText = errData.message || errText;
      } catch(e) {}
      throw new Error(errText);
    }
    return await res.json();
  },

  async getHistory(jobsList) {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: jobsList })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  },

  // ==========================================
  // SSE CONNECTIONS
  // ==========================================

  connectSSE(jobId, callbacks) {
    const eventSource = new EventSource(`/api/translation-events/${jobId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data);
        if (callbacks.onMessage) callbacks.onMessage(job);
      } catch (e) {
        console.error('Erreur parsing SSE:', e);
      }
    };
    
    eventSource.onerror = (err) => {
      if (callbacks.onError) callbacks.onError(err);
    };

    return eventSource;
  },

    // ========================================================================
  // LIBRARY & READER API
  // ========================================================================

  async getLibrary() {
    try {
      const response = await fetch('/api/library');
      if (!response.ok) throw new Error('Erreur récupération bibliothèque');
      return await response.json();
    } catch (e) {
      console.error(e);
      throw e;
    }
  },

  async fetchEpubBlob(jobId, token) {
    try {
      const response = await fetch(`/api/download-job/${jobId}?token=${token}`);
      if (!response.ok) throw new Error('Erreur téléchargement EPUB pour liseuse');
      return await response.blob();
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
;

window.ApiClient = ApiClient;