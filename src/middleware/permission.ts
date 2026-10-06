import { Request, Response, NextFunction } from 'express';
import { TeamMember } from '../models/TeamMember';
import { Role } from '../models/Role';

/**
 * Middleware to check if user has required permissions
 * @param resource The resource to check permissions for (e.g., 'content', 'media')
 * @param action The action to perform (e.g., 'create', 'read')
 */
export const hasPermission = (resource: string, action: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = (req as any).user;
            
            // Phase 6: Super Admin Bypass
            if (user && user.isSuperAdmin) {
                return next();
            }

            const userId = user.id;
            const projectId = req.params.projectId || req.query.projectId || req.body.projectId;


            // If no project ID, we can't check permissions specific to a project
            // But if the route doesn't require project context (e.g. creating a project), skip check
            // For now, assume all permission-protected routes require a projectId
            if (!projectId) {
                // Determine if this is a route that might not need projectId, or fail
                // For safety, proceed only if the user is a super-admin (if that concept existed)
                // For this system, we'll return 400 if projectId is missing for permission checks
                
                // Exception: if accessing resources not tied to project directly but user context 
                // In a multi-tenant system, usually everything is under a project.
                res.status(400).json({
                    success: false,
                    message: 'Project ID is required for permission check'
                });
                return;
            }

            // 1. Find team member record
            const member = await TeamMember.findOne({
                projectId,
                userId,
                status: 'active'
            });

            if (!member) {
                res.status(403).json({
                    success: false,
                    message: 'You are not a member of this project'
                });
                return;
            }

            // 2. Get role
            const role = await Role.findById(member.roleId);

            if (!role) {
                res.status(403).json({
                    success: false,
                    message: 'Role not found or invalid'
                });
                return;
            }

            // 3. Check permission
            // The permissions object is structured as permissions[resource][action]
            const resourcePermissions = (role.permissions as any)[resource];
            
            if (!resourcePermissions) {
                res.status(403).json({
                    success: false,
                    message: `Access denied: Resource '${resource}' permission not defined`
                });
                return;
            }

            const hasAccess = resourcePermissions[action] === true;

            if (!hasAccess) {
                res.status(403).json({
                    success: false,
                    message: `Access denied: Insufficient permissions for ${action} on ${resource}`
                });
                return;
            }

            // Permission granted
            next();

        } catch (error) {
            console.error('Permission check failed:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error checking permissions'
            });
        }
    };
};

/**
 * Middleware to restrict access based on IP or time (Role restrictions)
 */
export const checkRestrictions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const projectId = req.params.projectId || req.query.projectId || req.body.projectId;

        if (!projectId) return next();

         const member = await TeamMember.findOne({
            projectId,
            userId,
            status: 'active'
        });

        if (!member) return next(); // Let subsequent checks handle non-members

        const role = await Role.findById(member.roleId);
        if (!role || !role.restrictions) return next();

        const { restrictions } = role;

        // 1. IP Whitelist check
        if (restrictions.ipWhitelist && restrictions.ipWhitelist.length > 0) {
            const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
            // Simple check - in production would need CIDR parsing perhaps
            if (!restrictions.ipWhitelist.includes(clientIp)) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied: IP not whitelisted'
                });
                return;
            }
        }

        // 2. Time Restrictions
        if (restrictions.timeRestrictions) {
            const now = new Date();
            const day = now.getDay(); // 0-6
            const hour = now.getHours();

            const { allowedDays, allowedHours } = restrictions.timeRestrictions;

            if (allowedDays && allowedDays.length > 0 && !allowedDays.includes(day)) {
                res.status(403).json({
                    success: false,
                    message: 'Access denied: Login not allowed on this day'
                });
                return;
            }

            if (allowedHours) {
                if (hour < allowedHours.start || hour >= allowedHours.end) {
                    res.status(403).json({
                        success: false,
                        message: 'Access denied: Login not allowed at this time'
                    });
                    return;
                }
            }
        }

        next();

    } catch (error) {
        console.error('Restriction check failed:', error);
        // Fail open or closed? Closed is safer for restrictions
         res.status(500).json({
            success: false,
            message: 'Internal server error checking restrictions'
        });
    }
};
