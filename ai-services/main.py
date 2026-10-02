import os
import time
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
import uvicorn
from fastapi import FastAPI, status
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from api.routes import router as api_router
from services.db_client import close_db, get_db_pool
from utils.env import load_runtime_env
from utils.logging import get_logger

load_runtime_env()

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ai-services starting (provider=%s, model=%s)",
                os.getenv("LLM_PROVIDER", "groq"), os.getenv("LLM_MODEL", "openai/gpt-oss-120b"))
    yield
    await close_db()
    logger.info("ai-services shut down")


app = FastAPI(
    title="Devflow AI Services API",
    description="AI orchestration and agent services for Devflow",
    version="1.0.0",
    docs_url=None,
    lifespan=lifespan,
)

app.include_router(api_router)


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


APP_VERSION = "1.0.0"
START_TIME = time.time()


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    dependencies: dict


@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health_check():
    dependencies = {"database": "unknown", "rag": "unknown", "llm": "unknown"}

    try:
        pool = await get_db_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
                vector_ready = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')"
                )
                chunks_ready = await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM information_schema.tables
                       WHERE table_schema='public' AND table_name='knowledge_chunks')"""
                )
            dependencies["database"] = "healthy"
            dependencies["rag"] = "healthy" if vector_ready and chunks_ready else "unhealthy: RAG schema missing"
        else:
            dependencies["database"] = "unhealthy: database pool unavailable"
            dependencies["rag"] = "unhealthy: database pool unavailable"
    except Exception as e:
        dependencies["database"] = f"unhealthy: {str(e)}"
        dependencies["rag"] = f"unhealthy: {str(e)}"

    LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
    OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
    LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")

    if LLM_PROVIDER.lower() == "ollama":
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags")
                if resp.status_code == 200:
                    available = [m.get("name", "") for m in resp.json().get("models", [])]
                    if any(LLM_MODEL in name for name in available):
                        dependencies["llm"] = f"healthy (Ollama - {LLM_MODEL} loaded)"
                    else:
                        dependencies["llm"] = (
                            f"degraded (Ollama up but '{LLM_MODEL}' not pulled. Available: {available})"
                        )
                else:
                    dependencies["llm"] = f"unhealthy: Ollama status {resp.status_code}"
        except Exception as e:
            dependencies["llm"] = f"unhealthy: cannot reach Ollama at {OLLAMA_BASE_URL} ({str(e)})"
    elif LLM_PROVIDER.lower() == "groq":
        has_key = bool(os.getenv("GROQ_API_KEY") or os.getenv("GROQ_API"))
        dependencies["llm"] = (
            f"healthy (Groq Cloud - {LLM_MODEL})" if has_key
            else "unhealthy: GROQ_API_KEY / GROQ_API not set"
        )
    else:
        dependencies["llm"] = "healthy (configured for OpenAI-compatible cloud API)"

    overall = "degraded" if any("unhealthy" in v for v in dependencies.values()) else "healthy"
    return HealthResponse(
        status=overall, version=APP_VERSION, uptime_seconds=time.time() - START_TIME, dependencies=dependencies
    )


@app.get("/")
async def root():
    return {"message": "Devflow AI Services. See /docs for API documentation."}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
