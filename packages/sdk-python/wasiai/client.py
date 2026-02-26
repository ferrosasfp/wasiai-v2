from typing import Any

from .agents import AgentsResource
from .invoke import invoke_agent
from .types import InvokeResult

DEFAULT_BASE_URL = "https://wasiai-v2.vercel.app"


class WasiAI:
    """Official Python SDK for WasiAI."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
    ) -> None:
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.agents = AgentsResource(base_url=self.base_url, api_key=self._api_key)

    def __repr__(self) -> str:
        return f"WasiAI(base_url={self.base_url!r})"

    def invoke(self, slug: str, **kwargs: Any) -> InvokeResult:
        """Invoke an agent by slug, passing keyword arguments as input."""
        return invoke_agent(
            base_url=self.base_url,
            api_key=self._api_key,
            slug=slug,
            kwargs=kwargs,
        )
