import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional
from urllib.parse import quote

from .errors import AgentNotFoundError, WasiAIError
from .types import Agent, AgentList


def _parse_agent(data: dict[str, Any]) -> Agent:
    return Agent(
        slug=data["slug"],
        name=data["name"],
        description=data.get("description", ""),
        category=data.get("category", ""),
        price_usdc=float(data.get("price_usdc", 0.0)),
    )


class AgentsResource:
    def __init__(self, base_url: str, api_key: Optional[str] = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def list(self, page: int = 1, category: Optional[str] = None) -> AgentList:
        params: dict[str, str] = {"page": str(page)}
        if category is not None:
            params["category"] = category
        qs = urllib.parse.urlencode(params)
        url = f"{self._base_url}/api/v1/agents?{qs}"
        req = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise WasiAIError(str(exc), exc.code) from exc
        except urllib.error.URLError as exc:
            raise WasiAIError(str(exc.reason)) from exc

        agents = [_parse_agent(a) for a in data.get("agents", [])]
        return AgentList(
            agents=agents,
            total=data.get("total", len(agents)),
            page=data.get("page", page),
            has_more=data.get("has_more", False),
        )

    def get(self, slug: str) -> Agent:
        if not slug or not str(slug).strip():
            raise WasiAIError("slug must be a non-empty string")
        safe_slug = quote(str(slug), safe="")
        url = f"{self._base_url}/api/v1/agents/{safe_slug}"
        req = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise AgentNotFoundError(f"Agent '{slug}' not found", 404) from exc
            raise WasiAIError(str(exc), exc.code) from exc
        except urllib.error.URLError as exc:
            raise WasiAIError(str(exc.reason)) from exc

        return _parse_agent(data)
