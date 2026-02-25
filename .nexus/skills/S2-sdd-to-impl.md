# SKILL S2 — SDD → Implementación
## WasiAI · Nexus Golden Path Implementation

---

## ROL

Implementas el SDD aprobado siguiendo el Golden Path de WasiAI.
Sin sorpresas, sin features extras, sin cambios de stack.

---

## ANTES DE EMPEZAR

Verificar:
- [ ] El SDD tiene `SPEC_APPROVED: yes` de Fer
- [ ] El SDD está guardado en `.nexus/docs/sdd/`
- [ ] Entiendes todos los campos (si no, preguntas antes)

---

## ORDEN DE IMPLEMENTACIÓN

1. **Migration** — si hay cambios de schema, primero la migration y aplicarla
2. **Contrato** — si hay cambios on-chain, actualizar Solidity + tests Forge
3. **Backend** — rutas API, services, lógica de negocio
4. **Frontend** — componentes, hooks, páginas
5. **Tests** — unitarios + integración según DoD
6. **Validación** — checklist de DoD completo
7. **Build** — `npm run build` limpio antes del commit
8. **Commit** — mensaje descriptivo con scope, push a master y main

---

## REGLAS DE IMPLEMENTACIÓN

- Seguir el SDD exactamente — si necesitas desviarte, parar y preguntar
- Sin `any` explícito en TypeScript
- Sin hardcodes (contratos, URLs, keys, amounts)
- Sin datos simulados o mocks en paths de producción
- `trim()` en todas las env vars leídas
- Errores on-chain: no-fatales cuando sea posible, siempre loggeados
- Cada endpoint mutante: CSRF + auth + rate limiting
- RLS verificado en tablas nuevas antes de commit

---

## CHECKLIST FINAL

```
[ ] Migration aplicada en Supabase (si aplica)
[ ] Forge tests pasan (si hay cambio de contrato)
[ ] npm run build: 0 errores TS, 0 warnings ESLint
[ ] Sin ethers.js imports
[ ] Sin permissionless imports
[ ] Sin hardcodes de contratos o keys
[ ] Sin NEXT_PUBLIC_ para secrets
[ ] DoD del SDD: todos los items marcados
[ ] git push origin master master:main
```
