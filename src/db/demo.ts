// The marker the demo sign-in's gate reads. Only a database the demo seed loaded carries it (`test/demo/build.ts`).

export async function demoMarked(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS one FROM setting WHERE key = 'demo' AND value_json = '1'")
    .first();
  return row !== null;
}
