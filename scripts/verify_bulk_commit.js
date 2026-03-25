const path = require('path');

// Mock vscode
const vscode = {
  window: {
    withProgress: async (options, task) => {
      const progress = {
        report: (report) => {
          console.log(`Progress: ${report.message}, increment: ${report.increment}`);
        }
      };
      return await task(progress);
    },
    showInformationMessage: (msg) => {
      console.log(`Info: ${msg}`);
    }
  },
  ProgressLocation: { Notification: 1 }
};

// Mock git and repoManager
const git = {
  commit: async (repoPath, message) => {
    console.log(`Committing to ${repoPath} with message: ${message}`);
    if (repoPath.includes('fail')) {
      throw new Error('Commit failed');
    }
    return 'Done';
  }
};

const repoManager = {
  refreshRepo: async (repoPath) => {
    console.log(`Refreshing repo: ${repoPath}`);
  }
};

const channel = {
  show: () => console.log('Showing channel'),
  appendLine: (line) => console.log(`Channel: ${line}`)
};

async function testBulkCommit(selectedPaths, message) {
  let success = 0;
  let failed = 0;
  const paths = [...selectedPaths];
  const BATCH_SIZE = 2; // smaller for testing

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Diffchestrator: Bulk committing...",
      cancellable: false,
    },
    async (progress) => {
      for (let i = 0; i < paths.length; i += BATCH_SIZE) {
        const batch = paths.slice(i, i + BATCH_SIZE);
        progress.report({
          message: `${Math.min(i + BATCH_SIZE, paths.length)}/${paths.length} repos`,
          increment: (batch.length / paths.length) * 100,
        });

        await Promise.all(
          batch.map(async (repoPath) => {
            const name = path.basename(repoPath);
            try {
              const output = await git.commit(repoPath, message.trim());
              channel.appendLine(`[OK] ${name}: ${output.trim()}`);
              await repoManager.refreshRepo(repoPath);
              success++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              channel.appendLine(`[FAIL] ${name}: ${msg}`);
              failed++;
            }
          })
        );
      }
    }
  );

  vscode.window.showInformationMessage(
    `Diffchestrator: Bulk commit complete. ${success} succeeded, ${failed} failed.`
  );
}

async function run() {
  const paths = ['/path/to/repo1', '/path/to/repo2_fail', '/path/to/repo3', '/path/to/repo4', '/path/to/repo5'];
  console.log('--- Testing bulk commit with 5 repos (batch size 2) ---');
  await testBulkCommit(paths, 'feat: update');
}

run().catch(console.error);
