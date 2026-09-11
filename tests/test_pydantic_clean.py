# tests/test_pydantic_clean.py
"""Pydantic v2 hygiene: model modules must import without deprecation warnings.

Regression guard for the removed v1-style ``class Config: json_encoders``
blocks (kvkk/btk). Modules are re-executed via importlib.reload so the
class-creation-time warnings fire even when another test already imported
them in this pytest process.

W14 B-44: the ``example_fastapi_app`` case was dropped together with the
module. That 80 KB file was upstream SaaS residue — a FastAPI demo app for
a deployment contract this fork does not have (no Clerk/OAuth, no Fly.io,
no Stripe) — and ARCH S13 measured what it costs: a build agent reading the
repo finds it and answers from it. It is deleted, so there is nothing left
to guard.
"""

import importlib
import warnings

import pytest
from pydantic import PydanticDeprecatedSince20

MODEL_MODULES = (
    "anayasa_mcp_module.models",
    "bddk_mcp_module.models",
    "bedesten_mcp_module.models",
    "btk_mcp_module.models",
    "danistay_mcp_module.models",
    "emsal_mcp_module.models",
    "gib_mcp_module.models",
    "kik_mcp_module.models_v2",
    "kvkk_mcp_module.models",
    "rekabet_mcp_module.models",
    "sayistay_mcp_module.models",
    "sigorta_tahkim_mcp_module.models",
    "uyusmazlik_mcp_module.models",
    "yargitay_mcp_module.models",
    "mevzuat_models",
    "mevzuat_bedesten_models",
)


def _deprecation_warnings_for(module_name: str) -> list[warnings.WarningMessage]:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        module = importlib.import_module(module_name)
        importlib.reload(module)
    return [w for w in caught if issubclass(w.category, PydanticDeprecatedSince20)]


@pytest.mark.parametrize("module_name", MODEL_MODULES)
def test_model_module_has_no_pydantic_deprecations(module_name: str):
    deprecations = _deprecation_warnings_for(module_name)
    assert not deprecations, (
        f"{module_name} raised PydanticDeprecatedSince20 warnings: "
        f"{[str(w.message) for w in deprecations]}"
    )

