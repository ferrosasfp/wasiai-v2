# WasiAI v2 — Pre-Deploy Checklist

> Ejecutar antes de cada deploy a producción o staging.
> Este checklist complementa la validación automática (`npm run validate:env`).

---

## 0. Validación automática de env

```bash
npm run validate:env
```

- ✅ Exit 0 = continuar
- ❌ Exit 1 = STOP — configurar vars faltantes antes de continuar

---

## 1. Contratos (Blockchain)

- [ ] `OPERATOR_PRIVATE_KEY` configurada en Vercel (Environment Variables)
- [ ] `NEXT_PUBLIC_OPERATOR_ADDRESS` corresponde al address del private key
- [ ] `MARKETPLACE_CONTRACT_ADDRESS` apunta al contrato correcto (fuji/mainnet según target)
- [ ] `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` / `_MAINNET` actualizadas si hubo nuevo deploy
- [ ] Treasury address verificada: `WASIAI_TREASURY_ADDRESS` = `NEXT_PUBLIC_WASIAI_TREASURY`

---

## 2. Base de datos (Supabase)

- [ ] `NEXT_PUBLIC_SUPABASE_URL` apunta al proyecto correcto (no a local)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` es el key de producción (no el de dev)
- [ ] Migraciones pendientes aplicadas: `supabase db push` o via dashboard
- [ ] RLS policies verificadas (especialmente en tablas de pagos y wallets)

---

## 3. Storage (Pinata/IPFS)

- [ ] `PINATA_JWT` válido y con permisos de pin
- [ ] `NEXT_PUBLIC_PINATA_GATEWAY` configurado (usar gateway dedicado en prod)

---

## 4. Pagos x402

- [ ] `X402_FACILITATOR_URL` apunta al facilitador correcto
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limiting activo
- [ ] Test de pago end-to-end en staging antes de prod

---

## 5. Seguridad

- [ ] `CRON_SECRET` generado con `openssl rand -hex 32` — NO reutilizar entre ambientes
- [ ] `AGENT_WALLET_ENCRYPTION_KEY` — 64 hex chars — generado y guardado en vault seguro
- [ ] `OPEN_REGISTRATION_KEY` configurado si se activa registro abierto
- [ ] Verificar que NINGUNA var `OPERATOR_PRIVATE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` esté en git

---

## 6. Sistema interno

- [ ] `WASIAI_SYSTEM_CREATOR_ID` es el UUID del creator sistema en la DB de producción
- [ ] Verificar que el creator sistema existe: `SELECT id FROM creators WHERE id = $WASIAI_SYSTEM_CREATOR_ID`

---

## 7. Monitoring (Sentry)

- [ ] `SENTRY_DSN` configurado para el proyecto de producción
- [ ] `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` para source maps
- [ ] Test de error reportado correctamente en Sentry dashboard

---

## 8. Build

```bash
npm run qa          # typecheck + lint + tests
npm run build       # producción build — 0 errores
```

- [ ] `npm run qa` — exit 0
- [ ] `npm run build` — exit 0, 0 warnings críticos

---

## 9. Git

- [ ] `git push origin master && git push origin master:main`
- [ ] Vercel auto-deploy triggereado desde `main`
- [ ] Verificar deploy exitoso en Vercel dashboard

---

## 10. Post-deploy smoke test

- [ ] `GET /api/health` → 200
- [ ] Login con wallet funciona
- [ ] Listado de agentes carga (verifica Supabase + IPFS)
- [ ] Pago de prueba en staging (si aplica)
- [ ] Cron endpoint protegido: `GET /api/cron/settle` sin header → 401

---

## Referencias

- SDD: `doc/sdd/031-deploy-checklist/sdd.md`
- HU: WAS-119
- Validación automática: `scripts/validate-env.js`
