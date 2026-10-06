import express, { Request, Response } from 'express';
import { User, Tenant } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Basic SCIM Token Auth Middleware
 * Realistically this checks a SCIM token defined by the Tenant settings.
 */
const authenticateSCIM = async (req: Request, res: Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
         return res.status(401).json({ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "Missing SCIM Bearer token", "status": "401" });
    }
    // For scaffolding, we accept it. In production, validate this bearer token maps to a specific TenantId
    req.tenantId = "placeholder_tenant_id";
    next();
};

router.use(authenticateSCIM);

/**
 * List SCIM Users
 */
router.get('/Users', asyncHandler(async (req: Request, res: Response) => {
    // Return SCIM formatted user array
    res.json({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": 0,
        "itemsPerPage": 100,
        "startIndex": 1,
        "Resources": []
    });
}));

/**
 * Provision new SCIM User (Create)
 */
router.post('/Users', asyncHandler(async (req: Request, res: Response) => {
    const scimUser = req.body;
    
    const email = scimUser.emails?.[0]?.value;
    const name = scimUser.name?.givenName + " " + scimUser.name?.familyName;

    if (!email) throw new AppError("Email is required for SCIM Provisioning", 400);

    // Mock create via SCIM
    const newUser = {
        id: crypto.randomUUID(),
        active: true,
        userName: email,
        emails: [{ primary: true, value: email }],
        name: scimUser.name,
        meta: { resourceType: 'User', created: new Date().toISOString(), lastModified: new Date().toISOString() }
    };

    res.status(201).json({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        ...newUser
    });
}));

/**
 * Deprovision SCIM User (Delete or Deactivate)
 */
router.delete('/Users/:id', asyncHandler(async (req: Request, res: Response) => {
    // Delete or mark inactive in our User table
    res.status(204).send();
}));

/**
 * Update SCIM User
 */
router.put('/Users/:id', asyncHandler(async (req: Request, res: Response) => {
     res.status(200).json({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: req.params.id,
        "active": req.body.active
     });
}));

export default router;
