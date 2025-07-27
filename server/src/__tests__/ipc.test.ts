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
        mode: 'replace'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Review successfully displayed');
    });

    it('should handle update-section mode', async () => {
      const params: PresentReviewParams = {
        content: '## Updated Section\n\nNew content',
        mode: 'update-section',
        section: 'Summary'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
    });

    it('should handle append mode', async () => {
      const params: PresentReviewParams = {
        content: '\n\n## Additional Notes\n\nMore content',
        mode: 'append'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
    });

    it('should handle large content', async () => {
      const largeContent = '# Large Review\n\n' + 'Content line\n'.repeat(1000);
      const params: PresentReviewParams = {
        content: largeContent,
        mode: 'replace'
      };

      const result = await ipc.presentReview(params);
      
      expect(result.success).toBe(true);
    });

    it('should throw error when not initialized in production mode', async () => {
      const prodIpc = new IPCCommunicator(false);
      const params: PresentReviewParams = {
        content: '# Test',
        mode: 'replace'
      };

      await expect(prodIpc.presentReview(params)).rejects.toThrow('IPC not initialized');
    });
  });

  describe('error handling', () => {
    it('should handle close without initialization', async () => {
      const freshIpc = new IPCCommunicator(true);
      await expect(freshIpc.close()).resolves.not.toThrow();
    });

    it('should handle multiple close calls', async () => {
      await ipc.initialize();
      await ipc.close();
      await expect(ipc.close()).resolves.not.toThrow();
    });
  });

  describe('concurrent operations', () => {
    beforeEach(async () => {
      await ipc.initialize();
    });

    it('should handle multiple concurrent presentReview calls', async () => {
      const params1: PresentReviewParams = {
        content: '# Review 1',
        mode: 'replace'
      };
      
      const params2: PresentReviewParams = {
        content: '# Review 2',
        mode: 'replace'
      };

      const [result1, result2] = await Promise.all([
        ipc.presentReview(params1),
        ipc.presentReview(params2)
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});
