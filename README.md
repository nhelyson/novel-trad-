# NovelTrad - Traduction PDF avec Préservation de la Mise en Page (DeepL API)

Application web légère et autonome développée en **Node.js** et **Express.js** permettant de traduire des documents PDF (livres, manuels, rapports) tout en **conservant à 100% la mise en page**, la pagination, les polices, les tableaux et la position des illustrations.

## 🚀 Fonctionnalités

- **Préservation Stricte de la Structure** : Utilise l'API DeepL Document Translation (`/v2/document`) pour remplacer le texte in-place sans déformer ni supprimer les images ou la mise en page d'origine.
- **Architecture Modulaire (Strategy Pattern)** : Couche de service (`services/translation/`) permettant d'interchanger le moteur de traduction (DeepL, Google Translation, OpenAI) facilement.
- **Traitement Éphémère & Sécurisé** : Traitement des fichiers PDF en mémoire RAM sans conservation sur disque ni base de données.
- **Interface Web Moderne** : Zone de glisser-déposer, sélection de la langue cible, clé API personnalisable, barre de progression et téléchargement direct.

## 🛠️ Stack Technique

- **Backend** : Node.js, Express.js, Multer, Axios, Dotenv, Cors
- **Frontend** : HTML5, CSS3 (Design System Glassmorphism, Dark/Light mode), JavaScript ES6

## 📦 Installation & Démarrage Local

1. Cloner le dépôt :
```bash
git clone https://github.com/nhelyson/novel-trad-.git
cd novel-trad-
```

2. Installer les dépendances Node.js :
```bash
npm install
```

3. (Optionnel) Configurer la clé DeepL API dans `.env` :
```bash
cp .env.example .env
```
Ajoutez votre clé API DeepL dans `.env` (`DEEPL_API_KEY=votre_cle_api`). Si vous ne la renseignez pas, l'utilisateur pourra la saisir directement dans l'interface web.

4. Lancer le serveur local :
```bash
npm start
```
L'application est disponible sur `http://localhost:3000`.

## 📄 Licence

MIT
