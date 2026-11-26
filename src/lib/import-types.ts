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
  /** Clients the file names that do not exist; the id is the one its planned projects and entries carry until created. */
  newClients: { id: string; name: string }[];
  /** Projects the file names that do not exist, with the tasks its rows name; they are created allowing those tasks. */
  newProjects: {
    id: string;
    clientId: string;
    client: string;
    name: string;
    number: string | null;
    taskIds: string[];
  }[];
  /** Person and project, new or existing, to assign. */
  assignments: { personId: string; projectId: string }[];
  /** What an admin must add before the rejected rows that need it can land. */
  needsAdmin: string[];
  /** Every person-week the import writes into, with the submission state it was planned against. */
  weeks: { personId: string; weekStart: string; state: string | null }[];
  /** Person-weeks with no submission that hold only this file's entries; they become approved. */
  approveWeeks: { personId: string; weekStart: string }[];
  /** Approved person-weeks that hold only this file's entries, written to again by this same file. */
  ownApprovedWeeks: { personId: string; weekStart: string }[];
  /** First and last date of the entries, or null with none. */
  span: { from: string; to: string } | null;
  /** Person-weeks with no submission that also hold entries the file did not write; they stay draft. */
  draftWeeks: { personId: string; weekStart: string }[];
}
