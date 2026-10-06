import axios from 'axios';

type TeamsCard = {
    title: string;
    text: string;
    themeColor?: string; // Hex color without #, e.g. '0078D4'
    facts?: { name: string; value: string }[];
    potentialAction?: {
        name: string;
        target: string;
    };
};

/**
 * Microsoft Teams Integration via Incoming Webhook
 * Uses the legacy MessageCard format (works with ALL Teams webhooks)
 */
export const teamsIntegration = {
    async sendCard(webhookUrl: string, card: TeamsCard) {
        if (!webhookUrl) return false;

        const payload = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: card.themeColor || '6264A7',
            summary: card.title,
            sections: [
                {
                    activityTitle: `**${card.title}**`,
                    activityText: card.text,
                    facts: card.facts || [],
                    markdown: true,
                },
            ],
            ...(card.potentialAction && {
                potentialAction: [
                    {
                        '@type': 'OpenUri',
                        name: card.potentialAction.name,
                        targets: [{ os: 'default', uri: card.potentialAction.target }],
                    },
                ],
            }),
        };

        try {
            await axios.post(webhookUrl, payload);
            return true;
        } catch (error) {
            console.error('[Teams Integration] Failed to send card:', error);
            return false;
        }
    },

    async notifyContentPublished(webhookUrl: string, content: any, user: any) {
        return this.sendCard(webhookUrl, {
            title: '🚀 Content Published',
            text: `A new content item is now live on your website.`,
            themeColor: '00B294',
            facts: [
                { name: 'Title', value: content.name },
                { name: 'Type', value: content.contentTypeApiId || content.type },
                { name: 'Published By', value: user?.email || 'System' },
                { name: 'Status', value: 'Published ✅' },
            ],
            potentialAction: {
                name: 'View in CMS',
                target: `${process.env.FRONTEND_URL}/dashboard`,
            },
        });
    },

    async notifyWorkflowApproval(webhookUrl: string, content: any, stepName: string) {
        return this.sendCard(webhookUrl, {
            title: '⚠️ Workflow Approval Required',
            text: `An item needs your review before it can be published.`,
            themeColor: 'F7B733',
            facts: [
                { name: 'Item', value: content.name },
                { name: 'Pending Step', value: stepName },
                { name: 'Action Required', value: 'Approve or Reject' },
            ],
            potentialAction: {
                name: 'Review in CMS',
                target: `${process.env.FRONTEND_URL}/dashboard/workflows`,
            },
        });
    },

    async notifyNewComment(webhookUrl: string, content: any, commenter: any, commentText: string) {
        return this.sendCard(webhookUrl, {
            title: '💬 New Comment',
            text: `A team member left a comment on content.`,
            themeColor: '0078D4',
            facts: [
                { name: 'Content', value: content.name },
                { name: 'Comment by', value: commenter?.email || 'Unknown' },
                { name: 'Comment', value: commentText.substring(0, 200) },
            ],
        });
    },
};
