from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class InvokeResult:
    output: Any
    agent_slug: str
    call_id: str
    latency_ms: int


@dataclass
class Agent:
    slug: str
    name: str
    description: str
    category: str
    price_usdc: float


@dataclass
class AgentList:
    agents: list[Agent]
    total: int
    page: int
    has_more: bool
