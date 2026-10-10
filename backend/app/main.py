import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.api.projects import agents_router, router as projects_router
from app.api.github import router as github_router
from app.api.stream import router as stream_router
from app.api.users import router as users_router
from app.api.workspaces import router as workspaces_router
from app.core.config import settings
from app.core.logging import get_logger
from app.db.postgres import close_postgres, init_postgres, pool
from app.orchestrator.manager import start_workers, stop_workers
from app.services.ai_client import ai_services
from app.services.github_tracker import start_poller, stop_poller

logger = get_logger("main")
START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Devflow backend starting")
    await init_postgres()
    start_workers()
    start_poller()
    logger.info("Orchestrator workers started (%d)", settings.worker_count)
    yield
    await stop_poller()
    await stop_workers()
    await close_postgres()
    logger.info("Devflow backend shut down")


app = FastAPI(
    title="Devflow Backend API",
    description="Orchestration layer for the Devflow AI SDLC platform",
    version=settings.app_version,
    docs_url=None,
    lifespan=lifespan,
)

# Project documents are large JSON; compressing them cuts transfer ~5-10x.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(agents_router)
app.include_router(stream_router)
app.include_router(users_router)
app.include_router(workspaces_router)
app.include_router(github_router)
from app.api.rbac import router as rbac_router
app.include_router(rbac_router)


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    response = get_swagger_ui_html(openapi_url=app.openapi_url, title=app.title + " - Swagger UI")
    dark_css = """
    <style>
        html { filter: invert(90%) hue-rotate(180deg); background-color: white; }
        img, svg { filter: invert(100%) hue-rotate(180deg); }
        .swagger-ui .microlight { filter: invert(100%) hue-rotate(180deg); }
    </style>
    """
    html_content = response.body.decode("utf-8").replace("</head>", f"{dark_css}</head>")
    return HTMLResponse(content=html_content, status_code=response.status_code)


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    dependencies: dict


@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health_check():
    dependencies = {"database": "unknown", "rag_index": "unknown", "ai_services": "unknown"}
    try:
        async with pool().acquire() as conn:
            await conn.fetchval("SELECT 1")
        dependencies["database"] = "healthy"
        async with pool().acquire() as conn:
            vector_ready = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')"
            )
            rag_tables = await conn.fetchval(
                """SELECT count(*)=6 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name IN
                     ('project_documents','knowledge_chunks','project_memories',
                      'agent_runs','orchestration_jobs','orchestration_events')"""
            )
        dependencies["rag_index"] = "healthy" if vector_ready and rag_tables else "unhealthy: RAG schema missing"
    except Exception as e:
        dependencies["database"] = f"unhealthy: {str(e)}"
        dependencies["rag_index"] = f"unhealthy: {str(e)}"

    try:
        ai_health = await ai_services.health()
        dependencies["ai_services"] = "healthy" if ai_health.get("status") in ("healthy", "ok", "degraded") else "unhealthy"
    except Exception as e:
        dependencies["ai_services"] = f"unhealthy: {str(e)}"

    overall = "degraded" if any("unhealthy" in v for v in dependencies.values()) else "healthy"
    return HealthResponse(
        status=overall, version=settings.app_version, uptime_seconds=time.time() - START_TIME, dependencies=dependencies
    )


@app.get("/")
async def root():
    return {"message": "Devflow Backend API. See /docs for API documentation."}
