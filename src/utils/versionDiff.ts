/**
 * Version Comparison & Diff Utility
 * Compares content versions and generates diffs
 */

export interface DiffChange {
  type: 'added' | 'modified' | 'removed';
  path: string;
  oldValue?: any;
  newValue?: any;
}

export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  changes: DiffChange[];
  summary: {
    added: number;
    modified: number;
    removed: number;
    total: number;
  };
}

/**
 * Compare two versions and generate diff
 */
export const compareVersions = (
  oldVersion: any,
  newVersion: any,
  basePath: string = ''
): DiffChange[] => {
  const changes: DiffChange[] = [];

  // Get all unique keys from both versions
  const oldKeys = new Set(Object.keys(oldVersion || {}));
  const newKeys = new Set(Object.keys(newVersion || {}));
  const allKeys = new Set([...oldKeys, ...newKeys]);

  for (const key of allKeys) {
    const path = basePath ? `${basePath}.${key}` : key;
    const oldValue = oldVersion?.[key];
    const newValue = newVersion?.[key];

    // Field was removed
    if (oldKeys.has(key) && !newKeys.has(key)) {
      changes.push({
        type: 'removed',
        path,
        oldValue
      });
      continue;
    }

    // Field was added
    if (!oldKeys.has(key) && newKeys.has(key)) {
      changes.push({
        type: 'added',
        path,
        newValue
      });
      continue;
    }

    // Field exists in both - check if modified
    if (oldKeys.has(key) && newKeys.has(key)) {
      // Handle nested objects
      if (isObject(oldValue) && isObject(newValue) && !isArray(oldValue) && !isArray(newValue)) {
        // Recursively compare nested objects
        const nestedChanges = compareVersions(oldValue, newValue, path);
        changes.push(...nestedChanges);
      } else if (!isEqual(oldValue, newValue)) {
        // Values are different
        changes.push({
          type: 'modified',
          path,
          oldValue,
          newValue
        });
      }
    }
  }

  return changes;
};

/**
 * Generate full diff between two content versions
 */
export const generateDiff = (
  fromVersion: any,
  toVersion: any
): VersionDiff => {
  const changes: DiffChange[] = [];

  // Compare data
  if (fromVersion.data || toVersion.data) {
    const dataChanges = compareVersions(fromVersion.data, toVersion.data, 'data');
    changes.push(...dataChanges);
  }

  // Compare localized data
  if (fromVersion.localizedData || toVersion.localizedData) {
    const oldLocales = Object.keys(fromVersion.localizedData || {});
    const newLocales = Object.keys(toVersion.localizedData || {});
    const allLocales = new Set([...oldLocales, ...newLocales]);

    for (const locale of allLocales) {
      const oldLocaleData = fromVersion.localizedData?.[locale];
      const newLocaleData = toVersion.localizedData?.[locale];

      const localeChanges = compareVersions(
        oldLocaleData,
        newLocaleData,
        `localizedData.${locale}`
      );
      changes.push(...localeChanges);
    }
  }

  // Compare status
  if (fromVersion.status !== toVersion.status) {
    changes.push({
      type: 'modified',
      path: 'status',
      oldValue: fromVersion.status,
      newValue: toVersion.status
    });
  }

  // Calculate summary
  const summary = {
    added: changes.filter(c => c.type === 'added').length,
    modified: changes.filter(c => c.type === 'modified').length,
    removed: changes.filter(c => c.type === 'removed').length,
    total: changes.length
  };

  return {
    fromVersion: fromVersion.version,
    toVersion: toVersion.version,
    changes,
    summary
  };
};

/**
 * Check if value is an object
 */
const isObject = (value: any): boolean => {
  return value !== null && typeof value === 'object';
};

/**
 * Check if value is an array
 */
const isArray = (value: any): boolean => {
  return Array.isArray(value);
};

/**
 * Deep equality check
 */
const isEqual = (a: any, b: any): boolean => {
  // Primitive types
  if (a === b) return true;

  // Null/undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  // Objects
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => isEqual(a[key], b[key]));
  }

  return false;
};

/**
 * Format diff for display
 */
export const formatDiff = (diff: VersionDiff): string => {
  let output = `Version ${diff.fromVersion} → ${diff.toVersion}\n`;
  output += `Changes: ${diff.summary.total} (${diff.summary.added} added, ${diff.summary.modified} modified, ${diff.summary.removed} removed)\n\n`;

  for (const change of diff.changes) {
    switch (change.type) {
      case 'added':
        output += `+ ${change.path}: ${formatValue(change.newValue)}\n`;
        break;
      case 'removed':
        output += `- ${change.path}: ${formatValue(change.oldValue)}\n`;
        break;
      case 'modified':
        output += `~ ${change.path}:\n`;
        output += `  - ${formatValue(change.oldValue)}\n`;
        output += `  + ${formatValue(change.newValue)}\n`;
        break;
    }
  }

  return output;
};

