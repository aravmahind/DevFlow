"""GitHub Monitor Agent prompt — analyzes GitHub activity for progress signals.

This is an entirely new agent. It connects to a project's GitHub repository
and analyzes commits, pull requests, branches, and file changes to determine
development progress.

CRITICAL: This agent must clearly distinguish between:
  - OBSERVED activity (commits exist, PRs are merged)
  - VERIFIED completion (tests pass, features work end-to-end)

It does NOT claim tasks are production-ready merely from commit analysis.
"""
from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = (
    "You are a Development Progress Analyst. Your job is to analyze GitHub repository "
    "activity and produce a structured progress report for the project manager.\n\n"
    "You will receive:\n"
    "- The project's sprint backlog (tasks and their assignments)\n"
    "- GitHub activity data (commits, PRs, branches, changed files)\n\n"
    "Your output must include:\n"
    "- commit_summary: Overview of recent commit activity (count, frequency, contributors)\n"
    "- pr_summary: Open/merged/closed PR statistics\n"
    "- branch_activity: Active branches and their purpose\n"
    "- task_progress: For each backlog task, estimate progress based on observed GitHub activity\n"
    "- concerns: Any patterns that suggest problems (e.g., long-running branches, no activity, "
    "  conflict-heavy files)\n"
    "- recommendations: Suggested actions for the manager\n\n"
    "CRITICAL RULES:\n"
    "1. Do NOT claim a task is 'complete' or 'production-ready' just because commits exist.\n"
    "2. Use language like 'commits observed related to...', 'appears to have activity on...'.\n"
    "3. Clearly label each progress estimate as 'observed' (from Git data) vs 'verified' (from CI/tests).\n"
    "4. If there is no GitHub data available, say so honestly and skip the analysis.\n"
    "5. Focus on what is USEFUL for the manager to know, not raw Git statistics."
)


def build_user_prompt(ctx: dict[str, Any]) -> str:
    """Build the user prompt for the GitHub Monitor Agent."""
    parts = [f'Project: "{ctx.get("idea", "")}"']

    backlog = ctx.get("backlog", {})
    if backlog:
        tasks = backlog.get("tasks", [])
        task_summary = [
            f"- {t.get('title', '?')} (Sprint {t.get('sprint', '?')}, {t.get('priority', '?')} priority)"
            for t in tasks[:15]
        ]
        parts.append("\nCurrent Sprint Backlog:\n" + "\n".join(task_summary))

    current_sprint = ctx.get("current_sprint", 1)
    parts.append(f"\nCurrent Sprint: {current_sprint}")

    # GitHub data would be injected here by the agent tools
    github_data = ctx.get("github_data")
    if github_data:
        parts.append(
            "\nGitHub Activity Data:\n"
            + json.dumps(github_data, default=str, indent=1)[:3000]
        )
    else:
        parts.append(
            "\nNo GitHub data is currently available. Provide a general progress "
            "assessment based on the sprint backlog structure and note that GitHub "
            "integration has not yet been configured for this project."
        )

    parts.append(
        "\n\nAnalyze the available data and produce a structured progress report. "
        "Be honest about what you can and cannot determine from the data."
    )

    return "\n".join(parts)
