from typing import Optional


class WasiAIError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class InsufficientBudgetError(WasiAIError):
    """Raised when the account has insufficient budget (HTTP 402)."""


class AgentNotFoundError(WasiAIError):
    """Raised when the requested agent does not exist (HTTP 404)."""


class RateLimitError(WasiAIError):
    """Raised when the rate limit is exceeded (HTTP 429)."""
