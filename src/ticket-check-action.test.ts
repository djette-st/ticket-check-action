import * as core from '@actions/core';
import * as github from '@actions/github';

import { run } from './ticket-check-action';

jest.mock('@actions/core');
jest.mock('@actions/github');

const mockedCore = jest.mocked(core);
const mockedGithub = jest.mocked(github);

type GitHubOctokit = ReturnType<typeof github.getOctokit>;

interface MockOctokit {
  rest: {
    pulls: {
      update: jest.Mock;
      createReview: jest.Mock;
      listReviews: jest.Mock;
    };
  };
}

interface TestContext {
  title?: string;
  body?: string;
  branch?: string;
}

interface TestInputs {
  commentOnTitleUpdate?: string;
  commentWithTicketLink?: string;
  ticketLink?: string;
  titleRegex?: string;
  branchRegex?: string;
  bodyRegex?: string;
  bodyURLRegex?: string;
}

describe('ticket-check-action', () => {
  let mockOctokit: MockOctokit;

  const setupMockOctokit = (): MockOctokit => ({
    rest: {
      pulls: {
        update: jest.fn().mockResolvedValue({}),
        createReview: jest.fn().mockResolvedValue({}),
        listReviews: jest.fn().mockResolvedValue({ data: [] }),
      },
    },
  });

  const setupContext = (context: TestContext = {}): void => {
    const {
      title = 'Test PR',
      body = 'Test body',
      branch = 'feature-branch',
    } = context;

    const contextUpdate: Partial<typeof github.context> = {
      payload: {
        pull_request: {
          number: 123,
          title,
          body,
          user: {
            login: 'testuser',
            type: 'User',
          },
          head: {
            ref: branch,
          },
        },
      },
      issue: {
        owner: 'testowner',
        repo: 'testrepo',
        number: 123,
      },
    };

    Object.assign(github.context, contextUpdate);
  };

  const setupInputs = (customInputs: TestInputs = {}): void => {
    const defaultInputs: Record<string, string> = {
      token: 'fake-token',
      titleRegex: '^(TEST)-(?<ticketNumber>\\d+)',
      titleRegexFlags: 'gi',
      branchRegex: '^(TEST)-(?<ticketNumber>\\d+)',
      branchRegexFlags: 'gi',
      bodyRegex: '(TEST)-(?<ticketNumber>\\d+)',
      bodyRegexFlags: 'gim',
      bodyURLRegex: '',
      bodyURLRegexFlags: 'gim',
      titleFormat: '%prefix%%id%: %title%',
      ticketPrefix: 'TEST-',
      exemptUsers: '',
      commentOnTitleUpdate: 'false',
      commentWithTicketLink: 'false',
      ticketLink: '',
      ...customInputs,
    };

    mockedCore.getInput.mockImplementation((name: string) => defaultInputs[name] || '');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOctokit = setupMockOctokit();
    mockedGithub.getOctokit.mockReturnValue(mockOctokit as unknown as GitHubOctokit);
    setupContext();
    setupInputs();
  });

  describe('commentOnTitleUpdate', () => {
    describe('when false (default)', () => {
      it('does not post comment when title is auto-updated from branch', async () => {
        setupContext({
          title: 'My PR',
          branch: 'TEST-123-feature',
        });
        setupInputs({
          commentOnTitleUpdate: 'false',
        });

        await run();

        expect(mockOctokit.rest.pulls.update).toHaveBeenCalledTimes(1);
        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });

      it('does not post comment when title is auto-updated from body', async () => {
        setupContext({
          title: 'My PR',
          body: 'Fixes TEST-456',
        });
        setupInputs({
          commentOnTitleUpdate: 'false',
        });

        await run();

        expect(mockOctokit.rest.pulls.update).toHaveBeenCalledTimes(1);
        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });
    });

    describe('when true', () => {
      it('posts comment explaining title was updated from branch', async () => {
        setupContext({
          title: 'My PR',
          branch: 'TEST-123-feature',
        });
        setupInputs({
          commentOnTitleUpdate: 'true',
        });

        await run();

        expect(mockOctokit.rest.pulls.update).toHaveBeenCalledTimes(1);
        expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith({
          owner: 'testowner',
          repo: 'testrepo',
          pull_number: 123,
          body: expect.stringContaining('branch name'),
          event: 'COMMENT',
        });
      });

      it('posts comment explaining title was updated from body', async () => {
        setupContext({
          title: 'My PR',
          body: 'Fixes TEST-456',
        });
        setupInputs({
          commentOnTitleUpdate: 'true',
        });

        await run();

        expect(mockOctokit.rest.pulls.update).toHaveBeenCalledTimes(1);
        expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.stringContaining('body'),
          })
        );
      });

      it('posts comment explaining title was updated from body URL', async () => {
        setupContext({
          title: 'My PR',
          body: 'See https://github.com/example/repo/issues/TEST-789',
        });
        setupInputs({
          commentOnTitleUpdate: 'true',
          bodyRegex: '^$', // Won't match, so it falls through to bodyURL
          bodyURLRegex: 'github\\.com\\/example\\/repo\\/issues\\/TEST-(?<ticketNumber>\\d+)',
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.stringContaining('ticket URL'),
          })
        );
      });
    });
  });

  describe('commentWithTicketLink', () => {
    describe('when false (default)', () => {
      it('does not post ticket link comment even when ticketLink is configured', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'false',
          ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });
    });

    describe('when true', () => {
      it('posts ticket link comment when ticket is found in title', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'true',
          ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith({
          owner: 'testowner',
          repo: 'testrepo',
          pull_number: 123,
          body: 'See the ticket for this pull request: https://github.com/example/repo/issues/TEST-789',
          event: 'COMMENT',
        });
      });

      it('does not post comment when ticketLink is not configured', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'true',
          ticketLink: '',
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });

      it('does not post duplicate comment when ticket link already exists', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'true',
          ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
        });

        const mockResponse: Awaited<ReturnType<typeof mockOctokit.rest.pulls.listReviews>> = {
          data: [
            {
              body: 'See the ticket for this pull request: https://github.com/example/repo/issues/TEST-789',
            },
          ],
        };

        mockOctokit.rest.pulls.listReviews.mockResolvedValue(mockResponse);

        await run();

        expect(mockOctokit.rest.pulls.listReviews).toHaveBeenCalledTimes(1);
        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });

      it('does not post comment when ticketNumber group is missing', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'true',
          ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
          titleRegex: '^(TEST)-(\\d+)', // No named group
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });

      it('does not post comment when ticketLink missing placeholder', async () => {
        setupContext({
          title: 'TEST-789: My PR',
        });
        setupInputs({
          commentWithTicketLink: 'true',
          ticketLink: 'https://github.com/example/repo/issues/invalid', // Missing %ticketNumber%
        });

        await run();

        expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
      });
    });
  });

  describe('both flags together', () => {
    it('posts both comments when both are enabled and title is auto-updated', async () => {
      setupContext({
        title: 'My PR',
        branch: 'TEST-999-feature',
      });
      setupInputs({
        commentOnTitleUpdate: 'true',
        commentWithTicketLink: 'true',
        ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
      });

      await run();

      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.pulls.createReview).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          body: expect.stringContaining('branch name'),
        })
      );
      expect(mockOctokit.rest.pulls.createReview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          body: expect.stringContaining('https://github.com/example/repo/issues/TEST-999'),
        })
      );
    });

    it('posts no comments when both are disabled', async () => {
      setupContext({
        title: 'My PR',
        branch: 'TEST-999-feature',
      });
      setupInputs({
        commentOnTitleUpdate: 'false',
        commentWithTicketLink: 'false',
        ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('treats non-"true" string values as false', async () => {
      setupContext({
        title: 'TEST-789: My PR',
      });
      setupInputs({
        commentWithTicketLink: 'yes',
        commentOnTitleUpdate: '1',
        ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
      });

      await run();

      expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    });

    it('succeeds silently when title already has correct format', async () => {
      setupContext({
        title: 'TEST-123: My PR',
      });
      setupInputs({
        commentOnTitleUpdate: 'false',
        commentWithTicketLink: 'false',
      });

      await run();

      expect(mockedCore.setFailed).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    });

    it('handles empty string values gracefully', async () => {
      setupContext({
        title: 'TEST-789: My PR',
      });
      setupInputs({
        commentWithTicketLink: '',
        commentOnTitleUpdate: '',
        ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
      });

      await run();

      expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled();
    });
  });

  describe('core functionality integration', () => {
    it('still updates titles when commentOnTitleUpdate is false', async () => {
      setupContext({
        title: 'My PR without ticket',
        branch: 'TEST-555-feature',
      });
      setupInputs({
        commentOnTitleUpdate: 'false',
      });

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('TEST-555'),
        })
      );
    });

    it('still validates tickets when commentWithTicketLink is false', async () => {
      setupContext({
        title: 'TEST-999: Valid PR',
      });
      setupInputs({
        commentWithTicketLink: 'false',
      });

      await run();

      expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('title/branch ticket mismatch', () => {
    it('does not update title when title has different valid ticket than branch', async () => {
      setupContext({
        title: 'TEST-999: My feature',
        branch: 'TEST-123-different-feature',
      });
      setupInputs({
        titleRegex: '^TEST-(?<ticketNumber>\\d+)',
        branchRegex: '^TEST-(?<ticketNumber>\\d+)',
      });

      await run();

      // Should NOT update the title since it already has a valid ticket
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
      expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });

    it('does not update title when title has different valid ticket than body', async () => {
      setupContext({
        title: 'TEST-999: My feature',
        body: 'Fixes TEST-456',
      });
      setupInputs({
        titleRegex: '^TEST-(?<ticketNumber>\\d+)',
        bodyRegex: 'TEST-(?<ticketNumber>\\d+)',
      });

      await run();

      // Should NOT update the title since it already has a valid ticket
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
      expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });

    it('does not update title when title has different valid ticket than body URL', async () => {
      setupContext({
        title: 'TEST-999: My feature',
        body: 'See https://github.com/example/repo/issues/TEST-789',
      });
      setupInputs({
        titleRegex: '^TEST-(?<ticketNumber>\\d+)',
        bodyRegex: '^$', // Won't match
        bodyURLRegex: 'github\\.com\\/example\\/repo\\/issues\\/TEST-(?<ticketNumber>\\d+)',
      });

      await run();

      // Should NOT update the title since it already has a valid ticket
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
      expect(mockedCore.setFailed).not.toHaveBeenCalled();
    });

    it('calls linkTicket with title match when skipping branch update', async () => {
      setupContext({
        title: 'TEST-999: My feature',
        branch: 'TEST-123-different-feature',
      });
      setupInputs({
        titleRegex: '^TEST-(?<ticketNumber>\\d+)',
        branchRegex: '^TEST-(?<ticketNumber>\\d+)',
        commentWithTicketLink: 'true',
        ticketLink: 'https://github.com/example/repo/issues/TEST-%ticketNumber%',
      });

      await run();

      // Should link to the ticket in the title (999), not branch (123)
      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        pull_number: 123,
        body: 'See the ticket for this pull request: https://github.com/example/repo/issues/TEST-999',
        event: 'COMMENT',
      });
    });
  });
});