/**
 * Format value for display
 */
const formatValue = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * Get changes for a specific field
 */
export const getFieldChanges = (
  diff: VersionDiff,
  fieldPath: string
): DiffChange[] => {
  return diff.changes.filter(change => 
    change.path === fieldPath || change.path.startsWith(`${fieldPath}.`)
  );
};

/**
 * Get changes by type
 */
export const getChangesByType = (
  diff: VersionDiff,
  type: 'added' | 'modified' | 'removed'
): DiffChange[] => {
  return diff.changes.filter(change => change.type === type);
};

/**
 * Check if field was changed
 */
export const wasFieldChanged = (
  diff: VersionDiff,
  fieldPath: string
): boolean => {
  return diff.changes.some(change => 
    change.path === fieldPath || change.path.startsWith(`${fieldPath}.`)
  );
};

/**
 * Generate HTML diff for display
 */
export const generateHtmlDiff = (diff: VersionDiff): string => {
  let html = '<div class="version-diff">';
  html += `<div class="diff-header">`;
  html += `<h3>Version ${diff.fromVersion} → ${diff.toVersion}</h3>`;
  html += `<div class="diff-summary">`;
  html += `<span class="added">${diff.summary.added} added</span>`;
  html += `<span class="modified">${diff.summary.modified} modified</span>`;
  html += `<span class="removed">${diff.summary.removed} removed</span>`;
  html += `</div>`;
  html += `</div>`;

  html += '<div class="diff-changes">';
  for (const change of diff.changes) {
    html += `<div class="diff-change diff-${change.type}">`;
    html += `<div class="change-path">${change.path}</div>`;
    
    switch (change.type) {
      case 'added':
        html += `<div class="change-value added">+ ${escapeHtml(formatValue(change.newValue))}</div>`;
        break;
      case 'removed':
        html += `<div class="change-value removed">- ${escapeHtml(formatValue(change.oldValue))}</div>`;
        break;
      case 'modified':
        html += `<div class="change-value removed">- ${escapeHtml(formatValue(change.oldValue))}</div>`;
        html += `<div class="change-value added">+ ${escapeHtml(formatValue(change.newValue))}</div>`;
        break;
    }
    
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  return html;
};

/**
 * Escape HTML
 */
const escapeHtml = (text: string): string => {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
};

/**
 * Apply diff to a version (for preview)
 */
export const applyDiff = (
  baseVersion: any,
  diff: VersionDiff
): any => {
  const result = JSON.parse(JSON.stringify(baseVersion));

  for (const change of diff.changes) {
    const pathParts = change.path.split('.');
    let current = result;

    // Navigate to parent
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = pathParts[pathParts.length - 1];

    switch (change.type) {
      case 'added':
      case 'modified':
        current[lastPart] = change.newValue;
        break;
      case 'removed':
        delete current[lastPart];
        break;
    }
  }

  return result;
};

/**
 * Reverse a diff (swap from/to)
 */
export const reverseDiff = (diff: VersionDiff): VersionDiff => {
  const reversedChanges = diff.changes.map(change => {
    if (change.type === 'added') {
      return {
        type: 'removed' as const,
        path: change.path,
        oldValue: change.newValue
      };
    } else if (change.type === 'removed') {
      return {
        type: 'added' as const,
        path: change.path,
        newValue: change.oldValue
      };
    } else {
      return {
        type: 'modified' as const,
        path: change.path,
        oldValue: change.newValue,
        newValue: change.oldValue
      };
    }
  });

  return {
    fromVersion: diff.toVersion,
    toVersion: diff.fromVersion,
    changes: reversedChanges,
    summary: diff.summary
  };
};

/**
 * Merge multiple diffs
 */
export const mergeDiffs = (...diffs: VersionDiff[]): VersionDiff => {
  if (diffs.length === 0) {
    throw new Error('At least one diff is required');
  }

  const allChanges: DiffChange[] = [];
  for (const diff of diffs) {
    allChanges.push(...diff.changes);
  }

  const summary = {
    added: allChanges.filter(c => c.type === 'added').length,
    modified: allChanges.filter(c => c.type === 'modified').length,
    removed: allChanges.filter(c => c.type === 'removed').length,
    total: allChanges.length
  };

  return {
    fromVersion: diffs[0].fromVersion,
    toVersion: diffs[diffs.length - 1].toVersion,
    changes: allChanges,
    summary
  };
};
