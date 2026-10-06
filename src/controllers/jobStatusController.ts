import { Request, Response } from 'express';
import { getJobStatus } from '../workers/translationWorker';

/**
 * Job Status Controller
 *
 * Provides a polling endpoint for long-running background tasks.
 * Currently supports translation jobs; extensible for other workers.
 */

/**
 * @route   GET /api/v1/jobs/:jobId
 * @desc    Get the status and progress of a background job
 * @access  Private
 */
export const getJob = async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        if (!jobId) {
            return res.status(400).json({ success: false, message: 'Job ID is required' });
        }

        const status = await getJobStatus(jobId);

        if (!status) {
            return res.status(404).json({
                success: false,
                message: 'Job not found. It may have been removed after completion.',
            });
        }

        // Map Bull states to user-friendly status
        const stateMap: Record<string, string> = {
            waiting: 'queued',
            active: 'processing',
            completed: 'done',
            failed: 'failed',
            delayed: 'queued',
            paused: 'paused',
        };

        res.json({
            success: true,
            data: {
                jobId: status.id,
                status: stateMap[status.state] || status.state,
                progress: status.progress,
                result: status.result,
                error: status.failedReason || null,
                createdAt: status.createdAt,
                completedAt: status.completedAt,
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Failed to get job status',
            error: error.message,
        });
    }
};
