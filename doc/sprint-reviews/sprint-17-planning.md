# Sprint 17 Planning — WasiAI v2

**Fecha:** 2026-03-02  
**Scrum Master:** San (NexusAgil QUALITY mode)  
**Estado:** PLANNING  
**Sprint anterior:** 16 — referencia  
**Próxima migración disponible:** a confirmar en F0

---

## Sprint Goal

> **"Blindar el stack de pagos on-chain: tests ERC-3009 reales, arquitectura dual-flow consolidada, settlement automático vía listener, CLI para developers, escrow para tareas largas y primer plugin de ecosistema LlamaIndex."**

Sprint de madurez blockchain + ecosistema: cerramos deuda de calidad en contratos, automatizamos el settlement y abrimos WasiAI a integradores externos.

---

## HUs seleccionadas — Sprint 17

### Resumen ejecutivo

| # | ID | HU | SP | Prioridad | Modo |
|---|----|----|-----|-----------|------|
| 1 | WAS-89 | Tests MockUSDC firma ERC-3009 | 5 | P0-seguridad | QUALITY |
| 2 | WAS-103 | Arquitectura dual-flow (OZ-A1) | 3 | P1-arch | QUALITY |
| 3 | WAS-82 | Listener UpkeepPerformed → settlement | 8 | P1 | QUALITY |
| 4 | WAS-13 | CLI `wasiai invoke` | 5 | P2 | QUALITY |
| 5 | WAS-72 | Escrow para tareas largas | 13 | P2 | QUALITY |
| 6 | WAS-41 | Plugin LlamaIndex | 8 | P3-ecosistema | QUALITY |

**Total SP propuestos: 42**  
**Capacidad recomendada: 38 SP** (WAS-72 y WAS-41 como stretch si sprint avanza bien)

---

## HU-1: WAS-89 — Tests MockUSDC firma ERC-3009

**Descripción:**  
Los tests actuales usan `MockUSDC` que skipea la verificación de firma ERC-3009. Esto deja sin cobertura el flujo de autorización `transferWithAuthorization` que es el mecanismo real de pago en producción. Un bug en la firma podría permitir pagos inválidos o bloquear pagos legítimos.

**Acceptance Criteria (EARS):**
- [ ] **CUANDO** se ejecuta `forge test`, los tests de `WasiMarketplace` incluyen al menos 2 casos que validan firma ERC-3009 real (valid signer, invalid signer)
- [ ] **SI** la firma es inválida, el contrato revierte con el error esperado
- [ ] **SI** la firma es válida pero el nonce ya fue usado (replay), el contrato revierte
- [ ] **CUANDO** se ejecuta `forge coverage`, cobertura de firma ERC-3009 ≥ 80%
- [ ] MockUSDC actualizado para soportar verificación real o reemplazado por implementación ERC-20Permit compatible

**Story Points:** 5  
**Dependencias:** Ninguna (base de toda la suite)  
**Scope IN:** Tests forge, MockUSDC actualizado  
**Scope OUT:** Cambios al contrato en producción  

---

## HU-2: WAS-103 — Arquitectura dual-flow (OZ-A1)

**Descripción:**  
Hallazgo de auditoría OZ-A1: el contrato tiene superficie de ataque innecesaria por manejar dos flows distintos en el mismo contrato sin separación clara. Tarea de arquitectura: documentar, simplificar o separar responsabilidades para reducir superficie de ataque.

**Acceptance Criteria (EARS):**
- [ ] **CUANDO** se revisa el contrato, existe documentación en `contracts/` explicando el dual-flow y decisión de diseño
- [ ] **SI** se puede refactorizar sin riesgo, se implementa separación de flows en funciones distintas con modificadores explícitos
- [ ] **CUANDO** se ejecuta `forge test` tras refactor, todos los tests pasan
- [ ] SDD actualizado en `doc/sdd/` con nuevo context map de contratos
- [ ] Adversarial Review aprobado por rol Adversary antes de merge

**Story Points:** 3  
**Dependencias:** WAS-89 (tener tests sólidos antes de refactorizar contratos)  
**Scope IN:** Refactor arquitectónico, documentación  
**Scope OUT:** Nuevas features, cambio de lógica de negocio  

