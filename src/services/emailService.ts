import { mailerService } from './mailerService.js';

/**
 * Legacy wrapper kept for existing callers — delegates to the central mailer.
 */
export const emailService = {
  async sendEmail({ to, subject, html, projectId }: { to: string; subject: string; html: string; projectId?: string }): Promise<void> {
    await mailerService.send({ to, subject, html, projectId, category: projectId ? 'transactional' : 'system' });
  },
};
