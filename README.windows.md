# Devflow — Running on Windows

This guide covers running Devflow on **Windows 10/11** using **PowerShell**. `make` is not available by default on Windows, so every command below uses plain `python`, `npm`, and `docker`.

Devflow has three services:

| Service | Port | Folder |
| --- | --- | --- |
| Frontend (Next.js) | 3000 | `frontend` |
| Backend (FastAPI) | 8000 | `backend` |
| AI Services (FastAPI) | 8001 | `ai-services` |

---

## 1. Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Python | 3.10+ (3.11/3.12 recommended) | `python --version` |
| Node.js | 18+ (20 recommended) | `node --version` |
| Git | any | `git --version` |
| Docker Desktop | *only for Docker mode* | `docker --version` |

You also need:
- A **PostgreSQL / Supabase** connection string (`DATABASE_URL`). The `pgvector` extension must be available.
- A **Groq API key** (`GROQ_API_KEY`) — free at https://console.groq.com

> [!TIP]
> When installing Python, tick **"Add python.exe to PATH"**. If `python` isn't found, try `py` instead.

---

## 2. Configure environment

From the project root (`DevFlow`):

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set at least:

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
GROQ_API_KEY=gsk_your_key_here

NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# Native (non-Docker) run -> use localhost
AI_SERVICES_URL=http://localhost:8001

# Local testing without Clerk login
BYPASS_AUTH=true
NEXT_PUBLIC_BYPASS_AUTH=true
```

> [!IMPORTANT]
> - `AI_SERVICES_URL` must be `http://localhost:8001` for native mode and `http://ai-services:8001` for Docker mode.
> - To use Clerk login instead of bypass, set `BYPASS_AUTH=false`, `NEXT_PUBLIC_BYPASS_AUTH=false`, and fill in `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_ISSUER_URL`.

The Next.js frontend reads its variables from `frontend\.env`. Make sure it contains the `NEXT_PUBLIC_*` values too:

```powershell
@"
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_BYPASS_AUTH=true
"@ | Set-Content frontend\.env
```

(Skip this if `frontend\.env` already exists and is configured. Add the Clerk keys there if you use Clerk.)

---

## 3. Option A — Run natively (no Docker)

### 3.1 Allow virtual-environment activation (one time)

If you get *"running scripts is disabled on this system"*:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 3.2 Install dependencies

Run from the project root:

```powershell
# Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# AI Services
cd ai-services
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..
```

### 3.3 Start the services

Open **three separate PowerShell windows**, each at the project root.

**Terminal 1 — Backend (:8000)**
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — AI Services (:8001)**
```powershell
cd ai-services
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

**Terminal 3 — Frontend (:3000)**
```powershell
cd frontend
npm run dev -- -p 3000
```

Open **http://localhost:3000**.

> [!NOTE]
> Database tables and indexes are created automatically on backend startup.

---

## 4. Option B — Run with Docker Desktop

1. Install and start **Docker Desktop** (WSL 2 backend recommended).
2. In `.env`, set `AI_SERVICES_URL=http://ai-services:8001`.
3. From the project root:

```powershell
docker compose up --build --detach --wait   # build and start
docker compose ps                           # status
docker compose logs -f                      # tail logs
docker compose down --remove-orphans        # stop
```

---

## 5. Verify it works

| What | URL |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend Swagger | http://localhost:8000/docs |
| AI Services Swagger | http://localhost:8001/docs |

Health checks in PowerShell:

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8001/health
```

---

## 6. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Activate.ps1 cannot be loaded` | Run the `Set-ExecutionPolicy` command in 3.1, or use `.\.venv\Scripts\activate.bat` in `cmd`. |
| `python` not recognized | Reinstall Python with *Add to PATH*, or use `py -m venv .venv`. |
| Port already in use | Find it: `netstat -ano \| findstr :8000`, then `taskkill /PID <pid> /F`. |
| `pip install` fails building a package | Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or use Python 3.11/3.12. |
| Backend can't reach the database | Check `DATABASE_URL`, that your IP is allowed in Supabase, and that `pgvector` is enabled. |
| Frontend can't reach the API | Confirm `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` in `frontend\.env`, then restart `npm run dev`. |
| CORS errors | Add your frontend origin to `CORS_ORIGINS` in `.env`. |
| LLM errors / 401 | Verify `GROQ_API_KEY`; restart the AI service after editing `.env`. |
| Docker: *"ai-services unhealthy"* | Run `docker compose logs ai-services`; usually a missing `DATABASE_URL` or API key. |
| Line-ending problems in Docker | `git config core.autocrlf input`, then re-clone. |

---

## 7. Optional: use `make` on Windows

Install via `winget install GnuWin32.Make` or `choco install make`, then `make local-backend`, `make local-ai`, `make local-frontend`. Note the Makefile calls `uvicorn` directly, so activate the matching venv first.
