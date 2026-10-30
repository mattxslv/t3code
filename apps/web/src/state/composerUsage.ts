import { Atom } from "effect/reactivity";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { environmentPresentations } from "./presentation";

export const composerUsageAccountsAtom = Atom.make((get) =>
  collectLimitAccounts(get(environmentPresentations.presentationsWithProvidersAtom)),
).pipe(Atom.withLabel("composer-usage-accounts"));
