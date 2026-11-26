// Add row: pick a project (an all-clients person's own list is every live project), then one of its allowed tasks. Two real forms, so it works
// with no script: step one is a GET that carries the project in the query, step two posts to the Action.
import { useState } from 'react';
import type { EmptyCause, ProjectOption } from '../../lib/week';
import { Button } from '../ui/button';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

export interface AddRowProps {
  options: readonly ProjectOption[];
  /** Why `options` is empty, named so the person knows what to do; absent reads as a plain empty list. */
  empty?: EmptyCause | null | undefined;
  path: string;
  csrf: string;
  weekStart: string;
  initialProjectId: string;
  onAdd: (projectId: string, taskCodeId: string) => void;
}

const field = 'min-w-48 max-md:w-full [&_select]:max-md:h-11 [&_select]:max-md:text-base';
const tall = 'max-md:h-11';

const LINK = 'underline underline-offset-2';

/** What an empty add-row says: the cause and the next step. */
function Empty({ cause }: { cause: EmptyCause | null }) {
  if (cause?.kind === 'no_tasks') {
    const shown = cause.projects.slice(0, 3);
    const more = cause.projects.length - shown.length;
    return (
      <p className="text-sm text-muted-foreground">
        No task is allowed yet on{' '}
        {shown.map((p, i) => (
          <span key={p.projectId}>
            {i > 0 && ', '}
            <a className={LINK} href={`/projects/${p.projectId}`}>
              {p.name}
            </a>
          </span>
        ))}
        {more > 0 && ` and ${String(more)} more`}. Time cannot be booked until a task is allowed.
      </p>
    );
  }
  if (cause?.kind === 'no_projects') {
    return (
      <p className="text-sm text-muted-foreground">
        There is no live project yet. Create one under{' '}
        <a className={LINK} href="/clients">
          Clients
        </a>
        .
      </p>
    );
  }
  const who = cause?.kind === 'unassigned' ? cause.stewards.join(', ') : '';
  return (
    <p className="text-sm text-muted-foreground">
      You are not assigned to a project yet.{who !== '' && ` Ask ${who} to assign you.`}
    </p>
  );
}

export function AddRow({
  options,
  empty = null,
  path,
  csrf,
  weekStart,
  initialProjectId,
  onAdd,
}: AddRowProps) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = options.find((option) => option.projectId === projectId);
  if (options.length === 0) return <Empty cause={empty} />;
  if (!project) {
    return (
      <form method="get" action={path} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">
          Add a row: project
          <NativeSelect
            name="projectId"
            className={field}
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <NativeSelectOption value="">Choose a project</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.projectId} value={option.projectId}>
                {option.client} &middot; {option.project}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline" className={`${tall} border-control`}>
          Next
        </Button>
      </form>
    );
  }
  return (
    <form
      method="post"
      action={`${path}?_action=entries.addRow`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const task = new FormData(event.currentTarget).get('taskCodeId');
        if (typeof task === 'string' && task !== '') onAdd(project.projectId, task);
      }}
    >
      <input type="hidden" name="_csrf" value={csrf} />
      <input type="hidden" name="weekStart" value={weekStart} />
      <input type="hidden" name="projectId" value={project.projectId} />
      <label className="grid gap-1 text-sm font-medium">
        Task on {project.project}
        <NativeSelect name="taskCodeId" className={field} required defaultValue="">
          <NativeSelectOption value="" disabled>
            Choose a task
          </NativeSelectOption>
          {project.tasks.map((task) => (
            <NativeSelectOption key={task.taskCodeId} value={task.taskCodeId}>
              {task.code} {task.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <Button type="submit" className={tall}>
        Add row
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={tall}
        onClick={() => {
          setProjectId('');
        }}
      >
        Change project
      </Button>
    </form>
  );
}
