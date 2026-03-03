# Sprint 18 — Planning

**Fecha:** 2026-03-03  
**Estado:** APROBADO por PO  
**Total:** 11 Story Points  
**Modo:** QUALITY (producción, pagos reales)

---

## Objetivo del Sprint

Cerrar la deuda técnica crítica del Sprint 17 que bloquea seguridad y confiabilidad del contrato WasiEscrow en testnet, y elevar la calidad del frontend antes de la ventana Mainnet del Sprint 19.

**Definition of Done del sprint:**
- `refundExpired()` ejecutable trustless por cualquier wallet → contratos seguros
- Pipeline CI verde con Playwright en GitHub Actions → merge-gate operativo
- Pre-deploy checklist automatizado → zero deploy sin validación de env
- Cards de Home con íconos correctos y EscrowInfoBanner con datos dinámicos

---

## Historia de Usuario — Tabla

| ID Linear | Título | SP | Prioridad | Bloque |
|-----------|--------|----|-----------|--------|
| WAS-118 | `refundExpired()` trustless en WasiEscrow | 3 | P0 — Urgent | Deuda S17 |
| WAS-119 | Pre-deploy checklist + env validation | 2 | P0 — Urgent | Deuda S17 |
| WAS-120 | Playwright CI — GitHub Actions suite | 3 | P0 — Urgent | Deuda S17 |
| WAS-121 | Fix íconos cards Home | 1 | P2 — Medium | Calidad |
| WAS-122 | `_callEscrow()` helper + `estimated_completion` dinámico en EscrowInfoBanner | 2 | P2 — Medium | Calidad |

**Total: 11 SP** (Bloque 1: 8 SP · Bloque 2: 3 SP)

---

## Bloque 1 — Deuda S17 (8 SP)

### WAS-118 · `refundExpired()` trustless en WasiEscrow · 3 SP · P0

**Contexto:** Actualmente el reembolso por expiración requiere intervención del owner. Debe ser invocable trustless por cualquier wallet tras el deadline.

**ACs:**
- `refundExpired(orderId)` callable por cualquier EOA/contrato
- Reverts si `block.timestamp < deadline`
- Emite `OrderRefunded` con `triggeredBy` = caller
- Forge tests: happy path + revert anticipado + revert doble-claim
- Gas < 80k en happy path

**Dependencias:** Ninguna (contrato aislado en testnet)

---

### WAS-119 · Pre-deploy checklist + env validation · 2 SP · P0

**Contexto:** Deployments manuales sin validación han causado incidentes. Necesitamos un script que gate el deploy.

**ACs:**
- Script `scripts/pre-deploy-check.sh` ejecutable en CI y local
- Valida: vars de entorno requeridas, RPC_URL alcanzable, balance deployer > threshold, contrato no ya deployado en misma address
- Salida legible con ✅/❌ por ítem
- Exit code 1 si cualquier check falla
- Documentado en `doc/deployment.md`

**Dependencias:** Ninguna

---

### WAS-120 · Playwright CI — GitHub Actions suite · 3 SP · P0

**Contexto:** No existe merge-gate E2E. PRs pueden romper flujos críticos sin detección.

**ACs:**
- Workflow `.github/workflows/playwright.yml` ejecuta en push a `master`/`main` y en PRs
- Tests cubren: home load, crear orden, banner escrow visible, wallet connect mock
- Paralelizado con sharding (mínimo 2 workers)
- Artifacts con traces y screenshots en fallos
- README actualizado con badge CI

**Dependencias:** WAS-119 (env validation debe estar disponible para CI)

---

## Bloque 2 — Calidad (3 SP)

### WAS-121 · Fix íconos cards Home · 1 SP · P2

**Contexto:** Cards en Home muestran íconos incorrectos o rotos en ciertas categorías.

**ACs:**
- Íconos correctos en todas las categorías de cards (verificar con screenshot)
- Sin regresión en layout mobile/desktop
- No introducir dependencias nuevas de íconos

**Dependencias:** Ninguna

---

### WAS-122 · `_callEscrow()` helper + `estimated_completion` dinámico en EscrowInfoBanner · 2 SP · P2

**Contexto:** EscrowInfoBanner hace llamadas directas repetitivas al contrato y muestra completion estático.

**ACs:**
- Helper `_callEscrow(method, args)` centraliza todas las llamadas al contrato
- `estimated_completion` calculado dinámicamente desde `createdAt + sla_hours` de la orden
- Banner muestra countdown real en formato legible (`Xh Ym restantes`)
- Tests unitarios del helper con mock de provider
- Sin cambios en la ABI del contrato

**Dependencias:** WAS-118 (estructura de orden debe estar estabilizada)

---

## Dependencias del Sprint

```
WAS-118 ──► WAS-122 (estructura OrderRefunded estable)
WAS-119 ──► WAS-120 (env validation disponible para CI)
WAS-121   (independiente)
```

**Orden de ejecución recomendado:**
1. W0 (serial): WAS-118, WAS-119
2. W1 (paralelo): WAS-120, WAS-121, WAS-122

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Playwright flaky en CI por wallet mock | Media | Alto | Usar fixtures deterministas; retry 2x en CI |
| Gas de `refundExpired()` supera 80k | Baja | Medio | Perfilar con `forge snapshot` antes de merge |
| EscrowInfoBanner con datos stale por caché | Media | Medio | Invalidar caché en cambio de orderId |
| Env vars prod vs testnet mezcladas | Baja | Crítico | WAS-119 mitiga; doble-check en PR review |

---

## Bloque Mainnet → Sprint 19

Las siguientes HUs están **fuera del alcance de S18** y bloqueadas hasta que S18 esté verde:

| ID | Título | Razón del bloqueo |
|----|--------|------------------|
| WAS-43 | Deploy WasiEscrow Mainnet | Requiere WAS-118 + WAS-119 completos |
| WAS-22 | Listado de modelos en Mainnet | Requiere CI verde (WAS-120) |
| WAS-39 | Integración pagos reales end-to-end | Requiere WAS-43 previo |
| — | Outreach 3 creadores fundadores | Requiere producto estable en Mainnet |

> **Decisión PO:** Mainnet window target = inicio Sprint 19. No se adelanta ninguna tarea de Mainnet a S18 bajo ninguna circunstancia.

---

## Métricas de éxito S18

- [ ] Forge tests WAS-118: 0 fallos
- [ ] CI Playwright: verde en master
- [ ] Pre-deploy script: validado en staging
- [ ] Build Vercel: 0 errores, 0 warnings nuevos
- [ ] Cards Home: screenshot aprobado por PO
- [ ] Velocity real vs planeada: ≥ 90% (≥ 10/11 SP entregados)
