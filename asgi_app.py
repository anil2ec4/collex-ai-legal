"""
ASGI application for Yargı MCP Server

This module provides ASGI/HTTP access to the Yargı MCP server,
allowing it to be deployed as a web service with FastAPI wrapper.

Usage:
    uvicorn asgi_app:app --host 0.0.0.0 --port 8000
"""

import os
import json
import hmac
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from mcp_server_main import create_app

# Setup logging
logger = logging.getLogger(__name__)

# Configure CORS
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000"
    ).split(",")
    if origin.strip()
]
require_http_auth = os.getenv("REQUIRE_HTTP_AUTH", "true").strip().lower() not in {
    "0", "false", "no", "off"
}
mcp_api_token = os.getenv("MCP_API_TOKEN", "").strip()
if require_http_auth and len(mcp_api_token) < 32:
    raise RuntimeError("MCP_API_TOKEN must be configured with at least 32 characters for HTTP mode.")

# Create MCP app
mcp_server = create_app()

# Create MCP Starlette sub-application
mcp_app = mcp_server.http_app(path="/")


# Configure JSON encoder for proper Turkish character support
class UTF8JSONResponse(JSONResponse):
    def __init__(self, content=None, status_code=200, headers=None, **kwargs):
        if headers is None:
            headers = {}
        headers["Content-Type"] = "application/json; charset=utf-8"
        super().__init__(content, status_code, headers, **kwargs)

    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")

custom_middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Session-ID"],
    ),
]

# Create FastAPI wrapper application
app = FastAPI(
    title="Bağımsız Yargı ve Mevzuat MCP",
    description="Self-hosted MCP server for Turkish case law and legislation",
    version="1.0.0",
    middleware=custom_middleware,
    default_response_class=UTF8JSONResponse,
    redirect_slashes=False,
)

@app.middleware("http")
async def require_bearer_token(request: Request, call_next):
    """Protect every externally useful route; keep only health public."""
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    if not require_http_auth:
        return await call_next(request)

    authorization = request.headers.get("Authorization", "")
    scheme, _, supplied_token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(
        supplied_token.strip(), mcp_api_token
    ):
        return JSONResponse(
            status_code=401,
            content={"error": "unauthorized", "message": "A valid Bearer token is required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    tools = await mcp_server.get_tools()
    return {
        "status": "healthy",
        "service": "Bağımsız Yargı ve Mevzuat MCP",
        "version": "1.0.0",
        "tools_count": len(tools),
    }


@app.api_route("/mcp", methods=["GET", "POST", "HEAD", "OPTIONS"])
async def redirect_to_slash(request: Request):
    """Redirect /mcp to /mcp/ preserving HTTP method with 308"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/mcp/", status_code=308)


@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Bağımsız Yargı ve Mevzuat MCP",
        "description": "Self-hosted Turkish case law and legislation server",
        "endpoints": {
            "mcp": "/mcp/",
            "health": "/health",
            "status": "/status",
        },
        "transports": {
            "http": "/mcp/"
        },
        "supported_databases": [
            "Yargıtay (Court of Cassation)",
            "Danıştay (Council of State)",
            "Emsal (Precedent)",
            "Uyuşmazlık Mahkemesi (Court of Jurisdictional Disputes)",
            "Anayasa Mahkemesi (Constitutional Court)",
            "Kamu İhale Kurulu (Public Procurement Authority)",
            "Rekabet Kurumu (Competition Authority)",
            "Sayıştay (Court of Accounts)",
            "KVKK (Personal Data Protection Authority)",
            "BDDK (Banking Regulation and Supervision Agency)",
            "BTK (Information and Communication Technologies Authority)",
            "Bedesten API (Multiple courts)",
            "GİB (Revenue Administration)",
            "Mevzuat (12 legislation types)",
            "Sigorta Tahkim Komisyonu (Insurance Arbitration Commission)",
        ],
    }


@app.get("/status")
async def status():
    """Status endpoint with detailed information"""
    tools = []
    registered_tools = await mcp_server.get_tools()
    for tool in registered_tools.values():
        description = tool.description or ""
        tools.append({
            "name": tool.name,
            "description": description[:100] + "..." if len(description) > 100 else description
        })

    return {
        "status": "operational",
        "tools": tools,
        "total_tools": len(tools),
        "transport": "streamable_http",
    }


# Mount MCP app at /mcp/
app.mount("/mcp/", mcp_app)

# Set the lifespan context after mounting
app.router.lifespan_context = mcp_app.lifespan

# Export for uvicorn
__all__ = ["app"]
