const TextNormalizer = require('./services/library/TextNormalizer');

const files = [
  '633425674-86-EIGHTY-SIX-Volume-11 - Traduction Officielle_FR (3).pdf',
  '633425674-86-EIGHTY-SIX-Volume-11_fr.pdf',
  '86 - EIGHTY-SIX Alter - Vol. 1_fr.epub',
  '86 - EIGHTY-SIX Alter - Vol. 2_fr.epub',
  '86--EIGHTY-SIX Volume-4_fr.epub',
  '951962929-86-Eighty-Six-Volume-12-PDF-Room_fr.pdf',
  'Book 11 - Resistance_fr.epub',
  'Classroom of the Elite - Y3V2 _fr.epub',
  'Classroom of the Elite - Year 3 - Vol. 1_fr.epub',
  'Classroom of the Elite Y3V3_fr.epub',
  'Classroom of the Elite Y3V4_fr.epub',
  'Classroom of the Elite_ Year 2 Vol. 12.epub',
  'Classroom of the Elite_ Year 2 Vol. 12_fr.epub',
  'Fullmetal Alchemist - The Land of Sand_fr (1).epub',
  'Fullmetal Alchemist - The Land of Sand_fr.epub',
  'Miss Medic Diary at War Volume 1_fr.epub',
  'Miss Medic Diary at War Volume 2_fr.epub',
  'Mushoku Tensei - Redundant Reincarnation - Vol. 1_fr.epub',
  'Mushoku Tensei - Redundant Reincarnation - Volume 2_fr.epub',
  'Mushoku Tensei Redundant Reincarnation Vol. 3_fr.epub',
  'Naruto Hiden - Vol. 1.epub',
  'Naruto Hiden - Vol. 1_fr.epub',
  'Rascal Does Not Dream of Extra Stories_fr.epub',
  'Riviere and the Land of Prayer - Volume 1_fr.epub',
  'Sasuke Story - The Uchiha and the Heavenly Stardust.epub',
  'Sasuke Story - The Uchiha and the Heavenly Stardust_fr (1).epub',
  'Sasuke Story - The Uchiha and the Heavenly Stardust_fr.epub',
  'Sentenced to Be a Hero - Volume 1_fr.epub',
  'Shimoneta Vol 1_fr.epub',
  'Shimoneta Vol 2_fr.epub',
  'Shimoneta Vol 3_fr.epub',
  'Shimoneta Vol 4_fr.epub',
  'You Are My Regret - Vol. 1_fr.epub',
];

const groups = {};
files.forEach(f => {
  const p = TextNormalizer.parseFilename(f);
  const id = TextNormalizer.generateSeriesId(p.seriesTitle);
  if (!groups[id]) groups[id] = { title: p.seriesTitle, vols: [] };
  groups[id].vols.push({ file: f, vol: p.volumeNumber, spinoff: p.spinoffLabel, sub: p.subseriesLabel });
});

console.log('=== GROUPEMENT FINAL ===\n');
let ok = 0, issue = 0;
Object.entries(groups).sort((a,b) => b[1].vols.length - a[1].vols.length).forEach(([id, data]) => {
  const mark = data.vols.length > 1 ? 'OK' : '??';
  if (data.vols.length > 1) ok++; else issue++;
  console.log(mark + ' ' + data.title + ' [' + id + '] => ' + data.vols.length + ' vol(s)');
  data.vols.forEach(v => {
    let info = '   Vol.' + (v.vol !== null ? v.vol : '?');
    if (v.spinoff) info += ' [Spinoff:' + v.spinoff + ']';
    if (v.sub) info += ' [Arc:' + v.sub + ']';
    console.log(info + ' | ' + v.file);
  });
  console.log('');
});
console.log('Series OK (multi-vols):', ok, '| Singletons:', issue);
