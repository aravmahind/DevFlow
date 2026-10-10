"""GitHub repository tracker.

A project manager links one repository to a project. On every push (webhook)
or poll tick, new commits are ingested, classified by the AI service, and
mapped onto the project's plan items (backlog tasks and functional
requirements). Implementation status, per-contributor ownership, and a repo
summary are derived from those mappings, and the repo chat is grounded in them.

Sync is claimed with a conditional UPDATE rather than an advisory lock because
the Supabase pooler runs in transaction mode, where session locks are unsafe.
"""
from __future__ import annotations

import asyncio
import re
import secrets
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.db.postgres import execute, fetch, fetchrow
from app.services import projects as project_service
from app.services.ai_client import ai_services
from app.services import github_accounts
from app.services.github_client import (
    GitHubClient,
    GitHubError,
    encrypt_token,
    parse_repo,
)

logger = get_logger("services.github_tracker")

_BACKGROUND: set[asyncio.Task] = set()
_poller: asyncio.Task | None = None
_poll_etags: dict[str, str] = {}
_last_polled: dict[str, float] = {}
# 304s are free only for authenticated requests; anonymous polls each cost one of
# the 60 requests/hour, so they are spaced out.
_ANON_POLL_SECONDS = 600
_ANALYSIS_BATCH = 12  # keeps each request under free-tier per-minute token caps
_CONVENTIONAL = re.compile(r"^(?P<type>[a-z]+)(?:\([^)]*\))?!?:", re.I)
_CATEGORY_ALIASES = {
    "feat": "feature", "feature": "feature", "fix": "fix", "bugfix": "fix", "hotfix": "fix",
    "docs": "docs", "doc": "docs", "test": "test", "tests": "test", "refactor": "refactor",
    "perf": "refactor", "style": "chore", "chore": "chore", "build": "chore", "ci": "chore",
}


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


# ---------------------------------------------------------------------------
# Plan items: the things a commit can implement
# ---------------------------------------------------------------------------

