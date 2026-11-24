// The shapes an import plan is made from and makes: what the database holds, and what to write.
import type { Rejection } from './import';

export interface ImportReference {
  people: readonly { id: string; email: string; offboarded: boolean }[];
  clients: readonly { id: string; name: string; archived: boolean }[];
  projects: readonly {
    id: string;
    clientId: string;
    name: string;
    number: string | null;
    archived: boolean;
  }[];
  tasks: readonly { id: string; code: string; name: string; archived: boolean }[];
  /** Live allowed tasks, by project. */
  allowed: readonly { projectId: string; taskId: string }[];
  numberRequired: boolean;
}

/** What the people in the file already have in the weeks the file touches. */
export interface ImportExisting {
  cells: readonly {
    personId: string;
    weekStart: string;
    projectId: string;
    taskId: string;
    dow: number;
    hundredths: number;
    importId: string | null;
  }[];
  rows: readonly {
    id: string;
    personId: string;
    weekStart: string;
    projectId: string;
    taskId: string;
    position: number;
  }[];
  submissions: readonly { personId: string; weekStart: string; state: string }[];
}

export interface PlannedEntry {
  id: string;
  rowId: string;
  clientId: string;
  personId: string;
  dow: number;
  hundredths: number;
  note: string;
}

export interface PlannedRow {
  id: string;
  clientId: string;
  personId: string;
  weekStart: string;
  projectId: string;
  taskId: string;
  position: number;
}

export interface ImportPlan {
  entries: PlannedEntry[];
  rows: PlannedRow[];
  rejected: Rejection[];
  alreadyApplied: number;
  roundedRows: number;
  newClients: string[];
  newProjects: { client: string; name: string; number: string | null }[];
  /** Person and existing project, to assign. */
  assignments: { personId: string; projectId: string }[];
  /** Person and a project that does not exist yet, named by client and project, to assign once it does. */
  pendingAssignments: { personId: string; client: string; project: string }[];
  /** What an admin must add before the rejected rows that need it can land. */
  needsAdmin: string[];
  /** Every person-week the import writes into, with the submission state it was planned against. */
  weeks: { personId: string; weekStart: string; state: string | null }[];
  /** Person-weeks with no submission that hold only this file's entries; they become approved. */
  approveWeeks: { personId: string; weekStart: string }[];
  /** Person-weeks with no submission that also hold entries the file did not write; they stay draft. */
  draftWeeks: { personId: string; weekStart: string }[];
}