---

## HU-3: WAS-82 — Listener UpkeepPerformed → settlement automático

**Descripción:**  
`performUpkeep` actualmente emite `UpkeepPerformed` pero no ejecuta el settlement real. Implementar Opción A: un worker/listener backend que escucha el evento via `viem watchContractEvent` y dispara `settleKeyBatchOnChain()` automáticamente.

**Acceptance Criteria (EARS):**
- [ ] **CUANDO** Chainlink Automation llama `performUpkeep`, el evento `UpkeepPerformed` es detectado por el listener backend en ≤ 30 segundos
- [ ] **AL DETECTAR** el evento, el backend ejecuta `settleKeyBatchOnChain()` automáticamente sin intervención manual
- [ ] **SI** `settleKeyBatchOnChain()` falla, el error queda loggeado y se reintenta máximo 3 veces
- [ ] **CUANDO** se ejecuta en Fuji testnet, el settlement end-to-end funciona sin intervención humana
- [ ] Worker corre como proceso persistente (o cron/edge function) con restart automático
- [ ] Tests de integración con mock de evento on-chain

**Story Points:** 8  
**Dependencias:** WAS-89 (tests sólidos), WAS-39 (mainnet deploy — prerequisito documentado, no bloqueante para testnet)  
**Scope IN:** `marketplaceClient.ts` listener, worker dedicado, retry logic  
**Scope OUT:** UI para monitorear settlements, alertas Slack  

---

## HU-4: WAS-13 — CLI `wasiai invoke`

