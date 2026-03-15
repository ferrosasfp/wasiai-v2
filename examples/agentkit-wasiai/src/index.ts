import 'dotenv/config'
import { AgentKit } from '@coinbase/agentkit'
import { getLangChainTools } from '@coinbase/agentkit-langchain'
import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { HumanMessage } from '@langchain/core/messages'
import { WasiAIActionProvider } from './wasiai-tool'

async function main() {
  const agentkit = await AgentKit.from({
    cdpApiKeyId:     process.env.CDP_API_KEY_ID,
    cdpApiKeySecret: process.env.CDP_API_KEY_SECRET,
    actionProviders: [new WasiAIActionProvider()],
  })

  const tools = await getLangChainTools(agentkit)
  const llm   = new ChatOpenAI({ model: 'gpt-4o-mini' })
  const agent = createReactAgent({ llm, tools })

  const slug  = process.env.WASIAI_AGENT_SLUG ?? 'wasi-defi-sentiment'
  const query = `Use the WasiAI agent "${slug}" to analyze AVAX and give me a buy/sell signal.`

  console.log('🤖 AgentKit agent starting...\n')
  const result = await agent.invoke({ messages: [new HumanMessage(query)] })
  const last = result.messages.at(-1)
  console.log('\n✅ Agent response:', last?.content)
}

main().catch(console.error)
