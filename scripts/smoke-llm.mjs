import OpenAI from 'openai';
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec('CREATE TABLE t (a TEXT)');
db.prepare('INSERT INTO t VALUES (?)').run('sqlite-ok');
console.log('SQLITE:', db.prepare('SELECT a FROM t').get());

const key = process.env.EMERGENT_LLM_KEY;
const bases = [
  'https://integrations.emergentagent.com/llm',
  'https://llm.emergentagent.com/v1',
  'https://integrations.emergentagent.com/llm/v1',
];

const tools = [{
  type: 'function',
  function: {
    name: 'get_spend_summary',
    description: 'Get spend summary',
    parameters: {
      type: 'object',
      properties: { group_by: { type: 'string', enum: ['category', 'member'] } },
      required: ['group_by'],
      additionalProperties: false,
    },
  },
}];

for (const baseURL of bases) {
  try {
    const client = new OpenAI({ apiKey: key, baseURL, timeout: 60000, maxRetries: 0 });
    const r = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'What did I spend by category? use the tool.' }],
      tools,
      tool_choice: 'auto',
    });
    console.log('OK', baseURL, JSON.stringify(r.choices?.[0]?.message)?.slice(0, 500));
    break;
  } catch (e) {
    console.log('FAIL', baseURL, e?.status, String(e?.message).slice(0, 200));
  }
}
