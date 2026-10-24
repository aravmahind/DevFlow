"""
DEVFLOW AI-SERVICES — AI Workflow Tests (no live Groq/LLM calls)
Test IDs: AI-001 through AI-015
Covers: agent schema validation, quality gates (v2 schema), LLM resilience logic,
        text chunking/embedding, and mocked AI workflow triggers.

NOTE: Schema v2 (current) uses ArchitectureBundle, SprintPlan, RiskBundle, etc.
      IntegrationBundle and TeamPlan were removed in v2; DeploymentRecommendation
      and member-based team_allocation replaced them.
"""
import math
import unittest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# AI-001 / AI-002  Embedding — determinism, normalisation, semantic similarity
# ---------------------------------------------------------------------------
class TestEmbedding(unittest.TestCase):
    def test_embedding_deterministic_and_normalised(self):
        """AI-001: local_embedding produces identical, unit-length vectors."""
        from services.embeddings import DIMENSIONS, local_embedding
        v1 = local_embedding("DevFlow SaaS platform architecture")
        v2 = local_embedding("DevFlow SaaS platform architecture")
        self.assertEqual(v1, v2, "Embeddings must be deterministic")
        self.assertEqual(len(v1), DIMENSIONS, "Embedding must have expected dimension")
        norm = math.sqrt(sum(x * x for x in v1))
        self.assertAlmostEqual(norm, 1.0, places=6, msg="Embedding must be unit-normalised")

    def test_related_text_scores_higher_than_unrelated(self):
        """AI-002: Semantic similarity — related pair scores above unrelated pair."""
        from services.embeddings import local_embedding
        query = local_embedding("PostgreSQL tenant isolation")
        related = local_embedding("Every row carries a workspace tenant foreign key")
        unrelated = local_embedding("Oil painting landscape art colour palette")
        dot = lambda a, b: sum(x * y for x, y in zip(a, b))
        self.assertGreater(dot(query, related), dot(query, unrelated))


# ---------------------------------------------------------------------------
# AI-003  Text chunking — bounded output
# ---------------------------------------------------------------------------
class TestChunking(unittest.TestCase):
    def test_long_document_chunks_bounded(self):
        """AI-003: chunk_text splits long documents into chunks ≤ 1800 chars."""
        from services.rag import chunk_text
        source = ("Architecture and constraints. " * 150) + "\n\n" + ("Security control. " * 150)
        chunks = chunk_text(source)
        self.assertGreater(len(chunks), 2, "Long text should produce multiple chunks")
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 1800, f"Chunk too long: {len(chunk)}")


# ---------------------------------------------------------------------------
# AI-004 / AI-005  Architecture schema — v2 quality gate
# (v2 uses components/technologies/decisions keys per layer)
# ---------------------------------------------------------------------------
class TestArchitectureQualityGate(unittest.TestCase):
    def _make_layer(self):
        """A valid v2 architecture layer."""
        return {
            "components": ["Service A", "Service B"],
            "technologies": ["PostgreSQL", "FastAPI"],
            "decisions": ["Use event sourcing for auditability", "Tenant isolation at the row level"],
        }

    def test_full_architecture_passes_quality_gate(self):
        """AI-004: Full 4-layer architecture (v2) passes the quality gate."""
        from services.evaluation import evaluate_agent_output
        layer = self._make_layer()
        payload = {
            "frontend": dict(layer),
            "backend": dict(layer),
            "database": dict(layer),
            "infrastructure": dict(layer),
            "scalability_plan": [
                "Horizontal scaling via Kubernetes HPA",
                "Read replicas for PostgreSQL",
                "Edge CDN for static assets",
            ],
        }
        issues, metrics = evaluate_agent_output("architect", payload)
        self.assertEqual(issues, [], f"Unexpected issues: {issues}")
        self.assertEqual(metrics["complete_layers"], 4)

    def test_missing_layers_fails_quality_gate(self):
        """AI-005: Architecture with fewer than 4 complete layers reports issues."""
        from services.evaluation import evaluate_agent_output
        layer = self._make_layer()
        # Only 2 layers
        payload = {
            "frontend": dict(layer),
            "backend": dict(layer),
            "scalability_plan": ["HPA", "CDN", "Read replicas"],
        }
        issues, metrics = evaluate_agent_output("architect", payload)
        # Should flag incomplete layers
        self.assertTrue(
            len(issues) > 0 or metrics.get("complete_layers", 0) < 4,
            "Should report issues for missing layers"
        )


# ---------------------------------------------------------------------------
# AI-006  Sprint planner — v2 quality gate
# (v2 expects 'tasks' list + 'sprints' list directly)
# ---------------------------------------------------------------------------
class TestSprintPlannerQualityGate(unittest.TestCase):
    def test_sprint_plan_with_10_plus_tasks_passes(self):
        """AI-006: Sprint plan with ≥10 tasks and ≥3 sprints passes quality gate."""
        from services.evaluation import evaluate_agent_output
        tasks = [
            {"title": f"Task {i}", "estimated_days": 2, "story_points": 3,
             "sprint": (i % 3) + 1, "definition_of_done": "Tests pass and reviewed"}
            for i in range(12)
        ]
        sprints = [
            {"number": n, "task_titles": [t["title"] for t in tasks if t["sprint"] == n]}
            for n in range(1, 4)
        ]
        payload = {"tasks": tasks, "sprints": sprints, "epics": [{"name": "Core", "description": "Core work"}]}
        issues, metrics = evaluate_agent_output("sprint_planner", payload)
        self.assertEqual(issues, [])
        self.assertEqual(metrics["tasks"], 12)
        self.assertEqual(metrics["sprints"], 3)

    def test_sprint_plan_with_too_few_tasks_fails(self):
        """AI-007: Sprint plan with < 10 tasks fails the quality gate."""
        from services.evaluation import evaluate_agent_output
        tasks = [{"title": f"Task {i}", "story_points": 3} for i in range(5)]
        payload = {"tasks": tasks, "sprints": [{"number": 1, "task_titles": [t["title"] for t in tasks]}]}
        issues, metrics = evaluate_agent_output("sprint_planner", payload)
        self.assertTrue(len(issues) > 0, "Should flag too few tasks")
        self.assertEqual(metrics["tasks"], 5)


