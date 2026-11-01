import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  autoRoutingRequestFor,
  type ComposerRoutingMode,
  resolveComposerRoutingMode,
  useAutoRoutingModeStore,
} from "../../autoRoutingStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

/** Auto mode for one composer target; the server re-checks every request it receives. */
export function useComposerAutoRouting(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly isServerThread: boolean;
  readonly threadStarted: boolean;
}) {
  const supported = useServerConfigs().get(input.environmentId)?.autoModelRouting === true;
  const settings = useEnvironmentSettings(input.environmentId, (value) => value.autoRouting);
  const threadKey =
    input.threadId === null
      ? null
      : scopedThreadKey(scopeThreadRef(input.environmentId, input.threadId));
  const local = useAutoRoutingModeStore((state) =>
    threadKey === null ? undefined : state.modes[threadKey],
  );
  const setLocalMode = useAutoRoutingModeStore((state) => state.setMode);
  const available = supported && settings.enabled;
  const threadState = useEnvironmentQuery(
    available && input.isServerThread && input.threadId !== null
      ? serverEnvironment.autoRoutingThreadState({
          environmentId: input.environmentId,
          input: { threadId: input.threadId },
        })
      : null,
  );
  const mode = resolveComposerRoutingMode({
    available: supported,
    settings,
    local,
    server: threadState.data?.mode,
    threadStarted: input.threadStarted,
  });
  return {
    available,
    mode,
    request: autoRoutingRequestFor(mode),
    settings,
    state: available ? threadState.data : null,
    refresh: threadState.refresh,
    setMode: (next: ComposerRoutingMode) => {
      if (threadKey !== null) setLocalMode(threadKey, next);
    },
  };
}

export type ComposerAutoRouting = ReturnType<typeof useComposerAutoRouting>;
