import { Request, Response } from 'express';
import { CommentsService } from '../services/commentsService';

export const commentsController = {
  // Create comment
  async create(req: Request, res: Response) {
    try {
      const { projectId, contentId } = req.params;
      const { content, fieldPath, parentId } = req.body;
      const authorId = req.user!.id;

      const comment = await CommentsService.createComment({
        projectId,
        contentId,
        authorId,
        content,
        fieldPath,
        parentId
      });

      return res.json(comment);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get comments
  async getComments(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const { includeResolved } = req.query;

      const comments = await CommentsService.getComments(contentId, {
        includeResolved: includeResolved === 'true'
      });

      return res.json(comments);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get comment threads
  async getThreads(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const threads = await CommentsService.getCommentThreads(contentId);
      return res.json(threads);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Update comment
  async update(req: Request, res: Response) {
    try {
      const { commentId } = req.params;
      const { content } = req.body;

      const updated = await CommentsService.updateComment(commentId, content);
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Delete comment
  async delete(req: Request, res: Response) {
    try {
      const { commentId } = req.params;
      await CommentsService.deleteComment(commentId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Resolve comment
  async resolve(req: Request, res: Response) {
    try {
      const { commentId } = req.params;
      const userId = req.user!.id;

      const resolved = await CommentsService.resolveComment(commentId, userId);
      return res.json(resolved);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Unresolve comment
  async unresolve(req: Request, res: Response) {
    try {
      const { commentId } = req.params;
      const unresolved = await CommentsService.unresolveComment(commentId);
      return res.json(unresolved);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get comments by field
  async getByField(req: Request, res: Response) {
    try {
      const { contentId, fieldPath } = req.params;
      const comments = await CommentsService.getCommentsByField(contentId, fieldPath);
      return res.json(comments);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  },

  // Get unresolved count
  async getUnresolvedCount(req: Request, res: Response) {
    try {
      const { contentId } = req.params;
      const count = await CommentsService.getUnresolvedCount(contentId);
      return res.json({ count });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
};
