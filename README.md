# ASTRAG

ASTRAG is a small, local-first MVP that indexes a code folder into **chunks + metadata + embeddings**, then lets you query it and inspect a **multi-stage retrieval trace**:

- lexical hits
- semantic hits (local embeddings)
- fusion (RRF)
- rerank

## Quick start

### Prerequisites

- Node.js (recommended: 18+)
- npm

### Run

From the repo root:

```bash
./start.sh
```

Then open:

- Frontend: `http://localhost:5173/`
- Backend: `http://localhost:8787/`

## What’s included

- **Backend** (`backend/`)
  - Project registry: create/list projects that point to a local folder path
  - Indexer: chunks files (TypeScript AST where possible, with a window fallback), stores into SQLite, and computes embeddings
  - Search: hybrid lexical + semantic retrieval with RRF fusion and an explainable trace
- **Frontend** (`frontend/`)
  - Create/select project
  - Start indexing + live progress
  - Query UI + retrieval trace panels

## Data storage (important for public repos)

ASTRAG stores per-project data (including local absolute paths and the SQLite index/embeddings) in a workspace-local folder:

- `.astrag/` (and also `backend/.astrag/` if you run the backend from that directory)

This repo’s `.gitignore` excludes these folders so you don’t accidentally publish them.

## API (backend)

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects` `{ name, rootPath }`
- `POST /api/projects/:projectId/index`
- `GET /api/projects/:projectId/index/status`
- `POST /api/projects/:projectId/search` `{ query, topK? }`

