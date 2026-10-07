import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Tenant } from '../models/Tenant.js';
import { User, type IUser, type UserRole } from '../models/User.js';
import { authenticateJWT, requirePermission } from '../middleware/auth.js';

const router = express.Router();

const USER_SCHEMA_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_RESPONSE_URN = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_URN = 'urn:ietf:params:scim:api:messages:2.0:Error';

const VALID_ROLES: UserRole[] = ['owner', 'admin', 'editor', 'viewer'];

/** SHA-256 hex digest used for storing SCIM bearer tokens (raw token never hits the DB). */
export const hashScimToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

const scimError = (res: Response, status: number, detail: string): Response =>
  res.status(status).json({ schemas: [ERROR_URN], detail, status: String(status) });

const isValidEmail = (value: unknown): value is string =>
  typeof value === 'string' && /^\S+@\S+\.\S+$/.test(value.trim());

/** Map an app User document to a SCIM 2.0 User resource. */
const toScimUser = (user: IUser): Record<string, unknown> => ({
  schemas: [USER_SCHEMA_URN],
  id: user._id.toString(),
  userName: user.email,
  displayName: `${user.firstName} ${user.lastName}`.trim(),
  name: { givenName: user.firstName, familyName: user.lastName, formatted: `${user.firstName} ${user.lastName}`.trim() },
  emails: [{ primary: true, value: user.email, type: 'work' }],
  active: user.isActive,
  roles: [{ value: user.role, primary: true }],
  meta: {
    resourceType: 'User',
    created: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    lastModified: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    location: `/scim/v2/Users/${user._id.toString()}`,
  },
});

/** Pull the primary email out of a SCIM payload (`userName` wins, then `emails[]`). */
const extractEmail = (body: Record<string, any>): string | undefined => {
  if (isValidEmail(body?.userName)) return (body.userName as string).trim().toLowerCase();
  const emails = Array.isArray(body?.emails) ? body.emails : [];
  const primary = emails.find((e: any) => e?.primary === true && isValidEmail(e?.value)) ?? emails.find((e: any) => isValidEmail(e?.value));
  if (primary) return (primary.value as string).trim().toLowerCase();
  if (isValidEmail(body?.emails?.[0])) return ((body.emails as string[])[0] as string).trim().toLowerCase();
  return undefined;
};

/** Resolve a SCIM payload's roles/entitlements to an app role; default `editor`. */
const resolveRole = (body: Record<string, any>): UserRole => {
  const candidates: string[] = [];
  for (const key of ['roles', 'entitlements', 'groups']) {
    const arr = body?.[key];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (typeof entry === 'string') candidates.push(entry);
        else if (entry && typeof entry.value === 'string') candidates.push(entry.value);
        else if (entry && typeof entry.display === 'string') candidates.push(entry.display);
      }
    }
  }
  if (typeof body?.role === 'string') candidates.push(body.role);
  for (const c of candidates) {
    const normalized = c.trim().toLowerCase();
    const match = VALID_ROLES.find((r) => r === normalized);
    if (match) return match;
  }
  return 'editor';
};

const coerceActive = (body: Record<string, any>, fallback: boolean): boolean =>
  typeof body?.active === 'boolean' ? body.active : fallback;

/**
 * Per-tenant SCIM bearer auth. The presented token is hashed with SHA-256 and
 * compared (timing-safe) against the stored hash; the matching tenant scopes
 * all subsequent user operations. No placeholder tenant.
 */
const authenticateSCIM = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      scimError(res, 401, 'Missing SCIM Bearer token');
      return;
    }
    const presented = authHeader.slice('Bearer '.length).trim();
    if (!presented) {
      scimError(res, 401, 'Missing SCIM Bearer token');
      return;
    }
    const digest = hashScimToken(presented);
    // Narrow by hash for efficiency, then verify with a timing-safe compare
    // so a plain `==` short-circuit is never the sole gate.
    const tenant = await Tenant.findOne({ scimToken: digest, scimEnabled: true }).select('+scimToken');
    let trusted = false;
    if (tenant?.scimToken) {
      const a = Buffer.from(tenant.scimToken, 'utf8');
      const b = Buffer.from(digest, 'utf8');
      trusted = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!tenant || !trusted) {
      scimError(res, 401, 'Invalid SCIM Bearer token');
      return;
    }
    req.tenant = tenant;
    req.tenantId = (tenant._id as mongoose.Types.ObjectId).toString();
    next();
  } catch (err) {
    next(err);
  }
};

router.use(authenticateSCIM);

