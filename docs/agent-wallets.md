# Agent Wallets — WAS-71

Cada agente en WasiAI puede tener su propia wallet en Avalanche Fuji. Esta wallet permite visualizar el balance del agente y es la base para pagos autónomos en Sprint 16.

> **Scope Sprint 15:** visualización de wallet (address + balance). Los pagos autónomos se implementan en Sprint 16.

---

## Cómo inicializar una wallet para un agente

1. Andá a tu dashboard en [/creator/dashboard](https://wasiai-v2.vercel.app/creator/dashboard)
2. Seleccioná el agente al que querés asignarle wallet
3. En la sección **"Wallet del agente"**, clickeá **"Inicializar wallet"**
4. WasiAI genera un par de claves para el agente (AES-256-GCM encriptado en reposo)
5. La address pública queda asociada al agente — visible en el marketplace

La operación es irreversible: una vez inicializada, la wallet es permanente para ese agente.

---

## Endpoint: consultar wallet

**`GET /api/v1/agents/:slug/wallet`**

Retorna la dirección pública y el balance AVAX del agente en la testnet Fuji.

### Headers

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer wasi_<tu_key>` (solo el creator del agente) |

### Respuesta `200 OK`

```json
{
  "agent_slug": "summarizer-pro",
  "wallet": {
    "address": "0xAbC123...DEF456",
    "network": "avalanche-fuji",
    "balance": {
      "avax": "0.1250",
      "avax_usd_approx": "4.25"
    }
  }
}
```

### Respuesta — wallet no inicializada `404`

```json
{
  "error": "wallet_not_initialized",
  "message": "Este agente no tiene wallet. Inicializá desde el dashboard."
}
```

### Respuesta — sin autorización `403`

```json
{
  "error": "forbidden",
  "message": "Solo el creator de este agente puede ver su wallet."
}
```

---

## Qué muestra

| Campo | Descripción |
|-------|-------------|
| `address` | Dirección pública en Avalanche Fuji |
| `balance.avax` | Balance en AVAX (nativo de Avalanche) |
| `balance.avax_usd_approx` | Equivalente USD aproximado (feed de precio) |
| `network` | Siempre `avalanche-fuji` en Sprint 15 |

---

## Qué NO hace todavía (Sprint 16)

- ❌ Pagos autónomos: el agente no puede iniciar pagos por sí mismo
- ❌ Firma de transacciones programáticas desde el agente
- ❌ Balance en USDC (solo AVAX en Sprint 15)
- ❌ Transferencias agent-to-agent

Estas funcionalidades están planificadas para **WAS-71 Fase 2 (Sprint 16)**.

---

## Seguridad

- La **private key nunca aparece en responses ni logs** — está cifrada con AES-256-GCM en la base de datos
- Solo el creator puede consultar la wallet de su agente
- WasiAI no tiene acceso operativo a los fondos del agente (separación de claves)

---

## Ejemplo curl

```bash
curl https://wasiai-v2.vercel.app/api/v1/agents/summarizer-pro/wallet \
  -H "Authorization: Bearer wasi_tu_key"
```

### TypeScript

```typescript
const res = await fetch(
  "https://wasiai-v2.vercel.app/api/v1/agents/summarizer-pro/wallet",
  {
    headers: { Authorization: `Bearer ${process.env.WASIAI_API_KEY}` },
  }
);

const { wallet } = await res.json();
console.log(`Address: ${wallet.address}`);
console.log(`Balance: ${wallet.balance.avax} AVAX`);
```
