# WasiAI — Golden Path (INMUTABLE)

El stack es una decisión tomada. No se discute en cada feature.
Cualquier desviación debe ser propuesta a Fer con justificación explícita antes de implementar.

---

## Stack Web2

| Componente | Tecnología | Regla |
|-----------|-----------|-------|
| Framework | Next.js 14 (App Router) | Server Components por defecto. Client solo cuando hay interacción |
| Base de datos | Supabase (Postgres + Auth + RLS) | RLS activo en todas las tablas de usuario |
| Rate limiting | Upstash Redis | Todos los endpoints mutantes o costosos |
| Storage | Pinata (IPFS) | Solo para assets públicos (imágenes de agentes) |
| Estilos | Tailwind CSS | Sin CSS modules, sin styled-components |
| i18n | next-intl | Español e inglés. Copias en `/messages/` |
| Deploy | Vercel | Auto-deploy en push a `main` |
| Lenguaje | TypeScript (strict) | Sin `any` explícito en código de producción |

## Stack Web3

| Componente | Tecnología | Regla |
|-----------|-----------|-------|
| Blockchain | Avalanche C-Chain | Fuji (43113) en dev, Mainnet (43114) en prod |
| Contratos | Solidity 0.8.24 + Foundry | Tests con forge antes de cualquier deploy |
| Lib blockchain | viem v2 | Sin ethers.js |
| Wallet React | wagmi v3 | Para conexión de wallet en frontend |
| Pagos | x402 + ERC-3009 + uvd-x402-sdk | Protocolo de pago entre agentes |
| Identidad | ERC-8004 | Anclado on-chain en registerAgent() |
| AA (futuro) | permissionless + Pimlico | NO activo. Roadmap Épica 1. No instalar todavía |

## Reglas absolutas

- **Sin hardcodes:** direcciones de contratos, URLs de APIs, chain IDs — siempre desde env vars
- **Sin datos simulados en producción:** métricas, llamadas, revenue — siempre reales o en cero
- **Sin NEXT_PUBLIC_ para secrets:** API keys de terceros van en vars de servidor únicamente
- **Sin ethers.js:** usar viem en todo el codebase
- **SSRF protection** en cualquier endpoint que haga fetch a URLs controladas por el usuario
- **CSRF protection** en todas las mutaciones del frontend
- **RLS activo** en todas las tablas que contengan datos de usuario

## Convenciones de código

- Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Archivos: kebab-case
- Componentes: PascalCase, un componente por archivo
- Tests colocados junto al código que testean
- Migrations numeradas secuencialmente: `0XX_descripcion.sql`
- Push siempre a master Y main: `git push origin master master:main`

## Variables de entorno requeridas

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Blockchain
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_TESTNET=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_RPC_MAINNET=https://api.avax.network/ext/bc/C/rpc
MARKETPLACE_CONTRACT_ADDRESS=
NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI=
NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET=
OPERATOR_PRIVATE_KEY=

# Pagos
X402_FACILITATOR_URL=https://facilitator.ultravioletadao.xyz
NEXT_PUBLIC_WASIAI_TREASURY=

# Rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Storage
PINATA_JWT=
NEXT_PUBLIC_PINATA_GATEWAY=

# Cron
CRON_SECRET=

# Demo agents
GROQ_API_KEY=
```
