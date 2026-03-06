# Story HU-2.2 — SDK Python (`pip install wasiai`)

**Estado:** In Progress  
**Fecha:** 2026-02-26  
**Sprint:** 3

---

## Historia

Como developer Python que trabaja con LangChain, notebooks o scripts de IA,
quiero instalar `wasiai` con pip e invocar agentes en 3 líneas,
para integrar WasiAI en mi stack sin construir HTTP manualmente.

```python
from wasiai import WasiAI
client = WasiAI(api_key="wasi_xxx")
result = client.invoke("summarizer", text="Resume esto...")
print(result.output)
```

---

## Acceptance Criteria

- [ ] `pip install wasiai` funciona desde PyPI público
- [ ] `client.invoke(slug, **kwargs)` retorna output del agente
- [ ] `client.agents.list()` retorna catálogo paginado
- [ ] `client.agents.get(slug)` retorna detalle de un agente
- [ ] Excepciones tipadas: `InsufficientBudgetError`, `AgentNotFoundError`, `WasiAIError` base
- [ ] Type hints completos (mypy compatible)
- [ ] README con quickstart funcional
- [ ] Compatibilidad: Python 3.9+
- [ ] Zero dependencias externas (solo stdlib)

---

## Estructura de archivos

```
packages/sdk-python/
├── wasiai/
│   ├── __init__.py       # exports públicos
│   ├── client.py         # WasiAI class principal
│   ├── agents.py         # AgentsResource (list, get)
│   ├── invoke.py         # lógica de invocación
│   ├── errors.py         # excepciones tipadas
│   └── types.py          # dataclasses públicos
├── tests/
│   ├── test_invoke.py
│   ├── test_agents.py
│   └── test_errors.py
├── pyproject.toml
└── README.md
```

---

## API pública

```python
from wasiai import WasiAI

client = WasiAI(api_key="wasi_xxx", base_url="https://wasiai-v2.vercel.app")

# Invoke
result = client.invoke("summarizer", text="...")
# result.output, result.call_id, result.latency_ms, result.agent_slug

# Discovery
page = client.agents.list(page=1, category="nlp")
# page.agents, page.total, page.has_more

agent = client.agents.get("summarizer")
# agent.slug, agent.name, agent.price_usdc
```

---

## Tipos (dataclasses)

```python
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
```

---

## Excepciones

```python
class WasiAIError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code

class InsufficientBudgetError(WasiAIError): ...  # 402
class AgentNotFoundError(WasiAIError): ...       # 404
class RateLimitError(WasiAIError): ...           # 429
```

---

## Endpoints que consume

| Método | Ruta | Header |
|---|---|---|
| POST | `/api/v1/agents/[slug]/invoke` | `X-API-Key: wasi_xxx` |
| GET | `/api/v1/agents` | ninguno (público) |
| GET | `/api/v1/agents/[slug]` | ninguno (público) |

Body invoke: `{"input": {**kwargs}}`

---

## pyproject.toml

```toml
[project]
name = "wasiai"
version = "0.1.0"
description = "Official Python SDK for WasiAI — The Home of AI Agents"
requires-python = ">=3.9"
dependencies = []

[project.optional-dependencies]
dev = ["pytest", "pytest-mock", "mypy"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

---

## DoD

- [ ] `python -m pytest tests/` — todos los tests pasan
- [ ] `mypy wasiai/` — 0 errores
- [ ] `python -m build` genera `dist/` limpio
- [ ] README con ejemplo copy-paste funcional
- [ ] Verificar disponibilidad del nombre `wasiai` en PyPI (no publicar aún — solo verificar)

---

## Notas de implementación

- Usar `urllib.request` (stdlib) — sin dependencias externas
- `**kwargs` se envía como `{"input": kwargs}` en el body JSON
- `base_url` default: `https://wasiai-v2.vercel.app`
- NO publicar a PyPI aún — generar el dist y documentar el proceso
