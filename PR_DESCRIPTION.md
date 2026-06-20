# PR Write-up

> Fill this in as if opening a real PR for review. Delete these hints.

## Summary

_One or two sentences: what this PR does and why._

## Changes

_Bullet the meaningful changes (endpoints, the shared data path, schema/index
changes, validation, etc.). Skip boilerplate._

## Testing

_The most important section._

- **Automated tests:** what you added and what they cover.
- **Edge cases:** which ones you considered and exercised (bad input, empty
  results, admin vs. member, owner vs. shared vs. neither, …).
- **Performance / regression:** how you checked the shared path didn't regress
  for its other callers; any `EXPLAIN`/index reasoning.
- **How verified:** the exact commands / steps a reviewer can rerun.

## Trade-offs

_What you chose and what you deliberately did NOT do, and why (scope, time)._

## Open questions

_Anything you'd raise with the team or that needs a product decision._
