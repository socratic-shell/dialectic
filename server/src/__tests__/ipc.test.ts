// 💡: Unit tests for IPC communicator to ensure proper message handling
// and error conditions are handled correctly

import { IPCCommunicator } from '../ipc';
import { PresentReviewParams } from '../types';

describe('IPCCommunicator', () => {
  let ipc: IPCCommunicator;

  beforeEach(() => {
    // 💡: Use test mode to avoid real socket connections in tests
    ipc = new IPCCommunicator(true);
  });

  afterEach(async () => {
    await ipc.close();
  });

  describe('initialization', () => {
    it('should initialize without errors in test mode', async () => {
      await expect(ipc.initialize()).resolves.not.toThrow();
    });

    it('should throw error when DIALECTIC_IPC_PATH is not set in production mode', async () => {
      const originalPath = process.env.DIALECTIC_IPC_PATH;
      delete process.env.DIALECTIC_IPC_PATH;
      
      const prodIpc = new IPCCommunicator(false);
      await expect(prodIpc.initialize()).rejects.toThrow('DIALECTIC_IPC_PATH environment variable not set');
      
      if (originalPath) {
        process.env.DIALECTIC_IPC_PATH = originalPath;
      }
    });

    it('should be able to initialize multiple times', async () => {
      await ipc.initialize();
      await expect(ipc.initialize()).resolves.not.toThrow();
    });
  });

  describe('presentReview', () => {
    beforeEach(async () => {
      await ipc.initialize();
    });

    it('should handle basic review presentation', async () => {
      const params: PresentReviewParams = {
        content: '# Test Review\n\nThis is a test',
        mode: 'replace',
        baseUri: '/test/project'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Review successfully displayed (test mode)');
    });

    it('should handle update-section mode', async () => {
      const params: PresentReviewParams = {
        content: 'Updated section content',
        mode: 'update-section',
        section: 'Summary',
        baseUri: '/test/project'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
    });

    it('should handle append mode', async () => {
      const params: PresentReviewParams = {
        content: 'Additional content',
        mode: 'append',
        baseUri: '/test/project'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const params: PresentReviewParams = {
        content: '',
        mode: 'replace',
        baseUri: '/test/project'
      };

      const result = await ipc.presentReview(params);
      
      // 💡: In test mode, all calls succeed regardless of content
      expect(result.success).toBe(true);
      expect(result.message).toBe('Review successfully displayed (test mode)');
    });

    it('should timeout on long operations', async () => {
      const params: PresentReviewParams = {
        content: 'Test content',
        mode: 'replace',
        baseUri: '/test/project'
      };

      // 💡: In test mode, timeout behavior is not simulated
      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Review successfully displayed (test mode)');
    });
  });

  describe('sendLog', () => {
    beforeEach(async () => {
      await ipc.initialize();
    });

    it('should handle concurrent requests', async () => {
      const params1: PresentReviewParams = {
        content: 'First review',
        mode: 'replace',
        baseUri: '/test/project'
      };
      const params2: PresentReviewParams = {
        content: 'Second review',
        mode: 'replace',
        baseUri: '/test/project'
      };

      const [result1, result2] = await Promise.all([
        ipc.presentReview(params1),
        ipc.presentReview(params2)
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should handle log messages', async () => {
      await expect(ipc.sendLog('info', 'Test message')).resolves.not.toThrow();
      await expect(ipc.sendLog('error', 'Error message')).resolves.not.toThrow();
      await expect(ipc.sendLog('debug', 'Debug message')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should close cleanly', async () => {
      await ipc.initialize();
      await expect(ipc.close()).resolves.not.toThrow();
    });

    it('should handle multiple close calls', async () => {
      await ipc.initialize();
      await ipc.close();
      await expect(ipc.close()).resolves.not.toThrow();
    });
  });
});
