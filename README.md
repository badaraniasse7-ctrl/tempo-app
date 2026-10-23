# Tempo — Gestionnaire personnel du temps

Application responsive en HTML, CSS et JavaScript avec :
- tableau de bord et progression globale ;
- tâches avec priorité, statut, dates, heures, durée et projet ;
- vue calendrier journalière, hebdomadaire et mensuelle ;
- gestion de plusieurs projets ;
- bloc-notes avec recherche, autosauvegarde et lien vers un projet ;
- sauvegarde locale automatique ;
- option de synchronisation cloud via Supabase Auth + base de données protégée par RLS.

## Démarrer en local

1. Décompressez le dossier.
2. Ouvrez `index.html` dans un navigateur moderne. Pour de meilleurs résultats, servez le dossier avec un serveur local (par exemple l'extension Live Server de VS Code).
3. L'application fonctionne immédiatement en mode local.

Les données locales restent dans le navigateur utilisé. Exportez/sauvegardez régulièrement vos données importantes ; vider les données du navigateur peut les supprimer.

## Activer la synchronisation cloud

1. Créez un projet Supabase.
2. Dans Supabase > SQL Editor, exécutez le fichier `supabase-schema.sql`.
3. Dans Authentication, activez Email/Password et configurez la confirmation e-mail selon vos préférences.
4. Copiez l'URL du projet et la clé publique (publishable ou anon) depuis les paramètres API.
5. Dans Tempo, cliquez sur « Configuration cloud », renseignez l'URL et la clé publique, puis créez un compte ou connectez-vous.
6. Testez avec des données non sensibles avant usage réel.

### Sécurité et limites

- Ne placez jamais une clé `service_role` dans le code côté navigateur.
- Les tables utilisent Row Level Security (RLS) et limitent les lignes au compte connecté.
- Cette première version effectue une synchronisation complète des listes à chaque sauvegarde ; elle est destinée à un usage personnel léger, pas à un usage multi-utilisateur collaboratif.
- La toute première connexion avec un compte dont le cloud est vide importe les données locales. Si le cloud contient déjà des données, elles remplacent l'état local chargé par l'application.
- Le navigateur doit être en ligne pour la synchronisation cloud.
- La recherche globale affiche un résumé et ouvre la section correspondante ; elle n'est pas un moteur de recherche serveur.
- Le planning affiche les tâches sur chaque date couverte par leur période. La détection des chevauchements dépend des horaires et durées renseignés.
- Pour un déploiement public, servez l'application en HTTPS et envisagez une couche serveur/Edge Function pour une stratégie de synchronisation plus robuste.

## Fichiers

- `index.html` : structure de l'interface
- `style.css` : styles responsive
- `app.js` : fonctionnalités, stockage local et connecteur Supabase
- `supabase-schema.sql` : tables et politiques RLS
