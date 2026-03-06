# Story File — WAS-162: Transparency Dashboard

> Parent SDD: #049
> Size: M
> Sprint: 22+

---

## Acceptance Criteria (from Work Item)

| AC | Criterio |
|----|----------|
| AC1 | Footer muestra volumen total, invocaciones totales y fee del marketplace |
| AC2 | `/transparency` muestra dashboard con stats globales y lista de agentes on-chain con precio |
| AC3 | Si la llamada al contrato falla, el footer muestra "—" sin romper la página |
| AC4 | Todos los datos se leen del contrato (funciones view), no de Supabase |
| AC5 | Botón refresh actualiza stats inmediatamente |

---

## Checklist de implementación

- [ ] Crear `src/lib/contracts/config.ts` — helper `getContractAddress()`
- [ ] Agregar `fromUSDCAtomics()` a `src/lib/contracts/WasiAIMarketplace.ts`
- [ ] Crear `src/app/api/transparency/stats/route.ts` — API cacheada (60s)
- [ ] Crear `src/components/transparency/OnChainStats.tsx` — consume API
- [ ] Crear `src/app/[locale]/transparency/page.tsx` — server component (slugs)
- [ ] Crear `src/app/[locale]/transparency/TransparencyDashboard.tsx` — client dashboard
- [ ] Integrar `OnChainStats` en footer
- [ ] i18n keys en/es
- [ ] Verificar: tsc, build, AC1-AC5
