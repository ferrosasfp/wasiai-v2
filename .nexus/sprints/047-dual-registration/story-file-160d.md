# Story File — WAS-160d: Badge "On-chain Verified"

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration
> Depende de: WAS-160a (schema)

---

## Goal

Mostrar un badge "On-chain" en ModelCard, agent detail page, y perfil del creator para agentes con `registration_type === 'on_chain'`. Ocultar opción de upgrade si ya es on-chain.

## Acceptance Criteria (EARS)

1. WHILE un agente está registrado on-chain, THE sistema SHALL mostrar badge "On-chain Verified" en la detail page, cards, y perfil del creator. (AC8)
2. IF un agente ya está registrado on-chain, THEN THE sistema SHALL ocultar la opción de upgrade (ya completado). (AC9)

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/components/badges/OnChainBadge.tsx` | Crear | Badge reutilizable: ícono ShieldCheck + "On-chain" en pill verde | Badge inline existente en `ModelCard.tsx` línea 93-97 |
| 2 | `src/features/models/components/ModelCard.tsx` | Modificar | Reemplazar badge inline `on_chain_registered` por `<OnChainBadge />` usando `registration_type === 'on_chain'` | Mismo archivo, línea 93-97 |
| 3 | Agent detail page (locale) | Modificar | Agregar `<OnChainBadge />` junto al título si on-chain | Badges existentes en la page |
| 4 | `messages/en.json` | Modificar | Agregar key `agent.badge.onChain` | Keys existentes |
| 5 | `messages/es.json` | Modificar | Agregar key `agent.badge.onChain` | Keys existentes |

## Exemplars

### Exemplar 1: Badge inline en ModelCard
**Archivo**: `src/features/models/components/ModelCard.tsx` líneas 93-97
**Usar para**: Archivo #1
**Patrón clave**:
```tsx
{model.on_chain_registered && (
  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
    ✓ On-chain
  </span>
)}
```
- Migrar de inline a componente reutilizable
- Usar `ShieldCheck` de lucide-react (ya importado en ModelCard)
- Cambiar condición de `on_chain_registered` a `registration_type === 'on_chain'`

## Constraint Directives

### OBLIGATORIO
- Condición: `registration_type === 'on_chain'` (NO `on_chain_registered`)
- Ícono: `ShieldCheck` de lucide-react (ya en el proyecto)
- Estilo: pill verde consistente con badges existentes en ModelCard
- Componente exportado como named export

### PROHIBIDO
- NO agregar dependencias nuevas
- NO cambiar estilos de otros badges
- NO modificar lógica de negocio en ModelCard (solo reemplazar badge)

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Leer ModelCard.tsx, identificar badge inline actual

### Wave 1
- [ ] W1.1: Crear `OnChainBadge.tsx` → Archivo #1
- [ ] W1.2: i18n keys → Archivos #4, #5

### Wave 2
- [ ] W2.1: Reemplazar badge inline en ModelCard → Archivo #2
- [ ] W2.2: Agregar badge en agent detail page → Archivo #3

### Wave 3 (Verificación)
- [ ] W3.1: typecheck + build

## Out of Scope

- Upgrade modal/botón (WAS-160c)
- Publish flow (WAS-160b)
- Discovery boost (WAS-160e)

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