def plan_items(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Backlog tasks (T<index>, matching /tasks/{index}) and functional requirements (R<index>)."""
    items: list[dict[str, Any]] = []
    backlog = doc.get("backlog") if isinstance(doc.get("backlog"), dict) else {}
    for idx, task in enumerate(backlog.get("tasks") or []):
        if not isinstance(task, dict) or not task.get("title"):
            continue
        items.append({
            "key": f"T{idx}", "kind": "task", "title": task.get("title", ""),
            "epic": task.get("epic") or "General", "category": task.get("category") or "",
            "description": str(task.get("description") or "")[:200],
            "board_status": task.get("status") or "To Do",
            "assignee_id": task.get("assignee_id"),
        })
    reqs = doc.get("requirements") if isinstance(doc.get("requirements"), dict) else {}
    for idx, req in enumerate(reqs.get("functional_requirements") or []):
        if not isinstance(req, dict) or not req.get("title"):
            continue
        items.append({
            "key": f"R{idx}", "kind": "requirement", "title": req.get("title", ""),
            "epic": "Requirements", "category": req.get("category") or "",
            "description": str(req.get("description") or "")[:200],
        })
    return items[:160]


def _heuristic_analysis(message: str) -> dict[str, Any]:
    first = (message or "").strip().splitlines()[0] if message else ""
    lower = first.lower()
    match = _CONVENTIONAL.match(first)
    if lower.startswith("merge "):
        category = "merge"
    elif match:
        category = _CATEGORY_ALIASES.get(match.group("type").lower(), "chore")
    elif re.search(r"\b(fix|bug|patch|resolve)", lower):
        category = "fix"
    elif re.search(r"\b(add|implement|create|introduce|support|build)", lower):
        category = "feature"
    elif re.search(r"\b(readme|docs?|documentation)\b", lower):
        category = "docs"
    elif re.search(r"\btest", lower):
        category = "test"
    elif re.search(r"\b(refactor|cleanup|clean up|rename|restructure)", lower):
        category = "refactor"
    else:
        category = "chore"
    return {"summary": first[:160], "category": category, "area": "", "items": [], "source": "heuristic"}


_SIGNAL_RANK = {"feature": 0, "fix": 1, "test": 1, "refactor": 1, "docs": 2, "chore": 3}
_NOISE = re.compile(r"^(merge\b|bump\b|upgrade (all )?dependenc|update dependenc|\d+\.\d+\.\d+$|v?\d+\.\d+\.\d+\b)", re.I)


def _is_noise(message: str) -> bool:
    return bool(_NOISE.match((message or "").strip()))


# ---------------------------------------------------------------------------
# Link management
# ---------------------------------------------------------------------------

async def get_link(project_id: str) -> dict[str, Any] | None:
    row = await fetchrow("SELECT * FROM github_links WHERE project_id=$1", project_id)
    return dict(row) if row else None


async def link_repo(project_id: str, user_id: str, repo_url: str, token: str | None,
                    webhook_url: str | None, *, use_account: bool = False) -> dict[str, Any]:
    """Link a repo, reading it with a pasted ``token`` or, with ``use_account``,
    through the linking user's connected GitHub account."""
    owner, repo = parse_repo(repo_url)
    account_user_id = user_id if use_account and not token else None
    effective = await github_accounts.token_for_link({"account_user_id": account_user_id}) \
        if account_user_id else token
    gh = GitHubClient(effective)
    try:
        meta = await gh.repo(owner, repo)  # validates access before anything is stored
    except GitHubError as exc:
        await github_accounts.note_failure(account_user_id, exc)
        raise
    owner, repo = meta["owner"]["login"], meta["name"]
    secret = secrets.token_hex(20)
    existing = await get_link(project_id)
    if existing and existing.get("webhook_id"):
        await _delete_webhook(existing)
    await execute("DELETE FROM github_commits WHERE project_id=$1", project_id)
    await execute(
        """INSERT INTO github_links (project_id, owner, repo, default_branch, access_token,
               webhook_secret, linked_by, sync_status, repo_meta, status_report, account_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','{}'::jsonb,'{}'::jsonb,$8)
           ON CONFLICT (project_id) DO UPDATE SET owner=EXCLUDED.owner, repo=EXCLUDED.repo,
             default_branch=EXCLUDED.default_branch, access_token=EXCLUDED.access_token,
             account_user_id=EXCLUDED.account_user_id,
             webhook_secret=EXCLUDED.webhook_secret, webhook_id=NULL, linked_by=EXCLUDED.linked_by,
             sync_status='pending', sync_error=NULL, head_sha=NULL, last_synced_at=NULL,
             repo_meta='{}'::jsonb, status_report='{}'::jsonb, updated_at=NOW()""",
        project_id, owner, repo, meta.get("default_branch") or "main",
        encrypt_token(token if not account_user_id else None), secret, user_id, account_user_id,
    )
    if webhook_url and effective:
        hook_id = await gh.create_push_webhook(owner, repo, webhook_url, secret)
        if hook_id:
            await execute("UPDATE github_links SET webhook_id=$2 WHERE project_id=$1", project_id, hook_id)
    logger.info("Linked project %s to %s/%s", project_id, owner, repo)
    request_sync(project_id, "linked")
    return await get_link(project_id) or {}


async def _delete_webhook(link: dict[str, Any]) -> None:
    try:
        await GitHubClient(await github_accounts.token_for_link(link)).delete_webhook(
            link["owner"], link["repo"], int(link["webhook_id"])
        )
    except Exception as exc:
        logger.info("Could not delete webhook for %s: %s", link["project_id"], exc)


async def unlink(project_id: str) -> bool:
    link = await get_link(project_id)
    if not link:
        return False
    if link.get("webhook_id"):
        await _delete_webhook(link)
    await execute("DELETE FROM github_commits WHERE project_id=$1", project_id)
    await execute("DELETE FROM github_links WHERE project_id=$1", project_id)
    await execute(
        """UPDATE projects SET document = document - 'github_progress'
           WHERE id=$1 AND document->'github_progress'->>'source' = 'github_tracker'""", project_id,
    )
    return True


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def request_sync(project_id: str, reason: str, local_only: bool = False) -> None:
    """Schedule a sync in the background; overlapping requests collapse into one re-run.
    ``local_only`` re-runs AI mapping on stored commits without calling GitHub."""
    logger.info("Sync requested for %s (%s)", project_id, reason)
    task = asyncio.create_task(sync_project(project_id, local_only))
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


_STALE_SYNC = "INTERVAL '45 minutes'"  # longer than a worst-case sync with AI rate-limit waits


async def _claim(project_id: str) -> dict[str, Any] | None:
    row = await fetchrow(
        f"""UPDATE github_links SET sync_status='syncing', sync_started_at=NOW(),
                  resync_requested=FALSE, sync_error=NULL, updated_at=NOW()
           WHERE project_id=$1 AND (sync_status<>'syncing'
                 OR sync_started_at < NOW() - {_STALE_SYNC})
           RETURNING *""",
        project_id,
    )
    return dict(row) if row else None


async def _defer_to_running_sync(project_id: str) -> bool:
    """Ask the in-flight sync to run again. False if it finished in the meantime."""
    row = await fetchrow(
        """UPDATE github_links SET resync_requested=TRUE
           WHERE project_id=$1 AND sync_status='syncing' RETURNING 1""", project_id,
    )
    return row is not None


async def sync_project(project_id: str, local_only: bool = False) -> None:
    for _ in range(6):  # bounded re-runs when pushes arrive mid-sync
        link = await _claim(project_id)
        if not link:
            if not await get_link(project_id) or await _defer_to_running_sync(project_id):
                return
            continue  # the other sync just finished: claim again rather than drop this request
        gen = link["webhook_secret"]  # regenerated on every (re)link; guards stale writers
        try:
            head, warning = await _sync_once(link, local_only)
        except Exception as exc:
            await github_accounts.note_failure(link.get("account_user_id"), exc)
            message = str(exc) if isinstance(exc, GitHubError) else f"Sync failed: {exc}"
            if isinstance(exc, GitHubError) and exc.status == 401 and link.get("account_user_id"):
                message = str(exc) if str(exc) == github_accounts.DISCONNECTED_MESSAGE \
                    else github_accounts.RECONNECT_MESSAGE
            logger.warning("GitHub sync failed for %s: %s", project_id, exc)
            row = await fetchrow(
                """UPDATE github_links SET sync_status='failed', sync_error=$2, updated_at=NOW()
                   WHERE project_id=$1 AND webhook_secret=$3 RETURNING resync_requested""",
                project_id, message[:500], gen,
            )
        else:
            row = await fetchrow(
                """UPDATE github_links SET sync_status='ready', head_sha=COALESCE($2, head_sha),
                          sync_error=$3, last_synced_at=CASE WHEN $3::text IS NULL THEN NOW() ELSE last_synced_at END,
                          updated_at=NOW()
                   WHERE project_id=$1 AND webhook_secret=$4 RETURNING resync_requested""",
                project_id, head, warning, gen,
            )
        if not row or not row["resync_requested"]:
            return
        local_only = False  # a push arrived meanwhile: the re-run must fetch it


async def _sync_once(link: dict[str, Any], local_only: bool = False) -> tuple[str | None, str | None]:
    """Returns (head sha, warning). Local re-analysis still runs when GitHub throttles us."""
    project_id = link["project_id"]
    warning = link.get("sync_error") if local_only else None
    new_commits: list[dict[str, Any]] = []
    try:
        if not local_only:
            new_commits = await _fetch_from_github(link)
    except GitHubError as exc:
        if exc.status != 429 or not (link.get("repo_meta") or {}).get("full_name"):
            raise
        last = link.get("last_synced_at")
        when = last.strftime("%b %d, %H:%M UTC") if isinstance(last, datetime) else "the last sync"
        warning = f"{exc} Showing data from {when}; new commits will be picked up automatically."
    analyzed = await _analyze_pending(project_id, link["webhook_secret"])
    if new_commits or analyzed or not (link.get("status_report") or {}).get("summary"):
        await _refresh_summary(project_id, link["webhook_secret"])
    await publish_progress(project_id, link["webhook_secret"])
    logger.info("Synced %s/%s for %s: %d new commits", link["owner"], link["repo"], project_id, len(new_commits))
    return (new_commits[0]["sha"] if new_commits else None), warning


async def _fetch_from_github(link: dict[str, Any]) -> list[dict[str, Any]]:
    project_id, owner, repo = link["project_id"], link["owner"], link["repo"]
    gh = GitHubClient(await github_accounts.token_for_link(link))
    meta = await gh.repo(owner, repo)
    branch = meta.get("default_branch") or link["default_branch"]
    languages, contributors, readme, tree = await asyncio.gather(
        gh.languages(owner, repo), gh.contributors(owner, repo),
        gh.readme(owner, repo), gh.tree(owner, repo, branch),
    )
    repo_meta = {
        "full_name": meta.get("full_name"), "description": meta.get("description"),
        "html_url": meta.get("html_url"), "private": meta.get("private", False),
        "stars": meta.get("stargazers_count", 0), "forks": meta.get("forks_count", 0),
        "open_issues": meta.get("open_issues_count", 0), "language": meta.get("language"),
        "topics": meta.get("topics") or [], "pushed_at": meta.get("pushed_at"),
        "created_at": meta.get("created_at"), "languages": languages, "readme": readme,
        "tree": tree, "contributors": [
            {"login": c.get("login"), "avatar_url": c.get("avatar_url"),
             "contributions": c.get("contributions", 0)}
            for c in contributors if isinstance(c, dict)
        ],
    }
    gen = link["webhook_secret"]
    await execute(
        "UPDATE github_links SET repo_meta=$2, default_branch=$3 WHERE project_id=$1 AND webhook_secret=$4",
        project_id, repo_meta, branch, gen,
    )
    known = {r["sha"] for r in await fetch("SELECT sha FROM github_commits WHERE project_id=$1", project_id)}
    new_commits = await gh.commits(owner, repo, branch, known, settings.github_max_commits)
    await _store_commits(gh, project_id, owner, repo, new_commits, gen)
    if not new_commits and not link.get("head_sha"):
        # Already in sync but head unknown (e.g. after relink): record it once.
        head = await gh.head_sha(owner, repo, branch)
        if head:
            await execute("UPDATE github_links SET head_sha=$2 WHERE project_id=$1 AND webhook_secret=$3",
                          project_id, head, gen)
    return new_commits


async def _store_commits(gh: GitHubClient, project_id: str, owner: str, repo: str,
                         commits: list[dict[str, Any]], gen: str) -> None:
    # Keep headroom in the hourly budget (60/h unauthenticated) for polling and the next sync.
    budget = settings.github_detail_commits
    if gh.remaining is not None:
        budget = min(budget, max(0, gh.remaining - 10))
    detail_budget = commits[:budget]
    sem = asyncio.Semaphore(6)

    async def detail(sha: str) -> dict[str, Any] | None:
        async with sem:
            try:
                return await gh.commit_detail(owner, repo, sha)
            except GitHubError:
                return None

    details = await asyncio.gather(*(detail(c["sha"]) for c in detail_budget))
    by_sha = {c["sha"]: d for c, d in zip(detail_budget, details) if d}
    for item in commits:
        info = item.get("commit") or {}
        author = info.get("author") or {}
        gh_author = item.get("author") or {}
        d = by_sha.get(item["sha"]) or {}
        stats = d.get("stats") or {}
        files = [
            {"path": f.get("filename"), "status": f.get("status"),
             "additions": f.get("additions", 0), "deletions": f.get("deletions", 0)}
            for f in (d.get("files") or [])[:40]
        ]
        await execute(
            """INSERT INTO github_commits (project_id, sha, author_login, author_name, author_email,
                   author_avatar, committed_at, message, url, additions, deletions, files)
               SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
               WHERE EXISTS (SELECT 1 FROM github_links WHERE project_id=$1 AND webhook_secret=$13)
               ON CONFLICT (project_id, sha) DO NOTHING""",
            project_id, item["sha"], gh_author.get("login"), author.get("name"), author.get("email"),
            gh_author.get("avatar_url"), _dt(author.get("date")), (info.get("message") or "")[:4000],
            item.get("html_url"), int(stats.get("additions", 0)), int(stats.get("deletions", 0)), files, gen,
        )


async def _analyze_pending(project_id: str, gen: str) -> int:
    """Map unanalyzed commits onto plan items. Returns how many commits were updated."""
    doc = await project_service.get_project(project_id)
    items = plan_items(doc or {})
    rows = await fetch(
        """SELECT c.sha, c.message, c.author_login, c.author_name, c.files, c.analysis
           FROM github_commits c JOIN github_links l ON l.project_id=c.project_id AND l.webhook_secret=$2
           WHERE c.project_id=$1 AND c.analyzed_at IS NULL ORDER BY c.committed_at DESC NULLS LAST""",
        project_id, gen,
    )
    if not rows:
        return 0
    # Spend the AI budget where it carries signal: feature work first, dependency
    # bumps and merges last. In mature repos the newest commits are often bumps,
    # while the commits that built the features are older.
    ai_rows = sorted(
        (r for r in rows if not _is_noise(r["message"])),
        key=lambda r: _SIGNAL_RANK.get(_heuristic_analysis(r["message"])["category"], 9),
    )[: settings.github_ai_commits]
    ai_shas = {r["sha"] for r in ai_rows}
    results: dict[str, dict[str, Any]] = {}
    throttled: set[str] = set()  # shas whose batch hit a provider quota, not a bad response
    compact_items = [
        {"key": i["key"], "title": i["title"], "epic": i["epic"], "category": i["category"]}
        for i in items
    ]
    for start in range(0, len(ai_rows), _ANALYSIS_BATCH):
        batch = ai_rows[start:start + _ANALYSIS_BATCH]
        payload = [{
            "sha": r["sha"], "author": r["author_login"] or r["author_name"],
            "message": r["message"][:600],
            "files": [f.get("path") for f in (r["files"] or [])][:20],
        } for r in batch]
        try:
            response = await ai_services.github_analyze(compact_items, payload)
            for entry in response.get("commits", []):
                results[str(entry.get("sha"))] = entry
        except Exception as exc:
            logger.warning("Commit analysis batch failed for %s: %s", project_id, exc)
            body = getattr(getattr(exc, "response", None), "text", "") or ""
            if re.search(r"\b429\b|rate limit|tokens per (minute|day)", body, re.I):
                throttled.update(r["sha"] for r in batch)

    titles = {i["key"]: i["title"] for i in items}
    for r in rows:
        entry = results.get(r["sha"])
        if entry and r["sha"] in ai_shas:
            analysis = {
                "summary": str(entry.get("summary") or "")[:240],
                "category": entry.get("category") or _heuristic_analysis(r["message"])["category"],
                "area": str(entry.get("area") or "")[:60],
                # The title anchors the mapping: keys are list positions and shift
                # when the backlog is reordered.
                "items": [
                    {"key": m["key"], "title": titles[m["key"]],
                     "completion": "complete" if m.get("completion") == "complete" else "partial"}
                    for m in (entry.get("items") or []) if m.get("key") in titles
                ],
                "source": "ai",
            }
        else:
            analysis = _heuristic_analysis(r["message"])
        # A commit whose AI batch failed keeps the heuristic for display and stays
        # pending (analyzed_at NULL) so later syncs retry it, up to three attempts.
        # Quota throttling says nothing about this commit, so it doesn't use up an attempt.
        attempts = int((r["analysis"] or {}).get("ai_attempts", 0)) + (
            1 if r["sha"] in ai_shas and r["sha"] not in throttled else 0
        )
        retry_later = r["sha"] in ai_shas and not entry and (r["sha"] in throttled or attempts < 3)
        if not entry:
            analysis["ai_attempts"] = attempts
        await execute(
            """UPDATE github_commits SET analysis=$3,
                      analyzed_at=CASE WHEN $4 THEN NULL ELSE NOW() END
               WHERE project_id=$1 AND sha=$2""",
            project_id, r["sha"], analysis, retry_later,
        )
    return len(rows)


async def reanalyze(project_id: str) -> None:
    """Re-map all commits (e.g. after the plan changed) and refresh the summary."""
    await execute("UPDATE github_commits SET analyzed_at=NULL WHERE project_id=$1", project_id)
    request_sync(project_id, "reanalyze")


async def _refresh_summary(project_id: str, gen: str) -> None:
    try:
        context = await build_chat_context(project_id, max_commits=25, item_evidence=True, max_chars=9000)
        report = await ai_services.github_summarize(context)
    except Exception as exc:
        logger.warning("Repo summary failed for %s: %s", project_id, exc)
        # Keep the previous narrative but flag it: the item statuses may have moved on.
        await execute(
            """UPDATE github_links SET status_report = status_report || '{"stale": true}'::jsonb
               WHERE project_id=$1 AND webhook_secret=$2 AND status_report ? 'summary'""",
            project_id, gen,
        )
        return
    doc = await project_service.get_project(project_id) or {}
    titles = {i["key"]: i["title"] for i in plan_items(doc)}
    report["item_verdicts"] = {
        v["key"]: {"status": v["status"], "reason": v.get("reason", ""), "title": titles[v["key"]]}
        for v in report.get("item_verdicts") or [] if v.get("key") in titles
    }
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    await execute("UPDATE github_links SET status_report=$2 WHERE project_id=$1 AND webhook_secret=$3",
                  project_id, report, gen)


# ---------------------------------------------------------------------------
# GitHub Monitor integration
# ---------------------------------------------------------------------------

_MONITOR_STATUS = {"implemented": "likely_complete", "in_progress": "in_progress", "not_started": "not_started"}


def _monitor_report(link: dict[str, Any], status: dict[str, Any], people: list[dict[str, Any]],
                    commits: list[dict[str, Any]]) -> dict[str, Any]:
    """The project's ``github_progress`` section, in the GitHub Monitor agent's
    GitHubProgressReport shape. Everything here is observed from Git history,
    never verified by CI or tests, and the wording says so."""
    report = link.get("status_report") or {}
    prog = status["progress"]
    recent = [c for c in commits if c.get("committed_at")][:200]
    last_30 = [c for c in recent if (datetime.now(timezone.utc) - c["committed_at"]).days <= 30]
    task_progress = []
    for i in status["items"]:
        if i["kind"] != "task":
            continue
        n = len(i["commits"])
        evidence = (
            i.get("verdict_reason")
            or (f"{n} related commit(s) observed, latest {str(i['last_activity'])[:10]}" if n else "No related commits observed")
        )
        task_progress.append({
            "task_title": i["title"],
            "status": _MONITOR_STATUS[i["status"]],
            "evidence": f"Observed in Git: {evidence}",
            # Absence of commits is weak evidence; several mapped commits are stronger.
            "confidence": "high" if n >= 3 else "medium" if n else "low",
        })
    concerns = list(report.get("gaps") or [])[:4]
    recommendations = [f"Review board status of '{i['title']}': {i['mismatch']}" for i in status["items"] if i["mismatch"]][:5]
    if not last_30:
        concerns.append("No commits on the tracked branch in the last 30 days.")
    return {
        "commit_summary": (
            f"{len(commits)} commits tracked on {link['owner']}/{link['repo']}@{link['default_branch']} "
            f"from {len(people)} contributors ({len(last_30)} in the last 30 days). Observed against the plan: "
            f"{prog['implemented']} items appear complete, {prog['in_progress']} show activity, "
            f"{prog['not_started']} have no related commits. " + (report.get("summary") or "")
        ).strip(),
        "pr_summary": "Pull request data is not tracked yet; progress is inferred from commits on the default branch.",
        "branch_activity": [f"{link['default_branch']} (tracked)"],
        "task_progress": task_progress,
        "concerns": concerns,
        "recommendations": recommendations,
        "data_available": True,
        "source": "github_tracker",
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }


def _monitor_snapshot(link: dict[str, Any], status: dict[str, Any], people: list[dict[str, Any]],
                      commits: list[dict[str, Any]]) -> dict[str, Any]:
    """Compact, most-important-first input for the GitHub Monitor agent (truncated at ~6k chars)."""
    return {
        "repository": f"{link['owner']}/{link['repo']}@{link['default_branch']}",
        "note": "Observed from Git commit history; not verified by CI or tests.",
        "progress": status["progress"],
        "tasks": [
            {"title": i["title"], "observed": _MONITOR_STATUS[i["status"]], "commits": len(i["commits"]),
             "by": [p["name"] for p in i["contributors"][:3]], "why": (i.get("verdict_reason") or "")[:120]}
            for i in status["items"] if i["kind"] == "task"
        ][:40],
        "contributors": [{"name": p["name"], "commits": p["commits"], "last": str(p["last_commit"])[:10]} for p in people[:10]],
        "recent_commits": [
            f"{str(_iso(c.get('committed_at')))[:10]} {c.get('author_login') or c.get('author_name')}: "
            f"{((c.get('analysis') or {}).get('summary') or c.get('message') or '').splitlines()[0][:90]}"
            for c in commits[:25]
        ],
    }


async def publish_progress(project_id: str, gen: str) -> None:
    """Write ``github_progress`` into the project document and a snapshot for the agent."""
    link = await get_link(project_id)
    if not link or link["webhook_secret"] != gen:
        return
    doc = await project_service.get_project(project_id) or {}
    items = plan_items(doc)
    commits = await _commit_rows(project_id)
    status = compute_status(items, commits, (link.get("status_report") or {}).get("item_verdicts"))
    people = compute_contributors(commits, status["items"])
    # jsonb_set touches only this key, so concurrent user edits to the plan are not clobbered.
    await execute(
        """UPDATE projects SET document = jsonb_set(document, '{github_progress}', $2::jsonb)
           WHERE id=$1""",
        project_id, _monitor_report(link, status, people, commits),
    )
    await execute(
        """UPDATE github_links SET status_report = jsonb_set(status_report, '{tracker_snapshot}', $2::jsonb)
           WHERE project_id=$1 AND webhook_secret=$3""",
        project_id, _monitor_snapshot(link, status, people, commits), gen,
    )


# ---------------------------------------------------------------------------
# Read models
# ---------------------------------------------------------------------------

def _author_key(row: dict[str, Any]) -> str:
    return (row.get("author_login") or row.get("author_email") or row.get("author_name") or "unknown").lower()


async def _commit_rows(project_id: str) -> list[dict[str, Any]]:
    rows = await fetch(
        """SELECT sha, author_login, author_name, author_email, author_avatar, committed_at, message,
                  url, additions, deletions, files, analysis
           FROM github_commits WHERE project_id=$1 ORDER BY committed_at DESC NULLS LAST""",
        project_id,
    )
    return [dict(r) for r in rows]


def _person(row: dict[str, Any]) -> dict[str, Any]:
    return {"key": _author_key(row), "login": row.get("author_login"),
            "name": row.get("author_name") or row.get("author_login") or "Unknown",
            "avatar_url": row.get("author_avatar")}


def compute_status(items: list[dict[str, Any]], commits: list[dict[str, Any]],
                   verdicts: dict[str, dict[str, str]] | None = None) -> dict[str, Any]:
    """Status per plan item. The AI verdict (judged over all of an item's commits) wins
    when the item has evidence; otherwise a single 'complete' commit marks it implemented."""
    norm = lambda t: (t or "").strip().lower()  # noqa: E731
    title_by_key = {i["key"]: norm(i["title"]) for i in items}
    by_kind_title: dict[tuple[str, str], str] = {}
    by_title: dict[str, str] = {}
    for i in items:  # first occurrence wins, so lookups are deterministic
        by_kind_title.setdefault((i["key"][0], norm(i["title"])), i["key"])
        by_title.setdefault(norm(i["title"]), i["key"])

    def resolve(ref: dict[str, Any]) -> str | None:
        """Mappings carry the item title so they survive backlog reordering. Keep the
        stored key while its title still matches; otherwise follow the title within the
        same kind (a task and a requirement may share a title); drop removed items."""
        key, title = ref.get("key") or "", norm(ref.get("title"))
        if not title:
            return key if key in title_by_key else None
        if title_by_key.get(key) == title:
            return key
        return by_kind_title.get((key[:1], title)) or by_title.get(title)

    verdicts = {k: v for key, v in (verdicts or {}).items() if (k := resolve({"key": key, **v}))}
    evidence: dict[str, list[tuple[dict[str, Any], str]]] = defaultdict(list)
    for c in commits:
        for m in (c.get("analysis") or {}).get("items") or []:
            key = resolve(m)
            if key:
                evidence[key].append((c, m.get("completion", "partial")))

    out_items = []
    for item in items:
        ev = evidence.get(item["key"], [])
        verdict = verdicts.get(item["key"]) if ev else None
        if verdict:
            status = verdict["status"]
        elif any(comp == "complete" for _, comp in ev):
            status = "implemented"
        elif ev:
            status = "in_progress"
        else:
            status = "not_started"
        people: dict[str, dict[str, Any]] = {}
        for c, _ in ev:
            p = people.setdefault(_author_key(c), {**_person(c), "commits": 0})
            p["commits"] += 1
        mismatch = None
        board = item.get("board_status")
        if board == "Done" and status == "not_started":
            mismatch = "Marked Done on the board, but no matching commits were found"
        elif board in ("To Do", None) and status == "implemented" and item["kind"] == "task":
            mismatch = "Code looks complete, but the board still says To Do"
        out_items.append({
            **item, "status": status, "mismatch": mismatch,
            "verdict_reason": (verdict or {}).get("reason") or None,
            "contributors": sorted(people.values(), key=lambda p: -p["commits"]),
            "commits": [
                {"sha": c["sha"], "message": (c.get("message") or "").splitlines()[0][:120],
                 "author": c.get("author_login") or c.get("author_name"), "url": c.get("url"),
                 "committed_at": _iso(c.get("committed_at")), "completion": comp}
                for c, comp in ev[:8]
            ],
            "last_activity": _iso(ev[0][0].get("committed_at")) if ev else None,
        })

    counts = Counter(i["status"] for i in out_items)
    total = len(out_items)
    # In-progress work counts half so the bar moves as soon as code lands.
    percent = round(100 * (counts["implemented"] + 0.5 * counts["in_progress"]) / total) if total else 0
    epics: dict[str, dict[str, Any]] = {}
    for i in out_items:
        e = epics.setdefault(i["epic"], {"epic": i["epic"], "total": 0, "implemented": 0, "in_progress": 0})
        e["total"] += 1
        if i["status"] in ("implemented", "in_progress"):
            e[i["status"]] += 1
    for e in epics.values():
        e["percent"] = round(100 * (e["implemented"] + 0.5 * e["in_progress"]) / e["total"])
    return {
        "items": out_items,
        "epics": sorted(epics.values(), key=lambda e: -e["total"]),
        "progress": {"total": total, "implemented": counts["implemented"],
                     "in_progress": counts["in_progress"], "not_started": counts["not_started"],
                     "percent": percent},
    }


def compute_contributors(commits: list[dict[str, Any]], status_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-author stats. Delivered/worked-on follows each item's final status, so it
    always agrees with the implementation-status view."""
    people: dict[str, dict[str, Any]] = {}
    for c in commits:
        p = people.setdefault(_author_key(c), {
            **_person(c), "commits": 0, "additions": 0, "deletions": 0, "detailed": 0,
            "categories": Counter(), "areas": Counter(), "first_commit": None, "last_commit": None,
        })
        p["commits"] += 1
        p["additions"] += c.get("additions") or 0
        p["deletions"] += c.get("deletions") or 0
        p["detailed"] += 1 if c.get("files") else 0
        if not p.get("avatar_url") and c.get("author_avatar"):
            p["avatar_url"] = c["author_avatar"]
        p["categories"][(c.get("analysis") or {}).get("category") or "chore"] += 1
        for f in c.get("files") or []:
            path = f.get("path") or ""
            p["areas"][path.split("/")[0] if "/" in path else "(root)"] += 1
        ts = _iso(c.get("committed_at"))
        if ts:
            p["last_commit"] = max(p["last_commit"] or ts, ts)
            p["first_commit"] = min(p["first_commit"] or ts, ts)
    work: dict[str, dict[str, list[dict[str, str]]]] = defaultdict(lambda: {"delivered": [], "touched": []})
    for item in status_items:
        bucket = "delivered" if item["status"] == "implemented" else "touched"
        for person in item["contributors"]:
            work[person["key"]][bucket].append({"key": item["key"], "title": item["title"]})
    out = []
    for key, p in people.items():
        out.append({
            **{k: p[k] for k in ("key", "login", "name", "avatar_url", "commits", "additions",
                                 "deletions", "first_commit", "last_commit")},
            # Line counts exist only for commits whose details were fetched.
            "has_line_stats": p["detailed"] > 0,
            "categories": dict(p["categories"]),
            "top_areas": [a for a, _ in p["areas"].most_common(5)],
            "delivered": work[key]["delivered"],
            "touched": work[key]["touched"],
        })
    return sorted(out, key=lambda p: -p["commits"])


async def overview(project_id: str, *, reveal_secret: bool, webhook_url: str) -> dict[str, Any]:
    link = await get_link(project_id)
    if not link:
        return {"linked": False}
    doc = await project_service.get_project(project_id) or {}
    items = plan_items(doc)
    commits = await _commit_rows(project_id)
    status = compute_status(items, commits, (link.get("status_report") or {}).get("item_verdicts"))
    meta = link.get("repo_meta") or {}
    categories = Counter((c.get("analysis") or {}).get("category") or "pending" for c in commits)
    untracked = sum(
        1 for c in commits
        if (c.get("analysis") or {}).get("category") == "feature" and not (c.get("analysis") or {}).get("items")
    )
    linked_by = await fetchrow(
        "SELECT first_name, last_name, email FROM users WHERE clerk_user_id=$1", link.get("linked_by"),
    ) if link.get("linked_by") else None
    account_login = None
    if link.get("account_user_id"):
        acct = await github_accounts.account(link["account_user_id"])
        account_login = acct["login"] if acct else None
    return {
        "linked": True,
        "link": {
            "owner": link["owner"], "repo": link["repo"], "full_name": f"{link['owner']}/{link['repo']}",
            "html_url": meta.get("html_url") or f"https://github.com/{link['owner']}/{link['repo']}",
            "default_branch": link["default_branch"], "sync_status": link["sync_status"],
            "sync_error": link.get("sync_error"), "last_synced_at": _iso(link.get("last_synced_at")),
            "head_sha": link.get("head_sha"), "created_at": _iso(link.get("created_at")),
            "has_token": bool(link.get("access_token") or link.get("account_user_id")),
            "auth": "account" if link.get("account_user_id") else "token" if link.get("access_token") else "none",
            "account_login": account_login,
            "linked_by": " ".join(filter(None, [linked_by["first_name"], linked_by["last_name"]]))
            or linked_by["email"] if linked_by else None,
            "webhook": {
                "url": webhook_url, "auto_registered": bool(link.get("webhook_id")),
                "secret": link["webhook_secret"] if reveal_secret else None,
            },
            "poll_seconds": settings.github_poll_seconds
            if link.get("access_token") or link.get("account_user_id") or settings.github_token
            else max(settings.github_poll_seconds, _ANON_POLL_SECONDS),
        },
        "repo": {k: meta.get(k) for k in ("description", "language", "languages", "stars", "forks",
                                           "open_issues", "topics", "private", "pushed_at", "created_at")}
        | {"file_count": len(meta.get("tree") or [])},
        "report": link.get("status_report") or {},
        **status,
        "contributors": compute_contributors(commits, status["items"]),
        "stats": {
            "commits": len(commits),
            "analyzed": sum(1 for c in commits if (c.get("analysis") or {}).get("source") == "ai"),
            "untracked_features": untracked,
            "additions": sum(c.get("additions") or 0 for c in commits),
            "deletions": sum(c.get("deletions") or 0 for c in commits),
            "categories": dict(categories),
        },
    }


async def list_commits(project_id: str, limit: int, offset: int, author: str | None) -> list[dict[str, Any]]:
    rows = await fetch(
        """SELECT sha, author_login, author_name, author_avatar, committed_at, message, url,
                  additions, deletions, files, analysis
           FROM github_commits WHERE project_id=$1
             AND ($4::text IS NULL OR lower(coalesce(author_login, author_email, author_name)) = lower($4))
           ORDER BY committed_at DESC NULLS LAST LIMIT $2 OFFSET $3""",
        project_id, limit, offset, author,
    )
    out = []
    for r in rows:
        d = dict(r)
        d["committed_at"] = _iso(d["committed_at"])
        d["files"] = (d.get("files") or [])[:12]
        out.append(d)
    return out


async def build_chat_context(project_id: str, max_commits: int = 120, item_evidence: bool = False,
                             max_chars: int = 16000) -> str:
    """Compact text briefing over the repo, plan status, and contributors for the LLM.

    ``item_evidence`` adds each plan item's mapped commits so the summary step can
    judge item status; verdicts from a previous run are then deliberately ignored.
    """
    link = await get_link(project_id) or {}
    meta = link.get("repo_meta") or {}
    doc = await project_service.get_project(project_id) or {}
    items = plan_items(doc)
    commits = await _commit_rows(project_id)
    verdicts = None if item_evidence else (link.get("status_report") or {}).get("item_verdicts")
    status = compute_status(items, commits, verdicts)
    people = compute_contributors(commits, status["items"])
    langs = meta.get("languages") or {}
    total_bytes = sum(langs.values()) or 1
    parts = [
        f"# Repository {link.get('owner')}/{link.get('repo')} (branch {link.get('default_branch')})",
        f"Description: {meta.get('description') or 'n/a'}",
        "Languages: " + ", ".join(f"{k} {round(100 * v / total_bytes)}%" for k, v in list(langs.items())[:8]),
        f"Stars {meta.get('stars', 0)}, forks {meta.get('forks', 0)}, open issues {meta.get('open_issues', 0)}, "
        f"created {meta.get('created_at')}, last push {meta.get('pushed_at')}. Commits tracked: {len(commits)}.",
        f"Linked to Devflow project: {doc.get('title') or ''}",
    ]
    summary = None if item_evidence else (link.get("status_report") or {}).get("summary")
    if summary:
        parts.append("## Previous AI summary\n" + summary)
    # Plan status, evidence and contributors go before README/tree so truncation
    # (applied at the end) only ever trims the least important material.
    head_parts, parts = parts, []
    if meta.get("readme"):
        parts.append("## README (excerpt)\n" + meta["readme"][:2200])
    tree = meta.get("tree") or []
    if tree:
        dirs = Counter(p.split("/")[0] for p in tree if "/" in p)
        root_files = [p for p in tree if "/" not in p][:25]
        parts.append(
            "## File tree\nTop-level dirs (file counts): "
            + ", ".join(f"{d}({n})" for d, n in dirs.most_common(20))
            + "\nRoot files: " + ", ".join(root_files)
            + "\nSample paths: " + ", ".join(tree[:80])
        )
    repo_parts, parts = parts, []
    prog = status["progress"]
    lines = [
        f"- {i['key']} [{i['status']}] {i['title']} (epic {i['epic']}; by "
        f"{', '.join(p['name'] for p in i['contributors'][:3]) or 'nobody yet'})"
        for i in status["items"][:90]
    ]
    parts.append(
        f"## Plan implementation status ({prog['implemented']} implemented, {prog['in_progress']} in progress, "
        f"{prog['not_started']} not started of {prog['total']})\n" + "\n".join(lines)
    )
    if item_evidence:
        evidence = [
            f"{i['key']} {i['title']}:\n" + "\n".join(
                f"  - {c['sha'][:7]} {c['author']}: {c['message'][:90]} ({c['completion']})" for c in i["commits"]
            )
            for i in status["items"] if i["commits"]
        ]
        parts.append("## ITEM EVIDENCE (commits mapped to each plan item)\n" + "\n".join(evidence))
    parts.append("## Contributors\n" + "\n".join(
        f"- {p['name']} (@{p['login'] or '-'}): {p['commits']} commits, +{p['additions']}/-{p['deletions']}, "
        f"first {str(p['first_commit'])[:10]}, last {str(p['last_commit'])[:10]}, "
        f"mix {p['categories']}, areas {', '.join(p['top_areas'])}; delivered: "
        f"{', '.join(d['title'] for d in p['delivered'][:8]) or 'none'}; worked on: "
        f"{', '.join(d['title'] for d in p['touched'][:6]) or 'none'}"
        for p in people[:15]
    ))
    core_parts, parts = parts, []
    commit_lines = []
    for c in commits[:max_commits]:
        a = c.get("analysis") or {}
        keys = ",".join(m["key"] for m in a.get("items") or [])
        commit_lines.append(
            f"- {str(_iso(c.get('committed_at')))[:10]} {c['sha'][:7]} {c.get('author_login') or c.get('author_name')} "
            f"[{a.get('category', '?')}] {(a.get('summary') or c.get('message') or '').splitlines()[0][:110]}"
            f" (+{c.get('additions', 0)}/-{c.get('deletions', 0)})" + (f" -> {keys}" if keys else "")
        )
    log = f"## Commit log (newest first, {min(len(commits), max_commits)} of {len(commits)})\n" + "\n".join(commit_lines)
    budget = max_chars
    text = "\n\n".join(head_parts + core_parts)[:budget]
    for extra in ("\n\n".join(repo_parts), log):
        room = budget - len(text) - 2
        if extra and room > 200:
            text += "\n\n" + extra[:room]
    return text


# ---------------------------------------------------------------------------
# Poller: catches pushes when GitHub cannot reach the webhook (e.g. localhost).
# Conditional requests (ETag) make idle polls free when a token is configured.
# ---------------------------------------------------------------------------

async def _poll_once() -> None:
    links = await fetch(
        f"""SELECT project_id, owner, repo, default_branch, access_token, account_user_id,
                  head_sha, sync_status, sync_error
           FROM github_links
           WHERE (sync_status='ready' AND (sync_error IS NULL OR updated_at < NOW() - INTERVAL '10 minutes'))
              OR (sync_status='pending' AND updated_at < NOW() - INTERVAL '2 minutes')
              OR (sync_status='failed' AND sync_started_at < NOW() - INTERVAL '30 minutes')
              OR (sync_status='syncing' AND sync_started_at < NOW() - {_STALE_SYNC})"""
    )
    pending_ai = await fetch(
        """SELECT DISTINCT l.project_id FROM github_links l
           JOIN github_commits c ON c.project_id = l.project_id AND c.analyzed_at IS NULL
           WHERE l.sync_status = 'ready' AND l.updated_at < NOW() - INTERVAL '30 minutes'"""
    )
    retry_local = {r["project_id"] for r in pending_ai}
    for link in links:
        pid = link["project_id"]
        if pid in retry_local and not link["sync_error"]:
            request_sync(pid, "poll: retry pending AI mapping", local_only=True)
            continue
        # Links needing a retry (never synced, failed, stalled, or rate-limited) sync
        # directly: the ETag cache would 304 and hide them.
        if link["sync_status"] != "ready" or link["sync_error"]:
            _poll_etags.pop(pid, None)
            request_sync(pid, f"poll: retry {link['sync_status']}")
            continue
        try:
            token = await github_accounts.token_for_link(dict(link)) or settings.github_token
        except GitHubError as exc:
            # Account disconnected or revoked: surface it through a real sync.
            logger.info("Poll skipped for %s: %s", pid, exc)
            request_sync(pid, "poll: account credentials unavailable")
            continue
        now = asyncio.get_running_loop().time()
        if not token and now - _last_polled.get(pid, float("-inf")) < _ANON_POLL_SECONDS:
            continue
        _last_polled[pid] = now
        try:
            gh = GitHubClient(token)
            head, etag = await gh.head_sha_if_changed(
                link["owner"], link["repo"], link["default_branch"], _poll_etags.get(pid)
            )
            # Cache the ETag only once we know the stored head matches it; otherwise
            # the next poll must see the 200 again if this sync fails.
            if head and head != link["head_sha"]:
                _poll_etags.pop(pid, None)
                request_sync(pid, f"poll: new head {head[:7]}")
            elif etag:
                _poll_etags[pid] = etag
        except Exception as exc:
            logger.info("Poll failed for %s: %s", link["project_id"], exc)


async def _poll_loop() -> None:
    while True:
        await asyncio.sleep(settings.github_poll_seconds)
        try:
            await _poll_once()
        except Exception as exc:
            logger.warning("GitHub poll tick failed: %s", exc)


def start_poller() -> None:
    global _poller
    if settings.github_poll_seconds > 0 and _poller is None:
        _poller = asyncio.create_task(_poll_loop())


async def stop_poller() -> None:
    global _poller
    if _poller:
        _poller.cancel()
        _poller = None
