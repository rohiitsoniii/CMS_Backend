import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/index.js';

/**
 * Ensures req.params.projectId belongs to the authenticated tenant.
 * Use after authenticateJWT on any project-scoped router.
 */
export const requireProjectAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId } = req.params;
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      res.status(400).json({ success: false, message: 'Invalid project id' });
      return;
    }
    const exists = await Project.exists({ _id: projectId, tenantId: req.tenantId });
    if (!exists) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