/** GET /Users — paginated ListResponse. Supports `filter`, `startIndex`, `count`. */
router.get('/Users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId as string;
    const startIndex = Math.max(1, parseInt(String(req.query.startIndex ?? '1'), 10) || 1);
    let count = parseInt(String(req.query.count ?? '100'), 10);
    if (Number.isNaN(count) || count < 0) count = 100;
    count = Math.min(count, 200);

    const query: Record<string, unknown> = { tenantId };
    const filter = typeof req.query.filter === 'string' ? req.query.filter.trim() : '';
    if (filter) {
      // Support the common IdP form: userName eq "someone@example.com"
      const userNameMatch = filter.match(/userName\s+eq\s+"([^"]+)"/i);
      const emailMatch = filter.match(/emails(?:\.value)?\s+eq\s+"([^"]+)"/i);
      const wanted = (userNameMatch?.[1] ?? emailMatch?.[1])?.trim().toLowerCase();
      if (wanted) {
        query.email = wanted;
      } else {
        // Unsupported filter expression per SCIM §3.4.2
        scimError(res, 400, `Unsupported filter: ${filter}`);
        return;
      }
    }

    const totalResults = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ createdAt: 1 })
      .skip(startIndex - 1)
      .limit(count);

    res.json({
      schemas: [LIST_RESPONSE_URN],
      totalResults,
      itemsPerPage: users.length,
      startIndex,
      Resources: users.map(toScimUser),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /Users/:id */
router.get('/Users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      scimError(res, 404, 'User not found');
      return;
    }
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) {
      scimError(res, 404, 'User not found');
      return;
    }
    res.json(toScimUser(user));
  } catch (err) {
    next(err);
  }
});

/** POST /Users — provision a new tenant-scoped user. */
router.post('/Users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, any>;
    const email = extractEmail(body);
    if (!email) {
      scimError(res, 400, 'Email is required for SCIM provisioning (userName or emails[].value)');
      return;
    }
    const existing = await User.findOne({ tenantId: req.tenantId, email });
    if (existing) {
      scimError(res, 409, 'User already exists');
      return;
    }
    const givenName = typeof body?.name?.givenName === 'string' && body.name.givenName.trim()
      ? body.name.givenName.trim()
      : email.split('@')[0];
    const familyName = typeof body?.name?.familyName === 'string' && body.name.familyName.trim()
      ? body.name.familyName.trim()
      : 'User';
    const role = resolveRole(body);
    const active = coerceActive(body, true);

    const user = new User({
      tenantId: req.tenantId,
      email,
      password: crypto.randomBytes(32).toString('hex'),
      firstName: givenName,
      lastName: familyName,
      role,
      isActive: active,
      isEmailVerified: false,
    });
    await user.save();
    res.status(201).json(toScimUser(user));
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      scimError(res, 409, 'User already exists');
      return;
    }
    next(err);
  }
});

/** PUT /Users/:id — full replace (including the `active` → `isActive` flag). */
router.put('/Users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      scimError(res, 404, 'User not found');
      return;
    }
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) {
      scimError(res, 404, 'User not found');
      return;
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const email = extractEmail(body);
    if (!email) {
      scimError(res, 400, 'Email is required for SCIM provisioning (userName or emails[].value)');
      return;
    }
    const clash = await User.findOne({ tenantId: req.tenantId, email, _id: { $ne: user._id } });
    if (clash) {
      scimError(res, 409, 'Another user with this email already exists');
      return;
    }
    user.email = email;
    user.firstName = typeof body?.name?.givenName === 'string' && body.name.givenName.trim()
      ? body.name.givenName.trim()
      : user.firstName;
    user.lastName = typeof body?.name?.familyName === 'string' && body.name.familyName.trim()
      ? body.name.familyName.trim()
      : user.lastName;
    user.role = resolveRole(body);
    user.isActive = coerceActive(body, user.isActive);
    await user.save();
    res.json(toScimUser(user));
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      scimError(res, 409, 'Another user with this email already exists');
      return;
    }
    next(err);
  }
});

