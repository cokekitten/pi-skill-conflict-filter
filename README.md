# pi-skill-conflict-filter

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that hides duplicate Skill collision diagnostics from the interactive startup TUI.

## Behavior

- Hides only diagnostics where `type` is `collision` and `resourceType` is `skill`.
- Keeps invalid Skill metadata/path warnings visible.
- Keeps Prompt, Extension, and Theme diagnostics visible.
- Changes display only; Skill discovery, precedence, loaded content, sessions, and model context are untouched.

## Install

```bash
pi install /path/to/pi-skill-conflict-filter
```

Restart pi or run `/reload`.

## Development

```bash
npm test
pi -e /path/to/pi-skill-conflict-filter
```

## Compatibility

This extension monkey-patches Pi's private `InteractiveMode.prototype.showLoadedResources` method. It fails open and shows a warning if Pi changes the internal module path or method, but a Pi upgrade may still require an extension update.

## License

MIT
