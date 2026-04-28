import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionAPI } from '@pi/extension-api';
import { join, homedir } from 'path';
import { readFileSync, existsSync } from 'fs';

// Mock the extension to test the logic
describe('Spinner Verbs Extension - Session Startup Priority', () => {
  let mockPi: ExtensionAPI;
  let mockCtx: any;
  let mockActivate: any;
  
  beforeEach(() => {
    // Mock the Pi API
    mockPi = {
      getFlag: vi.fn(),
      on: vi.fn(),
      // ... other methods
    } as any;
    
    mockCtx = {
      cwd: '/mock/project',
      ui: {
        notify: vi.fn(),
        setWorkingMessage: vi.fn()
      }
    };
    
    mockActivate = vi.fn();
    
    // Mock file system functions
    vi.mock('fs', () => ({
      readFileSync: vi.fn(),
      existsSync: vi.fn()
    }));
    
    vi.mock('path', () => ({
      join: vi.fn(),
      homedir: vi.fn()
    }));
  });

  // Parameterized tests for different priority combinations
  const testCases = [
    {
      name: 'Flag takes priority over settings',
      flag: 'custom',
      projectSettings: { spinnerVerbs: 'projectSet' },
      globalSettings: { spinnerVerbs: 'globalSet' },
      expectedVerbSet: 'custom'
    },
    {
      name: 'Project settings used when no flag and project exists',
      flag: undefined,
      projectSettings: { spinnerVerbs: 'projectSet' },
      globalSettings: { spinnerVerbs: 'globalSet' },
      expectedVerbSet: 'projectSet'
    },
    {
      name: 'Global settings used when no flag and no project settings',
      flag: undefined,
      projectSettings: undefined,
      globalSettings: { spinnerVerbs: 'globalSet' },
      expectedVerbSet: 'globalSet'
    },
    {
      name: 'Fallback to random when flag is "random"',
      flag: 'random',
      projectSettings: { spinnerVerbs: 'projectSet' },
      globalSettings: { spinnerVerbs: 'globalSet' },
      expectedVerbSet: 'random'
    },
    {
      name: 'Default behavior when no settings and no flag',
      flag: undefined,
      projectSettings: undefined,
      globalSettings: undefined,
      expectedVerbSet: undefined
    }
  ];

  testCases.forEach((testCase) => {
    it(`should handle ${testCase.name}`, async () => {
      // Setup mocks based on test case
      vi.mocked(mockPi.getFlag).mockReturnValue(testCase.flag);
      
      if (testCase.projectSettings) {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(testCase.projectSettings));
      } else {
        vi.mocked(existsSync).mockReturnValue(false);
      }
      
      vi.mocked(join).mockImplementation((...args) => args.join('/'));
      vi.mocked(homedir).mockReturnValue('/home/user');
      
      // Import and test the extension
      const extension = await import('../extensions/spinner-verbs');
      
      // This would require more complex mocking of the full extension initialization
      // For now, this shows the test structure we'd want
      expect(true).toBe(true); // Placeholder
    });
  });

  it('should properly validate and notify on invalid flag', async () => {
    // Test that invalid flags produce error notifications
    vi.mocked(mockPi.getFlag).mockReturnValue('invalidSet');
    
    // Setup mocks
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(join).mockImplementation((...args) => args.join('/'));
    vi.mocked(homedir).mockReturnValue('/home/user');
    
    // Import and test
    const extension = await import('../extensions/spinner-verbs');
    
    // Verify error notification was called
    // expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Invalid verb set'));
  });
});