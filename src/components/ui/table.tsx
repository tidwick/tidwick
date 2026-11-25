import * as React from 'react';
import { cn } from 'cn';

// The copied table set, with one addition for the phone: below `md` each body row is a card and each cell reads
// its column name from `data-label`, as the week grid does. Explicit roles keep the table semantics that a
// changed `display` would otherwise drop.
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full rounded-lg border border-border">
      <table
        role="table"
        data-slot="table"
        className={cn('w-full caption-bottom text-sm max-md:block', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      role="rowgroup"
      data-slot="table-header"
      className={cn('bg-muted/50 max-md:sr-only [&_tr]:border-b', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      role="rowgroup"
      data-slot="table-body"
      className={cn('max-md:grid max-md:gap-3 max-md:p-3 md:[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      role="rowgroup"
      data-slot="table-footer"
      className={cn(
        'border-t border-border bg-muted/50 font-medium max-md:block max-md:p-3',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      role="row"
      data-slot="table-row"
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50 max-md:grid max-md:gap-1 max-md:rounded-md max-md:border max-md:p-3',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      role="columnheader"
      scope="col"
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** A row's own name: the first cell of a row, read as its header. */
function TableRowHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      role="rowheader"
      scope="row"
      data-slot="table-row-head"
      className={cn(
        'px-3 py-3 text-left align-middle font-medium max-md:block max-md:p-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      role="cell"
      data-slot="table-cell"
      className={cn(
        'px-3 py-3 align-middle max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:p-0 max-md:before:text-xs max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)] max-md:empty:hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRowHead, TableRow, TableCell };
