import { Request, Response } from 'express';
import { supportService } from '../services/supportService.js';

export const supportController = {
  async createTicket(req: Request, res: Response) {
    try {
      const { subject, description, category, priority } = req.body;
      const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
      const userId = (req.userId || req.user?._id || (req.user as any)?.id)?.toString();

      if (!tenantId || !userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const ticket = await supportService.createTicket({
        tenantId,
        userId,
        subject,
        description,
        category,
        priority
      });
      return res.status(201).json(ticket);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  },

  async getTickets(req: Request, res: Response) {
    try {
      const { status, priority, category } = req.query;
      const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();

      if (!tenantId) {
        return res.status(401).json({ message: 'Tenant context required' });
      }

      const tickets = await supportService.getTickets(
        tenantId,
        { status: status as string, priority: priority as string, category: category as string }
      );
      return res.json(tickets);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  },

  async getTicket(req: Request, res: Response) {
    try {
      const tenantId = (req.tenantId || req.user?.tenantId || (req.user as any)?.tenant)?.toString();
      if (!tenantId) {
        return res.status(401).json({ message: 'Tenant context required' });
      }

      const ticket = await supportService.getTicket(
        req.params.id,
        tenantId
      );
      if (!ticket) {
        return res.status(404).json({ message: 'Ticket not found' });
      }
      return res.json(ticket);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  },

  async addMessage(req: Request, res: Response) {
    try {
      const { message } = req.body;
      const userId = (req.userId || req.user?._id || (req.user as any)?.id)?.toString();

      if (!userId) {
        return res.status(401).json({ message: 'User context required' });
      }

      const ticket = await supportService.addMessage(
        req.params.id,
        userId,
        message,
        false
      );
      return res.json(ticket);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  },

  async updateTicket(req: Request, res: Response) {
    try {
      const ticket = await supportService.updateTicket(req.params.id, req.body);
      return res.json(ticket);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  },

  async closeTicket(req: Request, res: Response) {
    try {
      const ticket = await supportService.closeTicket(req.params.id);
      return res.json(ticket);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  }
};
