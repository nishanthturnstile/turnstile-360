# Web design-system maintenance

Follow the root workspace instructions. Read the accepted
[web design-system architecture](../../architecture.md#web-design-system) and
[shared design guide](../../docs/design-system.md) before changing presentation.

- Use the configured shadcn/Base UI primitives and semantic tokens. Keep shared
  styles in `src/index.css` and `src/components/ui`; compose them in feature UI.
- Use Hugeicons and the configured fonts. Use component variants for appearance;
  instance classes should arrange layout rather than redefine the visual system.
- Use the pinned CLI through `pnpm exec shadcn` from this app. Inspect generated
  changes and preserve documented local adaptations when updating upstream code.
- Update the development gallery for reusable patterns and states. Preserve its
  development-only boundary and use fixture text without account/API access.
- Preserve the existing credential, session, permission and recovery behavior
  when changing controls. Keep browser state transient and secrets server-side.
- Keep developer/designer guidance and bundled third-party notices current.

Required verification and progress/handoff rules remain in the root instructions.
