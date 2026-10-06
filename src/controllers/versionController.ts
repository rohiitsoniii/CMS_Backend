import { Request, Response } from 'express';
import { Content } from '../models/Content';
import { generateDiff, formatDiff, generateHtmlDiff } from '../utils/versionDiff';

/**
 * Version History Controller
 * Manages content version history and comparisons
 */

/**
 * @route   GET /api/v1/content/:id/versions
 * @desc    Get version history for a content entry
 * @access  Private
 */
export const getVersionHistory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50, skip = 0 } = req.query;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get version history (sorted by version number descending)
    const versions = content.versionHistory
      .sort((a, b) => b.version - a.version)
      .slice(Number(skip), Number(skip) + Number(limit));

    res.json({
      success: true,
      data: {
        contentId: content._id,
        currentVersion: content.version,
        versions,
        total: content.versionHistory.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching version history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch version history',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content/:id/versions/:version
 * @desc    Get specific version of content
 * @access  Private
 */
export const getVersion = async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Find specific version
    const versionData = content.versionHistory.find(
      v => v.version === Number(version)
    );

    if (!versionData) {
      return res.status(404).json({
        success: false,
        message: `Version ${version} not found`
      });
    }

    res.json({
      success: true,
      data: { version: versionData }
    });
  } catch (error: any) {
    console.error('Error fetching version:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch version',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content/:id/versions/compare
 * @desc    Compare two versions
 * @access  Private
 */
export const compareVersions = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { from, to, format = 'json' } = req.query;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Both "from" and "to" version numbers are required'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Find versions
    const fromVersion = content.versionHistory.find(
      v => v.version === Number(from)
    );
    const toVersion = content.versionHistory.find(
      v => v.version === Number(to)
    );

    if (!fromVersion) {
      return res.status(404).json({
        success: false,
        message: `Version ${from} not found`
      });
    }

    if (!toVersion) {
      return res.status(404).json({
        success: false,
        message: `Version ${to} not found`
      });
    }

    // Generate diff
    const diff = generateDiff(fromVersion, toVersion);

    // Format based on requested format
    let formattedDiff;
    switch (format) {
      case 'text':
        formattedDiff = formatDiff(diff);
        return res.type('text/plain').send(formattedDiff);
      
      case 'html':
        formattedDiff = generateHtmlDiff(diff);
        return res.type('text/html').send(formattedDiff);
      
      case 'json':
      default:
        return res.json({
          success: true,
          data: { diff }
        });
    }
  } catch (error: any) {
    console.error('Error comparing versions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to compare versions',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/v1/content/:id/versions/:version/restore
 * @desc    Restore content to a specific version
 * @access  Private
 */
export const restoreVersion = async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Find version to restore
    const versionToRestore = content.versionHistory.find(
      v => v.version === Number(version) || (v as any)._id?.toString() === version || (v as any).id === version
    );

    if (!versionToRestore) {
      return res.status(404).json({
        success: false,
        message: `Version ${version} not found`
      });
    }

    // Save current state to version history before restoring
    const currentVersion = {
      version: content.version,
      data: content.data,
      localizedData: content.localizedData,
      status: content.status,
      savedAt: new Date(),
      savedBy: content.updatedBy,
      changeNote: 'Auto-saved before restore'
    };

    // Restore data
    content.data = versionToRestore.data;
    content.localizedData = versionToRestore.localizedData;
    content.status = versionToRestore.status;
    content.updatedBy = userId;

    // Increment version
    content.version += 1;

    // Add current version to history
    content.versionHistory.push(currentVersion);

    // Limit version history to last 50
    if (content.versionHistory.length > 50) {
      content.versionHistory = content.versionHistory.slice(-50);
    }

    await content.save();

    res.json({
      success: true,
      message: `Content restored to version ${version}`,
      data: {
        content,
        restoredFrom: Number(version),
        newVersion: content.version
      }
    });
  } catch (error: any) {
    console.error('Error restoring version:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restore version',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/v1/content/:id/versions/current/diff
 * @desc    Compare current version with previous version
 * @access  Private
 */
export const getCurrentDiff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    if (content.versionHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No previous version found'
      });
    }

    // Get previous version
    const previousVersion = content.versionHistory[content.versionHistory.length - 1];

    // Current version data
    const currentVersion = {
      version: content.version,
      data: content.data,
      localizedData: content.localizedData,
      status: content.status
    };

    // Generate diff
    const diff = generateDiff(previousVersion, currentVersion);

    // Format based on requested format
    switch (format) {
      case 'text':
        const textDiff = formatDiff(diff);
        return res.type('text/plain').send(textDiff);
      
      case 'html':
        const htmlDiff = generateHtmlDiff(diff);
        return res.type('text/html').send(htmlDiff);
      
      case 'json':
      default:
        return res.json({
          success: true,
          data: { diff }
        });
    }
  } catch (error: any) {
    console.error('Error getting current diff:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current diff',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /api/v1/content/:id/versions/:version
 * @desc    Delete a specific version from history
 * @access  Private
 */
export const deleteVersion = async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?._id;

    if (!tenantId || !userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const content = await Content.findOne({ _id: id, tenantId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Find version index
    const versionIndex = content.versionHistory.findIndex(
      v => v.version === Number(version) || (v as any)._id?.toString() === version || (v as any).id === version
    );

    if (versionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: `Version ${version} not found`
      });
    }

    // Remove version
    content.versionHistory.splice(versionIndex, 1);
    content.updatedBy = userId;

    await content.save();

    res.json({
      success: true,
      message: `Version ${version} deleted successfully`,
      data: {
        remainingVersions: content.versionHistory.length
      }
    });
  } catch (error: any) {
    console.error('Error deleting version:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete version',
      error: error.message
    });
  }
};
