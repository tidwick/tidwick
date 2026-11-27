# Security policy

## Reporting a vulnerability

Report it privately on GitHub: open the repository's Security tab and choose "Report a vulnerability". Please keep it out of public issues, pull requests and discussions.

A report should reproduce against the latest release, with steps that run on invented data. One person maintains tidwick, with no support commitment, so a reply can take a while.

## Supported versions

Only the latest release gets fixes. A fix lands on `next` and ships in the next release. Older releases are not patched.

## Security design

`docs/ARCHITECTURE.md` describes the trust boundaries and threats (section 3) and the boundaries the gates enforce (section 8). The decisions are in `docs/adr/`: sign-in and sessions (0003), the authorization table and step-up (0004), data and note encryption (0005), the audit log (0006), headers, CSRF and error text (0007), backups (0008) and the agent surface (0014).

This states the design and names the tests that hold it. It is not an audit, and nothing here promises the code is free of faults.
