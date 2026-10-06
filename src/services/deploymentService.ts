import axios from 'axios';
import DeploymentIntegration from '../models/DeploymentIntegration';

export class DeploymentService {
  /**
   * List all integrations for a project
   */
  static async getIntegrations(tenantId: string, projectId: string) {
    return await DeploymentIntegration.find({ tenantId, projectId });
  }

  /**
   * Create a new deployment integration
   */
  static async createIntegration(tenantId: string, projectId: string, data: any) {
    const integration = new DeploymentIntegration({
      tenantId,
      projectId,
      ...data
    });
    return await integration.save();
  }

  /**
   * Trigger a deployment
   */
  static async triggerDeploy(tenantId: string, integrationId: string) {
    const integration = await DeploymentIntegration.findOne({ _id: integrationId, tenantId });
    if (!integration) throw new Error('Integration not found');

    try {
      integration.lastDeployStatus = 'pending';
      await integration.save();

      // Trigger the build hook
      await axios.post(integration.hookUrl);

      integration.lastDeployStatus = 'success';
      integration.lastDeployAt = new Date();
      await integration.save();

      return { success: true, message: 'Deployment triggered successfully' };
    } catch (error: any) {
      integration.lastDeployStatus = 'failed';
      await integration.save();
      console.error('Deployment Trigger Error:', error.message);
      throw new Error(`Failed to trigger deployment: ${error.message}`);
    }
  }

  /**
   * Delete an integration
   */
  static async deleteIntegration(tenantId: string, integrationId: string) {
    return await DeploymentIntegration.deleteOne({ _id: integrationId, tenantId });
  }
}
