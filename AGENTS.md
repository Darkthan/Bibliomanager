# Agent Guidelines

This guide helps contributors work consistently and efficiently on this repository.  
It favors small, verifiable changes and clear developer ergonomics.

## Project Structure & Module Organization

- Root layout:
  - `src/api/` → Express backend (modular services: books, patrons, loans, print, auth)
  - `src/web/` → React frontend (Vite, PWA)
  - `src/worker/` → BullMQ workers
  - `tests/` → mirrors `src/`
  - `assets/` → static files
  - `scripts/` → dev/CI helpers (migrations, seeds, print examples)
  - `docs/` → notes (workflows, RFID setup)
  - `.github/workflows/` → CI pipelines

- Keep modules cohesive and shallow.  
- Example: `src/api/books/service.ts` → `tests/api/books/service.spec.ts`.

## Build, Test, and Development Commands

- Development:
  - Backend: `npm run dev` (Express + Nodemon)
  - Frontend: `npm run dev` (Vite)
  - Worker: `npm run worker:dev`
- Build:
  - Backend: `npm run build`
  - Frontend: `npm run build`
- Test:
  - `npm test` (Jest)
  - `npm run test:e2e` (Playwright)
- Lint/Format:
  - `npm run lint`
  - `npm run format`

## Coding Style & Naming Conventions

- Files/dirs: `kebab-case` (frontend), `camelCase` or `snake_case` (backend code), consistent within a folder.
- Classes: `PascalCase`.
- Functions/vars: `camelCase`.
- Indentation: 2 spaces.  
- Max line length: 100 chars. No trailing whitespace.
- Tools:
  - ESLint + Prettier (JS/TS)
- Run formatters before committing.

## Testing Guidelines

- `tests/` mirrors `src/`.
- Unit tests: Jest (`*.spec.ts`).
- Integration tests: API endpoints, DB (Postgres), queue jobs (BullMQ), printer service.
- Coverage: ≥ 80% for changed code.
- Run locally: `npm test -- --coverage`.

## Commit & Pull Request Guidelines

- Commits: Conventional Commits where possible:
  - `feat: add ISBN import service`
  - `fix: correct RFID ZPL encoding`
  - `docs: update README with DMZ setup`
- PRs:
  - clear summary + linked issues (`Closes #123`)
  - screenshots/GIFs for UI changes
  - notes on testing/rollback
  - must pass lint, tests, build

## Security & Configuration Tips

- Never commit secrets.
- Use `.env` for configs; provide `.env.example` with safe defaults.
- Add sensitive files to `.gitignore`.
- Validate and sanitize external inputs (ISBN, metadata APIs).
- ORM (Prisma) for DB queries → prevents SQL injection.
- Printer service: validate ZPL payloads before sending to Zebra.

## Agent-Specific Instructions

- Prefer minimal diffs, consistent with repo tooling.
- Update docs (`README.md`, `docs/`) when behavior changes.
- Extend `package.json` scripts for discoverability.
- Keep Dockerfiles and `docker-compose.yml` reproducible.
- Document RFID/Zebra usage in `docs/print.md`.
