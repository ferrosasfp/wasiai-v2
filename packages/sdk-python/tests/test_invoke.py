"""Tests for invoke logic."""
import json
import urllib.error
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest

from wasiai import WasiAI, AgentNotFoundError, InsufficientBudgetError, RateLimitError, WasiAIError
from wasiai.types import InvokeResult


def _make_response(data: dict) -> MagicMock:
    body = json.dumps(data).encode()
    mock = MagicMock()
    mock.read.return_value = body
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    return mock


def _make_http_error(code: int, body: dict) -> urllib.error.HTTPError:
    encoded = json.dumps(body).encode()
    return urllib.error.HTTPError(
        url="http://test",
        code=code,
        msg="err",
        hdrs=None,  # type: ignore[arg-type]
        fp=BytesIO(encoded),
    )


class TestInvoke:
    def test_invoke_success(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        response_data = {
            "output": "Summary here",
            "agent_slug": "summarizer",
            "call_id": "abc123",
        }
        mock_resp = _make_response(response_data)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = client.invoke("summarizer", text="Hello")
        assert isinstance(result, InvokeResult)
        assert result.output == "Summary here"
        assert result.agent_slug == "summarizer"
        assert result.call_id == "abc123"
        assert result.latency_ms >= 0

    def test_invoke_agent_not_found(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        exc = _make_http_error(404, {"error": "Agent not found"})
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(AgentNotFoundError) as exc_info:
                client.invoke("missing-agent")
        assert exc_info.value.status_code == 404

    def test_invoke_insufficient_budget(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        exc = _make_http_error(402, {"error": "Insufficient budget"})
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(InsufficientBudgetError) as exc_info:
                client.invoke("summarizer", text="...")
        assert exc_info.value.status_code == 402

    def test_invoke_rate_limit(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        exc = _make_http_error(429, {"error": "Rate limit exceeded"})
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(RateLimitError) as exc_info:
                client.invoke("summarizer")
        assert exc_info.value.status_code == 429

    def test_invoke_generic_http_error(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        exc = _make_http_error(500, {"error": "Server error"})
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(WasiAIError) as exc_info:
                client.invoke("summarizer")
        assert exc_info.value.status_code == 500

    def test_invoke_url_error(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        exc = urllib.error.URLError("Connection refused")
        with patch("urllib.request.urlopen", side_effect=exc):
            with pytest.raises(WasiAIError):
                client.invoke("summarizer")

    def test_invoke_sends_correct_body(self) -> None:
        client = WasiAI(api_key="wasi_test", base_url="http://localhost")
        response_data = {"output": "ok", "agent_slug": "s", "call_id": "c1"}
        mock_resp = _make_response(response_data)
        captured: list = []

        def fake_urlopen(req, timeout=None):  # type: ignore[no-untyped-def]
            captured.append(req)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            client.invoke("summarizer", text="hello", lang="es")

        req = captured[0]
        body = json.loads(req.data.decode())
        assert body == {"input": {"text": "hello", "lang": "es"}}
        assert req.get_header("X-api-key") == "wasi_test"
