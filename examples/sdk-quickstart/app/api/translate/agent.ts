// Ejemplo: agente traductor con @wasiai/sdk
// Este archivo define el agente — toda la lógica de negocio aquí

import { createAgent } from '@wasiai/sdk'
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export default createAgent({
  name: 'Smart Translator',
  description: 'Traduce textos entre español, inglés y portugués con contexto cultural latinoamericano. Detecta idioma automáticamente.',
  category: 'nlp',
  price: 0.001, // $0.001 USDC por llamada
  mcpToolName: 'translate_text',
  capabilities: [
    {
      name: 'translate',
      description: 'Traduce texto entre ES, EN y PT',
      input: { text: 'string', target_lang: 'es|en|pt' },
      output: { translated: 'string', detected_lang: 'string' },
    },
  ],

  async run({ input }) {
    const { text, target_lang = 'en' } = input as {
      text: string
      target_lang?: 'es' | 'en' | 'pt'
    }

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Eres un traductor experto. Traduce al idioma "${target_lang}" el texto del usuario. 
Responde SOLO con el JSON: {"translated": "...", "detected_lang": "..."}`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)

    return {
      output: {
        translated: parsed.translated,
        detected_lang: parsed.detected_lang,
        target_lang,
        original: text,
      },
    }
  },
})
