// 💡: Unit tests for IPC communicator to ensure proper message handling
// and error conditions are handled correctly

import { IPCCommunicator } from '../ipc';
import { PresentReviewParams } from '../types';

describe('IPCCommunicator', () => {
  let ipc: IPCCommunicator;

  beforeEach(() => {
    ipc = new IPCCommunicator();
  });

  afterEach(async () => {
    await ipc.close();
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(ipc.initialize()).resolves.not.toThrow();
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
      expect(result.message).toContain('Review would be displayed');
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
  });

  describe('error handling', () => {
    it('should handle close without initialization', async () => {
      const freshIpc = new IPCCommunicator();
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
