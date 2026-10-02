# Devflow AI Services 🧠

The AI Services microservice handles the execution of autonomous agents and planning workflows. It coordinates specialized agents to analyze user project ideas, break down requirements, evaluate technical stack compatibility, estimate costs, assess project risks, and produce developer-friendly blueprints.

---

## 🛠️ Technology Stack

- **Framework**: FastAPI (Python 3.12-slim base image) running on Port **8001**
- **ASGI Server**: Uvicorn
- **AI Tooling Frameworks**: LangChain 1.x and LangGraph 1.x
- **Retrieval & Memory**: PostgreSQL/pgvector hybrid retrieval and durable agent memories
- **Provenance**: Agent runs and phase-level retrieval/tool/quality traces

## How generation works

There are two orchestration levels. `workflows/engine.py` is the outer business
workflow. It preserves the product-planning dependency order and emits streamed
events persisted by the backend:

```text
CEO
 └─ Product Manager
     └─ Architect
         └─ [Sprint Planner | Risk | Team Allocation]  (parallel)
             └─ [Timeline | Integration]               (parallel)
```

Agents in the same row run concurrently. Completed outputs are written into one
project context dictionary under `executive_summary`, `requirements`,
`architecture`, `backlog`, `risks`, `team`, `timeline`, and `integrations`.
Cost and architecture diagrams remain deterministic derived artifacts rather
than LLM output.

`workflows/agent_graph.py` is the inner LangGraph executed for every specialist:

```text
START
  │
  ▼
retrieve_context (LangChain tool)
  │
  ▼
hybrid RAG (project sources + memories)
  │
  ▼
specialist tools
  │
  ▼
generate (role prompt + Pydantic structured output)
  │
  ▼
review (semantic consistency gate)
  ├─ passed ───────────────► finish ─► END
  └─ material issues ──────► refine ─► END
```

### 1. Context retrieval

`tools/project_context.py` defines `select_project_context`, a LangChain tool
with an explicit dependency map. It gives each agent authoritative upstream
records instead of the entire mutable workflow state. For example, the
architect receives the original idea, executive summary, and complete
requirements; the timeline agent receives the executive estimate, architecture,
backlog, and team. Large presentation-only fields such as Mermaid and diagram
coordinates are removed. This provides substantially more grounding than the
older prompt-only summaries while avoiding irrelevant context. In addition,
`services/rag.py` runs a role-specific hybrid pgvector/full-text query over
uploaded sources, prior validated output, and distilled decisions. The SQL
always constrains both workspace and project, and every result has a stable
source citation recorded in `agent_run_steps`.

The existing compact summaries in `prompts/context.py` remain in the human
instruction. They emphasize the most important facts; the scoped JSON is the
lossless source of truth when the model needs acceptance criteria, task
dependencies, architectural decisions, or estimates omitted by the summary.

### 2. Typed generation with LangChain

`llm/langchain_client.py` adapts the existing OpenAI-compatible provider
configuration (Groq, Ollama, or OpenAI) to `ChatOpenAI`. Each graph uses
`with_structured_output(..., method="function_calling")`, so the model produces
the agent's Pydantic type directly. This is stricter than extracting JSON from
free-form text: malformed values are rejected at the model boundary and the
same schemas are still used by the API and downstream workflow.

Model selection and temperature remain centralized in `llm/router.py`. The
foundation agents can use `LLM_MODEL_SMART`, while parallel downstream agents
can use `LLM_MODEL_FAST`; `LLM_MODEL_<AGENT_ID>` still overrides an individual
agent.

### 3. Quality review and refinement

Schema validity only proves shape, not planning quality. A temperature-zero
reviewer therefore checks every draft against the request and scoped context for
material problems: contradictions, missing scope, broken cross-references,
implausible estimates, generic filler, and technology drift. It returns a typed
`QualityReview` with actionable issues.

Passing drafts finish immediately. Failed drafts get one focused refinement
pass with the original request, source context, candidate, and review issues.
The pass is bounded to prevent correction loops and unpredictable cost. If the
reviewer itself is unavailable, the already schema-valid draft is retained so a
secondary quality call cannot break the workflow. Set
`LLM_QUALITY_REVIEW=false` to skip this extra call when optimizing for cost or
latency.

### 4. Outer workflow resilience

`agents/base.py` is the stable bridge between the outer engine and LangGraph.
It builds the specialist graph, invokes it asynchronously, and converts the
final Pydantic object to JSON-compatible data. The engine continues to isolate
agent failures, update progress, stream node events, and run independent agents
in parallel. The project assistant also uses the same LangChain model adapter,
but remains a simple grounded chat because it does not need the planning graph.
No backend or frontend API contract changes are required.

---

## 📁 Directory Structure

The internal module structure isolates agent design patterns:

```
ai-services/
├── agents/             # Specialized AI Agent implementations (e.g. Risk AI, Cost Estimator)
├── llm/                # LangChain/OpenAI-compatible client and model routing
├── memory/             # Durable project/agent context and versioned output access
├── services/           # RAG, embeddings, evaluation, provenance, and helpers
├── tools/              # LangChain tools for scoped project-context retrieval
├── utils/              # Helper utilities (text parsers, cleanups)
├── workflows/          # Workflow definitions (Agent graphs and orchestrators)
├── main.py             # FastAPI entry point, exposing Swagger UI on Port 8001
│
├── Dockerfile          # Container setup
└── requirements.txt    # Declared Python library dependencies
```

---

## 🚦 Health Check & Swagger UI

To help test and monitor agent APIs, this service runs a FastAPI endpoint on port `8001`.

- **Swagger UI**: Visit `http://localhost:8001/docs` in your browser.
- **Health Endpoint**: Test service health with `GET /health`.

#### Health Response format:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 150.2,
  "dependencies": {
    "database": "healthy",
    "rag": "healthy",
    "llm": "healthy (Groq Cloud - openai/gpt-oss-120b)"
  }
}
```

---

## 🚀 Local Development Setup (Without Docker)

To run the AI services locally:

### 1. Environment Configuration

Ensure `ai-services/.env` or the root `.env` contains:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@[YOUR-HOST]:5432/postgres
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key
LLM_MODEL=openai/gpt-oss-120b
LLM_MODEL_SMART=openai/gpt-oss-120b
LLM_MODEL_FAST=openai/gpt-oss-20b
LLM_QUALITY_REVIEW=false
```

### 2. Set Up Virtual Environment

```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Run the Service

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
# or from root: make local-ai
```

The server will begin listening on `http://localhost:8001`. You can access the Swagger UI at `http://localhost:8001/docs`.
