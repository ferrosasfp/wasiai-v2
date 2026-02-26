# SDD — UX-07: Hero Copy Real

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-26
> **Sprint:** 3

---

## Objetivo
Reemplazar el copy genérico del hero de la homepage por mensajes específicos que hablen directamente al creator (publica y cobra) y al consumer (encuentra e integra).

---

## Cambios en `src/app/[locale]/page.tsx`

Reemplazar el bloque `<section>` del hero actual por:

```tsx
<section className="bg-white border-b border-gray-100 px-6 py-16">
  <div className="mx-auto max-w-4xl text-center">

    {/* Badge */}
    <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-avax-50 border border-avax-100 px-4 py-1.5 text-sm text-avax-600 font-medium">
      <span>⚡</span>
      <span>{t('badge')}</span>
    </div>

    {/* Headline */}
    <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
      {t('heroTitle')}
      <br />
      <span className="text-avax-500">{t('heroSubtitle')}</span>
    </h1>

    <p className="text-lg text-gray-500 mb-10 max-w-2xl mx-auto">
      {t('heroDescription')}
    </p>

    {/* Dual CTA */}
    <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14">
      <Link
        href={`/${locale}/publish`}
        className="inline-flex items-center gap-2 bg-avax-500 text-white font-semibold px-6 py-3 rounded-xl hover:bg-avax-600 transition-colors"
      >
        {t('ctaCreator')}
      </Link>
      <Link
        href="#agents"
        className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:border-avax-300 hover:text-avax-600 transition-colors"
      >
        {t('ctaConsumer')}
      </Link>
    </div>

    {/* Stats pills */}
    <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400">
      <span>⚡ {t('statPayments')}</span>
      <span>💰 {t('statMinCall')}</span>
      <span>🏠 {t('statToCreators')}</span>
      <span>🔗 {t('statIdentity')}</span>
    </div>

  </div>
</section>
```

---

## Cambios en `messages/es.json`

```json
"heroTitle": "Publica tu agente de IA.",
"heroSubtitle": "Cobra automáticamente en USDC.",
"heroDescription": "WasiAI es el marketplace donde creators publican agentes de IA y cobran por cada llamada. Los developers encuentran el agente que necesitan y lo integran en minutos.",
"ctaCreator": "Publicar mi agente →",
"ctaConsumer": "Explorar agentes",
```

## Cambios en `messages/en.json`

```json
"heroTitle": "Publish your AI agent.",
"heroSubtitle": "Get paid automatically in USDC.",
"heroDescription": "WasiAI is the marketplace where creators publish AI agents and earn per call. Developers find the right agent and integrate it in minutes.",
"ctaCreator": "Publish my agent →",
"ctaConsumer": "Explore agents",
```

---

## Definition of Done
- [ ] Hero con headline dual creator/consumer
- [ ] 2 CTAs: "Publicar mi agente" + "Explorar agentes"
- [ ] i18n en/es actualizado
- [ ] `npm run build` limpio
