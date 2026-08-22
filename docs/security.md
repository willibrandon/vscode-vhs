# Security model

Editing is local. The extension does not download VHS or send tape contents to a service.

VHS runs only after an explicit command or enabled validation-on-save setting. Execution is blocked
in untrusted, virtual, and browser workspaces. The runner does not use a shell and limits time,
output, concurrency, and cancellation cleanup.

Preview pages use a strict content security policy and load only declared output files.

Release checks include CodeQL, dependency review, Picket, secret scanning, npm audits, package and
license allowlists, reproducible artifacts, checksums, SBOMs, and attestations. Actions are pinned
to commit SHAs with narrow permissions.

Report extension vulnerabilities through GitHub private vulnerability reporting. VHS vulnerabilities
belong to the VHS project.
