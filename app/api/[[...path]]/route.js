import { NextResponse } from 'next/server';
import { all, one, run } from '@/lib/db';
import {
  uid, nowIso, hashPassword, verifyPassword, signAccessToken, issueRefreshToken,
  rotateRefreshToken, revokeAllRefresh, setAuthCookies, clearAuthCookies,
  currentUser, linkPendingInvites, REFRESH_COOKIE,
} from '@/lib/auth';
import { resolveContext, navConfig, HttpError, notFound } from '@/lib/rbac';
import * as svc from '@/lib/service';
import * as ws from '@/lib/workspaces';
import * as agent from '@/lib/agent';
import { ensureSeed } from '@/lib/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data, status = 200) => NextResponse.json(data, { status });
const fail = (e) => {
  if (e instanceof HttpError || e?.status) return json({ error: e.message, code: e.code }, e.status || 500);
  console.error('[api]', e?.message, e?.stack?.split('\n')[1]);
  return json({ error: e?.message || 'Internal server error' }, 500);
};

function requireUser(request) {
  ensureSeed();
  const user = currentUser(request);
  if (!user) throw new HttpError(401, 'Not authenticated', 'NO_SESSION');
  return user;
}

function ctxFor(request, workspaceId) {
  const user = requireUser(request);
  const ctx = resolveContext(user.id, workspaceId);
  return { user, ctx };
}

const qp = (request) => Object.fromEntries(new URL(request.url).searchParams.entries());
const body = async (request) => {
  try { return await request.json(); } catch { return {}; }
};

function sessionPayload(user) {
  const { workspaces, invites } = ws.myWorkspaces(user.id, user.email);
  return { user, workspaces, invites };
}

/* =======================================================================
   ROUTER
   ======================================================================= */
