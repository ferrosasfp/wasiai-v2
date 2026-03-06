# Work Item #047 — WAS-160: Dual Registration: Off-chain (free) + On-chain (ERC-8004) con Upgrade Path

> Fecha: 2026-03-05
> Tipo: EPIC (feature)
> SDD_MODE: full
> Branch: feat/047-dual-registration

---

## Work Item

| Campo | Valor |
|-------|-------|
| **#** | 047 |
| **Linear** | WAS-160 |
| **Tipo** | EPIC — feature |
| **SDD_MODE** | full |
| **Objetivo** | Registro dual de agentes: off-chain (gratis, inmediato) y on-chain (ERC-8004, con gas). Creators con wallet pueden registrar on-chain de frente. Creators sin wallet registran off-chain y pueden escalar después. Agentes con AgentKit wallet sugieren on-chain por default. Gas lo paga siempre el creador/upgrader. |
| **Reglas de negocio** | Ver sección abajo |
| **Scope IN** | Registro off-chain, upgrade a on-chain, UI de upgrade, beneficios diferenciados, `selfRegisterAgent()` en contrato |
| **Scope OUT** | Migración masiva de agentes existentes, subsidio de gas |
| **Missing Inputs** | N/A — WAS-160f cubre retrocompat de agentes existentes |

---

## Contexto — Decisiones previas

- **WAS-159** (evaluado): Se decidió **NO eliminar** el registro on-chain automático actual. Se mantiene como opción.
- **WAS-158**: Migración Pinata → Supabase Storage (en progreso). La metadata URI de agentes estará en Supabase.
- **WAS-160**: Este EPIC. Dual registration con upgrade path voluntario.

---

## Reglas de Negocio

### RN-1: Tres paths de registro
| Escenario | Default | Costo | Velocidad | Almacenamiento |
|-----------|---------|-------|-----------|----------------|
| **Creator sin wallet** | Off-chain automático | Gratis | Inmediato | Solo Supabase |
| **Creator con wallet conectada** | Elige: on-chain u off-chain | On-chain: gas fee / Off-chain: gratis | On-chain: ~15-30s / Off-chain: inmediato | On-chain: Supabase + ERC-8004 token |
| **Agente con AgentKit wallet** | On-chain sugerido (default) | Gas fee | ~15-30s confirmación | Supabase + ERC-8004 token |

### RN-2: Upgrade path
- Un agente off-chain puede escalar a on-chain en cualquier momento.
- El upgrade lo inicia el **owner del agente** (creator original o transferido).
- El gas lo paga **siempre** quien ejecuta la transacción (owner/upgrader).
- El upgrade es **irreversible**: una vez on-chain, siempre on-chain.

### RN-3: Identidad consistente
- El agente mantiene el **mismo UUID** en Supabase al escalar.
- Al hacer upgrade, se mintea el token ERC-8004 y se asocia `token_id` + `chain_registered_at` al registro existente.
- No se duplican registros. Es un enriquecimiento del registro off-chain.

### RN-4: Sin degradación de servicio
- Un agente off-chain tiene **funcionalidad completa** en la plataforma (discovery, invocación, pagos, keys).
- La diferencia está en los **beneficios adicionales** de on-chain (ver sección Value Prop).

---

## Value Prop: ¿Por qué escalar a On-chain?

> Si no hay diferencia percibida, nadie va a escalar. Estos son los beneficios concretos:

### 🔒 Propiedad Verificable (Ownership)
| Aspecto | Off-chain | On-chain |
|---------|-----------|----------|
| Propiedad | Registro en BD (Supabase) — confianza en la plataforma | Token ERC-8004 — propiedad criptográfica, verificable por cualquiera |
| Transferencia de ownership | Manual (soporte) | `transferFrom()` — cambio de owner on-chain (ej. cambiar quién cobra earnings) |
| Prueba de autoría | "Trust me bro" | On-chain timestamp inmutable |

**Para el creator**: "Este agente es MÍO, demostrable en cualquier explorador de bloques. Nadie — ni WasiAI — puede quitármelo."

### 🌐 Composabilidad Cross-Protocol
| Aspecto | Off-chain | On-chain |
|---------|-----------|----------|
| Integración con DeFi | ❌ | ✅ Puede ser colateral, referenciado en protocolos on-chain |
| Integración con otros protocolos AI | Requiere API custom | Estándar ERC-8004 — cualquier protocolo compatible puede leerlo |
| DAOs / Gobernanza | ❌ | ✅ Token-gating basado en ownership |

**Para el creator**: "Mi agente puede interactuar con el ecosistema Web3 sin pedir permiso a nadie."

### 📊 Reputación Inmutable
| Aspecto | Off-chain | On-chain |
|---------|-----------|----------|
| Historial | Editable por plataforma | Inmutable en blockchain |
| Credibilidad | Depende de WasiAI | Verificable independientemente |
| Portabilidad | Atado a WasiAI | Migrable a cualquier plataforma que lea ERC-8004 |

**Para el creator**: "Mi reputación viaja conmigo. Si WasiAI desaparece mañana, mi agente y su historial siguen existiendo."