/** PATCH /Users/:id — apply SCIM PatchOp Operations (`active`, names, emails). */
router.patch('/Users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      scimError(res, 404, 'User not found');
      return;
    }
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) {
      scimError(res, 404, 'User not found');
      return;
    }
    const operations = (req.body ?? {}).Operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      scimError(res, 400, 'PATCH requires a non-empty Operations array');
      return;
    }
    for (const op of operations) {
      const operation = String(op?.op ?? '').toLowerCase();
      const path = String(op?.path ?? '').toLowerCase();
      const value = op?.value;
      if (!['add', 'replace', 'remove'].includes(operation)) {
        scimError(res, 400, `Unsupported PATCH operation: ${op?.op}`);
        return;
      }
      if (path === 'active') {
        const nextActive = operation === 'remove'
          ? false
          : typeof value === 'boolean' ? value : value?.active;
        if (typeof nextActive !== 'boolean') {
          scimError(res, 400, 'PATCH Operation for path "active" requires a boolean value');
          return;
        }
        user.isActive = nextActive;
      } else if (path === 'username' || path === 'emails' || path === 'emails.value') {
        if (operation === 'remove') {
          scimError(res, 400, 'Email cannot be removed via PATCH; supply a replacement value');
          return;
        }
        const candidate = Array.isArray(value)
          ? value.find((e: any) => isValidEmail(e?.value))?.value ?? (typeof value[0] === 'string' ? value[0] : undefined)
          : typeof value === 'string' ? value : value?.value ?? value?.[0]?.value;
        if (!isValidEmail(candidate)) {
          scimError(res, 400, 'PATCH Operation for email requires a valid email value');
          return;
        }
        const normalized = candidate.trim().toLowerCase();
        const clash = await User.findOne({ tenantId: req.tenantId, email: normalized, _id: { $ne: user._id } });
        if (clash) {
          scimError(res, 409, 'Another user with this email already exists');
          return;
        }
        user.email = normalized;
      } else if (path.startsWith('name.')) {
        const next = operation === 'remove' ? undefined : typeof value === 'string' ? value : value?.value;
        if (path === 'name.givenname' && typeof next === 'string' && next.trim()) user.firstName = next.trim();
        else if (path === 'name.familyname' && typeof next === 'string' && next.trim()) user.lastName = next.trim();
        else if (path === 'name.formatted') { /* derived; ignore */ } else {
          scimError(res, 400, `Unsupported PATCH path: ${op?.path}`);
          return;
        }
      } else if (path === 'name') {
        if (operation !== 'remove' && value && typeof value === 'object') {
          if (typeof value.givenName === 'string' && value.givenName.trim()) user.firstName = value.givenName.trim();
          if (typeof value.familyName === 'string' && value.familyName.trim()) user.lastName = value.familyName.trim();
        } else if (operation !== 'remove') {
          scimError(res, 400, 'PATCH Operation for path "name" requires an object value');
          return;
        }
      } else if (path === 'roles' || path === 'entitlements' || path === 'role') {
        if (operation === 'remove') {
          user.role = 'editor';
        } else {
          user.role = resolveRole({ [path === 'role' ? 'role' : path]: value });
        }
      } else if (path === '' && value && typeof value === 'object') {
        // Path-less replace: treat value as a partial resource.
        const mergedEmail = extractEmail({ userName: value.userName, emails: value.emails });
        if (mergedEmail) user.email = mergedEmail;
        if (typeof value.active === 'boolean') user.isActive = value.active;
        if (value.name && typeof value.name === 'object') {
          if (typeof value.name.givenName === 'string' && value.name.givenName.trim()) user.firstName = value.name.givenName.trim();
          if (typeof value.name.familyName === 'string' && value.name.familyName.trim()) user.lastName = value.name.familyName.trim();
        }
      } else {
        scimError(res, 400, `Unsupported PATCH path: ${op?.path ?? '(empty)'}`);
        return;
      }
    }
    await user.save();
    res.json(toScimUser(user));
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      scimError(res, 409, 'Another user with this email already exists');
      return;
    }
    next(err);
  }
});

/** DELETE /Users/:id — soft-deactivate only; users are never hard-deleted. */
router.delete('/Users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      scimError(res, 404, 'User not found');
      return;
    }
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) {
      scimError(res, 404, 'User not found');
      return;
    }
    user.isActive = false;
    await user.save();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin token management (JWT-guarded; mounted separately at /admin/scim).
// Defined here so all SCIM credential logic lives in one module.
// ---------------------------------------------------------------------------
export const scimAdminRouter = express.Router();

scimAdminRouter.use(authenticateJWT, requirePermission('users:manage'));

/** POST /admin/scim/token — rotate: generate a new raw token (returned once). */
scimAdminRouter.post('/token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId ?? req.user?.tenantId?.toString();
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Missing tenant context' });
      return;
    }
    const rawToken = `scim_${crypto.randomBytes(32).toString('hex')}`;
    await Tenant.findByIdAndUpdate(tenantId, {
      $set: { scimToken: hashScimToken(rawToken), scimEnabled: true },
    });
    res.status(201).json({ success: true, data: { token: rawToken } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /admin/scim/token — revoke the SCIM token. */
scimAdminRouter.delete('/token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.tenantId ?? req.user?.tenantId?.toString();
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Missing tenant context' });
      return;
    }
    await Tenant.findByIdAndUpdate(tenantId, {
      $set: { scimEnabled: false },
      $unset: { scimToken: 1 },
    });
    res.json({ success: true, message: 'SCIM token revoked' });
  } catch (err) {
    next(err);
  }
});

export default router;
