# Análisis de Producto — WAS-142 RAG / Knowledge Base
**Fecha:** 2026-03-04  
**Autores:** Fer (decisión) + San (PO) + SM

---

## Epic Breakdown — 6 HUs en 3 Sprints

### Sprint A — "Fundaciones"
| HU | Descripción | Talla | Modo |
|----|-------------|-------|------|
| WAS-143 | Activar Storage page en nav + ampliar upload a PDF/TXT/CSV/JSON | S | FAST |
| WAS-144 | Migración pgvector + tabla `knowledge_chunks` (id, agent_id, content, embedding, metadata) | S | QUALITY |

### Sprint B — "Pipeline RAG"
| HU | Descripción | Talla | Modo |
|----|-------------|-------|------|
| WAS-145 | Indexación automática — chunking + embeddings vía OpenAI/Supabase Edge Function | M | QUALITY |
| WAS-146 | Retrieval en invocación — inyectar contexto relevante en body antes de llamar endpoint_url | M | QUALITY |

### Sprint C — "Creator UX"
| HU | Descripción | Talla | Modo |
|----|-------------|-------|------|
| WAS-147 | UI en create/edit agent — sección "Knowledge Base": asociar/desasociar docs | M | QUALITY |
| WAS-148 | Storage page completa — lista docs, estado de indexación, eliminar | S | QUALITY |

### Dependencias
```
WAS-143 (nav + upload) ──→ WAS-145 (indexación)
WAS-144 (pgvector)     ──→ WAS-145 (indexación)
WAS-145 (indexación)   ──→ WAS-146 (retrieval)
WAS-146 (retrieval)    ──→ WAS-147 + WAS-148 (UX)
```

---

## Inventario de lo que ya existe

| Componente | Estado |
|-----------|--------|
| `StoragePage` + `FileUploader` + `StorageViewer` | ✅ Existe, oculta en nav |
| `/api/storage/upload` → Pinata IPFS | ✅ Funciona — solo imágenes hoy |
| `tsvector` en agents (full-text search) | ✅ Existe — NO es pgvector |
| `pgvector` en Supabase | ❌ No habilitado |
| RAG pipeline | ❌ No existe |
| Knowledge base ligada a agente | ❌ No existe |

---

## Evaluación de Valor — Decisión de diferir

### Veredicto
| Dimensión | Score | Razón |
|-----------|-------|-------|
| Valor técnico | ⭐⭐⭐⭐ | Bien ejecutable con stack actual |
| Valor de producto | ⭐⭐ | Resuelve problema que el usuario actual no tiene |
| Timing | ❌ | Pre-mainnet, pre-creators, pre-tracción |
| Costo/beneficio | ⚠️ | 3 sprints para feature sin usuarios que la consuman hoy |

### El dilema de audiencia
El creator no-técnico que más se beneficiaría de RAG (sube docs, no maneja backend) 
no puede publicar un agente hoy — WasiAI requiere `endpoint_url`. 
Son audiencias distintas.

El creator técnico que ya tiene su backend no necesita RAG de WasiAI — lo implementa él solo.

### Diferenciador real (cuando tenga sentido)
**RAG + monetización x402 automatizada** — nadie más tiene eso.
Pero requiere primero un "modo no-code" donde WasiAI construya el agente completo.
Eso es un producto diferente al actual.

### Comparación de mercado
| Plataforma | RAG nativo | Nota |
|------------|------------|------|
| OpenAI GPTs | ✅ File search | Masivo, gratuito |
| Flowise / Dify | ✅ No-code + RAG | Competidor directo |
| LangChain / LlamaIndex | ✅ Core del producto | Para devs |
| WasiAI con RAG | ✅ + x402 | Único diferenciador futuro |

---

## Decisión
**DIFERIR** — implementar post-mainnet y post-primeros 10 creators reales.

**Condiciones para retomar:**
1. Mainnet desplegado (WAS-22 done)
2. Al menos 5 creators activos con agentes en producción
3. Feedback explícito de creators pidiendo contexto propio

**Prioridad actual:** Bloque mainnet (WAS-22 → WAS-130 → WAS-79 → WAS-39)
