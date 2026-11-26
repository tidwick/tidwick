// Matching each read row to a person, client, project and task, rejecting what cannot be matched and noting what
// is new or what an admin must add. A client or project the file names that does not exist is planned under a new
// id, and the tasks its rows name become the project's allowed tasks, so a first import lands in one apply. Pure.
import type { ImportRow } from './import';
import { newId } from './ids';
import type { ImportPlan, ImportReference } from './import-types';

const lower = (text: string): string => text.toLowerCase();
export const KEY = '\u0001';
export const key = (...parts: (string | number)[]): string => parts.join(KEY);

export interface Resolved {
  row: ImportRow;
  personId: string;
  clientId: string;
  projectId: string;
  taskId: string;
}

/** Matches each row to a person, client, project and task, rejecting what cannot be matched and noting what is new. */
export function resolveRows(
  rows: readonly ImportRow[],
  ref: ImportReference,
  plan: ImportPlan,
  reject: (lines: readonly number[], reason: string) => void,
): Resolved[] {
  const people = new Map(ref.people.map((p) => [lower(p.email), p]));
  const clients = new Map(ref.clients.map((c) => [lower(c.name), c]));
  const projects = new Map(ref.projects.map((p) => [key(p.clientId, lower(p.name)), p]));
  const byNumber = new Map(
    ref.projects.flatMap((p) => (p.number === null ? [] : [[p.number, p] as const])),
  );
  const taskOf = new Map<string, ImportReference['tasks'][number]>();
  for (const t of ref.tasks) taskOf.set(lower(t.name), t);
  for (const t of ref.tasks) taskOf.set(lower(t.code), t);
  const allowed = new Set(ref.allowed.map((a) => key(a.projectId, a.taskId)));
  const newClients = new Map<string, ImportPlan['newClients'][number]>();
  const newProjects = new Map<string, ImportPlan['newProjects'][number]>();
  const out: Resolved[] = [];
  for (const row of rows) {
    const person = people.get(lower(row.email));
    if (person === undefined || person.offboarded) {
      reject([row.line], `unknown person ${row.email}`);
      continue;
    }
    const task = taskOf.get(lower(row.task));
    if (task === undefined) {
      reject([row.line], `unknown task code "${row.task}"`);
      plan.needsAdmin.push(`add task code ${row.task}`);
      continue;
    }
    if (task.archived) {
      reject([row.line], `task code ${task.code} is archived`);
      continue;
    }
    const client = clients.get(lower(row.client));
    if (client?.archived === true) {
      reject([row.line], `client "${client.name}" is archived`);
      continue;
    }
    const project =
      client === undefined ? undefined : projects.get(key(client.id, lower(row.project)));
    if (project?.archived === true) {
      reject([row.line], `project "${project.name}" is archived`);
      continue;
    }
    const named = row.projectNumber === null ? undefined : byNumber.get(row.projectNumber);
    if (row.projectNumber !== null && named !== undefined && named.id !== project?.id) {
      reject([row.line], `project number ${row.projectNumber} names a different project`);
      continue;
    }
    if (
      project?.number != null &&
      row.projectNumber !== null &&
      project.number !== row.projectNumber
    ) {
      reject(
        [row.line],
        `project "${project.name}" is ${project.number}, not ${row.projectNumber}`,
      );
      continue;
    }
    if (project === undefined) {
      if (ref.numberRequired && row.projectNumber === null) {
        reject([row.line], 'a project number is required for a new project');
        continue;
      }
      const clientName = client?.name ?? row.client;
      let owner = client === undefined ? newClients.get(lower(row.client)) : undefined;
      if (client === undefined && owner === undefined) {
        owner = { id: newId(), name: row.client };
        newClients.set(lower(row.client), owner);
      }
      const clientId = client?.id ?? owner?.id ?? '';
      const planned = newProjects.get(key(lower(clientName), lower(row.project))) ?? {
        id: newId(),
        clientId,
        client: clientName,
        name: row.project,
        number: row.projectNumber,
        taskIds: [],
      };
      newProjects.set(key(lower(clientName), lower(row.project)), planned);
      if (
        row.projectNumber !== null &&
        planned.number !== null &&
        planned.number !== row.projectNumber
      ) {
        reject(
          [row.line],
          `project "${planned.name}" is ${planned.number}, not ${row.projectNumber}`,
        );
        continue;
      }
      planned.number ??= row.projectNumber;
      if (!planned.taskIds.includes(task.id)) planned.taskIds.push(task.id);
      out.push({ row, personId: person.id, clientId, projectId: planned.id, taskId: task.id });
      continue;
    }
    if (!allowed.has(key(project.id, task.id))) {
      reject([row.line], `task ${task.code} is not allowed on project "${project.name}"`);
      plan.needsAdmin.push(`allow ${task.code} on project "${project.name}"`);
      continue;
    }
    out.push({
      row,
      personId: person.id,
      clientId: project.clientId,
      projectId: project.id,
      taskId: task.id,
    });
  }
  plan.newClients = [...newClients.values()];
  plan.newProjects = [...newProjects.values()];
  return out;
}
