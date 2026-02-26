"""Tests for AgentsResource."""
import json
import urllib.error
from io import BytesIO
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest

from wasiai import AgentNotFoundError, WasiAIError
from wasiai.agents import AgentsResource
from wasiai.types import Agent, AgentList


def _make_response(data: dict) -> MagicMock:
    body = json.dumps(data).encode()
    mock = MagicMock()
    mock.read.return_value = body
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    return mock


def _make_http_error(code: int, body: Optional[dict] = None) -> urllib.error.HTTPError:
    body = body or {}
    return urllib.error.HTTPError(
        url="http://test",
        code=code,
        msg="err",
        hdrs=None,  # type: ignore[arg-type]
        fp=BytesIO(json.dumps(body).encode()),
    )


AGENT_DATA = {
    "slug": "summarizer",
    "name": "Summarizer",
    "description": "Summarizes text",
    "category": "nlp",
    "price_usdc": 0.01,
}


class TestAgentsList:
    def test_list_success(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        data = {
            "agents": [AGENT_DATA],
            "total": 1,
            "page": 1,
            "has_more": False,
        }
        mock_resp = _make_response(data)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = resource.list()
        assert isinstance(result, AgentList)
        assert len(result.agents) == 1
        assert result.agents[0].slug == "summarizer"
        assert result.total == 1
        assert result.has_more is False

    def test_list_with_category(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        data = {"agents": [], "total": 0, "page": 1, "has_more": False}
        captured: list = []

        def fake_urlopen(req, timeout=None):  # type: ignore[no-untyped-def]
            captured.append(req)
            mock = _make_response(data)
            return mock

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            resource.list(page=2, category="vision")

        url = captured[0].full_url
        assert "category=vision" in url
        assert "page=2" in url

    def test_list_http_error(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        exc = _make_http_error(500)
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(WasiAIError):
                resource.list()


class TestAgentsGet:
    def test_get_success(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        mock_resp = _make_response(AGENT_DATA)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent = resource.get("summarizer")
        assert isinstance(agent, Agent)
        assert agent.slug == "summarizer"
        assert agent.price_usdc == 0.01

    def test_get_not_found(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        exc = _make_http_error(404)
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(AgentNotFoundError) as exc_info:
                resource.get("ghost")
        assert exc_info.value.status_code == 404
        assert "ghost" in str(exc_info.value)

    def test_get_url_error(self) -> None:
        resource = AgentsResource(base_url="http://localhost")
        exc = urllib.error.URLError("timeout")
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(WasiAIError):
                resource.get("summarizer")
