"""Tests for error hierarchy."""
import pytest

from wasiai.errors import AgentNotFoundError, InsufficientBudgetError, RateLimitError, WasiAIError


class TestErrorHierarchy:
    def test_base_error(self) -> None:
        err = WasiAIError("something went wrong", status_code=500)
        assert str(err) == "something went wrong"
        assert err.status_code == 500
        assert isinstance(err, Exception)

    def test_base_error_no_status(self) -> None:
        err = WasiAIError("oops")
        assert err.status_code is None

    def test_insufficient_budget_is_wasiai_error(self) -> None:
        err = InsufficientBudgetError("no funds", status_code=402)
        assert isinstance(err, WasiAIError)
        assert err.status_code == 402

    def test_agent_not_found_is_wasiai_error(self) -> None:
        err = AgentNotFoundError("not found", status_code=404)
        assert isinstance(err, WasiAIError)
        assert err.status_code == 404

    def test_rate_limit_is_wasiai_error(self) -> None:
        err = RateLimitError("slow down", status_code=429)
        assert isinstance(err, WasiAIError)
        assert err.status_code == 429

    def test_catch_as_base_class(self) -> None:
        with pytest.raises(WasiAIError):
            raise InsufficientBudgetError("no funds", status_code=402)

    def test_catch_specific(self) -> None:
        with pytest.raises(AgentNotFoundError):
            raise AgentNotFoundError("agent not found", status_code=404)
