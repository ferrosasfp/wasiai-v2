# wasiai — Python SDK

Official Python SDK for [WasiAI](https://wasiai-v2.vercel.app) — The Home of AI Agents.

## Installation

```bash
pip install wasiai
```

## Quickstart

```python
from wasiai import WasiAI

client = WasiAI(api_key="wasi_xxx")

# Invoke an agent
result = client.invoke("summarizer", text="Resume esto en una oración...")
print(result.output)
print(result.call_id)
print(result.latency_ms)

# List agents
page = client.agents.list(page=1, category="nlp")
for agent in page.agents:
    print(agent.slug, agent.price_usdc)

# Get a specific agent
agent = client.agents.get("summarizer")
print(agent.name, agent.description)
```

## Error handling

```python
from wasiai import WasiAI, AgentNotFoundError, InsufficientBudgetError, RateLimitError

client = WasiAI(api_key="wasi_xxx")

try:
    result = client.invoke("summarizer", text="...")
except AgentNotFoundError:
    print("Agent not found")
except InsufficientBudgetError:
    print("Top up your USDC balance")
except RateLimitError:
    print("Slow down!")
```

## Requirements

- Python 3.9+
- Zero external dependencies (stdlib only)

## License

MIT
