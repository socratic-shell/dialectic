// 💡: Comprehensive unit tests for validation utilities to ensure parameter
// validation works correctly for all edge cases and error conditions

import { 
  validatePresentReviewParams, 
  ValidationError, 
  isValidMarkdown, 
  sanitizeMarkdown 
} from '../validation';

describe('validatePresentReviewParams', () => {
  describe('valid parameters', () => {
    it('should accept minimal valid parameters', () => {
      const result = validatePresentReviewParams({
        content: 'Test review content'
      });

      expect(result).toEqual({
        content: 'Test review content',
        mode: 'replace',
        section: undefined,
      });
    });

    it('should accept all valid parameters', () => {
      const result = validatePresentReviewParams({
        content: '# Review\n\nContent here',
        mode: 'update-section',
        section: 'Summary'
      });

      expect(result).toEqual({
        content: '# Review\n\nContent here',
        mode: 'update-section',
        section: 'Summary',
      });
    });

    it('should trim whitespace from content and section', () => {
      const result = validatePresentReviewParams({
        content: '  Test content  ',
        mode: 'update-section',
        section: '  Section Name  '
      });

      expect(result.content).toBe('Test content');
      expect(result.section).toBe('Section Name');
    });

    it('should accept all valid modes', () => {
      const modes = ['replace', 'update-section', 'append'] as const;
      
      modes.forEach(mode => {
        const params = mode === 'update-section' 
          ? { content: 'test', mode, section: 'test' }
          : { content: 'test', mode };
          
        const result = validatePresentReviewParams(params);
        expect(result.mode).toBe(mode);
      });
    });
  });

  describe('invalid arguments object', () => {
    it('should reject null arguments', () => {
      expect(() => validatePresentReviewParams(null))
        .toThrow(ValidationError);
      expect(() => validatePresentReviewParams(null))
        .toThrow('Invalid arguments: expected object');
    });

    it('should reject undefined arguments', () => {
      expect(() => validatePresentReviewParams(undefined))
        .toThrow(ValidationError);
    });

    it('should reject non-object arguments', () => {
      expect(() => validatePresentReviewParams('string'))
        .toThrow('Invalid arguments: expected object');
      
      expect(() => validatePresentReviewParams(123))
        .toThrow('Invalid arguments: expected object');
      
      expect(() => validatePresentReviewParams([]))
        .toThrow('Invalid arguments: expected object');
    });
  });

  describe('invalid content parameter', () => {
    it('should reject missing content', () => {
      expect(() => validatePresentReviewParams({}))
        .toThrow('Missing required parameter: content');
    });

    it('should reject null content', () => {
      expect(() => validatePresentReviewParams({ content: null }))
        .toThrow('Missing required parameter: content');
    });

    it('should reject non-string content', () => {
      expect(() => validatePresentReviewParams({ content: 123 }))
        .toThrow('Invalid content: expected string');
      
      expect(() => validatePresentReviewParams({ content: {} }))
        .toThrow('Invalid content: expected string');
    });

    it('should reject empty content', () => {
      expect(() => validatePresentReviewParams({ content: '' }))
        .toThrow('Invalid content: cannot be empty');
      
      expect(() => validatePresentReviewParams({ content: '   ' }))
        .toThrow('Invalid content: cannot be empty');
    });
  });

  describe('invalid mode parameter', () => {
    it('should reject invalid mode values', () => {
      expect(() => validatePresentReviewParams({ 
        content: 'test', 
        mode: 'invalid' 
      })).toThrow('Invalid mode: must be one of replace, update-section, append');
    });

    it('should reject non-string mode values', () => {
      expect(() => validatePresentReviewParams({ 
        content: 'test', 
        mode: 123 
      })).toThrow('Invalid mode: must be one of replace, update-section, append');
    });
  });

  describe('section parameter validation', () => {
    it('should require section for update-section mode', () => {
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'update-section'
      })).toThrow('Missing required parameter: section (required for update-section mode)');
    });

    it('should reject non-string section', () => {
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'update-section',
        section: 123
      })).toThrow('Invalid section: expected string');
    });

    it('should reject empty section', () => {
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'update-section',
        section: ''
      })).toThrow('Invalid section: cannot be empty');
      
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'update-section',
        section: '   '
      })).toThrow('Invalid section: cannot be empty');
    });

    it('should not require section for other modes', () => {
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'replace'
      })).not.toThrow();
      
      expect(() => validatePresentReviewParams({
        content: 'test',
        mode: 'append'
      })).not.toThrow();
    });
  });
});

describe('isValidMarkdown', () => {
  it('should accept valid markdown with headers', () => {
    expect(isValidMarkdown('# Header')).toBe(true);
    expect(isValidMarkdown('## Sub Header')).toBe(true);
    expect(isValidMarkdown('### Another Header')).toBe(true);
  });

  it('should accept valid markdown with lists', () => {
    expect(isValidMarkdown('- List item')).toBe(true);
    expect(isValidMarkdown('* Another item')).toBe(true);
    expect(isValidMarkdown('+ Plus item')).toBe(true);
    expect(isValidMarkdown('1. Numbered item')).toBe(true);
  });

  it('should accept valid markdown with code', () => {
    expect(isValidMarkdown('`inline code`')).toBe(true);
    expect(isValidMarkdown('```\ncode block\n```')).toBe(true);
  });

  it('should accept plain text', () => {
    expect(isValidMarkdown('Just plain text')).toBe(true);
  });

  it('should reject invalid content', () => {
    expect(isValidMarkdown('')).toBe(false);
    expect(isValidMarkdown('   ')).toBe(false);
    expect(isValidMarkdown(null as any)).toBe(false);
    expect(isValidMarkdown(undefined as any)).toBe(false);
    expect(isValidMarkdown(123 as any)).toBe(false);
  });
});

describe('sanitizeMarkdown', () => {
  it('should remove script tags', () => {
    const input = 'Safe content <script>alert("xss")</script> more content';
    const result = sanitizeMarkdown(input);
    expect(result).toBe('Safe content  more content');
  });

  it('should remove javascript: URLs', () => {
    const input = 'Click [here](javascript:alert("xss")) for more';
    const result = sanitizeMarkdown(input);
    expect(result).toBe('Click [here](alert("xss")) for more');
  });

  it('should trim whitespace', () => {
    const input = '   Content with spaces   ';
    const result = sanitizeMarkdown(input);
    expect(result).toBe('Content with spaces');
  });

  it('should preserve safe markdown', () => {
    const input = '# Header\n\n- List item\n- Another item\n\n`code`';
    const result = sanitizeMarkdown(input);
    expect(result).toBe(input);
  });
});
