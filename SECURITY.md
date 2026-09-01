# Security

## Reporting a vulnerability

Report privately through GitHub's
[security advisories](https://github.com/Slash-ui/slash-port/security/advisories/new)
rather than in a public issue. You should get a first response within a few
days.

Useful to include: the platform and Node version, what you ran, what happened,
and what you expected instead.

## What this tool does, and does not do

`slash-port` reads the local socket table and the local process table, and sends
signals to processes you already have permission to signal. It makes no network
connections at any point, has no telemetry, no update check, and no
configuration file. It requests no privileges: run under `sudo` and it sees more
processes, exactly as any other program would.

Things worth reporting:

- A way to make it kill something on the protected list - the init process,
  `sshd`, a session process, itself, or its parent shell.
- A way to make it kill something without the confirmation that names the
  target.
- A command line, process name, or socket table entry that causes a shell
  injection, a crash, or a path traversal when parsed. Subprocesses are spawned
  with an argument array rather than a shell string, so an injection here would
  be a genuine bug.
- Anything that makes it open a network connection.

## If a credential reaches this repository

The order is:

1. **Rotate the credential.** Immediately, before anything else.
2. **Then rewrite the history**, if it is still worth doing.

Never the other way round. A rewritten history does not un-leak a key that was
public for an hour - it only makes it harder to find out what happened. Assume
anything pushed to a public repository was scraped within minutes.

## Supported versions

The latest published minor version. Fixes go out as a new release rather than
being backported.
