import { all, one, run } from './db';
import { uid, nowIso } from './auth';
import { require_, notFound, forbidden, HttpError } from './rbac';
import { writeAudit } from './service';

export const DEFAULT_CATEGORIES = [
  { name: 'Food', color: 'cat-1' },
  { name: 'Transport', color: 'cat-2' },
  { name: 'Bills', color: 'cat-3' },
  { name: 'Shopping', color: 'cat-4' },
  { name: 'Other', color: 'cat-5' },
];

const slugify = (s) =>
  `${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'ws'}-${Math.random().toString(36).slice(2, 7)}`;

export function seedCategories(workspaceId) {
  for (const c of DEFAULT_CATEGORIES) {
    run('INSERT INTO categories (id, workspace_id, name, parent_id, color, is_default) VALUES (?,?,?,NULL,?,1)', [uid(), workspaceId, c.name, c.color]);
  }
}

/** Creates a workspace + owner membership + default categories. */
export function createWorkspace({ name, type, ownerId, currency = 'INR' }) {
  const id = uid();
  run('INSERT INTO workspaces (id, name, slug, type, owner_id, currency_code, created_at) VALUES (?,?,?,?,?,?,?)',
    [id, name, slugify(name), type, ownerId, (currency || 'INR').toUpperCase().slice(0, 3), nowIso()]);
  run("INSERT INTO workspace_members (id, workspace_id, user_id, invited_email, role, member_scope, status, invited_by, joined_at) VALUES (?,?,?,NULL,'owner','all','active',?,?)",
    [uid(), id, ownerId, ownerId, nowIso()]);
  seedCategories(id);
  return one('SELECT * FROM workspaces WHERE id = ?', [id]);
}

/** Workspaces the user is an ACTIVE member of + pending invitations. */
export function myWorkspaces(userId, email) {
  const active = all(
    `SELECT w.id, w.name, w.slug, w.type, w.currency_code, m.role, m.member_scope, m.status
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY w.type = 'personal' DESC, w.name`, [userId]);
  const invites = all(
    `SELECT m.id AS membership_id, w.id AS workspace_id, w.name, w.type, m.role, u.display_name AS invited_by_name
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN users u ON u.id = m.invited_by
      WHERE m.status = 'pending' AND (m.user_id = ? OR lower(m.invited_email) = lower(?))`, [userId, email || '']);
  return { workspaces: active, invites };
}

export function listMembers(ctx) {
  require_(ctx, 'member_write');
  return all(
    `SELECT m.id, m.user_id, m.invited_email, m.role, m.member_scope, m.status, m.joined_at,
            u.display_name, u.email, u.avatar_url, ib.display_name AS invited_by_name
       FROM workspace_members m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN users ib ON ib.id = m.invited_by
      WHERE m.workspace_id = ? AND m.status <> 'removed'
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.display_name`,
    [ctx.workspaceId]);
}

export function inviteMember(ctx, { email, role = 'member', member_scope = 'all' }) {
  require_(ctx, 'member_write');
  if (ctx.workspace.type === 'personal') throw new HttpError(400, 'Personal workspaces cannot have additional members');
  if (role === 'owner') throw forbidden('Cannot invite someone as owner');
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new HttpError(400, 'Invalid email address');

  const existingUser = one('SELECT id FROM users WHERE lower(email) = ?', [clean]);
  const dupe = one(
    "SELECT id FROM workspace_members WHERE workspace_id = ? AND (lower(coalesce(invited_email,'')) = ? OR (user_id IS NOT NULL AND user_id = ?)) AND status <> 'removed'",
    [ctx.workspaceId, clean, existingUser?.id || '\u0000']);
  if (dupe) throw new HttpError(409, 'That person is already a member or has a pending invite');

  const id = uid();
  run("INSERT INTO workspace_members (id, workspace_id, user_id, invited_email, role, member_scope, status, invited_by, joined_at) VALUES (?,?,?,?,?,?,'pending',?,NULL)",
    [id, ctx.workspaceId, existingUser?.id || null, clean, role, member_scope, ctx.userId]);
  writeAudit(ctx, 'invite', 'member', id, { after: { email: clean, role, member_scope } }, `Invited ${clean} as ${role}`);
  return one('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?', [id, ctx.workspaceId]);
}

