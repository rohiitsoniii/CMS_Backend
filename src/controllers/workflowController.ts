import mongoose from 'mongoose';
import { Request, Response } from 'express';
import Workflow from '../models/Workflow';
import WorkflowState from '../models/WorkflowState';
import { Content } from '../models/Content';
import { v4 as uuidv4 } from 'uuid';

/**
 * Workflow Controller
 * Manages content approval workflows
 */

/**
 * @route   GET /api/v1/workflows
 * @desc    Get all workflows for tenant
 * @access  Private
 */
export const getWorkflows = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { projectId } = req.query;
    const query: any = { tenantId };
    if (projectId) {
      query.$or = [
        { projectId },
        { projectId: null },
        { projectId: { $exists: false } }
      ];
    }

    const workflows = await Workflow.find(query).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: workflows,
      total: workflows.length
    });
  } catch (error: any) {
    console.error('Error fetching workflows:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch workflows',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/workflows/:apiId
 * @desc    Get single workflow
 * @access  Private
 */
export const getWorkflow = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let workflow = null;
    if (mongoose.Types.ObjectId.isValid(apiId)) {
      workflow = await Workflow.findOne({ _id: apiId, tenantId });
    }
    if (!workflow) {
      workflow = await (Workflow as any).findByApiId(tenantId, apiId);
    }

    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    return res.json({
      success: true,
      data: workflow
    });
  } catch (error: any) {
    console.error('Error fetching workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch workflow',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/workflows
 * @desc    Create new workflow
 * @access  Private
 */
export const createWorkflow = async (req: Request, res: Response) => {
  try {
    const { name, apiId, description, steps, contentTypes, isDefault, projectId } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: name'
      });
    }

    // Auto-generate apiId if not provided
    const cleanApiId = (apiId || name)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `wf-${Date.now().toString(36)}`;

    // Fallback steps if empty
    const stepList = Array.isArray(steps) && steps.length > 0
      ? steps
      : [
          { name: 'Draft', requiresApproval: false },
          { name: 'Review', requiresApproval: true },
          { name: 'Publish', requiresApproval: false }
        ];

    // Add IDs and standard fields to steps
    const stepsWithIds = stepList.map((step: any, index: number) => ({
      id: step.id || `step_${uuidv4().substring(0, 8)}`,
      name: step.name || `Step ${index + 1}`,
      description: step.description || '',
      order: step.order !== undefined ? step.order : index,
      requiresApproval: step.requiresApproval !== undefined ? step.requiresApproval : true,
      assignedRoles: step.assignedRoles || [],
      assignedTo: step.assignedTo ? (Array.isArray(step.assignedTo) ? step.assignedTo : [step.assignedTo]) : [],
      autoAdvance: Boolean(step.autoAdvance || step.autoApprove),
      notifyOnEntry: step.notifyOnEntry !== undefined ? step.notifyOnEntry : true
    }));

    // Ensure apiId uniqueness
    const exists = await (Workflow as any).apiIdExists(tenantId, cleanApiId);
    const finalApiId = exists ? `${cleanApiId}-${Date.now().toString(36)}` : cleanApiId;

    // Create workflow
    const workflow = new Workflow({
      tenantId,
      projectId: projectId || undefined,
      name,
      apiId: finalApiId,
      description,
      steps: stepsWithIds,
      contentTypes: contentTypes || [],
      isDefault: isDefault || false,
      isActive: true,
      createdBy: userId,
      updatedBy: userId
    });

    await workflow.save();

    return res.status(201).json({
      success: true,
      message: 'Workflow created successfully',
      data: workflow
    });
  } catch (error: any) {
    console.error('Error creating workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create workflow',
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/v1/workflows/:apiId
 * @desc    Update workflow
 * @access  Private
 */
export const updateWorkflow = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const { name, description, steps, contentTypes, isDefault, isActive, projectId } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let workflow = null;
    if (mongoose.Types.ObjectId.isValid(apiId)) {
      workflow = await Workflow.findOne({ _id: apiId, tenantId });
    }
    if (!workflow) {
      workflow = await (Workflow as any).findByApiId(tenantId, apiId);
    }

    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Update fields
    if (name) workflow.name = name;
    if (description !== undefined) workflow.description = description;
    if (projectId) (workflow as any).projectId = projectId;
    if (steps && Array.isArray(steps)) {
      workflow.steps = steps.map((step: any, index: number) => ({
        id: step.id || `step_${uuidv4().substring(0, 8)}`,
        name: step.name || `Step ${index + 1}`,
        description: step.description || '',
        order: step.order !== undefined ? step.order : index,
        requiresApproval: step.requiresApproval !== undefined ? step.requiresApproval : true,
        assignedRoles: step.assignedRoles || [],
        assignedTo: step.assignedTo ? (Array.isArray(step.assignedTo) ? step.assignedTo : [step.assignedTo]) : [],
        autoAdvance: Boolean(step.autoAdvance || step.autoApprove),
        notifyOnEntry: step.notifyOnEntry !== undefined ? step.notifyOnEntry : true
      }));
    }
    if (contentTypes) workflow.contentTypes = contentTypes;
    if (isDefault !== undefined) workflow.isDefault = isDefault;
    if (isActive !== undefined) workflow.isActive = isActive;

    workflow.updatedBy = userId;
    await workflow.save();

    return res.json({
      success: true,
      message: 'Workflow updated successfully',
      data: workflow
    });
  } catch (error: any) {
    console.error('Error updating workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update workflow',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/workflows/:apiId
 * @desc    Delete workflow
 * @access  Private
 */
export const deleteWorkflow = async (req: Request, res: Response) => {
  try {
    const { apiId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let workflow = null;
    if (mongoose.Types.ObjectId.isValid(apiId)) {
      workflow = await Workflow.findOne({ _id: apiId, tenantId });
    }
    if (!workflow) {
      workflow = await (Workflow as any).findByApiId(tenantId, apiId);
    }

    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    await workflow.deleteOne();

    return res.json({
      success: true,
      message: 'Workflow deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete workflow',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content/:id/workflow/start
 * @desc    Start workflow for content
 * @access  Private
 */
export const startWorkflow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { workflowId } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Get content
    let content = await Content.findOne({ _id: id, tenantId });
    if (!content) {
      content = await Content.findById(id);
    }
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get workflow
    let workflow = null;
    if (mongoose.Types.ObjectId.isValid(workflowId)) {
      workflow = await Workflow.findById(workflowId);
    }
    if (!workflow) {
      workflow = await (Workflow as any).findByApiId(tenantId, workflowId);
    }
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Check if content already has active workflow
    const existingState = await WorkflowState.findOne({ contentId: content._id, status: 'in_progress' });
    if (existingState) {
      return res.status(400).json({
        success: false,
        message: 'Content already has an active workflow'
      });
    }

    // Get first step
    const firstStep = (workflow as any).getFirstStep();
    if (!firstStep) {
      return res.status(400).json({
        success: false,
        message: 'Workflow has no steps'
      });
    }

    // Create workflow state
    const workflowState = new WorkflowState({
      tenantId,
      contentId: content._id,
      contentType: content.contentTypeApiId || content.type,
      workflowId: workflow._id,
      workflowName: workflow.name,
      currentStepId: firstStep.id,
      currentStepName: firstStep.name,
      status: 'in_progress',
      assignedTo: firstStep.assignedTo || [],
      history: [{
        action: 'advance',
        stepId: firstStep.id,
        stepName: firstStep.name,
        performedBy: userId,
        performedAt: new Date(),
        comment: 'Workflow started'
      }],
      startedAt: new Date()
    });

    await workflowState.save();

    return res.status(201).json({
      success: true,
      message: 'Workflow started successfully',
      data: { workflowState }
    });
  } catch (error: any) {
    console.error('Error starting workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start workflow',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content/:id/workflow/advance
 * @desc    Advance workflow to next step
 * @access  Private
 */
export const advanceWorkflow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Get workflow state
    const workflowState = await WorkflowState.findOne({ contentId: id, status: 'in_progress' });
    if (!workflowState) {
      return res.status(404).json({
        success: false,
        message: 'No active workflow found for this content'
      });
    }

    // Check if user is assigned
    if (!(workflowState as any).isAssignedTo(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to approve this step'
      });
    }

    // Get workflow
    const workflow = await Workflow.findById(workflowState.workflowId);
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Get next step
    const nextStep = (workflow as any).getNextStep(workflowState.currentStepId);
    if (!nextStep) {
      // No next step - workflow complete
      (workflowState as any).complete();
      (workflowState as any).addAction({
        action: 'advance',
        stepId: workflowState.currentStepId,
        stepName: workflowState.currentStepName,
        performedBy: userId,
        performedAt: new Date(),
        comment: comment || 'Workflow completed'
      });
      await workflowState.save();

      try {
        await Content.findByIdAndUpdate(id, {
          status: 'published',
          publishedAt: new Date()
        });
      } catch (pubErr) {
        console.error('Failed to auto-publish content on workflow completion:', pubErr);
      }

      return res.json({
        success: true,
        message: 'Workflow completed successfully and content published',
        data: { workflowState }
      });
    }

    // Advance to next step
    (workflowState as any).addAction({
      action: 'advance',
      stepId: workflowState.currentStepId,
      stepName: workflowState.currentStepName,
      performedBy: userId,
      performedAt: new Date(),
      comment
    });

    workflowState.currentStepId = nextStep.id;
    workflowState.currentStepName = nextStep.name;
    workflowState.assignedTo = nextStep.assignedTo || [];

    await workflowState.save();

    return res.json({
      success: true,
      message: 'Workflow advanced to next step',
      data: { workflowState }
    });
  } catch (error: any) {
    console.error('Error advancing workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to advance workflow',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content/:id/workflow/reject
 * @desc    Reject workflow and send back
 * @access  Private
 */
export const rejectWorkflow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comment, sendToStep } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const workflowState = await WorkflowState.findOne({ contentId: id, status: 'in_progress' });
    if (!workflowState) {
      return res.status(404).json({
        success: false,
        message: 'No active workflow found'
      });
    }

    if (!(workflowState as any).isAssignedTo(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this step'
      });
    }

    const workflow = await Workflow.findById(workflowState.workflowId);
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Add reject action
    (workflowState as any).addAction({
      action: 'reject',
      stepId: workflowState.currentStepId,
      stepName: workflowState.currentStepName,
      performedBy: userId,
      performedAt: new Date(),
      comment: comment || 'Rejected'
    });

    if (sendToStep) {
      // Send to specific step
      const targetStep = (workflow as any).getStep(sendToStep);
      if (targetStep) {
        workflowState.currentStepId = targetStep.id;
        workflowState.currentStepName = targetStep.name;
        workflowState.assignedTo = targetStep.assignedTo || [];
      }
    } else {
      // Send to previous step
      const prevStep = (workflow as any).getPreviousStep(workflowState.currentStepId);
      if (prevStep) {
        workflowState.currentStepId = prevStep.id;
        workflowState.currentStepName = prevStep.name;
        workflowState.assignedTo = prevStep.assignedTo || [];
      } else {
        // No previous step - reject entire workflow
        (workflowState as any).reject();
      }
    }

    await workflowState.save();

    return res.json({
      success: true,
      message: 'Workflow rejected',
      data: { workflowState }
    });
  } catch (error: any) {
    console.error('Error rejecting workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject workflow',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content/:id/workflow
 * @desc    Get workflow state for content
 * @access  Private
 */
export const getWorkflowState = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let workflowState = await WorkflowState.findOne({ contentId: id, status: 'in_progress' });
    if (!workflowState) {
      workflowState = await WorkflowState.findOne({ contentId: id }).sort({ createdAt: -1 });
    }

    if (!workflowState) {
      return res.json({
        success: true,
        data: null
      });
    }

    const workflow = await Workflow.findById(workflowState.workflowId);

    return res.json({
      success: true,
      data: { workflowState, workflow }
    });
  } catch (error: any) {
    console.error('Error fetching workflow state:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch workflow state',
      error: error.message
    });
  }
};
