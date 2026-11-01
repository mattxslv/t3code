import {
  AutoRoutingDecision,
  AutoRoutingError,
  type AutoRoutingFeedback,
  type AutoRoutingListHistoryInput,
  type CommandId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const AUTO_ROUTING_HISTORY_LIMIT = 5_000;

export interface AutoRoutingThreadRecord {
  readonly threadId: ThreadId;
  readonly mode: "auto" | "pinned" | null;
  readonly escalationsUsed: number;
  /** Decision that started the current task; a new task resets the escalation budget. */
  readonly taskDecisionId: string | null;
  readonly declinedOfferIds: ReadonlyArray<string>;
  readonly acceptedOfferIds: ReadonlyArray<string>;
  readonly updatedAt: string;
}

export interface AutoRoutingStoreShape {
  readonly insertDecision: (decision: AutoRoutingDecision) => Effect.Effect<void, AutoRoutingError>;
  readonly findByCommandId: (
    commandId: CommandId,
  ) => Effect.Effect<AutoRoutingDecision | null, AutoRoutingError>;
  readonly latestForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<AutoRoutingDecision | null, AutoRoutingError>;
  readonly list: (
    input: AutoRoutingListHistoryInput,
  ) => Effect.Effect<ReadonlyArray<AutoRoutingDecision>, AutoRoutingError>;
  readonly setFeedback: (
    decisionId: string,
    feedback: AutoRoutingFeedback | null,
  ) => Effect.Effect<boolean, AutoRoutingError>;
  readonly clear: Effect.Effect<void, AutoRoutingError>;
  readonly getThread: (
    threadId: ThreadId,
  ) => Effect.Effect<AutoRoutingThreadRecord | null, AutoRoutingError>;
  readonly putThread: (record: AutoRoutingThreadRecord) => Effect.Effect<void, AutoRoutingError>;
}

export class AutoRoutingStore extends Context.Service<AutoRoutingStore, AutoRoutingStoreShape>()(
  "t3/autoRouting/AutoRoutingStore",
) {}

const decodeDecision = Schema.decodeUnknownEffect(Schema.fromJsonString(AutoRoutingDecision));
const encodeDecision = Schema.encodeEffect(Schema.fromJsonString(AutoRoutingDecision));
const StringList = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeStringList = Schema.decodeUnknownEffect(StringList);
const encodeStringList = Schema.encodeEffect(StringList);

const failWith = (message: string) => (cause: unknown) => new AutoRoutingError({ message, cause });

interface DecisionRow {
  readonly payload: string;
  readonly feedback: string | null;
}

interface ThreadRow {
  readonly threadId: string;
  readonly mode: string | null;
  readonly escalationsUsed: number;
  readonly taskDecisionId: string | null;
  readonly declinedOfferIds: string;
  readonly acceptedOfferIds: string;
  readonly updatedAt: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Fork-only tables stay out of the numbered migration manifest so upstream migration ids
  // never collide with them when official releases merge in.
  yield* sql`
    CREATE TABLE IF NOT EXISTS auto_routing_decisions (
      id TEXT PRIMARY KEY,
      command_id TEXT UNIQUE,
      thread_id TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      feedback TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS auto_routing_decisions_thread
    ON auto_routing_decisions (thread_id, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS auto_routing_decisions_created
    ON auto_routing_decisions (created_at)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS auto_routing_threads (
      thread_id TEXT PRIMARY KEY,
      mode TEXT,
      escalations_used INTEGER NOT NULL DEFAULT 0,
      task_decision_id TEXT,
      declined_offer_ids TEXT NOT NULL DEFAULT '[]',
      accepted_offer_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )
  `;

  const toDecision = (row: DecisionRow) =>
    decodeDecision(row.payload).pipe(
      Effect.map((decision) => ({
        ...decision,
        feedback: row.feedback === "good" || row.feedback === "bad" ? row.feedback : null,
      })),
    );

  const insertDecision: AutoRoutingStoreShape["insertDecision"] = Effect.fn(
    "AutoRoutingStore.insertDecision",
  )(
    function* (decision) {
      const payload = yield* encodeDecision(decision);
      yield* sql`
      INSERT INTO auto_routing_decisions
        (id, command_id, thread_id, project_id, created_at, kind, payload, feedback)
      VALUES (
        ${decision.id}, ${decision.commandId}, ${decision.threadId}, ${decision.projectId},
        ${decision.createdAt}, ${decision.kind}, ${payload}, ${decision.feedback}
      )
      ON CONFLICT (id) DO NOTHING
    `;
      yield* sql`
      DELETE FROM auto_routing_decisions
      WHERE created_at < (
        SELECT created_at FROM auto_routing_decisions
        ORDER BY created_at DESC LIMIT 1 OFFSET ${AUTO_ROUTING_HISTORY_LIMIT}
      )
    `;
    },
    Effect.mapError(failWith("Could not record the routing decision.")),
  );

  const findOne = (rows: ReadonlyArray<DecisionRow>) =>
    rows[0] === undefined ? Effect.succeed(null) : toDecision(rows[0]);

  const findByCommandId: AutoRoutingStoreShape["findByCommandId"] = (commandId) =>
    sql<DecisionRow>`
      SELECT payload, feedback FROM auto_routing_decisions WHERE command_id = ${commandId}
    `.pipe(Effect.flatMap(findOne), Effect.mapError(failWith("Could not read routing history.")));

  const latestForThread: AutoRoutingStoreShape["latestForThread"] = (threadId) =>
    sql<DecisionRow>`
      SELECT payload, feedback FROM auto_routing_decisions
      WHERE thread_id = ${threadId}
      ORDER BY created_at DESC LIMIT 1
    `.pipe(Effect.flatMap(findOne), Effect.mapError(failWith("Could not read routing history.")));

  const list: AutoRoutingStoreShape["list"] = (input) => {
    const limit = input.limit ?? 100;
    const query =
      input.threadId !== undefined
        ? sql<DecisionRow>`
            SELECT payload, feedback FROM auto_routing_decisions
            WHERE thread_id = ${input.threadId}
            ORDER BY created_at DESC LIMIT ${limit}
          `
        : input.projectId !== undefined
          ? sql<DecisionRow>`
              SELECT payload, feedback FROM auto_routing_decisions
              WHERE project_id = ${input.projectId}
              ORDER BY created_at DESC LIMIT ${limit}
            `
          : sql<DecisionRow>`
              SELECT payload, feedback FROM auto_routing_decisions
              ORDER BY created_at DESC LIMIT ${limit}
            `;
    return query.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toDecision)),
      Effect.mapError(failWith("Could not read routing history.")),
    );
  };

  const setFeedback: AutoRoutingStoreShape["setFeedback"] = (decisionId, feedback) =>
    sql`UPDATE auto_routing_decisions SET feedback = ${feedback} WHERE id = ${decisionId}`.pipe(
      Effect.andThen(
        sql<{ readonly found: number }>`
          SELECT COUNT(*) AS found FROM auto_routing_decisions WHERE id = ${decisionId}
        `,
      ),
      Effect.map((rows) => (rows[0]?.found ?? 0) > 0),
      Effect.mapError(failWith("Could not save routing feedback.")),
    );

  const clear: AutoRoutingStoreShape["clear"] = sql`DELETE FROM auto_routing_decisions`.pipe(
    Effect.asVoid,
    Effect.mapError(failWith("Could not clear routing history.")),
  );

  const getThread: AutoRoutingStoreShape["getThread"] = (threadId) =>
    sql<ThreadRow>`
      SELECT
        thread_id AS "threadId",
        mode,
        escalations_used AS "escalationsUsed",
        task_decision_id AS "taskDecisionId",
        declined_offer_ids AS "declinedOfferIds",
        accepted_offer_ids AS "acceptedOfferIds",
        updated_at AS "updatedAt"
      FROM auto_routing_threads WHERE thread_id = ${threadId}
    `.pipe(
      Effect.flatMap((rows) => {
        const row = rows[0];
        if (row === undefined) return Effect.succeed(null);
        return Effect.all([
          decodeStringList(row.declinedOfferIds),
          decodeStringList(row.acceptedOfferIds),
        ]).pipe(
          Effect.map(([declinedOfferIds, acceptedOfferIds]): AutoRoutingThreadRecord => ({
            threadId,
            mode: row.mode === "auto" || row.mode === "pinned" ? row.mode : null,
            escalationsUsed: Number(row.escalationsUsed),
            taskDecisionId: row.taskDecisionId,
            declinedOfferIds,
            acceptedOfferIds,
            updatedAt: row.updatedAt,
          })),
        );
      }),
      Effect.mapError(failWith("Could not read thread routing state.")),
    );

  const putThread: AutoRoutingStoreShape["putThread"] = Effect.fn("AutoRoutingStore.putThread")(
    function* (record) {
      // Bounded so a long-lived thread cannot grow the row without limit.
      const declined = yield* encodeStringList(record.declinedOfferIds.slice(-50));
      const accepted = yield* encodeStringList(record.acceptedOfferIds.slice(-50));
      yield* sql`
        INSERT INTO auto_routing_threads
          (thread_id, mode, escalations_used, task_decision_id, declined_offer_ids, accepted_offer_ids, updated_at)
        VALUES (
          ${record.threadId}, ${record.mode}, ${record.escalationsUsed}, ${record.taskDecisionId},
          ${declined}, ${accepted}, ${record.updatedAt}
        )
        ON CONFLICT (thread_id) DO UPDATE SET
          mode = excluded.mode,
          escalations_used = excluded.escalations_used,
          task_decision_id = excluded.task_decision_id,
          declined_offer_ids = excluded.declined_offer_ids,
          accepted_offer_ids = excluded.accepted_offer_ids,
          updated_at = excluded.updated_at
      `;
    },
    Effect.mapError(failWith("Could not save thread routing state.")),
  );

  return AutoRoutingStore.of({
    insertDecision,
    findByCommandId,
    latestForThread,
    list,
    setFeedback,
    clear,
    getThread,
    putThread,
  });
});

export const layer = Layer.effect(AutoRoutingStore, make);
