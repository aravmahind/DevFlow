import pytest

from agents.schemas import ArchitectureBundle


def test_architecture_key_entities_dicts_are_coerced_to_strings():
    raw = {
        "backend": {
            "summary": "API services",
            "components": ["Auth API"],
            "technologies": ["FastAPI"],
            "decisions": ["REST-first"],
            "key_entities": [
                {
                    "method": "POST",
                    "path": "/login",
                    "description": "Authenticate user and returns JWT",
                },
                {
                    "method": "GET",
                    "path": "/spots",
                    "description": "List available parking spots",
                },
            ],
        },
        "frontend": {"summary": "", "components": [], "technologies": [], "decisions": [], "key_entities": []},
        "database": {"summary": "", "components": [], "technologies": [], "decisions": [], "key_entities": []},
        "infrastructure": {"summary": "", "components": [], "technologies": [], "decisions": [], "key_entities": []},
    }

    bundle = ArchitectureBundle.model_validate(raw)

    assert isinstance(bundle.backend.key_entities, list)
    assert all(isinstance(item, str) for item in bundle.backend.key_entities)
    assert bundle.backend.key_entities[0].startswith("POST /login")
    assert bundle.backend.key_entities[1].startswith("GET /spots")