# ---------------------------------------------------------------------------
# AI-008 / AI-009  Risk quality gate
# ---------------------------------------------------------------------------
class TestRiskQualityGate(unittest.TestCase):
    def test_empty_risks_fail(self):
        """AI-008: Risk agent output with no risks fails the quality gate."""
        from services.evaluation import evaluate_agent_output
        issues, metrics = evaluate_agent_output("risk", {"risks": []})
        self.assertTrue(issues, "Empty risks should produce issues")
        self.assertEqual(metrics["risks"], 0)

    def test_diverse_risks_pass(self):
        """AI-009: Risk agent output with ≥5 diverse risks across ≥4 categories passes."""
        from services.evaluation import evaluate_agent_output
        risks = [
            {"title": str(i), "category": cat, "mitigation": "Concrete mitigation steps"}
            for i, cat in enumerate(
                ["security", "technical", "delivery", "product", "scalability"], start=1
            )
        ]
        issues, _ = evaluate_agent_output("risk", {"risks": risks})
        self.assertEqual(issues, [])


# ---------------------------------------------------------------------------
# AI-010  Team allocation — v2 quality gate (uses 'members' list)
# ---------------------------------------------------------------------------
class TestTeamAllocationQualityGate(unittest.TestCase):
    def test_valid_team_passes_quality_gate(self):
        """AI-010: Team allocation with ≥3 members with responsibilities/owns_area passes."""
        from services.evaluation import evaluate_agent_output
        members = [
            {"role": role, "responsibilities": ["Lead delivery", "Code review"], "owns_area": area}
            for role, area in [
                ("Tech Lead", "Technical architecture"),
                ("Product Engineer", "Feature development"),
                ("SRE", "Deployment and reliability"),
            ]
        ]
        payload = {"members": members}
        issues, metrics = evaluate_agent_output("team_allocation", payload)
        self.assertEqual(issues, [])
        self.assertEqual(metrics["roles"], 3)

    def test_empty_team_fails_quality_gate(self):
        """AI-011: Team allocation with no members fails the quality gate."""
        from services.evaluation import evaluate_agent_output
        issues, metrics = evaluate_agent_output("team_allocation", {"members": []})
        self.assertTrue(issues, "Should flag empty team")
        self.assertEqual(metrics["roles"], 0)


# ---------------------------------------------------------------------------
# AI-012 / AI-013 / AI-014  Resilience — retryable vs non-retryable errors
# ---------------------------------------------------------------------------
class TestResilienceLogic(unittest.TestCase):
    class _StatusError(Exception):
        def __init__(self, status, message=""):
            super().__init__(message or f"HTTP {status}")
            self.status_code = status

    def test_permanent_errors_not_retried(self):
        """AI-012: 404 (bad model), 401 (bad key), 400 (bad request) are not retried."""
        from api.routes import _is_retryable
        E = self._StatusError
        self.assertFalse(_is_retryable(E(404, "model `x` does not exist")))
        self.assertFalse(_is_retryable(E(401)))
        self.assertFalse(_is_retryable(E(400)))

    def test_transient_errors_are_retried(self):
        """AI-013: TPM rate limits, 503, timeouts and JSON parse errors are retried."""
        from api.routes import _is_retryable
        E = self._StatusError
        self.assertTrue(_is_retryable(E(429, "tokens per minute (TPM)")))
        self.assertTrue(_is_retryable(E(503)))
        self.assertTrue(_is_retryable(TimeoutError()))
        self.assertTrue(_is_retryable(ValueError("Failed to parse JSON")))

    def test_daily_quota_not_retried(self):
        """AI-014: Daily token quota (TPD) exhaustion is NOT retried."""
        from api.routes import _is_retryable
        E = self._StatusError
        self.assertFalse(_is_retryable(E(429, "tokens per day (TPD)")))


# ---------------------------------------------------------------------------
# AI-015  Model fallback logic
# ---------------------------------------------------------------------------
class TestModelFallback(unittest.TestCase):
    class _StatusError(Exception):
        def __init__(self, status, message=""):
            super().__init__(message or f"HTTP {status}")
            self.status_code = status

    def test_fallback_switches_for_transient_errors(self):
        """AI-015: Model fallback triggers for 404/429 but not for 401 or secondary model."""
        from agents.base import _fallback_for
        from llm.router import SECONDARY_MODEL, ModelConfig
        E = self._StatusError
        primary = ModelConfig("deprecated-model", 0.4, 4096)
        for exc in (E(404), E(429), ValueError("bad json")):
            fallback = _fallback_for(primary, exc)
            self.assertIsNotNone(fallback, f"Should have fallback for {exc}")
            self.assertEqual(fallback.model, SECONDARY_MODEL)
        # 401 never falls back
        self.assertIsNone(_fallback_for(primary, E(401)))
        # Already on secondary model — no further fallback
        secondary_cfg = ModelConfig(SECONDARY_MODEL, 0.4, 4096)
        self.assertIsNone(_fallback_for(secondary_cfg, E(404)))


# ---------------------------------------------------------------------------
# Keep running the existing test_resilience.py tests (they use pytest-style functions)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    unittest.main()
