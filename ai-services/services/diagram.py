"""Build a renderable architecture diagram (nodes + edges) from the architecture
bundle. Generated deterministically so the frontend always has a valid graph to
draw with React Flow, independent of model output quirks.
"""
from __future__ import annotations

from typing import Any

_LAYERS = [
    ("frontend", "Frontend"),
    ("backend", "Backend"),
    ("database", "Database"),
    ("infrastructure", "Infrastructure"),
]
_MAX_COMPONENTS = 6


def _norm(text: str) -> str:
    return " ".join(str(text).lower().split())


def build_diagram(architecture: dict[str, Any]) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    by_name: dict[str, str] = {}

    for layer_key, layer_label in _LAYERS:
        layer = architecture.get(layer_key, {}) if isinstance(architecture, dict) else {}
        hub_id = f"layer:{layer_key}"
        nodes.append({"id": hub_id, "label": layer_label, "group": layer_key, "kind": "layer"})

        components = (layer.get("components") or [])[:_MAX_COMPONENTS]
        for idx, comp in enumerate(components):
            comp_id = f"{layer_key}:{idx}"
            nodes.append({"id": comp_id, "label": str(comp), "group": layer_key, "kind": "component"})
            by_name.setdefault(_norm(comp), comp_id)

    # Model-declared flows between components, kept only when both ends are
    # real components (exact name, or one name containing the other).
    def resolve(name: Any) -> str | None:
        key = _norm(name)
        if not key:
            return None
        if key in by_name:
            return by_name[key]
        matches = [cid for n, cid in by_name.items() if key in n or n in key]
        return matches[0] if len(matches) == 1 else None

    seen: set[tuple[str, str]] = set()
    for flow in (architecture.get("data_flows") or []) if isinstance(architecture, dict) else []:
        if not isinstance(flow, dict):
            continue
        src, dst = resolve(flow.get("source")), resolve(flow.get("target"))
        if src and dst and src != dst and (src, dst) not in seen:
            seen.add((src, dst))
            edges.append({"id": f"{src}=>{dst}", "source": src, "target": dst,
                          "label": str(flow.get("label") or "")[:40]})

    # Components with no declared flow hang off their layer; layers connect.
    linked = {e["source"] for e in edges} | {e["target"] for e in edges}
    for node in nodes:
        if node["kind"] == "component" and node["id"] not in linked:
            hub = f"layer:{node['group']}"
            edges.append({"id": f"{hub}->{node['id']}", "source": hub, "target": node["id"], "label": ""})
    if not seen:
        flow = [
            ("layer:frontend", "layer:backend", "API"),
            ("layer:backend", "layer:database", "persists"),
            ("layer:backend", "layer:infrastructure", "deploys on"),
        ]
        for src, dst, label in flow:
            edges.append({"id": f"{src}=>{dst}", "source": src, "target": dst, "label": label})

    return {"nodes": nodes, "edges": edges}


def build_mermaid(architecture: dict[str, Any]) -> str:
    """A Mermaid representation as a portable, copy-pasteable artifact."""
    lines = ["graph TD"]
    for layer_key, layer_label in _LAYERS:
        layer = architecture.get(layer_key, {}) if isinstance(architecture, dict) else {}
        lines.append(f'  {layer_key}["{layer_label}"]')
        for idx, comp in enumerate((layer.get("components") or [])[:_MAX_COMPONENTS]):
            safe = str(comp).replace('"', "'")
            lines.append(f'  {layer_key} --> {layer_key}_{idx}["{safe}"]')
    lines.append("  frontend --> backend")
    lines.append("  backend --> database")
    lines.append("  backend --> infrastructure")
    return "\n".join(lines)
