import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Project, RagConversation, RagBot } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import { mailerService } from '../services/mailerService.js';

/**
 * Live chat inbox: see chatbot conversations, take over, reply, hand back.
 * Mounted under /api/v1/projects/:projectId/inbox
 */

async function project(req: Request) {
  const { projectId } = req.params;
  if (!Types.ObjectId.isValid(projectId)) throw new AppError('Invalid project id', 400);
  const p = await Project.findOne({ _id: projectId, tenantId: req.tenantId }).select('_id name');
  if (!p) throw new AppError('Project not found', 404);
  return p;
}

async function conversation(req: Request) {
  const p = await project(req);
  if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('Invalid id', 400);
  const conv = await RagConversation.findOne({ _id: req.params.id, projectId: p._id });
  if (!conv) throw new AppError('Conversation not found', 404);
  return { p, conv };
}

const agentName = (req: Request) => [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ') || 'Support';

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const p = await project(req);
  const filter: Record<string, unknown> = { projectId: p._id };
  const status = String(req.query.status || 'open');
  if (status === 'open') filter['handoff.status'] = { $in: ['requested', 'human'] };
  else if (['bot', 'requested', 'human', 'closed'].includes(status)) filter['handoff.status'] = status;
  const convs = await RagConversation.find(filter)
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(100)
    .select('botId visitorEmail handoff unreadForAgent lastMessageAt updatedAt messages')
    .lean();
  const bots = new Map((await RagBot.find({ _id: { $in: convs.map((c) => c.botId) } }).select('name').lean()).map((b) => [String(b._id), b.name]));
  const counts = await RagConversation.aggregate([
    { $match: { projectId: p._id, 'handoff.status': { $in: ['requested', 'human'] } } },
    { $group: { _id: '$handoff.status', n: { $sum: 1 } } },
  ]);
  res.json({
    success: true,
    data: {
      conversations: convs.map((c: any) => {
        const last = (c.messages || []).slice(-1)[0];
        return {
          _id: c._id,
          botName: bots.get(String(c.botId)),
          visitorEmail: c.visitorEmail,
          status: c.handoff?.status || 'bot',
          assignedName: c.handoff?.assignedName,
          unread: c.unreadForAgent || 0,
          lastMessageAt: c.lastMessageAt || c.updatedAt,
          preview: last ? `${last.role === 'user' ? '' : `${last.role}: `}${String(last.content).slice(0, 140)}` : '',
          messageCount: (c.messages || []).length,
        };
      }),
      counts: Object.fromEntries(counts.map((x) => [x._id, x.n])),
    },
  });
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const { conv } = await conversation(req);
  if (conv.unreadForAgent) {
    conv.unreadForAgent = 0;
    await conv.save();
  }
  const bot = await RagBot.findById(conv.botId).select('name').lean();
  res.json({ success: true, data: { ...conv.toObject(), botName: (bot as any)?.name } });
});

export const reply = asyncHandler(async (req: Request, res: Response) => {
  const { p, conv } = await conversation(req);
  const message = String(req.body?.message || '').trim();
  if (!message) throw new AppError('Write a message first', 400);
  const name = agentName(req);
  conv.messages.push({ role: 'agent', content: message.slice(0, 4000), agentName: name, timestamp: new Date() } as any);
  conv.handoff = { ...(conv.handoff as any), status: 'human', assignedTo: req.user?._id as any, assignedName: name };
  conv.lastMessageAt = new Date();
  await conv.save();

  // Optional email copy for visitors who already left the page
  if (req.body?.emailCopy && conv.visitorEmail) {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    await mailerService.send({
      projectId: p._id,
      category: 'transactional',
      to: conv.visitorEmail,
      subject: `${name} from ${p.name} replied`,
      html: `<p>${esc(message).replace(/\n/g, '<br>')}</p><p style="color:#6b7280;font-size:12px">— ${esc(name)}, ${esc(p.name)}</p>`,
    });
  }
  res.json({ success: true, data: conv });
});

export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  const { conv } = await conversation(req);
  const status = req.body?.status;
  if (!['bot', 'human', 'closed'].includes(status)) throw new AppError('Invalid status', 400);
  const name = agentName(req);
  const note = status === 'human' ? `${name} joined the chat.` : status === 'bot' ? 'You are chatting with the assistant again.' : 'This conversation was closed.';
  conv.handoff = {
    ...(conv.handoff as any),
    status,
    ...(status === 'human' ? { assignedTo: req.user?._id, assignedName: name } : {}),
  };
  conv.messages.push({ role: 'system', content: note, timestamp: new Date() } as any);
  conv.lastMessageAt = new Date();
  await conv.save();
  res.json({ success: true, data: conv });
});
