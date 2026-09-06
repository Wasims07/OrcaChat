# Contributing to OrcaChat

First off, thanks for taking the time to contribute! ❤️

OrcaChat is a privacy-first AI chat that runs on your device and keeps conversations local. Please read through this guide before opening issues or pull requests. By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Privacy & Security Rules](#privacy--security-rules)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

We expect everyone participating in this project to be respectful and constructive. Harassment, discrimination, or abusive behavior of any kind will not be tolerated.

**The golden rule:** conversations, model keys, and user data that flow through OrcaChat are private. Treat contributor discussions the same way.

## Getting Started

### Prerequisites

- Node.js **20+** (24.x recommended)
- npm
- (Optional) A Redis instance for cache + distributed rate limiting — an in-memory fallback is used automatically if unset

### First-time setup

```bash
# 1. Fork the repository on GitHub
# 2. Clone your fork
git clone https://github.com/<your-username>/OrcaChat.git
cd OrcaChat

# 3. Add the upstream remote
git remote add upstream https://github.com/Wasims07/OrcaChat.git

# 4. Install dependencies
npm install

# 5. Copy the environment template (fill in keys as needed)
cp .env.example .env.local

# 6. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the built-in free tier works without any API keys.

## Development Workflow

1. **Sync your fork** before starting:

   ```bash
   git fetch upstream
   git checkout main
   git pull upstream main
   ```

2. **Create a feature branch** from the latest `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

   Use a short, descriptive branch name: `fix/sidebar-close`, `feat/chat-export`, `docs/roadmap`.

3. **Make changes** — keep them focused and reviewable. One logical change per branch.

4. **Run checks locally** before pushing:

   ```bash
   npm run lint   # ESLint
   npm run test   # Vitest unit tests
   npm run build  # Production build
   ```

5. **Commit** using the [Commit Conventions](#commit-conventions) below, then push and open a pull request.

## Project Structure

```
app/
├── api/              # Route handlers (chat, verify, parse-pdf, preview-file, healthz)
├── layout.tsx        # Root layout, fonts, PWA metadata
└── page.tsx          # Main chat shell
components/
├── Chat/             # Input, chat window, markdown renderer, previews
├── Sidebar/          # History, model manager, guide, user menu
├── Settings/         # Settings + privacy notice modal
└── UI/               # Shared UI primitives
lib/                  # Crypto, storage, security, providers, OCR, language detection
__tests__/            # Vitest unit tests (storage, auto-delete, boundaries, pinning)
```

Keep related files with their feature area — e.g. new chat logic goes in `components/Chat/`, new client utilities in `lib/`, new endpoints in `app/api/`.

## Coding Standards

- **TypeScript everywhere** — write strongly-typed code; avoid `any` unless there's a documented reason.
- **Match existing style** — follow the patterns already present in the file you're editing (naming, component structure, import order).
- **No unrequested comments** — code should be self-explanatory. Only add comments when they explain *why*, not *what*.
- **Follow the existing conventions** — React 19 + Next.js App Router, Tailwind CSS 4, lucide-react icons.
- **No external dependencies without discussion** — if a new library is needed, explain why in the PR description.
- **Security-sensitive code** — never log, print, or persist API keys, tokens, or message content. See [Privacy & Security Rules](#privacy--security-rules).

## Testing

The project uses [Vitest](https://vitest.dev) with a real IndexedDB implementation (`fake-indexeddb`).

```bash
npm test        # Run the full suite
npm run test    # (alias for the above)
```

When you add or change logic, **add or update tests**. The existing suite covers:

- Chat storage round-trips
- Session auto-delete and pinning
- Free-tier boundaries
- Crypto round-trips

Any PR that changes behavior without tests will likely be sent back for updates.

## Commit Conventions

We follow **Conventional Commits**. Use a concise imperative subject line under 72 characters:

| Prefix    | Use for                                   | Example                                   |
| --------- | ----------------------------------------- | ----------------------------------------- |
| `feat:`   | New features or user-visible additions    | `feat: add chat export to Markdown`       |
| `fix:`    | Bug fixes                                 | `fix: clamp model dropdown on mobile`     |
| `docs:`   | Documentation only (README, guides, JSDoc)| `docs: add CONTRIBUTING guide`            |
| `chore:`  | Maintenance, tooling, CI, deps            | `chore: pin redis adapter version`        |
| `refactor:`| Code changes with no behavior change      | `refactor: extract web search client`     |
| `test:`   | Adding/fixing tests                       | `test: cover chat auto-delete window`     |
| `perf:`   | Performance improvements                  | `perf: lazy-load tesseract workers`       |

**Example:**

```
fix: clamp model selector dropdown to viewport on mobile

The dropdown overflowed the viewport on small screens.
Added a max-height and overflow-y scroll.
```

- One commit per logical change.
- Do **not** commit generated files, `.env.local`, or any real API keys.

## Pull Request Process

1. **Open a PR** against the `main` branch with a clear title (`feat: …`, `fix: …`, `docs: …`).
2. In the description, explain **what** changed and **why**, plus how you tested it.
3. Reference any related issue (`Fixes #12`).
4. Ensure CI checks pass: ESLint, Vitest, and a production build.
5. Keep the PR small. If it grows beyond one concern, split it into multiple PRs.
6. Be responsive to review comments — incorporate feedback, then re-request review.

Your PR will be reviewed, and once approved and merged it lands on `main`.

## Privacy & Security Rules

These rules are **non-negotiable** given the project's privacy-first identity:

- **Never** log or store API keys, tokens, or message content server-side. Custom model keys are verified server-side but live **only** in the browser, encrypted with AES-256-GCM.
- New endpoints must add **input validation** (see `lib/apiValidation.ts`) and respect existing **rate limiting** (see `lib/redisRateLimiter.ts`).
- Keep the **optional audit log** metadata-only and encrypted — never include message content.
- Preserve existing security headers: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- If your change touches crypto (`lib/chatCrypto.ts`, `lib/security.ts`), add or update crypto round-trip tests.

## Reporting Issues

- **Search first** — check existing issues and discussions to avoid duplicates.
- **Use a clear title** and describe:
  - Steps to reproduce
  - Expected vs. actual behavior
  - Environment (OS, browser, Node version, self-hosted vs. hosted, any model/provider involved)
  - Screenshots or console output if relevant
- **Never include real API keys or conversation content** in an issue.

Thanks again for helping make OrcaChat better! 🐋