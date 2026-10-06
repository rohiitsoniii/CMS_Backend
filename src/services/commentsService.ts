import { Comment } from '../models/Comment';
import { EmailNotificationService } from './emailNotificationService';
import { User } from '../models/User';

export class CommentsService {
  // Create comment
  static async createComment(data: {
    projectId: string;
    contentId: string;
    authorId: string;
    content: string;
    fieldPath?: string;
    parentId?: string;
  }) {
    // Extract mentions from content (@username)
    const mentions = this.extractMentions(data.content);
    const mentionedUserIds = await this.resolveMentions(mentions, data.projectId);

    const comment = await Comment.create({
      projectId: data.projectId,
      contentId: data.contentId,
      author: data.authorId,
      content: data.content,
      mentions: mentionedUserIds,
      fieldPath: data.fieldPath,
      parentId: data.parentId
    });

    // Send notifications to mentioned users
    const author = await User.findById(data.authorId);
    for (const userId of mentionedUserIds) {
      await EmailNotificationService.sendCommentMention(
        userId.toString(),
        author?.name || 'Someone',
        data.contentId,
        data.content
      );
    }

    return comment.populate('author', 'name email avatar');
  }

  // Get comments for content
  static async getComments(contentId: string, options?: { includeResolved?: boolean }) {
    const query: any = { contentId };
    
    if (!options?.includeResolved) {
      query.resolved = false;
    }

    return Comment.find(query)
      .populate('author', 'name email avatar')
      .populate('mentions', 'name email')
      .populate('resolvedBy', 'name email')
      .sort({ createdAt: -1 });
  }

  // Get comment threads
  static async getCommentThreads(contentId: string) {
    const comments = await this.getComments(contentId, { includeResolved: true });
    
    // Build thread structure
    const commentMap = new Map();
    const threads: any[] = [];

    comments.forEach(comment => {
      commentMap.set(comment._id.toString(), { ...comment.toObject(), replies: [] });
    });

    comments.forEach(comment => {
      const commentObj = commentMap.get(comment._id.toString());
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId.toString());
        if (parent) {
          parent.replies.push(commentObj);
        }
      } else {
        threads.push(commentObj);
      }
    });

    return threads;
  }

  // Update comment
  static async updateComment(commentId: string, content: string) {
    const mentions = this.extractMentions(content);
    const comment = await Comment.findById(commentId);
    
    if (!comment) {
      throw new Error('Comment not found');
    }

    const mentionedUserIds = await this.resolveMentions(mentions, comment.projectId.toString());

    return Comment.findByIdAndUpdate(
      commentId,
      { content, mentions: mentionedUserIds },
      { new: true }
    ).populate('author', 'name email avatar');
  }

  // Delete comment
  static async deleteComment(commentId: string) {
    // Also delete all replies
    const comment = await Comment.findById(commentId);
    if (!comment) {
      throw new Error('Comment not found');
    }

    await Comment.deleteMany({ parentId: commentId });
    await Comment.findByIdAndDelete(commentId);

    return { success: true };
  }

  // Resolve comment
  static async resolveComment(commentId: string, userId: string) {
    return Comment.findByIdAndUpdate(
      commentId,
      {
        resolved: true,
        resolvedBy: userId,
        resolvedAt: new Date()
      },
      { new: true }
    ).populate('author', 'name email avatar');
  }

  // Unresolve comment
  static async unresolveComment(commentId: string) {
    return Comment.findByIdAndUpdate(
      commentId,
      {
        resolved: false,
        $unset: { resolvedBy: 1, resolvedAt: 1 }
      },
      { new: true }
    ).populate('author', 'name email avatar');
  }

  // Get comments by field
  static async getCommentsByField(contentId: string, fieldPath: string) {
    return Comment.find({ contentId, fieldPath })
      .populate('author', 'name email avatar')
      .sort({ createdAt: -1 });
  }

  // Get unresolved comments count
  static async getUnresolvedCount(contentId: string) {
    return Comment.countDocuments({ contentId, resolved: false });
  }

  // Extract @mentions from text
  private static extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  // Resolve usernames to user IDs
  private static async resolveMentions(usernames: string[], projectId: string): Promise<string[]> {
    if (usernames.length === 0) return [];

    const users = await User.find({
      $or: [
        { username: { $in: usernames } },
        { email: { $in: usernames } }
      ]
    });

    return users.map(u => u._id.toString());
  }
}
