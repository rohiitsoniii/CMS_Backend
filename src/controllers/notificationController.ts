import { Request, Response } from 'express';
import { Notification } from '../models/Notification.js';
import { asyncHandler } from '../middleware/index.js';

export const notificationController = {
  getNotifications: asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    // If we only want unread
    const unreadOnly = req.query.unreadOnly === 'true';
    
    const query: any = { 
        tenantId: req.tenantId,
        userId: req.userId 
    };

    if (unreadOnly) {
        query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ ...query, isRead: false });

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit)
        }
      }
    });
  }),

  markAsRead: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    const notification = await Notification.findOneAndUpdate(
        { _id: id, userId: req.userId, tenantId: req.tenantId },
        { isRead: true },
        { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, data: { notification } });
  }),

  markAllAsRead: asyncHandler(async (req: Request, res: Response) => {
    await Notification.updateMany(
        { userId: req.userId, tenantId: req.tenantId, isRead: false },
        { isRead: true }
    );
    res.json({ success: true });
  }),

  clearAll: asyncHandler(async (req: Request, res: Response) => {
    await Notification.deleteMany({ userId: req.userId, tenantId: req.tenantId });
    res.json({ success: true });
  })
};
