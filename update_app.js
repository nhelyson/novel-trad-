const fs = require('fs');
let content = fs.readFileSync('C:/Users/japhet/Downloads/novel_trad/public/js/app.js', 'utf8');

const historyLogic = `

// ==========================================
// HISTORY & RESUME LOGIC
// ==========================================

function getSavedJobs() {
  try {
    return JSON.parse(localStorage.getItem('noveltrad_jobs') || '[]');
  } catch(e) { return []; }
}

function saveJobToHistory(jobId, secretToken) {
  const jobs = getSavedJobs();
  const existing = jobs.find(j => j.jobId === jobId);
  if (!existing) {
    jobs.push({ jobId, secretToken });
    localStorage.setItem('noveltrad_jobs', JSON.stringify(jobs));
  }
}

function removeJobFromHistory(jobId) {
  const jobs = getSavedJobs();
  const filtered = jobs.filter(j => j.jobId !== jobId);
  localStorage.setItem('noveltrad_jobs', JSON.stringify(filtered));
}

const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryModal = document.getElementById('closeHistoryModal');
const historyList = document.getElementById('historyList');

if (historyBtn) {
  historyBtn.addEventListener('click', async () => {
    historyModal.classList.remove('hidden');
    await refreshHistory();
  });
}
if (closeHistoryModal) {
  closeHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
}

async function refreshHistory() {
  historyList.innerHTML = '<div style="text-align:center; padding:2rem;">Chargement...</div>';
  const savedJobs = getSavedJobs();
  if (savedJobs.length === 0) {
    historyList.innerHTML = '<div style="text-align:center; color:#6b7280; padding:2rem;">Aucune traduction en attente.</div>';
    return;
  }

  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: savedJobs })
    });
    
    if (!res.ok) throw new Error('Erreur de chargement');
    const data = await res.json();
    
    // Clean up local storage for jobs that server said don't exist
    const validJobIds = data.jobs.map(j => j.jobId);
    savedJobs.forEach(sj => {
      if (!validJobIds.includes(sj.jobId)) removeJobFromHistory(sj.jobId);
    });

    if (data.jobs.length === 0) {
      historyList.innerHTML = '<div style="text-align:center; color:#6b7280; padding:2rem;">Aucune traduction en attente.</div>';
      return;
    }

    historyList.innerHTML = '';
    data.jobs.forEach(job => {
      const jobEl = document.createElement('div');
      jobEl.style = 'border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;';
      
      let statusIcon = '??';
      if (job.status === 'WAITING_FOR_KEY') statusIcon = '??';
      if (job.status === 'QUOTA_EXCEEDED') statusIcon = '??';
      if (job.status === 'PAUSED') statusIcon = '??';
      if (job.status === 'COMPLETED') statusIcon = '?';

      let lastAct = Math.round((Date.now() - job.lastUpdated) / 60000);
      let timeText = lastAct < 1 ? "à l\\'instant" : "il y a " + lastAct + " min";
      
      const savedJob = savedJobs.find(sj => sj.jobId === job.jobId);

      jobEl.innerHTML = \`
        <div style="font-weight:bold; font-size:1rem;">\${statusIcon} \${job.filename}</div>
        <div style="font-size:0.9rem; color:#4b5563;">Statut: \${job.statusMessage || job.status}</div>
        <div style="font-size:0.9rem; color:#4b5563;">Progression: \${job.progress}% (\${job.currentBlock} / \${job.totalBlocks})</div>
        <div style="font-size:0.8rem; color:#9ca3af;">Dernière activité: \${timeText}</div>
        <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
          \${job.canResume ? \\\`<button class="btn btn-primary" onclick="resumeJob('\\\$'{job.jobId}', '\\\$'{savedJob.secretToken}')">Reprendre</button>\\\` : ''}
          \${job.status === 'COMPLETED' ? \\\`<a class="btn btn-primary" href="/api/download-job/\\\$'{job.jobId}?token=\\\$'{savedJob.secretToken}">Télécharger</a>\\\` : ''}
        </div>
      \`;
      // Fix string interpolation inside template string:
      jobEl.innerHTML = jobEl.innerHTML.replace(/\\$'/g, '$');
      historyList.appendChild(jobEl);
    });

  } catch(e) {
    historyList.innerHTML = '<div style="text-align:center; color:#ef4444; padding:2rem;">Erreur de chargement de l\\'historique.</div>';
  }
}

window.resumeJob = async function(jobId, secretToken) {
  const newKey = prompt("Veuillez entrer une clé DeepL valide pour reprendre la traduction (laisser vide pour réutiliser l\\'actuelle):");
  if (newKey === null) return; // cancelled

  try {
    const res = await fetch('/api/resume-translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, secretToken, deeplApiKey: newKey.trim() })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erreur lors de la reprise');
    
    historyModal.classList.add('hidden');
    
    // Set UI to translating state
    document.getElementById('uploadContainer').classList.add('hidden');
    document.getElementById('progressContainer').classList.remove('hidden');
    document.getElementById('resultContainer').classList.add('hidden');
    currentJobId = jobId;
    connectSSE(jobId);

  } catch(e) {
    alert("Erreur: " + e.message);
  }
}
`;

// Insert the logic at the end of the file
if (!content.includes('HISTORY & RESUME LOGIC')) {
  content += historyLogic;
}

// Intercept error and header in fetch
const targetFetch = `const response = await fetch('/api/translate-document', {
        method: 'POST',
        body: formData
      });`;
      
const replaceFetch = `const response = await fetch('/api/translate-document', {
        method: 'POST',
        body: formData
      });
      
      const secToken = response.headers.get('X-Secret-Token');
      if (secToken && currentJobId) saveJobToHistory(currentJobId, secToken);`;

content = content.replace(targetFetch, replaceFetch);

const targetErr = `const errData = await response.json();
          errText = errData.message || errText;
        } catch (e) {}`;

const replaceErr = `const errData = await response.json();
          errText = errData.message || errText;
          if (errData.jobId && errData.secretToken) {
            saveJobToHistory(errData.jobId, errData.secretToken);
          }
        } catch (e) {}`;

content = content.replace(targetErr, replaceErr);

fs.writeFileSync('C:/Users/japhet/Downloads/novel_trad/public/js/app.js', content);
