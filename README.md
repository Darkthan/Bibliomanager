# Bibliomanager2

Gestionnaire de bibliothèque (WIP). Ce dépôt contient la structure de base, la documentation et les conventions pour démarrer rapidement. Reportez-vous à `AGENTS.md` pour les règles de contribution et à `STACK.md` pour la stack et l’environnement de dev.

## Démarrage rapide

- Installer la stack (voir `STACK.md`), puis:
- Développement: `npm run dev` (serveur sur `http://localhost:3000` par défaut)
- Tests: `npm test`
- Build: `npm run build`

## Structure du projet

```
src/            # Code applicatif (TypeScript)
tests/          # Tests (Vitest), miroir de src/
assets/         # Fichiers statiques
scripts/        # Scripts d’automatisation
docs/           # Documentation (architecture, ADRs)
.github/        # Workflows CI et templates
```

## Serveur et port

Le serveur HTTP intégré écoute sur la variable d’environnement `PORT` (défaut `3000`).

Exemple:

```sh
PORT=4000 npm run dev
```

## Versioning

Versionnement sémantique. Tant que le projet n’est pas en production, toutes les versions commencent par `0.x.x`. Première balise: `v0.1.0`.

## Liens utiles

- Contribution: voir `AGENTS.md`
- Stack & outillage: voir `STACK.md`
- Sécurité/config: voir `AGENTS.md` (section dédiée)
