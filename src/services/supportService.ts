import { Ticket } from '../models/Ticket';
import { emailService } from './emailService';
import mongoose from 'mongoose';

export const supportService = {
  async createTicket(data: {
    tenantId: string;
    userId: string;
    subject: string;
    description: string;
    category: string;
    priority?: string;
  }) {
    const ticket = await Ticket.create({
      tenant: data.tenantId,
      user: data.userId,
      subject: data.subject,
      description: data.description,
      category: data.category,
      priority: data.priority || 'medium',
      messages: [{
        user: data.userId,
        message: data.description,
        isStaff: false,
        createdAt: new Date()
      }]
    });

    await emailService.sendEmail({
      to: 'support@example.com',
      subject: `New Support Ticket: ${data.subject}`,
      html: `
        <h2>New Support Ticket</h2>
        <p><strong>Subject:</strong> ${data.subject}</p>
        <p><strong>Category:</strong> ${data.category}</p>
        <p><strong>Priority:</strong> ${data.priority || 'medium'}</p>
        <p><strong>Description:</strong></p>
        <p>${data.description}</p>
      `
    });

    return ticket;
  },

  async getTickets(tenantId: string, filters: any = {}) {
    const query: any = { tenant: tenantId };
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.category) query.category = filters.category;

    return Ticket.find(query)
      .populate('user', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 });
  },

  async getTicket(ticketId: string, tenantId: string) {
    return Ticket.findOne({ _id: ticketId, tenant: tenantId })
      .populate('user', 'name email')
      .populate('assignedTo', 'name email')
      .populate('messages.user', 'name email');
  },

  async addMessage(ticketId: string, userId: string, message: string, isStaff: boolean = false) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    ticket.messages.push({
      user: new mongoose.Types.ObjectId(userId),
      message,
      isStaff,
      createdAt: new Date()
    });

    if (ticket.status === 'waiting' && !isStaff) {
      ticket.status = 'in_progress';
    }

    await ticket.save();
    return ticket;
  },

  async updateTicket(ticketId: string, updates: any) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    if (updates.status) ticket.status = updates.status;
    if (updates.priority) ticket.priority = updates.priority;
    if (updates.assignedTo) ticket.assignedTo = updates.assignedTo;

    if (updates.status === 'resolved' && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }

    await ticket.save();
    return ticket;
  },

  async closeTicket(ticketId: string) {
    return Ticket.findByIdAndUpdate(
      ticketId,
      { status: 'closed', resolvedAt: new Date() },
      { new: true }
    );
  }
};
