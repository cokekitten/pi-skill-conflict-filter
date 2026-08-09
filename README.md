# pi-skill-conflict-filter

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that hides duplicate Skill collision diagnostics from the interactive startup TUI.

**Repo:** https://github.com/cokekitten/pi-skill-conflict-filter

## Behavior

- Hides only diagnostics where `type` is `collision` and `resourceType` is `skill`.
- Keeps invalid Skill metadata/path warnings visible.
- Keeps Prompt, Extension, and Theme diagnostics visible.
- Changes display only; Skill discovery, precedence, loaded content, sessions, and model context are untouched.

## Install

From GitHub:

```bash
pi install git:github.com/cokekitten/pi-skill-conflict-filter
```

Or try it for one run without installing:

```bash
pi -e git:github.com/cokekitten/pi-skill-conflict-filter
```

Local checkout:

```bash
# e.g. in ~/.pi/agent/settings.json packages:
#   "../../dev/pi-expansion/pi-skill-conflict-filter"
pi install /path/to/pi-skill-conflict-filter
# or
pi -e /path/to/pi-skill-conflict-filter
```

After installing, restart pi or run `/reload`.

## Compatibility

This extension monkey-patches Pi's private `InteractiveMode.prototype.showLoadedResources` method. It fails open and shows a warning if Pi changes the internal module path or method, but a Pi upgrade may still require an extension update.

## Development

Package entry: `package.json` -> `pi.extensions` -> `./extensions/skill-conflict-filter.ts`.

```bash
npm test
```

## License

MIT