**Descripción:**  
Como developer, quiero llamar agentes WasiAI directamente desde la terminal para integrar en scripts y pipelines CI/CD. Reemplaza WAS-114 (duplicado, marcado Won't Do).

**Acceptance Criteria (EARS):**
- [ ] `npx wasiai invoke <slug> '<input>'` funciona y retorna resultado en stdout
- [ ] Flag `--key <api-key>` para autenticación
- [ ] Flag `--format json|text` controla formato de salida
- [ ] Flag `--env fuji|mainnet` selecciona endpoint
- [ ] Exit code `0` en éxito, `1` en error con mensaje descriptivo en stderr
- [ ] **CUANDO** el agente no existe, retorna error claro (no stack trace)
- [ ] Publicado como `wasiai` en npm (o funcionando via `npx wasiai`)
- [ ] README con ejemplos de uso y casos CI/CD

**Story Points:** 5  
**Dependencias:** Ninguna (usa API pública existente)  
**Scope IN:** CLI invoke, flags básicos, npm package  
**Scope OUT:** Gestión de keys desde CLI, login interactivo, listar agentes  
**Nota:** WAS-114 marcado como Won't Do (duplicado de esta HU)

---

## HU-5: WAS-72 — Escrow para tareas largas

**Descripción:**  
Agentes que toman minutos (video, entrenamiento) necesitan escrow: el caller deposita, el agente completa, el caller confirma y el escrow libera al creator. Sin esto, el caller pierde USDC si el agente falla.

**Acceptance Criteria (EARS):**
- [ ] **CUANDO** un caller invoca un agente marcado como `long_running`, el pago va a escrow on-chain (no directo al creator)
- [ ] **CUANDO** el agente completa y el resultado está disponible, el caller puede confirmar recepción → escrow libera USDC al creator
- [ ] **SI** el caller no confirma en 24h, el escrow hace auto-release al creator
- [ ] **SI** el agente falla (error reportado), el caller puede reclamar refund desde escrow
- [ ] Smart contract `WasiEscrow` con funciones: `deposit`, `release`, `refund`, `autoRelease`
- [ ] Tests forge: flujo happy path, fallo de agente, auto-release por timeout
- [ ] UI: banner en agent page si es `long_running`, estado del escrow en "My Calls"
- [ ] Migración SQL para tabla `escrow_transactions`

**Story Points:** 13 (stretch)  
**Dependencias:** WAS-89 (tests ERC-3009), WAS-103 (arquitectura limpia), WAS-82 (settlement automático)  
**Scope IN:** Contrato escrow, backend escrow logic, UI básica  
**Scope OUT:** Dispute resolution on-chain, sistema de arbitraje, multi-currency  

---

## HU-6: WAS-41 — Plugin LlamaIndex

**Descripción:**  
Package `llama-index-wasiai` que permite a usuarios de LlamaIndex usar agentes WasiAI como tools nativas. Primer plugin de ecosistema externo.

**Acceptance Criteria (EARS):**
- [ ] Package `llama-index-wasiai` publicado en npm (o beta installable)
- [ ] **CUANDO** se instala el package, se puede importar `WasiAITool` y usarlo en un LlamaIndex agent
- [ ] `WasiAITool` acepta `agentSlug`, `apiKey` y `description` en el constructor
- [ ] `call(input)` invoca el agente via API WasiAI y retorna el resultado como string
- [ ] Ejemplo funcional en `examples/llamaindex/` en el repo
- [ ] README con quick start (5 líneas de código para integrar)
- [ ] Tests unitarios con mock de la API WasiAI

**Story Points:** 8 (stretch)  
**Dependencias:** WAS-13 (CLI/API invoke estable como base)  
**Scope IN:** npm package, WasiAITool class, ejemplo, docs  
**Scope OUT:** Plugin LangChain, plugin OpenAI SDK, soporte streaming  

---

## Dependencias entre HUs

```
WAS-89 (tests ERC-3009)
  └─→ WAS-103 (refactor dual-flow, necesita tests sólidos)
  └─→ WAS-82 (listener settlement, necesita contratos testeados)
       └─→ WAS-72 (escrow, necesita settlement automático)

WAS-13 (CLI invoke) — independiente
  └─→ WAS-41 (plugin LlamaIndex, usa API que CLI valida)

WAS-72 depende de WAS-89 + WAS-103 + WAS-82 (todos blockchain)
```

**Orden de ejecución recomendado:**
1. WAS-89 (desbloqueador)
2. WAS-103 y WAS-13 (en paralelo)
3. WAS-82 (cuando WAS-89 done)
4. WAS-41 (cuando WAS-13 done)
5. WAS-72 (cuando WAS-89 + WAS-103 + WAS-82 done)

---

## Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| WAS-72 (Escrow) subestimado — contratos on-chain siempre escalan | Alta | Alto | Marcado como stretch. Si WAS-89+82 consumen más SP, WAS-72 pasa a Sprint 18 |
| MockUSDC no compatible con ERC-3009 real — requiere reescritura completa | Media | Medio | F2 Codebase Grounding profundo antes de estimar; puede subir a 8 SP |
| Chainlink Automation en Fuji inestable — timeouts frecuentes en testnet | Media | Medio | WAS-82 debe funcionar con trigger manual como fallback |
| npm publish `wasiai` — nombre puede estar tomado | Baja | Bajo | Verificar disponibilidad en F0; alternativa: `@wasiai/cli` |
| WAS-103 (refactor) introduce regresiones en contratos | Baja | Alto | Tests WAS-89 como red de seguridad obligatoria antes de merge |

---

## Capacidad del Sprint

| Métrica | Valor |
|---------|-------|
| SP comprometidos (P0-P2) | 29 |
| SP stretch (WAS-72 + WAS-41) | 21 |
| SP total planeado | 42 |
| Velocidad Sprint 15 | 37 SP |
| Capacidad recomendada | 38 SP |
| Buffer | Los 4 SP extra vienen de velocidad demostrada |

**Recomendación:** Comprometer WAS-89 + WAS-103 + WAS-82 + WAS-13 (29 SP). WAS-72 y WAS-41 entran si el sprint avanza por encima del 75% al día 5.

---

## Definition of Done (Sprint 17)

- [ ] Todos los ACs de cada HU validados con evidencia (`archivo:línea`)
- [ ] `forge test` 0 errores para HUs blockchain
- [ ] `npm run build` 0 errores
- [ ] Adversarial Review aprobado para WAS-89, WAS-103, WAS-82, WAS-72
- [ ] `git push origin master master:main`
- [ ] `sprint-status.yaml` actualizado a Sprint 17 estado DONE
- [ ] Sprint Review doc creado

---

*Generado por San (NexusAgil SM) — 2026-03-02*
