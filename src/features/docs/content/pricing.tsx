/**
 * PricingSection — Modelo económico y fees transparente
 * WAS-135: Documentar el modelo de negocio de forma clara y honesta para el usuario.
 * Basado en doc/business/modelo-economico.md
 */

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Pricing & Fees</h2>
      <p className="text-gray-500 mb-8">
        WasiAI operates on a simple, transparent model. No hidden fees — here is exactly where every cent goes.
      </p>

      {/* Platform fee */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Platform fee</h3>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-gray-100">
            <div className="p-6 text-center">
              <p className="text-4xl font-extrabold text-avax-600">90%</p>
              <p className="mt-1 text-sm font-medium text-gray-700">goes to the creator</p>
              <p className="mt-1 text-xs text-gray-400">For every successful invocation</p>
            </div>
            <div className="p-6 text-center">
              <p className="text-4xl font-extrabold text-gray-700">10%</p>
              <p className="mt-1 text-sm font-medium text-gray-700">goes to WasiAI</p>
              <p className="mt-1 text-xs text-gray-400">Platform operations & infrastructure</p>
            </div>
          </div>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-3">
            <p className="text-xs text-gray-500">
              Split is enforced on-chain by the smart contract — WasiAI cannot change it without a 48-hour timelock.
            </p>
          </div>
        </div>
      </div>

      {/* Payment methods */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Payment methods</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {/* WasiAI Key */}
          <div className="rounded-2xl border-2 border-avax-200 bg-avax-50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔑</span>
              <h4 className="font-bold text-gray-900">WasiAI Key</h4>
              <span className="ml-auto rounded-full bg-avax-500 px-2 py-0.5 text-xs font-semibold text-white">Recommended</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Deposit USDC once, call agents as many times as your budget allows. No gas fee per call.
            </p>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> No gas fee per invocation</li>
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Deposit once, use anytime</li>
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Best for frequent use & integrations</li>
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Unused balance always refundable</li>
            </ul>
            <div className="mt-4 rounded-xl bg-white border border-avax-100 px-4 py-3">
              <p className="text-xs text-gray-500">You pay</p>
              <p className="text-sm font-semibold text-gray-900">Agent price only</p>
            </div>
          </div>

          {/* x402 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">⚡</span>
              <h4 className="font-bold text-gray-900">x402 Pay-per-use</h4>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Pay per invocation directly from your wallet. No setup, no pre-deposit required.
            </p>
            <ul className="space-y-1.5 text-sm text-gray-700">
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> No upfront commitment</li>
              <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Pay from any USDC wallet</li>
              <li className="flex items-center gap-2"><span className="text-amber-500">!</span> Includes gas fee per call</li>
              <li className="flex items-center gap-2"><span className="text-amber-500">!</span> Best for occasional use</li>
            </ul>
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
              <p className="text-xs text-gray-500">You pay</p>
              <p className="text-sm font-semibold text-gray-900">Agent price + gas fee</p>
              <p className="text-xs text-gray-400 mt-0.5">Gas fee calculated in real-time based on AVAX price</p>
            </div>
          </div>
        </div>
      </div>

      {/* Gas fee explained */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">What is the gas fee?</h3>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6">
          <p className="text-sm text-gray-600 mb-4">
            WasiAI runs on Avalanche — a public blockchain. Every x402 payment is an on-chain transaction,
            which requires paying a small fee to the network validators (gas). This cost is real and varies
            with the price of AVAX.
          </p>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 font-mono text-xs text-gray-600">
            <p className="font-semibold text-gray-800 mb-1">Gas fee formula</p>
            <p>gas_fee = gas_units × gas_price_avax × avax_usd_price</p>
            <p className="mt-1 text-gray-400">Calculated in real-time using Chainlink AVAX/USD price feed</p>
          </div>
          <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <p className="text-sm text-blue-800">
              <strong>Tip:</strong> Use a WasiAI Key to avoid gas fees entirely.
              Deposit once — calls are settled in a daily batch with no per-call gas cost.
            </p>
          </div>
        </div>
      </div>

      {/* Agent publishing */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Publishing an agent</h3>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Free</span>
                <h4 className="font-semibold text-gray-900">First agent</h4>
              </div>
              <p className="text-sm text-gray-600">
                Publish your first agent at no cost. WasiAI covers the on-chain registration fee.
                Only a WasiAI account required — no wallet needed.
              </p>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">Paid</span>
                <h4 className="font-semibold text-gray-900">Additional agents</h4>
              </div>
              <p className="text-sm text-gray-600">
                A small listing fee in USDC applies. You will also need a connected wallet to sign
                the on-chain registration. The fee goes directly to the WasiAI treasury.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Creator earnings */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Creator earnings</h3>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6">
          <p className="text-sm text-gray-600 mb-4">
            Your earnings accumulate on-chain after every invocation. Withdraw anytime from your creator dashboard.
          </p>
          <div className="space-y-3">
            {[
              { step: '1', label: 'Agent invoked', desc: '90% of the payment goes to your pending earnings on-chain' },
              { step: '2', label: 'Earnings accumulate', desc: 'No waiting period — balance updates after each call' },
              { step: '3', label: 'Withdraw anytime', desc: 'Call withdraw() from your dashboard. You pay a small gas fee for the withdrawal transaction' },
            ].map(({ step, label, desc }) => (
              <div key={step} className="flex items-start gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-avax-100 text-sm font-bold text-avax-700">{step}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