export function updateMember(ctx, memberId, patch) {
  require_(ctx, 'member_write');
  const before = one('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?', [memberId, ctx.workspaceId]);
  if (!before) throw notFound();
  if (before.role === 'owner') throw forbidden("The owner's role cannot be changed");
  if (before.user_id && before.user_id === ctx.userId) throw forbidden('You cannot change your own role');

  const role = patch.role || before.role;
  if (role !== before.role) {
    if (!ctx.caps.role_change) throw forbidden('Only the workspace owner can change roles');
    if (role === 'owner') throw forbidden('Ownership transfer is not supported in this version');
  }
  const scope = patch.member_scope || before.member_scope;
  run('UPDATE workspace_members SET role = ?, member_scope = ? WHERE id = ? AND workspace_id = ?', [role, scope, memberId, ctx.workspaceId]);
  writeAudit(ctx, 'role_change', 'member', memberId,
    { before: { role: before.role, member_scope: before.member_scope }, after: { role, member_scope: scope } },
    `Changed role from ${before.role} to ${role}${scope !== before.member_scope ? ` and scope to ${scope}` : ''}`);
  return one('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?', [memberId, ctx.workspaceId]);
}

export function removeMember(ctx, memberId) {
  require_(ctx, 'member_write');
  const before = one('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?', [memberId, ctx.workspaceId]);
  if (!before) throw notFound();
  if (before.role === 'owner') throw forbidden('The owner cannot be removed');
  run("UPDATE workspace_members SET status = 'removed' WHERE id = ? AND workspace_id = ?", [memberId, ctx.workspaceId]);
  writeAudit(ctx, 'delete', 'member', memberId, { before }, `Removed ${before.invited_email || 'member'} from workspace`);
  return { ok: true };
}

export function acceptInvite(userId, email, membershipId) {
  const row = one(
    "SELECT * FROM workspace_members WHERE id = ? AND status = 'pending' AND (user_id = ? OR lower(coalesce(invited_email,'')) = lower(?))",
    [membershipId, userId, email || '']);
  if (!row) throw notFound();
  run("UPDATE workspace_members SET user_id = ?, status = 'active', joined_at = ? WHERE id = ?", [userId, nowIso(), row.id]);
  run('INSERT INTO audit_log (id, workspace_id, actor_id, action, entity_type, entity_id, diff, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [uid(), row.workspace_id, userId, 'update', 'member', row.id, JSON.stringify({ after: { status: 'active' } }), 'Accepted workspace invitation', nowIso()]);
  return one('SELECT * FROM workspaces WHERE id = ?', [row.workspace_id]);
}

export function updateWorkspace(ctx, patch) {
  require_(ctx, 'workspace_write');
  const before = ctx.workspace;
  const name = patch.name || before.name;
  let currency = before.currency_code;
  if (patch.currency_code && patch.currency_code !== before.currency_code) {
    const hasTxn = one('SELECT COUNT(*) AS c FROM transactions WHERE workspace_id = ?', [ctx.workspaceId]).c;
    if (hasTxn > 0) throw new HttpError(400, 'Currency is locked once the workspace has transactions');
    currency = patch.currency_code.toUpperCase().slice(0, 3);
  }
  run('UPDATE workspaces SET name = ?, currency_code = ? WHERE id = ?', [name, currency, ctx.workspaceId]);
  writeAudit(ctx, 'update', 'workspace', ctx.workspaceId, { before: { name: before.name, currency_code: before.currency_code }, after: { name, currency_code: currency } }, `Updated workspace settings`);
  return one('SELECT * FROM workspaces WHERE id = ?', [ctx.workspaceId]);
}

export function deleteWorkspace(ctx, confirmName) {
  require_(ctx, 'workspace_delete');
  if (ctx.workspace.type === 'personal') throw forbidden('Your personal workspace cannot be deleted');
  if (String(confirmName || '').trim() !== ctx.workspace.name) throw new HttpError(400, 'Workspace name does not match');
  run('DELETE FROM workspaces WHERE id = ?', [ctx.workspaceId]);
  return { ok: true };
}
