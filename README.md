# Drift Hello World — Quickstart

Follow these steps in order:

```bash
# 1) Clone the repo
git clone <repo-url>
cd Drift-Hello-World

# 2) Use Node 20.18.0
proto use node 20.18.0 || nvm use 20.18.0

# 3) Install all dependencies
npm install

# 4) Run the sanity check (must pass ✅ ✅ before doing anything else)
npm run sanity

# 5) Start everything (backend + frontend + database)
npm run up

# 6) Open in browser:
# Backend:   http://localhost:3000   → should show { "ok": true }
# Frontend:  http://localhost:5173   → shows status, seed button, and link to backend

# (Optional) If you want to clear only test seed rows from the database:
npm --workspace backend run db:clear-seed
