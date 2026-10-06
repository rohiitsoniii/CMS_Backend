import axios from 'axios';

type DiscordEmbed = {
    title: string;
    description: string;
    color?: number; // Decimal color value
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: { text: string };
    timestamp?: string;
};

const DISCORD_COLORS = {
    green: 0x00b294,
    orange: 0xf7b733,
    blue: 0x5865f2,
    red: 0xed4245,
    purple: 0x9b59b6,
};

/**
 * Discord Integration via Incoming Webhook
 * Uses the rich embed format supported by all Discord webhooks.
 */
export const discordIntegration = {
    async sendEmbed(webhookUrl: string, embed: DiscordEmbed) {
        if (!webhookUrl) return false;

        const payload = {
            embeds: [
                {
                    title: embed.title,
                    description: embed.description,
                    color: embed.color ?? DISCORD_COLORS.blue,
                    fields: embed.fields || [],
                    footer: embed.footer,
                    timestamp: embed.timestamp || new Date().toISOString(),
                },
            ],
        };

        try {
            await axios.post(webhookUrl, payload);
            return true;
        } catch (error) {
            console.error('[Discord Integration] Failed to send embed:', error);
            return false;
        }
    },

    async notifyContentPublished(webhookUrl: string, content: any, user: any) {
        return this.sendEmbed(webhookUrl, {
            title: '🚀 Content Published',
            description: `**${content.name}** is now live on the website.`,
            color: DISCORD_COLORS.green,
            fields: [
                { name: 'Type', value: content.contentTypeApiId || content.type, inline: true },
                { name: 'Published By', value: user?.email || 'System', inline: true },
                { name: 'Preview', value: `[Open CMS](${process.env.FRONTEND_URL}/dashboard)`, inline: true },
            ],
            footer: { text: 'Headless CMS' },
        });
    },

    async notifyWorkflowApproval(webhookUrl: string, content: any, stepName: string) {
        return this.sendEmbed(webhookUrl, {
            title: '⚠️ Workflow Approval Needed',
            description: `**${content.name}** is waiting for approval at step **${stepName}**.`,
            color: DISCORD_COLORS.orange,
            fields: [
                { name: 'Item', value: content.name, inline: true },
                { name: 'Step', value: stepName, inline: true },
                { name: 'Action', value: `[Review Now](${process.env.FRONTEND_URL}/dashboard/workflows)`, inline: true },
            ],
            footer: { text: 'Headless CMS Workflow' },
        });
    },

    async notifyNewComment(webhookUrl: string, content: any, commenter: any, commentText: string) {
        return this.sendEmbed(webhookUrl, {
            title: '💬 New Comment',
            description: commentText.substring(0, 300),
            color: DISCORD_COLORS.purple,
            fields: [
                { name: 'On Content', value: content.name, inline: true },
                { name: 'By', value: commenter?.email || 'Anonymous', inline: true },
            ],
            footer: { text: 'Headless CMS' },
        });
    },

    async notifySystemAlert(webhookUrl: string, title: string, message: string) {
        return this.sendEmbed(webhookUrl, {
            title: `🚨 ${title}`,
            description: message,
            color: DISCORD_COLORS.red,
            footer: { text: 'Headless CMS System' },
        });
    },
};
