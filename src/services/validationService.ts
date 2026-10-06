import { ValidationRule } from '../models/ValidationRule';
import axios from 'axios';

export class ValidationService {
  // Validate content against rules
  static async validateContent(contentTypeId: string, data: any) {
    const rules = await ValidationRule.find({
      contentTypeId,
      enabled: true
    });

    const errors: any[] = [];

    for (const rule of rules) {
      const fieldValue = this.getNestedValue(data, rule.fieldPath);
      const isValid = await this.validateField(rule, fieldValue, data);

      if (!isValid) {
        errors.push({
          field: rule.fieldPath,
          message: rule.errorMessage,
          ruleType: rule.ruleType
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Validate single field
  private static async validateField(rule: any, value: any, allData: any): Promise<boolean> {
    switch (rule.ruleType) {
      case 'regex':
        return this.validateRegex(value, rule.config.pattern);
      
      case 'range':
        return this.validateRange(value, rule.config.min, rule.config.max);
      
      case 'length':
        return this.validateLength(value, rule.config.min, rule.config.max);
      
      case 'custom':
        return this.validateCustom(value, rule.config.customFunction);
      
      case 'crossField':
        return this.validateCrossField(value, allData, rule.config.dependentFields);
      
      case 'async':
        return await this.validateAsync(value, rule.config.asyncUrl);
      
      default:
        return true;
    }
  }

  // Regex validation
  private static validateRegex(value: any, pattern: string): boolean {
    if (!value) return true; // Skip if empty
    const regex = new RegExp(pattern);
    return regex.test(String(value));
  }

  // Range validation (for numbers)
  private static validateRange(value: any, min?: number, max?: number): boolean {
    if (value === null || value === undefined) return true;
    const num = Number(value);
    if (isNaN(num)) return false;
    if (min !== undefined && num < min) return false;
    if (max !== undefined && num > max) return false;
    return true;
  }

  // Length validation (for strings/arrays)
  private static validateLength(value: any, min?: number, max?: number): boolean {
    if (!value) return true;
    const length = Array.isArray(value) ? value.length : String(value).length;
    if (min !== undefined && length < min) return false;
    if (max !== undefined && length > max) return false;
    return true;
  }

  // Custom function validation
  private static validateCustom(value: any, functionString: string): boolean {
    try {
      const fn = new Function('value', functionString);
      return fn(value);
    } catch (error) {
      console.error('Custom validation error:', error);
      return false;
    }
  }

  // Cross-field validation
  private static validateCrossField(value: any, allData: any, dependentFields: string[]): boolean {
    // Example: validate that end_date > start_date
    // This is a simple implementation - can be enhanced
    return true;
  }

  // Async validation (e.g., check if URL exists)
  private static async validateAsync(value: any, url: string): Promise<boolean> {
    try {
      const response = await axios.post(url, { value }, { timeout: 5000 });
      return response.data.valid === true;
    } catch (error) {
      console.error('Async validation error:', error);
      return false;
    }
  }

  // Get nested value from object
  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  // Create validation rule
  static async createRule(ruleData: any) {
    return ValidationRule.create(ruleData);
  }

  // Get rules for content type
  static async getRules(contentTypeId: string) {
    return ValidationRule.find({ contentTypeId });
  }

  // Update rule
  static async updateRule(ruleId: string, updates: any) {
    return ValidationRule.findByIdAndUpdate(ruleId, updates, { new: true });
  }

  // Delete rule
  static async deleteRule(ruleId: string) {
    return ValidationRule.findByIdAndDelete(ruleId);
  }
}
