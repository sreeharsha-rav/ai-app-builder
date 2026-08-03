import { one } from './db';

/**
 * Single source of truth for the fixed role matrix (§5.1). No custom roles.
 * The REST API and the AI agent both go through this module.
 */
export const ROLE_CAPS = {
  owner:  { txn_read: true, txn_write: true, budget_write: true, category_write: true, member_write: true, role_change: true,  workspace_write: true,  workspace_delete: true, audit_read: true },
  admin:  { txn_read: true, txn_write: true, budget_write: true, category_write: true, member_write: true, role_change: false, workspace_write: false, workspace_delete: false, audit_read: true },
  member: { txn_read: true, txn_write: true, budget_write: false, category_write: false, member_write: false, role_change: false, workspace_write: false, workspace_delete: false, audit_read: false },
  viewer: { txn_read: true, txn_write: false, budget_write: false, category_write: false, member_write: false, role_change: false, workspace_write: false, workspace_delete: false, audit_read: false },
};

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Out-of-tenant access must look like non-existence, never like a denial. */
export const notFound = () => new HttpError(404, 'Not found');
export const forbidden = (m = 'Insufficient permissions') => new HttpError(403, m);

/**
 * Resolves membership FRESH from the DB on every request. role/scope are never
 * read from the JWT because a user holds different roles per workspace.
 * Throws 404 (not 403) when the user is not an active member.
 */
export function resolveContext(userId, workspaceId) {
  if (!workspaceId) throw notFound();
  const row = one(
    `SELECT m.id AS membership_id, m.role, m.member_scope, m.status,
            w.id AS workspace_id, w.name, w.slug, w.type, w.currency_code, w.owner_id
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ? AND m.user_id = ?`,
    [workspaceId, userId]
  );
  if (!row || row.status !== 'active') throw notFound();

  const caps = ROLE_CAPS[row.role] || ROLE_CAPS.viewer;
  // Owners/admins always see everything; own_only narrowing applies below that.
  const scope = row.role === 'owner' || row.role === 'admin' ? 'all' : row.member_scope;

  return {
    userId,
    membershipId: row.membership_id,
    workspaceId: row.workspace_id,
    workspace: {
      id: row.workspace_id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      currency_code: row.currency_code,
      owner_id: row.owner_id,
    },
    role: row.role,
    scope,
    caps,
  };
}

export function require_(ctx, cap) {
  if (!ctx.caps[cap]) throw forbidden(`Role '${ctx.role}' cannot perform this action`);
  return true;
}

/** Nav config is computed server-side; the client never filters it. */
export function navConfig(ctx) {
  const items = [
    { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { key: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight' },
    { key: 'budgets', label: 'Budgets', icon: 'Target' },
    { key: 'insights', label: 'Insights', icon: 'Sparkles' },
  ];
  if (ctx.caps.category_write) items.push({ key: 'categories', label: 'Categories', icon: 'Tags' });
  if (ctx.caps.member_write) items.push({ key: 'members', label: 'Members', icon: 'Users' });
  if (ctx.caps.audit_read) items.push({ key: 'audit', label: 'Audit log', icon: 'ScrollText' });
  if (ctx.caps.workspace_write) items.push({ key: 'settings', label: 'Settings', icon: 'Settings' });
  return items;
}
