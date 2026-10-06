import nodemailer from 'nodemailer';

export const emailService = {
  async sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
    try {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`📧 [Mock Email] To: ${to} | Subject: ${subject}`);
        return;
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@headlesscms.com',
        to,
        subject,
        html,
      });
    } catch (err: any) {
      console.warn('⚠️ Failed to send email:', err.message);
    }
  },
};
