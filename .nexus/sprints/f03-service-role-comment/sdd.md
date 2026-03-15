# SDD F-03: SECURITY_NOTE comment en health-probe

> SPEC_APPROVED: no
> Fecha: 2026-03-14
> Tipo: tech-task
> SDD_MODE: mini
> Branch: fix/f03-service-role-comment

---

## 1. Resumen

`health-probe.ts` usa `createServiceClient()` que tiene SERVICE_ROLE key (bypassa RLS). No existe ningún comentario que explique por qué es necesario — un auditor de seguridad podría marcarlo como vulnerabilidad sin el contexto. Añadir un `// SECURITY_NOTE` explícito.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | F-03 |
| **Tipo** | tech-task |
| **Objetivo** | Documentar con SECURITY_NOTE por qué SERVICE_ROLE es necesario en probe |
| **Scope IN** | `src/lib/agents/health-probe.ts` — solo el comentario |
| **Scope OUT** | Cambiar la implementación, otros archivos |

## 3. Context Map

### Exemplars
| Para modificar | Seguir patrón de |
|---------------|-----------------|
| `health-probe.ts` línea 5-6 | Comentarios existentes en el mismo archivo |

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|---------|
| `src/lib/agents/health-probe.ts` | Modificar | Añadir comentario SECURITY_NOTE antes de `createServiceClient()` | mismo archivo |

## 5. Acceptance Criteria (EARS)

1. WHEN `src/lib/agents/health-probe.ts` es revisado, THE línea antes de `const serviceClient = createServiceClient()` SHALL tener un comentario `// SECURITY_NOTE:` explicando que: (a) probe corre sin sesión de usuario, (b) necesita escribir en tabla `agents` para actualizar health status, (c) el scope está limitado únicamente a updates en `agents` via `.eq('id', agentId)`
2. WHEN el comentario existe, THE SHALL ser visible dentro de la función `probeEndpoint` (no a nivel de módulo)

## 6. Constraint Directives

### PROHIBIDO
- NO cambiar ninguna lógica
- NO crear archivos nuevos
- NO mover imports
- NO expandir scope más allá de un comentario de 3-5 líneas

---

*SDD generado por NexusAgil — MINI*
