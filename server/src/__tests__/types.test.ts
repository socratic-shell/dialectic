import { 
  PresentReviewParams, 
  PresentReviewResult, 
  IPCMessage, 
  IPCResponse 
} from '../types';

describe('Type Definitions', () => {
  describe('PresentReviewParams', () => {
    it('should accept valid minimal parameters', () => {
      const params: PresentReviewParams = {
        content: 'Test content',
        mode: 'replace',
        baseUri: '/test/project'
      };

      expect(params.content).toBe('Test content');
      expect(params.mode).toBe('replace');
      expect(params.section).toBeUndefined();
      expect(params.baseUri).toBe('/test/project');
    });

    it('should accept all parameters', () => {
      const params: PresentReviewParams = {
        content: '# Review Content',
        mode: 'update-section',
        section: 'Summary',
        baseUri: '/test/project'
      };

      expect(params.content).toBe('# Review Content');
      expect(params.mode).toBe('update-section');
      expect(params.section).toBe('Summary');
      expect(params.baseUri).toBe('/test/project');
    });

    it('should enforce type constraints', () => {
      // These should compile without errors
      const replace: PresentReviewParams = { content: 'test', mode: 'replace', baseUri: '/test/project' };
      const updateSection: PresentReviewParams = { content: 'test', mode: 'update-section', section: 'Summary', baseUri: '/test/project' };
      const append: PresentReviewParams = { content: 'test', mode: 'append', baseUri: '/test/project' };

      expect(replace.mode).toBe('replace');
      expect(updateSection.mode).toBe('update-section');
      expect(append.mode).toBe('append');
    });
  });

  describe('PresentReviewResult', () => {
    it('should accept success result', () => {
      const result: PresentReviewResult = {
        success: true,
        message: 'Review displayed successfully'
      };

      expect(result.success).toBe(true);
      expect(result.message).toBe('Review displayed successfully');
    });

    it('should accept failure result', () => {
      const result: PresentReviewResult = {
        success: false,
        message: 'Failed to display review'
      };

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to display review');
    });
  });

  describe('IPCMessage', () => {
    it('should accept valid IPC message', () => {
      const message: IPCMessage = {
        type: 'present_review',
        payload: {
          content: 'Test review',
          mode: 'replace',
          baseUri: '/test/project'
        },
        id: 'test-id-123'
      };

      expect(message.type).toBe('present_review');
      if (message.type === 'present_review') {
        const payload = message.payload as PresentReviewParams;
        expect(payload.content).toBe('Test review');
        expect(payload.baseUri).toBe('/test/project');
      }
      expect(message.id).toBe('test-id-123');
    });

    it('should enforce type constraints', () => {
      // This should compile - type is constrained to 'present_review'
      const message: IPCMessage = {
        type: 'present_review',
        payload: { content: 'test', mode: 'replace', baseUri: '/test/project' },
        id: 'test'
      };

      expect(message.type).toBe('present_review');
    });

    it('should accept log messages', () => {
      const logMessage: IPCMessage = {
        type: 'log',
        payload: { level: 'info', message: 'Test log message' },
        id: 'log-test-123'
      };

      expect(logMessage.type).toBe('log');
      if (logMessage.type === 'log') {
        const payload = logMessage.payload as { level: string; message: string };
        expect(payload.level).toBe('info');
        expect(payload.message).toBe('Test log message');
      }
      expect(logMessage.id).toBe('log-test-123');
    });
  });

  describe('IPCResponse', () => {
    it('should accept success response', () => {
      const response: IPCResponse = {
        id: 'test-id-123',
        success: true
      };

      expect(response.id).toBe('test-id-123');
      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();
    });

    it('should accept error response', () => {
      const response: IPCResponse = {
        id: 'test-id-123',
        success: false,
        error: 'Something went wrong'
      };

      expect(response.id).toBe('test-id-123');
      expect(response.success).toBe(false);
      expect(response.error).toBe('Something went wrong');
    });
  });

  describe('Type compatibility', () => {
    it('should allow PresentReviewParams in IPCMessage payload', () => {
      const params: PresentReviewParams = {
        content: 'Test content',
        mode: 'update-section',
        section: 'Summary',
        baseUri: '/test/project'
      };

      const message: IPCMessage = {
        type: 'present_review',
        payload: params,
        id: 'test'
      };

      expect(message.payload).toEqual(params);
    });

    it('should maintain type safety across interfaces', () => {
      // This test ensures that our types work together correctly
      const createMessage = (params: PresentReviewParams): IPCMessage => ({
        type: 'present_review',
        payload: params,
        id: 'generated-id'
      });

      const createResponse = (success: boolean, error?: string): IPCResponse => ({
        id: 'response-id',
        success,
        error
      });

      const params: PresentReviewParams = { content: 'test', mode: 'replace', baseUri: '/test/project' };
      const message = createMessage(params);
      const response = createResponse(true);

      expect(message.type).toBe('present_review');
      expect(response.success).toBe(true);
    });
  });
});
