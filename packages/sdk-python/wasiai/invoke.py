import json
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import quote

from .errors import AgentNotFoundError, InsufficientBudgetError, RateLimitError, WasiAIError
from .types import InvokeResult

_STATUS_ERRORS: dict[int, type[WasiAIError]] = {
    402: InsufficientBudgetError,
    404: AgentNotFoundError,
    429: RateLimitError,
}


def invoke_agent(
    base_url: str,
    api_key: str,
    slug: str,
    kwargs: dict[str, Any],
) -> InvokeResult:
    if not slug or not str(slug).strip():
        raise WasiAIError("slug must be a non-empty string")
    safe_slug = quote(str(slug), safe="")
    url = f"{base_url.rstrip('/')}/api/v1/agents/{safe_slug}/invoke"
    body = json.dumps({"input": kwargs}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
        method="POST",
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            latency_ms = int((time.monotonic() - start) * 1000)
            data: dict[str, Any] = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_cls = _STATUS_ERRORS.get(exc.code, WasiAIError)
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
        except Exception:
            detail = str(exc)
        raise error_cls(detail, exc.code) from exc
    except urllib.error.URLError as exc:
        raise WasiAIError(str(exc.reason)) from exc

    return InvokeResult(
        output=data.get("output"),
        agent_slug=data.get("agent_slug", slug),
        call_id=data.get("call_id", ""),
        latency_ms=latency_ms,
    )
