# MAPR Design Context

## Register
product

## Physical Scene
An analyst watches a live global risk board on a large monitor in a dim operations room, then prepares a source-backed brief for a client or internal team.

## Interface Model
The mapper page is the workbench. The map owns the screen. Panels, rails, sheets, and Composer actions dock to the map and should feel operational, not decorative.

## Visual Language
- Tactical but readable: dark neutral field, restrained amber command accent, severity colors for meaning.
- Severity drives hierarchy: green, amber, red, black.
- Provenance is a first-class UI layer: source count, source type, verification state, and social unverified badges should be scannable.
- Agent output should look like intelligence product: evidence rows, brief modules, timelines, source packs. Avoid chat-bubble aesthetics.

## Layout Rules
- Keep the map dominant.
- Prefer docked panels and inline expansions over modals.
- Avoid nested cards. Use compact strips, rows, tabs, and section dividers.
- Free/Pro locks should appear in context, next to the workflow they unlock.

## Motion Rules
- Motion should be short and directional: panel slides, hover elevation, focus glow.
- Do not animate layout-heavy properties.
- Respect reduced motion.

## Conversion UX
Free users should understand value by using the live map. Pro prompts should be specific: watch this region, brief this dossier, export this source pack, create this alert. Never use vague upgrade copy.
