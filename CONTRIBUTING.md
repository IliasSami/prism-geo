# Contributing to PrismGEO

Thank you for your interest in contributing to **PrismGEO**, the open-source Generative Engine Optimization (GEO) & AI Visibility Suite!

## Development Guidelines

1. **Monorepo Layout:**
   - `apps/web`: Next.js 15 (App Router) user interface and dashboard.
   - `packages/core`: Mathematical formulations, Monte Carlo calculators, reverse-RAG parsing.
   - `packages/crawler`: Stealth Playwright engine, browser fingerprinting, and search engine adapters.
   - `packages/db`: SQLite schema and data persistence layer with WAL mode.

2. **Branching & Commits:**
   - Fork the repository and create your branch from `main`.
   - Use descriptive commit messages following the Conventional Commits specification (e.g. `feat: add DuckDuckGo AI Overviews support`, `fix: Wilson confidence interval edge case`).

3. **Running Locally:**
   ```bash
   pnpm install
   pnpm build
   pnpm dev
   ```

4. **Testing & Type Safety:**
   - Always run `pnpm build` before submitting a PR to ensure 100% clean TypeScript builds without warnings or errors.

5. **Submitting a Pull Request:**
   - Push your branch to your fork.
   - Open a pull request against `main` on GitHub with a clear summary of your changes and motivation.
