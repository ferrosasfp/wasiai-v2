# Requirements Review — WAS-257 — Web3Provider lazy-load (HU-MAJOR)

**Fecha:** 2026-03-20
**Reviewer:** Requirements Reviewer — NexusAgil v1.3

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | Calidad AC | ALTA | AC1 es verificable en CI (bundle analysis), pero no especifica el **método de verificación** aceptable. ¿Bundle analyzer? ¿Test de red? Sin criterio de aceptación concreto, QA no puede marcar PASS/FAIL objetivamente. | Agregar: "verificable mediante `next build` + análisis de chunks donde el chunk de Web3Provider no aparezca en el manifest de páginas non-Web3." |
| F2 | Cobertura paths | ALTA | El provider está en el **root layout**, lo que significa que se cargará en TODAS las páginas al hidratar, no solo en las Web3. `next/dynamic + ssr:false` evita incluirlo en el JS inicial del servidor, pero el cliente lo solicitará en cuanto hidrate el layout. **AC1 puede ser técnicamente cumplible en server-render pero misleading para el objetivo de negocio.** No hay AC que distinga entre "no en el bundle SSR" vs. "no cargado en cliente para non-Web3". | Aclarar el alcance real de "initial JS download" o agregar AC sobre lazy-load condicional por ruta. |
| F3 | Cobertura paths | ALTA | No hay AC para **hydration mismatch**. Con `ssr:false`, el servidor renderiza el fallback pero el cliente renderiza Web3Provider. Si los hijos dependen de contexto Web3 durante hidratación, puede haber errores silenciosos. | AC nuevo: "WHEN page hydrates, SHALL NOT produce React hydration mismatch warnings in console." |
| F4 | Calidad AC | MEDIA | AC3: "minimal non-blocking fallback (no blank screen)" no es testeable. No define qué elemento renderiza el fallback ni su duración máxima aceptable. | Redactar: "WHEN dynamic import is loading, children SHALL render a fallback element (e.g., null o spinner) que no bloquee el LCP del contenido principal." |
| F5 | Calidad AC | MEDIA | AC4: "WasiNavBar and child pages SHALL have Web3 context" — en el código actual, WasiNavBar **está dentro** de Web3Provider. Si el dynamic import cambia el árbol de componentes, este AC podría romperse. El AC no especifica cómo verificar que el contexto está disponible. | Agregar criterio: "WHEN Web3Provider resolves, `useAccount()` SHALL return defined context in /publish, /creator/dashboard y /agent-keys." |
| F6 | Cobertura paths | MEDIA | No hay AC para el comportamiento durante **navegación client-side** (SPA navigation) de una non-Web3 page a una Web3 page. ¿El provider se carga on-demand o ya estaba en memoria? | AC nuevo: "WHEN user navigates from a non-Web3 page to a Web3 page via client-side routing, Web3Provider SHALL be available before wallet interaction is required." |
| F7 | Código actual | MEDIA | El import estático actual es: `import { Web3Provider } from '@/shared/providers/Web3Provider'`. El WI no menciona que **Web3ErrorBoundary** está presumiblemente dentro o alrededor de Web3Provider en el árbol. No hay AC que verifique que ErrorBoundary sigue envolviendo al provider dinámico (AC6/AC7 lo asumen pero no lo verifican estructuralmente). | Aclarar posición de Web3ErrorBoundary relativa al dynamic import en el árbol. |
| F8 | Dependencias | BAJA | Si WAS-256 (Promise.all) se aplica primero, modifica el mismo archivo `layout.tsx`. No hay mención de orden de aplicación o conflicto de merge. | Agregar dependencia explícita: "WAS-257 SHALL be applied after WAS-256 is merged." |
| F9 | Scope | BAJA | Scope OUT dice "no componentes consumidores" pero AC2 requiere verificar que wallet funciona en /publish, /creator/dashboard, /agent-keys — lo cual implica probar componentes consumidores. Hay tensión entre Scope OUT y AC2. | Aclarar que la verificación de AC2 es de aceptación (QA), no de implementación. |

### ACs sugeridos

```
- AC8 (nuevo): WHEN page hydrates with ssr:false dynamic import, SHALL NOT produce
  React hydration mismatch warnings in browser console.
- AC9 (nuevo): WHEN user navigates client-side from a non-Web3 route to /publish,
  /creator/dashboard, or /agent-keys, Web3Provider SHALL be loaded and functional
  before the user can trigger a wallet interaction.
- AC3 (revisado): WHEN dynamic import is pending, the layout SHALL render a non-null
  fallback that does not cause blank screen or block rendering of non-Web3 content.
```

### Veredicto

**NECESITA CAMBIOS** — F2 (comportamiento real del lazy-load en root layout vs. objetivo de negocio) y F3 (hydration mismatch) son gaps significativos que pueden llevar a una implementación que pase todos los ACs pero no logre el objetivo real. AC1 y AC3 necesitan criterios verificables. F8 (dependencia con WAS-256) debe documentarse.
