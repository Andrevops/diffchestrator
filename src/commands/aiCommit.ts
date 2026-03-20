import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import type { RepoManager } from "../services/repoManager";
import { CMD } from "../constants";

export function registerAiCommitCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager
): void {
  const outputChannel = vscode.window.createOutputChannel("Diffchestrator AI");

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD.aiCommit,
      async (item?: { path?: string }) => {
        const repoPath = item?.path ?? repoManager.selectedRepo;
        if (!repoPath) {
          vscode.window.showWarningMessage(
            "Diffchestrator: No repository selected for AI commit."
          );
          return;
        }

        const repoName = path.basename(repoPath);
        const config = vscode.workspace.getConfiguration("diffchestrator");
        const permissionMode = config.get<string>("claudePermissionMode", "acceptEdits");

        let permFlag: string;
        switch (permissionMode) {
          case "full":
            permFlag = "full";
            break;
          case "default":
            permFlag = "default";
            break;
          case "acceptEdits":
          default:
            permFlag = "accept-edits";
            break;
        }

        const prompt =
          "Review the current git diff (staged and unstaged). Write a clear, conventional " +
          "commit message. Stage all meaningful changes and create the commit. " +
          "Do NOT push. Respond with just the commit hash and message when done.";

        outputChannel.clear();
        outputChannel.show();
        outputChannel.appendLine(`[AI Commit] ${repoName} (${repoPath})`);
        outputChannel.appendLine(`Permission mode: ${permFlag}`);
        outputChannel.appendLine("---");

        const claudeProcess = spawn(
          "claude",
          ["-p", "--permission-mode", permFlag, prompt],
          {
            cwd: repoPath,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env },
          }
        );

        claudeProcess.stdout.on("data", (data: Buffer) => {
          outputChannel.append(data.toString());
        });

        claudeProcess.stderr.on("data", (data: Buffer) => {
          outputChannel.append(data.toString());
        });

        claudeProcess.on("error", (err) => {
          outputChannel.appendLine(`\n[ERROR] Failed to spawn claude: ${err.message}`);
          outputChannel.appendLine(
            "Make sure 'claude' CLI is installed and available in PATH."
          );
          vscode.window.showErrorMessage(
            `Diffchestrator: Failed to launch Claude CLI: ${err.message}`
          );
        });

        claudeProcess.on("close", async (code) => {
          outputChannel.appendLine(`\n--- Claude exited with code ${code} ---`);
          await repoManager.refreshRepo(repoPath);

          if (code === 0) {
            vscode.window.showInformationMessage(
              `Diffchestrator: AI commit complete for ${repoName}`
            );
          } else {
            vscode.window.showWarningMessage(
              `Diffchestrator: Claude exited with code ${code} for ${repoName}`
            );
          }
        });
      }
    )
  );
}
