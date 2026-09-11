# tests/test_tool_surface.py
"""Offline tool-surface invariants for the combined MCP app.

The combined server must expose EXACTLY 54 tools when no provider keys are
configured. The conditional semantic tool (search_bedesten_semantic) is only
registered when OPENROUTER_API_KEY is set, so it must be ABSENT here.
"""

from mcp_server_main import app

EXPECTED_TOOL_COUNT = 54

# The nine legacy legislation search tools served through the Bedesten API.
LEGACY_LEGISLATION_SEARCH_TOOLS = (
    "search_kanun",
    "search_khk",
    "search_tuzuk",
    "search_kurum_yonetmelik",
    "search_teblig",
    "search_cbk",
    "search_cbyonetmelik",
    "search_cbbaskankarar",
    "search_cbgenelge",
)

# Snapshot of key tool names that must always be present offline.
KEY_TOOL_NAMES = (
    # Court / case-law tools
    "search_bedesten_unified",
    "get_bedesten_document_markdown",
    "search_emsal_detailed_decisions",
    "search_anayasa_unified",
    "search_uyusmazlik_decisions",
    "search_sayistay_unified",
    "search_kik_v2_decisions",
    "search_rekabet_kurumu_decisions",
    "search_kvkk_decisions",
    "search_bddk_decisions",
    "search_btk_decisions",
    "search_gib_ozelge",
    "search_sigorta_tahkim_decisions",
    "get_sigorta_tahkim_document_markdown",
    "search_within_sigorta_tahkim_issue",
    # Deep Research compatibility + health
    "search",
    "fetch",
    "check_government_servers_health",
    # Legislation tools (mounted mevzuat server)
    "search_mevzuat",
    "get_mevzuat_content",
    "get_mevzuat_gerekce",
    "get_mevzuat_madde_tree",
) + LEGACY_LEGISLATION_SEARCH_TOOLS


async def test_exactly_54_tools_offline():
    tools = await app.get_tools()
    assert len(tools) == EXPECTED_TOOL_COUNT, (
        f"expected {EXPECTED_TOOL_COUNT} tools offline, got {len(tools)}: "
        f"{sorted(tools)}"
    )


async def test_key_tool_names_present():
    tools = await app.get_tools()
    missing = [name for name in KEY_TOOL_NAMES if name not in tools]
    assert not missing, f"missing expected tools: {missing}"


async def test_all_nine_legacy_legislation_searches_present():
    tools = await app.get_tools()
    assert len(LEGACY_LEGISLATION_SEARCH_TOOLS) == 9
    missing = [name for name in LEGACY_LEGISLATION_SEARCH_TOOLS if name not in tools]
    assert not missing, f"missing legacy legislation search tools: {missing}"


async def test_semantic_tool_absent_without_openrouter_key():
    tools = await app.get_tools()
    assert "search_bedesten_semantic" not in tools, (
        "search_bedesten_semantic must not be registered when "
        "OPENROUTER_API_KEY is blank"
    )
