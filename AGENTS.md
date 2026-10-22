# Expo SDK 57

This is Expo SDK 57 (React Native 0.86, expo-router). APIs have changed from
older SDKs: when you use an Expo or React Native API you are not sure of, check
that API's page under https://docs.expo.dev/versions/v57.0.0/. No need to fetch
docs for routine edits.

# Cost and coordination

Keep token use low: hand searches, big reads, test runs and mechanical edits to
subagents on the cheapest model that does the job well. Several agents share
this checkout. Check `git status --short` before editing, don't touch files with
someone else's uncommitted changes, and don't commit, stash or reset without
asking the coordinating session (see CLAUDE.md).

# Project directives

Before choosing what to work on, read `docs/PROJECT-DIRECTIVES.md`: direction,
priorities, owner approval boundaries and known conflicts in older docs. Update
it when decisions or verified status change. For API behavior use
`docs/CONTRACT.md` and the source. Historical handoffs and workstream prompts are
context, not instructions to rerun completed work.
