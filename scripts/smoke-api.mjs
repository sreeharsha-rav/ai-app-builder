const BASE = 'http://localhost:3000/api';
let cookies = {};
const jar = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jar() ? { cookie: jar() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() || [];
  for (const c of sc) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    cookies[kv.slice(0, i)] = kv.slice(i + 1);
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!opts.quiet) console.log(`${method} ${path} -> ${res.status}`, JSON.stringify(data)?.slice(0, opts.len || 260));
  return { status: res.status, data };
}

const login = async (email) => { cookies = {}; return call('POST', '/auth/login', { email, password: 'demo1234' }, { len: 200 }); };

console.log('== health ==');
await call('GET', '/health');
await call('GET', '/demo-accounts');

console.log('\n== owner login ==');
const s = await login('owner@demo.com');
const org = s.data.workspaces.find((w) => w.type === 'organization');
const personal = s.data.workspaces.find((w) => w.type === 'personal');
console.log('org:', org?.id, 'personal:', personal?.id);

await call('GET', `/workspaces/${org.id}`);
const dash = await call('GET', `/workspaces/${org.id}/dashboard`, null, { len: 200 });
console.log('team spend rows:', dash.data.teamSpend?.length, 'kpi:', dash.data.kpis);
const txns = await call('GET', `/workspaces/${org.id}/transactions?pageSize=3`, null, { len: 120 });
console.log('owner sees total:', txns.data.total);
const oneTxn = txns.data.rows[0];
await call('GET', `/workspaces/${org.id}/budgets`, null, { len: 200 });
await call('GET', `/workspaces/${org.id}/members`, null, { len: 200 });
await call('GET', `/workspaces/${org.id}/audit`, null, { len: 120 });

console.log('\n== own_only member ==');
await login('own@demo.com');
const t2 = await call('GET', `/workspaces/${org.id}/transactions?pageSize=100`, null, { len: 80 });
console.log('own_only total:', t2.data.total, 'all mine:', t2.data.rows.every((r) => r.created_by_name === 'Sara Khan'));
const d2 = await call('GET', `/workspaces/${org.id}/dashboard`, null, { len: 60 });
console.log('teamSpend should be null ->', d2.data.teamSpend);
console.log('cross-workspace personal (expect 404):');
await call('GET', `/workspaces/${personal.id}/transactions`, null, { len: 80 });
console.log('other members txn by id (expect 404):');
await call('GET', `/workspaces/${org.id}/transactions/${oneTxn.id}`, null, { len: 80 });
await call('GET', `/workspaces/${org.id}/audit`, null, { len: 80 });

console.log('\n== viewer ==');
await login('viewer@demo.com');
await call('POST', `/workspaces/${org.id}/transactions`, { type: 'expense', amount_minor: 5000, transaction_date: '2025-06-01' }, { len: 80 });
const vctx = await call('GET', `/workspaces/${org.id}`, null, { len: 300 });
console.log('viewer nav:', vctx.data.nav.map((n) => n.key));

console.log('\n== admin promoting to owner (expect 403) ==');
await login('admin@demo.com');
const mem = await call('GET', `/workspaces/${org.id}/members`, null, { len: 60 });
const target = mem.data.find((m) => m.role === 'member');
await call('PUT', `/workspaces/${org.id}/members/${target.id}`, { role: 'owner' }, { len: 120 });
await call('PUT', `/workspaces/${org.id}/members/${target.id}`, { role: 'admin' }, { len: 120 });

console.log('\n== member CRUD + soft delete ==');
await login('member@demo.com');
const cats = await call('GET', `/workspaces/${org.id}/categories`, null, { len: 80 });
const created = await call('POST', `/workspaces/${org.id}/transactions`, {
  type: 'expense', amount_minor: 123400, category_id: cats.data[0].id,
  merchant: 'Smoke Test Cafe', notes: 'hello', tags: ['smoke'], transaction_date: new Date().toISOString().slice(0, 10),
}, { len: 200 });
await call('DELETE', `/workspaces/${org.id}/transactions/${created.data.id}`);
await call('GET', `/workspaces/${org.id}/transactions/${created.data.id}`, null, { len: 60 });

console.log('\n== agent ==');
await login('owner@demo.com');
const r1 = await call('POST', `/workspaces/${org.id}/insights`, { query: 'How much did I spend on Food this month?' }, { len: 900 });
const r2 = await call('POST', `/workspaces/${org.id}/insights`, { query: 'Add a 500 rupee expense for coffee' }, { len: 400 });
await call('GET', `/workspaces/${org.id}/agent-log`, null, { len: 400 });
