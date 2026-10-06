import axios from 'axios';

type SlackPayload = {
    webhookUrl: string;
    text?: string;
    blocks?: any[];
};

export const slackIntegration = {
    /**
     * Sends a rich notification to the tenant's Slack workspace
     */
    async sendNotification(payload: SlackPayload) {
        if (!payload.webhookUrl) return false;

        try {
            await axios.post(payload.webhookUrl, {
                text: payload.text,
                blocks: payload.blocks
            });
            return true;
        } catch (error) {
            console.error('[Slack Integration] Failed to send webhook:', error);
            return false;
        }
    },

    /**
     * Preset for Content Published
     */
    async notifyContentPublished(webhookUrl: string, contentItem: any, user: any) {
        return this.sendNotification({
            webhookUrl,
            text: `Content Published: ${contentItem.name}`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `🚀 *New Content Published*\n*Title:* ${contentItem.name}\n*Type:* ${contentItem.contentTypeApiId}\n*Published By:* ${user?.email || 'System'}`
                    }
                }
            ]
        });
    },

    /**
     * Preset for Workflow Approval Needed
     */
    async notifyWorkflowApproval(webhookUrl: string, contentItem: any, stepName: string) {
         return this.sendNotification({
            webhookUrl,
            text: `Workflow Approval Needed: ${contentItem.name}`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `⚠️ *Workflow Action Required*\n*Item:* ${contentItem.name}\n*Pending Step:* ${stepName}`
                    }
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: "Review in CMS"
                            },
                            style: "primary",
                            url: `${process.env.FRONTEND_URL}/dashboard/workflows`
                        }
                    ]
                }
            ]
        });
    }
};