async function handle(request, method, segments) {
  ensureSeed();
  const [a, b, c, d, e] = segments;

  /* ---------------- health / demo accounts ---------------- */
  if (a === 'health') return json({ ok: true, db: 'sqlite', time: nowIso() });
  if (a === 'demo-accounts') {
    return json({
      password: 'demo1234',
      accounts: all("SELECT email, display_name FROM users WHERE email LIKE '%@demo.com' ORDER BY email"),
    });
  }

  /* ---------------- auth ---------------- */
  if (a === 'auth') {
    if (b === 'signup' && method === 'POST') {
      const { email, password, display_name, mode, org_name, currency_code, invites } = await body(request);
      const clean = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new HttpError(400, 'Enter a valid email address');
      if (!password || String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      if (one('SELECT id FROM users WHERE lower(email) = ?', [clean])) throw new HttpError(409, 'An account with that email already exists');

      const id = uid();
      run('INSERT INTO users (id, email, password_hash, display_name, avatar_url, created_at) VALUES (?,?,?,?,NULL,?)',
        [id, clean, hashPassword(password), String(display_name || clean.split('@')[0]).slice(0, 80), nowIso()]);
      const user = one('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?', [id]);

      // Every signup gets a personal workspace, always.
      ws.createWorkspace({ name: `${user.display_name} \u2014 Personal`, type: 'personal', ownerId: id, currency: 'INR' });
      const linked = linkPendingInvites(id, clean);

      // Optional org created during onboarding.
      if (mode === 'organization' && org_name) {
        const org = ws.createWorkspace({ name: String(org_name).slice(0, 80), type: 'organization', ownerId: id, currency: currency_code || 'INR' });
        const octx = resolveContext(id, org.id);
        for (const em of (invites || []).slice(0, 20)) {
          try { ws.inviteMember(octx, { email: em, role: 'member', member_scope: 'all' }); } catch { /* ignore bad emails */ }
        }
      }
      const res = json({ ...sessionPayload(user), linked_invites: linked }, 201);
      return setAuthCookies(res, signAccessToken(id), issueRefreshToken(id));
    }

    if (b === 'login' && method === 'POST') {
      const { email, password } = await body(request);
      const row = one('SELECT * FROM users WHERE lower(email) = ?', [String(email || '').trim().toLowerCase()]);
      if (!row || !verifyPassword(String(password || ''), row.password_hash)) throw new HttpError(401, 'Incorrect email or password');
      linkPendingInvites(row.id, row.email);
      const user = { id: row.id, email: row.email, display_name: row.display_name, avatar_url: row.avatar_url, created_at: row.created_at };
      const res = json(sessionPayload(user));
      return setAuthCookies(res, signAccessToken(row.id), issueRefreshToken(row.id));
    }

    if (b === 'refresh' && method === 'POST') {
      const rotated = rotateRefreshToken(request.cookies.get(REFRESH_COOKIE)?.value);
      if (!rotated) return clearAuthCookies(json({ error: 'Session expired' }, 401));
      const user = one('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?', [rotated.userId]);
      if (!user) return clearAuthCookies(json({ error: 'Session expired' }, 401));
      return setAuthCookies(json(sessionPayload(user)), signAccessToken(user.id), rotated.refresh);
    }

    if (b === 'logout' && method === 'POST') {
      const user = currentUser(request);
      if (user) revokeAllRefresh(user.id);
      return clearAuthCookies(json({ ok: true }));
    }

    if (b === 'me' && method === 'GET') return json(sessionPayload(requireUser(request)));

    if (b === 'profile' && method === 'PUT') {
      const user = requireUser(request);
      const { display_name, current_password, new_password } = await body(request);
      if (display_name) run('UPDATE users SET display_name = ? WHERE id = ?', [String(display_name).slice(0, 80), user.id]);
      if (new_password) {
        const row = one('SELECT password_hash FROM users WHERE id = ?', [user.id]);
        if (!verifyPassword(String(current_password || ''), row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
        if (String(new_password).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
        run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), user.id]);
      }
      return json(sessionPayload(one('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?', [user.id])));
    }
  }

  /* ---------------- invites (accept) ---------------- */
  if (a === 'invites' && b && c === 'accept' && method === 'POST') {
    const user = requireUser(request);
    const wsRow = ws.acceptInvite(user.id, user.email, b);
    return json({ workspace: wsRow, ...sessionPayload(user) });
  }

  /* ---------------- workspaces ---------------- */
  if (a === 'workspaces' && !b) {
    const user = requireUser(request);
    if (method === 'GET') return json(sessionPayload(user));
    if (method === 'POST') {
      const { name, currency_code, invites } = await body(request);
      if (!name || String(name).trim().length < 2) throw new HttpError(400, 'Workspace name is required');
      const created = ws.createWorkspace({ name: String(name).trim().slice(0, 80), type: 'organization', ownerId: user.id, currency: currency_code || 'INR' });
      const octx = resolveContext(user.id, created.id);
      svc.writeAudit(octx, 'create', 'workspace', created.id, { after: { name: created.name } }, `Created workspace "${created.name}"`);
      for (const em of (invites || []).slice(0, 20)) {
        try { ws.inviteMember(octx, { email: em, role: 'member', member_scope: 'all' }); } catch { /* ignore */ }
      }
      return json({ workspace: created, ...sessionPayload(user) }, 201);
    }
  }

  if (a === 'workspaces' && b) {
    const workspaceId = b;

    /* -- context (role, caps, nav) resolved fresh from DB -- */
    if (!c && method === 'GET') {
      const { ctx } = ctxFor(request, workspaceId);
      return json({ workspace: ctx.workspace, role: ctx.role, scope: ctx.scope, caps: ctx.caps, nav: navConfig(ctx) });
    }
    if (!c && method === 'PUT') {
      const { ctx } = ctxFor(request, workspaceId);
      return json(ws.updateWorkspace(ctx, await body(request)));
    }
    if (!c && method === 'DELETE') {
      const { ctx } = ctxFor(request, workspaceId);
      const { confirm_name } = await body(request);
      return json(ws.deleteWorkspace(ctx, confirm_name));
    }

    const { ctx } = ctxFor(request, workspaceId);

    /* -- dashboard -- */
    if (c === 'dashboard' && method === 'GET') return json(svc.dashboard(ctx, qp(request).days || 30));

    /* -- categories -- */
    if (c === 'categories') {
      if (!d && method === 'GET') return json(svc.listCategories(ctx));
      if (!d && method === 'POST') return json(svc.createCategory(ctx, await body(request)), 201);
      if (d && method === 'PUT') return json(svc.updateCategory(ctx, d, await body(request)));
      if (d && method === 'DELETE') return json(svc.deleteCategory(ctx, d));
    }

    /* -- transactions -- */
    if (c === 'transactions') {
      if (!d && method === 'GET') {
        const q = qp(request);
        return json(svc.listTransactions(ctx, {
          from: q.from, to: q.to, type: q.type, q: q.q, page: q.page, pageSize: q.pageSize,
          sortBy: q.sortBy, sortDir: q.sortDir,
          categoryIds: q.categories ? q.categories.split(',').filter(Boolean) : undefined,
        }));
      }
      if (!d && method === 'POST') return json(svc.createTransaction(ctx, await body(request)), 201);
      if (d && method === 'GET') return json(svc.getTransaction(ctx, d));
      if (d && method === 'PUT') return json(svc.updateTransaction(ctx, d, await body(request)));
      if (d && method === 'DELETE') return json(svc.deleteTransaction(ctx, d));
    }

    if (c === 'merchants' && method === 'GET') return json(svc.listMerchants(ctx));

    /* -- budgets -- */
    if (c === 'budgets') {
      if (!d && method === 'GET') return json(svc.budgetStatus(ctx));
      if (!d && method === 'POST') return json(svc.createBudget(ctx, await body(request)), 201);
      if (d && method === 'PUT') return json(svc.updateBudget(ctx, d, await body(request)));
      if (d && method === 'DELETE') return json(svc.deleteBudget(ctx, d));
    }

    /* -- members -- */
    if (c === 'members') {
      if (!d && method === 'GET') return json(ws.listMembers(ctx));
      if (!d && method === 'POST') return json(ws.inviteMember(ctx, await body(request)), 201);
      if (d && e === 'resend' && method === 'POST') {
        ws.listMembers(ctx);
        const row = one('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?', [d, workspaceId]);
        if (!row) throw notFound();
        svc.writeAudit(ctx, 'invite', 'member', d, { after: { resent: true } }, `Resent invite to ${row.invited_email}`);
        return json({ ok: true, note: 'Invite recorded. Email delivery is not enabled in this build.' });
      }
      if (d && method === 'PUT') return json(ws.updateMember(ctx, d, await body(request)));
      if (d && method === 'DELETE') return json(ws.removeMember(ctx, d));
    }

    /* -- audit -- */
    if (c === 'audit' && method === 'GET') return json(svc.listAudit(ctx, qp(request)));
    if (c === 'agent-log' && method === 'GET') {
      if (!ctx.caps.audit_read) throw new HttpError(403, 'Insufficient permissions');
      return json(all('SELECT * FROM agent_query_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100', [workspaceId])
        .map((r) => ({ ...r, resolved_scope: JSON.parse(r.resolved_scope), tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : [] })));
    }

    /* -- insights agent -- */
    if (c === 'insights') {
      if (!d && method === 'GET') return json({ messages: agent.threadFor(ctx) });
      if (!d && method === 'POST') {
        const { query } = await body(request);
        const text = String(query || '').trim();
        if (!text) throw new HttpError(400, 'Ask a question first');
        if (text.length > 1000) throw new HttpError(400, 'Question is too long');
        const { user } = ctxFor(request, workspaceId);
        const message = await agent.ask(ctx, user, text);
        return json({ message });
      }
      if (!d && method === 'DELETE') return json(agent.clearThread(ctx));
    }

    /* -- prefs (dismissible invite prompt) -- */
    if (c === 'prefs') {
      if (method === 'GET') {
        return json(Object.fromEntries(all('SELECT key, value FROM user_prefs WHERE user_id = ? AND workspace_id = ?', [ctx.userId, workspaceId]).map((r) => [r.key, r.value])));
      }
      if (method === 'POST') {
        const { key, value } = await body(request);
        run('INSERT INTO user_prefs (user_id, workspace_id, key, value) VALUES (?,?,?,?) ON CONFLICT(user_id, workspace_id, key) DO UPDATE SET value = excluded.value',
          [ctx.userId, workspaceId, String(key), String(value)]);
        return json({ ok: true });
      }
    }
  }

  return json({ error: `No route for ${method} /api/${segments.join('/')}` }, 404);
}

const wrap = (method) => async (request, context) => {
  try {
    const { path } = await context.params;
    return await handle(request, method, path || []);
  } catch (err) {
    return fail(err);
  }
};

export const GET = wrap('GET');
export const POST = wrap('POST');
export const PUT = wrap('PUT');
export const PATCH = wrap('PUT');
export const DELETE = wrap('DELETE');
export const OPTIONS = async () => new NextResponse(null, { status: 204 });
