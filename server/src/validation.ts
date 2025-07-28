// 💡: Validation utilities for MCP tool parameters. Extracted into separate module
// to enable comprehensive unit testing of parameter validation logic.

import { PresentReviewParams } from './types.js';

/**
 * Validation error with descriptive message
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates parameters for the present-review tool
 * @param args Raw arguments from MCP tool call
 * @returns Validated and typed parameters
 * @throws ValidationError if parameters are invalid
 */
export function validatePresentReviewParams(args: any): PresentReviewParams {
  // 💡: Comprehensive validation with specific error messages for each failure case
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ValidationError('Invalid arguments: expected object');
  }

  // Check for missing content first
  if (args.content === undefined || args.content === null) {
    throw new ValidationError('Missing required parameter: content');
  }

  if (typeof args.content !== 'string') {
    throw new ValidationError('Invalid content: expected string');
  }

  if (args.content.trim().length === 0) {
    throw new ValidationError('Invalid content: cannot be empty');
  }

  // Validate mode parameter
  const mode = args.mode || 'replace';
  const validModes = ['replace', 'update-section', 'append'] as const;
  
  if (!validModes.includes(mode)) {
    throw new ValidationError(`Invalid mode: must be one of ${validModes.join(', ')}`);
  }

  // Validate section parameter for update-section mode
  if (mode === 'update-section') {
    if (args.section === undefined || args.section === null) {
      throw new ValidationError('Missing required parameter: section (required for update-section mode)');
    }
    
    if (typeof args.section !== 'string') {
      throw new ValidationError('Invalid section: expected string');
    }
    
    if (args.section.trim().length === 0) {
      throw new ValidationError('Invalid section: cannot be empty');
    }
  }

  // Validate baseUri parameter (required)
  if (args.baseUri === undefined || args.baseUri === null) {
    throw new ValidationError('Missing required parameter: baseUri');
  }
  
  if (typeof args.baseUri !== 'string') {
    throw new ValidationError('Invalid baseUri: expected string');
  }
  
  if (args.baseUri.trim().length === 0) {
    throw new ValidationError('Invalid baseUri: cannot be empty');
  }

  return {
    content: args.content.trim(),
    mode,
    section: args.section?.trim(),
    baseUri: args.baseUri.trim(),
  };
}

/**
 * Validates that a string is valid markdown content
 * @param content Content to validate
 * @returns true if valid, false otherwise
 */
export function isValidMarkdown(content: string): boolean {
  // 💡: Basic markdown validation - could be expanded with more sophisticated checks
  if (typeof content !== 'string' || content.trim().length === 0) {
    return false;
  }

  // Check for basic markdown patterns (headers, lists, etc.)
  const markdownPatterns = [
    /^#{1,6}\s+.+$/m,  // Headers
    /^\s*[-*+]\s+.+$/m, // Unordered lists
    /^\s*\d+\.\s+.+$/m, // Ordered lists
    /`[^`]+`/,          // Inline code
    /```[\s\S]*?```/,   // Code blocks
  ];

  // Content is valid if it contains at least one markdown pattern or is plain text
  return markdownPatterns.some(pattern => pattern.test(content)) || content.length > 0;
}

/**
 * Sanitizes markdown content for safe display
 * @param content Raw markdown content
 * @returns Sanitized content
 */
export function sanitizeMarkdown(content: string): string {
  // 💡: Basic sanitization - remove potentially dangerous content
  // In a production system, this would use a proper markdown sanitizer
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .trim();
}
