# STACK

Stack de référence pour Bibliomanager2 (monorepo simple, TypeScript/Node.js).

## Outils

- Node.js >= 18
- TypeScript, tsx (exécution TS), Vitest (tests)
- ESLint + @typescript-eslint, Prettier

## Installation (local)

```sh
npm install -D typescript tsx vitest eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

## Scripts

- `npm run dev`: lance `src/index.ts` en watch via tsx.
- `npm run build`: transpile TS vers `dist/` avec `tsc`.
- `npm test`: exécute Vitest en mode CLI.
- `npm run lint` / `npm run format`: vérif/format du code.

## Structure

```
src/      # modules applicatifs (feature-first)
tests/    # tests unitaires/intégration (mirroir de src)
assets/   # ressources statiques
scripts/  # scripts d’outillage
docs/     # docs d’architecture/ADRs
```

## CI (optionnel)

Une CI Node peut:
- installer les devDeps,
- exécuter `npm run lint`, `npm run build`, `npm test`.

## Versioning

SemVer. Avant prod: `0.x.x`. Première version: `0.1.0`.
