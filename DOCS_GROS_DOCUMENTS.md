# Documentation Technique — Mode Gros Document (PDF > 10 Mo) sur NovelTrad

## 1. Problème Identifié & Cause Exacte
Lorsqu'un utilisateur soumettait un roman ou document PDF dépassant 10 Mo, l'API DeepL Document Translation rejetait la requête avec l'erreur suivante :
> `Échec de l'envoi du document à DeepL : Document exceeds the size limit of 10 MB.`

L'ancienne implémentation envoyait le fichier PDF complet en une seule requête `POST /v2/document`, provoquant un rejet direct par les serveurs de DeepL.

---

## 2. Solution Implémentée

### Ancienne Méthode
```text
PDF (15-50 MB) ──> Envoi unique DeepL ──> Rejet 400 Bad Request (Taille > 10 MB)
```

### Nouvelle Méthode (Mode Gros Document)
```text
PDF (15-50 MB)
      │
      ▼
Taille > 9.5 Mo ?
      │
      ├─► NON : Traitement direct via l'API DeepL Document (Fichiers standard)
      │
      └─► OUI : Activation automatique du Mode Gros Document
            │
            ├─ 1. Chargement et analyse du PDF source avec `pdf-lib`
            ├─ 2. Découpage intelligent par lots de pages (ex: ~6.5 Mo / lot)
            │      Chaque lot est un vrai PDF conservant 100% des images/vectors.
            ├─ 3. Envoi séquentiel de chaque lot à l'API DeepL Document
            │      (Logique de réessai avec jusqu'à 3 tentatives par lot)
            └─ 4. Fusion et reconstruction du PDF final avec `pdf-lib`
```

---

## 3. Preservation de la Mise en Page & des Illustrations
Contrairement aux approches destructives (extraction du texte brut -> régénération d'un PDF vierge), NovelTrad utilise le **découpage vectoriel natif de PDF avec `pdf-lib`** :
* Les images, illustrations, filigranes et graphiques sont conservés **intacts**.
* Les dimensions de chaque page, les marges, les en-têtes et les pieds de page restent **strictement identiques**.
* DeepL traduit le texte à l'intérieur de la structure PDF originale de chaque lot.

---

## 4. Fichiers Modifiés & Bibliothèques Ajoutées

### Bibliothèques Ajoutées
* **`pdf-lib`** (`^1.17.1`) : Manipulation, découpage et fusion purement en JavaScript/Node.js (sans dépendance binaire externe, parfaitement compatible avec Render).

### Fichiers Modifiés
1. **[package.json](file:///C:/Users/japhet/Downloads/novel_trad/package.json)** : Ajout de la dépendance `pdf-lib`.
2. **[services/translation/DeepLProvider.js](file:///C:/Users/japhet/Downloads/novel_trad/services/translation/DeepLProvider.js)** :
   - Méthode `translateDocument()` : Détection automatique des fichiers > 9.5 Mo ou réessaie automatique si DeepL renvoie une erreur de limite de taille.
   - Méthode `splitAndTranslateLargePdf()` : Découpage intelligent des pages, envoi par lots avec réessai (`retry`), rapport de progression en temps réel, et fusion finale.
   - Méthode `translateSingleDocumentChunk()` : Envoi unitaire des sous-PDFs à l'API DeepL.
3. **[public/js/app.js](file:///C:/Users/japhet/Downloads/novel_trad/public/js/app.js)** :
   - Détection dès la sélection du fichier et affichage du badge `⚡ Mode Gros Document (Lots & Images)`.
   - Animation des étapes de progression adaptées aux gros volumes.
4. **[tests/test_large_pdf.js](file:///C:/Users/japhet/Downloads/novel_trad/tests/test_large_pdf.js)** *(Nouveau)* : Suite de tests automatisés couvrant les PDF courts, les gros PDF (> 10 Mo), le découpage, la fusion et le pipeline complet.

---

## 5. Variables d'Environnement Nécessaires
Les variables d'environnement existantes restent inchangées :
* `DEEPL_API_KEY` : Clé API DeepL (Free ou Pro).
* `DEEPL_API_TYPE` : `free` (par défaut) ou `pro`.
* `PORT` : Port d'écoute Express (défini automatiquement par Render).

---

## 6. Tests Réalisés & Validés
Le script de test [tests/test_large_pdf.js](file:///C:/Users/japhet/Downloads/novel_trad/tests/test_large_pdf.js) a été exécuté avec succès :
* **Test 1** : Petit PDF (< 9.5 Mo) ──► Traitement direct validé.
* **Test 2** : Gros PDF (11 Mo) ──► Détection automatique du Mode Gros Document validée.
* **Test 3** : Découpage et Fusion ──► 15 pages fusionnées sans aucune perte ni altération de la structure.
* **Test 4** : Pipeline complet par lots ──► Simulation DeepL par lots validée avec statut 100%.