### 🛡️ Resistencia a Censura
| Aspecto | Off-chain | On-chain |
|---------|-----------|----------|
| Plataforma baja el agente | Desaparece | Token persiste — re-listable en otro frontend |
| Disputa de ownership | Resolución manual | Resolución criptográfica |

**Para el creator**: "Mi agente no puede ser eliminado silenciosamente. El registro on-chain es mi seguro."

### 🏷️ Badge y Visibilidad
| Aspecto | Off-chain | On-chain |
|---------|-----------|----------|
| Badge en UI | Ninguno | ✅ "Verified On-chain" badge |
| Ranking en discovery | Normal | Boost en algoritmo de discovery |
| Trust signal para usuarios | — | "Este agente tiene ownership verificada" |

**Para el usuario final**: "Prefiero usar agentes verificados on-chain — sé que alguien real está detrás."

---

## Acceptance Criteria (EARS)

### Registro según contexto de wallet
1. **WHEN** un creator **sin wallet conectada** publica un agente, **THE** sistema **SHALL** registrarlo off-chain (solo Supabase) automáticamente, sin solicitar transacción blockchain.
2. **WHEN** un creator **con wallet conectada** publica un agente, **THE** sistema **SHALL** presentar la opción de registrar on-chain (gas fee) u off-chain (gratis), permitiendo elegir.
3. **WHEN** un agente con **AgentKit wallet** se registra, **THE** sistema **SHALL** sugerir registro on-chain como default, con opción de elegir off-chain.
4. **WHILE** un agente está registrado solo off-chain, **THE** sistema **SHALL** permitir funcionalidad completa: discovery, invocación, pagos, keys, edición.

### Upgrade a On-chain (para agentes ya registrados off-chain)
5. **WHEN** el owner de un agente off-chain solicita upgrade a on-chain, **THE** sistema **SHALL** presentar un flujo de upgrade con: beneficios, estimado de gas, y confirmación de wallet.
6. **WHEN** el owner confirma el upgrade y firma la transacción, **THE** sistema **SHALL** mintear el token ERC-8004 y asociar `token_id` + `chain_registered_at` al registro existente sin crear un nuevo UUID.
7. **IF** la transacción de upgrade falla o es revertida, **THEN THE** sistema **SHALL** mantener el agente en estado off-chain sin modificaciones, mostrando error descriptivo al usuario.

### Irreversibilidad y estado
8. **WHILE** un agente está registrado on-chain, **THE** sistema **SHALL** mostrar badge "On-chain Verified" en la detail page, cards, y perfil del creator.
9. **IF** un agente ya está registrado on-chain, **THEN THE** sistema **SHALL** ocultar la opción de upgrade (ya completado).

### Gas y costos
10. **WHEN** el owner inicia registro o upgrade on-chain, **THE** sistema **SHALL** mostrar estimado de gas en AVAX antes de solicitar firma.
11. **WHILE** la transacción está pendiente (registro directo o upgrade), **THE** sistema **SHALL** mostrar estado "Registering on-chain..." / "Upgrading..." con indicador de progreso.

### Discovery boost
12. **WHEN** el algoritmo de discovery ordena agentes, **THE** sistema **SHALL** aplicar boost de ranking a agentes on-chain sobre off-chain (con igual score base).

---

## Scope IN
- Detección de wallet para determinar path de registro (sin wallet → off-chain / con wallet → elige / AgentKit → on-chain sugerido)
- Nuevo flujo de registro off-chain (sin tx blockchain)
- Registro on-chain directo para creators con wallet
- UI de upgrade (botón, modal, estimado gas, confirmación)
- Mint ERC-8004 durante upgrade
- Badge "On-chain Verified" en UI
- Boost en discovery para agentes on-chain
- Migración de schema: columnas `registration_type`, `token_id`, `chain_registered_at`

## Scope OUT
- Modificar `registerAgent()` existente (se mantiene intacta para operator/AgentKit)
- Migración automática de agentes existentes (se manejan como on-chain, ya lo están)
- Subsidio de gas por parte de WasiAI
- Reventa/marketplace secundario (el endpoint es web2 del creator — el token sin backend no tiene valor standalone)

---

## Propuesta de Sub-HUs (breakdown del EPIC)

| Sub-HU | Descripción | Dependencia | Tamaño |
|--------|-------------|-------------|--------|
| WAS-160g | Contrato: `selfRegisterAgent()` — creator firma y paga gas + tests Foundry | — | S |
| WAS-160a | Schema migration: `registration_type` enum + columnas + retrocompat agentes existentes | — | S |
| WAS-160b | Refactor publish flow: 3 paths según contexto de wallet (sin wallet → off-chain / con wallet → elige / AgentKit → on-chain sugerido) | WAS-160a, WAS-160g, WAS-158 | M |
| WAS-160c | API + UI: Upgrade modal con estimado gas + mint via `selfRegisterAgent` | WAS-160a, WAS-160g | L |
| WAS-160d | Badge "On-chain Verified" en cards, detail, perfil | WAS-160a | S |
| WAS-160e | Discovery boost para agentes on-chain (RPC function) | WAS-160a | S |

---

*Work Item generado por NexusAgil — F1*
*HU_APPROVED: 2026-03-05 | SPEC_APPROVED: 2026-03-05*
