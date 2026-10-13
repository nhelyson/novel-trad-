const fs = require('fs');
const path = require('path');
let content = fs.readFileSync('C:/Users/japhet/Downloads/novel_trad/services/pdf/DocumentProcessor.js', 'utf8');

const regex = /const translatedPartBuffers = \[\];[\s\S]*?translatedPartBuffers\.push\(translatedPart\);\s*\n\s*\}/m;
const newLoop = `
        const translatedPartBuffers = [];
        const fs = require('fs');
        const path = require('path');
        const jobDir = DiskJobStore.getJobDir(effectiveDocId);

        for (let i = 0; i < totalParts; i++) {
          const part = parts[i];
          const partNum = i + 1;
          const partFilename = 'part_' + partNum + '.pdf';
          const partFilePath = path.join(jobDir, partFilename);
          
          DiskJobStore.setTranslationProgress(
            effectiveDocId,
            partNum,
            totalParts,
            \`Traduction lot : \${partNum} / \${totalParts} (\${part.title})\`
          );

          let translatedPart;
          if (fs.existsSync(partFilePath)) {
            translatedPart = fs.readFileSync(partFilePath);
            if (onProgress) onProgress(\`Lot \${partNum}/\${totalParts} (\${part.title}) : Récupéré du cache (Reprise)\`, Math.round(15 + (i / totalParts) * 75 + (100 / 100) * (75 / totalParts)));
          } else {
            translatedPart = await translator.translateDocument(
              part.buffer,
              targetLang,
              sourceLang,
              apiKey,
              (statusText, subPct) => {
                if (onProgress) onProgress(\`Lot \${partNum}/\${totalParts} (\${part.title}) : \${statusText}\`, Math.round(15 + (i / totalParts) * 75 + (subPct / 100) * (75 / totalParts)));
              }
            );
            fs.writeFileSync(partFilePath, translatedPart);
          }

          translatedPartBuffers.push(translatedPart);
        }
`;

content = content.replace(regex, newLoop.trim());

fs.writeFileSync('C:/Users/japhet/Downloads/novel_trad/services/pdf/DocumentProcessor.js', content);
