// The demo seed's notes: the plain lines a person writes beside their hours, by task, with no client, person or
// place named. Administration often goes without one, as it does in a real week.
import type { TaskCode } from './build.ts';

const NOTES: Record<TaskCode, readonly string[]> = {
  PLAN: [
    'Drafted the stage plan and resource estimate',
    'Updated the programme after the client call',
    'Scoped the survey brief and the fee split',
    'Reworked the phasing so the ground floor stays open',
  ],
  DSGN: [
    'Worked up three layout options for the entrance',
    'Revised the elevations after the review comments',
    'Sketched the joinery details for the counter',
    'Developed the materials palette and sample board',
    'Tested the seating plan against the fire exits',
  ],
  DOCS: [
    'Issued the revised drawing set',
    'Wrote the finishes section of the specification',
    'Updated the room data sheets',
    'Marked up the contractor queries and replied',
  ],
  MEET: [
    'Weekly project meeting with the client',
    'Design review with the team',
    'Coordination call with the structural engineer',
    'Briefing for the new starter on the project',
  ],
  SITE: [
    'Site visit to check the setting out',
    'Measured survey of the ground floor',
    'Snagging walk with the contractor',
    'Photographed the existing roof before strip-out',
  ],
  QUAL: [
    'Checked the drawing register before issue',
    'Peer review of the planning statement',
    'Cross-checked the door schedule against the plans',
  ],
  ADMN: ['Timesheets and expenses', 'Studio admin and filing', 'Updated the project tracker'],
  LEAV: ['Annual leave'],
};

/** The note for a cell of `task`, picked by `k`; a third of admin cells have none. */
export function noteFor(task: TaskCode, k: number): string | null {
  if (task === 'ADMN' && k % 3 === 0) return null;
  const pool = NOTES[task];
  return pool[k % pool.length] ?? null;
}
