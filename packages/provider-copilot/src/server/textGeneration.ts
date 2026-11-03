import { TextGenerationError } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";

import type { CopilotSettings } from "../settings.ts";

const isTextGenerationError = Schema.is(TextGenerationError);

// An empty --available-tools leaves every tool on (CLI 1.0.105 read a file with it), so name one
// that does not exist.
const NO_TOOLS = "--available-tools=t3_no_tools";

/** No tools, MCP servers or repository instructions: only the prompt reaches the model. */
export const copilotOneShotArgs = (prompt: string, model: string): ReadonlyArray<string> => [
  "-p",
  prompt,
  "-s",
  "--model",
  model,
  NO_TOOLS,
  "--no-custom-instructions",
  "--disable-builtin-mcps",
  "--no-ask-user",
  "--no-auto-update",
  "--no-color",
];

const unsupported = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail:
        "GitHub Copilot does not write this. Enter it yourself, or switch the thread to Personal.",
    }),
  );

// Titles, commit messages and the like would spend AI credits without a prompt from the user.
// Sizing a request for Auto is the one background call, and only for turns already on Copilot.
export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")(function* (
  settings: CopilotSettings,
  environment: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = settings.binaryPath || "copilot";

  const runCopilotJson: TextGenerationOperations.Runner = Effect.fn(
    "CopilotTextGeneration.runCopilotJson",
  )(
    function* (request) {
      const spawn = yield* resolveSpawnCommand(
        command,
        copilotOneShotArgs(request.prompt, request.modelSelection.model),
        { env: environment },
      );
      const result = yield* spawnAndCollect(
        command,
        ChildProcess.make(spawn.command, spawn.args, {
          cwd: request.cwd,
          env: environment,
          shell: spawn.shell,
        }),
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
      if (result.code !== 0) {
        return yield* new TextGenerationError({
          operation: request.operation,
          detail: `GitHub Copilot exited with code ${result.code}.`,
        });
      }
      return yield* TextGenerationOperations.decodeJsonReply(
        request,
        "GitHub Copilot",
        result.stdout.trim(),
      );
    },
    (effect, request) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: request.operation,
                detail: "GitHub Copilot text generation failed.",
                cause,
              }),
        ),
      ),
  );

  const { classifyRoutingTask } = TextGenerationOperations.fromRunner(
    "CopilotTextGeneration",
    TextGenerationOperations.withoutInvestigation("GitHub Copilot", runCopilotJson),
  );

  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateReviewGuide: () => unsupported("generateReviewGuide"),
    ...(classifyRoutingTask === undefined ? {} : { classifyRoutingTask }),
  } satisfies ProviderTextGeneration;
});
