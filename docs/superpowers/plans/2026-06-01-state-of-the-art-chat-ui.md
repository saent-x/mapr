# State-of-the-Art Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the MAPR map chat from a functional bottom composer into a state-of-the-art, Codex-class intelligence workspace: calm, fast, keyboard-first, evidence-rich, responsive, and visually refined.

**Architecture:** Keep the map as the primary canvas and make chat the main command surface. Split the current monolithic composer into focused chat components and hooks, preserve Convex/RAG/search behavior, and move chat-specific styling into a dedicated stylesheet imported by the app. No new runtime dependency is required for the first implementation pass because `web/package.json` does not include a motion or icon library.

**Tech Stack:** React 19, Vite 6, Convex React, React Router, react-markdown, remark-gfm, existing SVG icon module, CSS variables, CSS transitions/animations, headless Chrome or in-app browser for visual verification.

---

## Current-State Evidence

This plan is based on the current worktree as of 2026-06-01.

- `web/src/components/Composer.jsx` is the current chat implementation. It owns suggestions, mode switching, textarea growth, submit behavior, assistant/search message rendering, citations, charts, region rows, anomaly rows, and result cards.
- `web/src/index.css` contains global app styling and the entire chat style block around the composer/thread selectors.
- `web/package.json` has no `framer-motion`, no Phosphor/Radix icon dependency, and no test runner dependency. The first pass should therefore use existing dependencies and CSS-only motion.
- The repository has a dirty worktree with many unrelated deletions and untracked migrated directories. Do not revert or clean unrelated files.

## Product Direction

### Visual Thesis

The MAPR chat should feel like a professional intelligence command surface: restrained dark tactical UI, soft machined glass, precise typography, minimal chrome, and amber used only for active state, focus, and grounded evidence.

### Interaction Thesis

1. The composer should feel like the command center: wide, calm, tactile, keyboard-first, and always ready.
2. The thread should feel like a transcript, not a stack of cards: readable assistant prose, compact user prompts, evidence rows, collapsed citations, and clear answer states.
3. Map actions should be treated as grounded outcomes of chat: filters, event sheets, region panels, and source links are exposed as evidence/action rows rather than decorative panels.

### Non-Goals

- Do not redesign the entire map, shell, account, admin, trend, region, workspace, or event pages.
- Do not add a landing page or marketing hero.
- Do not add heavy animation libraries in this pass.
- Do not change Convex API contracts unless a later backend task explicitly requires streaming or persisted conversation history.
- Do not make fake AI data, fake citations, or decorative response content.

## Definition of Done

The goal is complete only when all of these are true:

1. The detailed implementation plan exists in this file and is current.
2. The chat UI has been implemented according to this plan.
3. The app builds successfully with `cd web && npm run build`.
4. Desktop and mobile visual checks confirm the composer, thread, suggestions, mode controls, and evidence UI do not overlap or clip.
5. Core interactions are verified: type, send, clear, suggestion click, mode switch, enter/shift-enter behavior, and empty/error/thinking states.
6. A final summary is written with files changed, tests run, and any residual risks.

## Required Approval Gate

Before implementing production UI code, present this plan to the user and get approval to proceed. This gate exists because the requested work is a visual/product redesign with multiple valid directions.

Recommended approval prompt:

```text
I saved the implementation plan at docs/superpowers/plans/2026-06-01-state-of-the-art-chat-ui.md. Please confirm whether you want me to implement this plan as written, or list any changes first.
```

## File Structure

### Modify

- `web/src/components/Composer.jsx`
  - Keep the public `Composer` props unchanged.
  - Replace monolithic rendering with imported focused chat components and hooks.
  - Preserve existing Convex ask/search behavior.

- `web/src/index.css`
  - Remove or shrink the chat-specific CSS block after moving it to `chat.css`.
  - Keep global tokens and shared app styles.
  - Import chat CSS from `web/src/main.jsx` or `web/src/App.jsx` if the project pattern supports it.

- `web/src/main.jsx`
  - Import `./components/chat/chat.css` if chat CSS is split into a standalone file.

### Create

- `web/src/components/chat/useComposerController.js`
  - Own input, thinking state, messages, quota gating, submit flow, clear behavior, textarea growth, prompt history, and keyboard handling.

- `web/src/components/chat/ComposerSurface.jsx`
  - Presentational shell for suggestions, mode switch, composer input, footer, and thread.

- `web/src/components/chat/PromptInput.jsx`
  - Textarea, lead icon, send button, focus behavior, disabled/ready state, helper line.

- `web/src/components/chat/ModeSwitch.jsx`
  - Agent/Search segmented control and quota display.

- `web/src/components/chat/SuggestionRail.jsx`
  - Grouped, high-signal starter prompts.

- `web/src/components/chat/ChatThread.jsx`
  - Scroll container, auto-scroll behavior, new-message affordance, thread header.

- `web/src/components/chat/ChatMessage.jsx`
  - User and assistant message rendering.

- `web/src/components/chat/EvidenceRows.jsx`
  - Result rows, anomaly rows, region rows, severity/facet summary, and action links.

- `web/src/components/chat/CitationTray.jsx`
  - Collapsed source list and optional image strip.

- `web/src/components/chat/chatUtils.js`
  - `regionName`, `isSocial`, `ago`, `fmtReset`, suggestion groups, and small formatting helpers.

- `web/src/components/chat/chat.css`
  - All chat-specific selectors, responsive rules, reduced-motion rules, and interaction states.

### Optional Later

- `web/src/components/chat/__tests__/chatUtils.test.js`
  - Only if a test runner is added later. The current `web/package.json` has no test script.

## Design System Targets

### Layout Metrics

- Desktop composer width: `min(760px, calc(100vw - 48px))`.
- Large desktop composer width cap: `780px`.
- Mobile composer width: `calc(100vw - 20px)` with safe-area bottom padding.
- Composer bottom offset: `max(16px, env(safe-area-inset-bottom))`.
- Thread max height desktop: `min(58vh, 560px)`.
- Thread max height mobile: `min(48vh, 420px)`.
- Composer radius: `18px`.
- Thread panel radius: `18px`.
- Evidence rows radius: `10px`.
- Input font size: `14px` desktop, `16px` mobile to avoid iOS zoom.

### Color and Material

- Keep existing MAPR palette variables.
- Use `--amber` only for focus, active mode, send-ready state, and citation/evidence indices.
- Replace heavy black shadows with softer layered shadows:

```css
--chat-shadow: 0 18px 70px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.04);
--chat-line-soft: color-mix(in srgb, var(--line-2) 66%, transparent);
```

- Avoid pure black and neon effects.
- Use glass only for fixed/absolute overlay surfaces. Do not apply blur to scrolling inner content.

### Typography

- Keep `IBM Plex Sans` and `IBM Plex Mono` for now because they are already part of the app identity.
- Use sans for prompts and assistant prose.
- Reserve mono for metadata, status labels, citation numbers, counts, and shortcut hints.
- Increase assistant prose readability from `13px` to `14px` with line height `1.62`.
- Keep metadata compact at `9px-10px`.

### Motion

- Use CSS-only motion in this pass.
- Animate only `transform`, `opacity`, and border/background color.
- Use `cubic-bezier(0.16, 1, 0.3, 1)` for interaction transitions.
- Respect `prefers-reduced-motion`.
- Avoid perpetual decorative animation except the existing small typing dots and live status pulses.

## Task 1: Baseline and Safety

**Files:**
- Read: `web/src/components/Composer.jsx`
- Read: `web/src/index.css`
- Read: `web/package.json`
- Output: `/tmp/mapr-chat-before-desktop.png`
- Output: `/tmp/mapr-chat-before-mobile.png`

- [ ] **Step 1: Confirm current dependency constraints**

Run:

```bash
cd web && npm pkg get dependencies devDependencies
```

Expected: output confirms no motion/icon dependency is available beyond existing project packages.

- [ ] **Step 2: Capture desktop baseline**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/mapr-chat-before-desktop.png --window-size=1440,1000 --virtual-time-budget=8000 http://127.0.0.1:5173/
```

Expected: screenshot file exists. If it renders blank, record the blocker and use in-app browser screenshot instead.

- [ ] **Step 3: Capture mobile baseline**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/mapr-chat-before-mobile.png --window-size=390,844 --virtual-time-budget=8000 http://127.0.0.1:5173/
```

Expected: screenshot file exists. If it renders blank, record the blocker and use in-app browser screenshot instead.

- [ ] **Step 4: Build baseline**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0 before UI changes. If not, record current failure before implementation.

## Task 2: Extract Chat Utilities

**Files:**
- Create: `web/src/components/chat/chatUtils.js`
- Modify: `web/src/components/Composer.jsx`

- [ ] **Step 1: Create utility module**

Move these existing helpers without behavior changes:

```js
export const ISO2_NAME = {
  JP: "Japan",
  TR: "Turkiye",
  US: "United States",
  BE: "Belgium",
  SG: "Singapore",
  FR: "France",
  AR: "Argentina",
  IN: "India",
  EG: "Egypt",
  UA: "Ukraine",
  IL: "Israel",
  SS: "South Sudan",
  CN: "China",
  AU: "Australia",
  GB: "United Kingdom",
  CD: "DR Congo",
  YE: "Yemen",
  HK: "Hong Kong",
  MX: "Mexico",
  DE: "Germany",
  ZA: "South Africa",
  UZ: "Uzbekistan",
  BR: "Brazil",
  RU: "Russia",
  KR: "South Korea",
  SI: "Slovenia",
  CL: "Chile",
  IQ: "Iraq",
  IT: "Italy",
  CH: "Switzerland",
  ET: "Ethiopia",
  BD: "Bangladesh",
};

export const SUGGESTION_GROUPS = [
  {
    label: "Brief",
    prompts: ["Brief me on the last hour", "Top 5 by severity"],
  },
  {
    label: "Filter",
    prompts: ["Red-tier conflict events", "Cyber activity in Europe"],
  },
  {
    label: "Detect",
    prompts: ["What's spiking right now?"],
  },
];

export const regionName = (iso) => ISO2_NAME[iso] || iso;
export const isSocial = (src) => /^(bluesky|mastodon)/i.test(src || "");

export function ago(ts) {
  const seconds = Math.max(0, (Date.now() - ts) / 1000);
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function fmtReset(ts) {
  if (!ts) return "next period";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
```

Implementation note: The current code uses `"Turkiye"` with a non-ASCII character. The new file should stay ASCII unless the project explicitly standardizes on non-ASCII country names.

- [ ] **Step 2: Import helpers in `Composer.jsx`**

Expected import:

```js
import { SUGGESTION_GROUPS, ago, fmtReset, isSocial, regionName } from "./chat/chatUtils.js";
```

- [ ] **Step 3: Replace flat suggestions**

Replace `SUGGESTIONS.map(...)` usage with grouped rendering through `SuggestionRail` in a later task. Until then, derive:

```js
const suggestions = SUGGESTION_GROUPS.flatMap((group) => group.prompts);
```

- [ ] **Step 4: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 3: Extract Composer State Controller

**Files:**
- Create: `web/src/components/chat/useComposerController.js`
- Modify: `web/src/components/Composer.jsx`

- [ ] **Step 1: Extract state and actions**

Create a hook with this public API:

```js
export function useComposerController({
  convex,
  ask,
  quota,
  isAuthed,
  onNeedAuth,
  onResult,
}) {
  return {
    messages,
    input,
    setInput,
    thinking,
    aiMode,
    setAiMode,
    agentMode,
    canUseAgent,
    agentBlocked,
    hasThread,
    submit,
    clearThread,
    onKeyDown,
    growTextarea,
    registerPromptHistory,
  };
}
```

- [ ] **Step 2: Preserve current submit behavior**

Behavior must remain:

- Empty prompt does nothing.
- While thinking, submit does nothing.
- Agent mode calls `ask({ text: q })`.
- Search mode calls `convex.query(anyApi.events.intentSearch, { text: q })`.
- Search results still call `onResult(parsed.eventIds, parsed.scope)`.
- Errors still produce friendly assistant messages.
- Clear still empties messages and resets map result through `onResult(null, null)`.

- [ ] **Step 3: Add prompt history behavior**

Add these keyboard rules:

- `Enter`: submit.
- `Shift+Enter`: newline.
- `ArrowUp` with empty textarea: restore previous submitted prompt.
- `ArrowDown` after history navigation: move forward.
- `Escape`: blur textarea.

The hook should store prompt history in local state only. Do not persist history.

- [ ] **Step 4: Add scroll intent state**

Add a thread scroll helper state:

- Auto-scroll only if the user is already near the bottom.
- If the user has scrolled up and a new message arrives, expose `hasUnreadBelow`.
- Clicking the unread affordance scrolls to bottom.

- [ ] **Step 5: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 4: Create Presentational Chat Components

**Files:**
- Create: `web/src/components/chat/ComposerSurface.jsx`
- Create: `web/src/components/chat/PromptInput.jsx`
- Create: `web/src/components/chat/ModeSwitch.jsx`
- Create: `web/src/components/chat/SuggestionRail.jsx`
- Modify: `web/src/components/Composer.jsx`

- [ ] **Step 1: Create `ComposerSurface`**

Responsibilities:

- Own outer DOM order.
- Render thread only when `hasThread` is true.
- Render suggestions only when `hasThread` is false.
- Render mode switch, input, and footer consistently.

Expected component shape:

```jsx
export function ComposerSurface({
  eventCount,
  quota,
  isAuthed,
  agentMode,
  canUseAgent,
  aiMode,
  setAiMode,
  input,
  setInput,
  thinking,
  hasThread,
  messages,
  threadRef,
  textareaRef,
  submit,
  clearThread,
  onNeedAuth,
  onKeyDown,
  growTextarea,
  onOpenEvent,
  onPickRegion,
}) {
  return (
    <div className="chat-shell">
      {/* thread, suggestions, mode switch, prompt input, footer */}
    </div>
  );
}
```

- [ ] **Step 2: Create `PromptInput`**

Markup target:

```jsx
export function PromptInput({
  input,
  textareaRef,
  agentMode,
  thinking,
  onChange,
  onKeyDown,
  onSubmit,
}) {
  const ready = input.trim().length > 0;
  return (
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <span className="chat-composer__lead" aria-hidden>{agentMode ? SparkIco : MapIco}</span>
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={agentMode ? "Ask MAPR about live events..." : "Filter by tier, region, category, or time..."}
        aria-label={agentMode ? "Ask MAPR Agent" : "Search live feed"}
      />
      <button className="chat-composer__send" data-ready={ready} disabled={!ready || thinking} type="submit" title="Send">
        {SendIco}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Create `ModeSwitch`**

Requirements:

- Use `role="group"` and `aria-label="Chat mode"`.
- Show Agent as locked if user is signed out or quota exhausted.
- Call `onNeedAuth` when signed-out users choose Agent.
- Keep Search available without auth.
- Keep quota copy compact.

- [ ] **Step 4: Create `SuggestionRail`**

Requirements:

- Group prompts by intent labels.
- Use horizontal scroll on small screens instead of wrapping into multiple rows.
- Do not display more than five starter prompts.
- Add `type="button"` to all buttons.

- [ ] **Step 5: Replace `Composer.jsx` render with the shell**

`Composer.jsx` should become orchestration:

```jsx
export default function Composer(props) {
  const convex = useConvex();
  const ask = useAction(anyApi.rag.ask);
  const quota = useQuery(anyApi.qa.quotaStatus, {});
  const threadRef = useRef(null);
  const textareaRef = useRef(null);
  const controller = useComposerController({ convex, ask, quota, ...props });

  return (
    <ComposerSurface
      {...props}
      {...controller}
      quota={quota}
      threadRef={threadRef}
      textareaRef={textareaRef}
    />
  );
}
```

- [ ] **Step 6: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 5: Rebuild the Thread as a Transcript

**Files:**
- Create: `web/src/components/chat/ChatThread.jsx`
- Create: `web/src/components/chat/ChatMessage.jsx`
- Create: `web/src/components/chat/EvidenceRows.jsx`
- Create: `web/src/components/chat/CitationTray.jsx`
- Modify: `web/src/components/Composer.jsx`

- [ ] **Step 1: Move existing visual subcomponents**

Move these from `Composer.jsx` into chat-specific component files:

- `NewsImage`
- `ResultCard` renamed to `EvidenceEventRow`
- `Sparkline`
- `AnomalyCards` renamed to `AnomalyRows`
- `RegionCards` renamed to `RegionRows`
- `Citations` renamed to `CitationTray`
- `CitationGallery` renamed to `CitationImageStrip`
- `RichAnswer`
- `FacetChart` renamed to `FacetSummary`

- [ ] **Step 2: Change result cards into evidence rows**

Visual behavior:

- Closed state is a dense row, not a boxed card.
- Severity pill, title, metadata, and actions fit in one scan path.
- Expanded state shows image, summary, facts, tags, and actions.
- `View page`, `Quick view`, and `Source` remain.

- [ ] **Step 3: Make assistant answers more readable**

Requirements:

- Assistant answer text uses sans-serif prose at `14px`.
- Markdown list spacing is comfortable.
- Tables remain compact but readable.
- Inline code is visible but not visually dominant.
- Citations appear below the answer as source chips or collapsed rows.

- [ ] **Step 4: Improve thinking state**

Replace generic three-dot-only state with a skeleton that matches final layout:

```jsx
<div className="chat-thinking" aria-label="MAPR is analyzing live events">
  <span className="chat-thinking__line" />
  <span className="chat-thinking__line short" />
  <span className="chat-thinking__dots"><i /><i /><i /></span>
</div>
```

- [ ] **Step 5: Add empty and error state components**

Empty state is the default no-thread suggestions state.

Error state requirements:

- Quota exhausted: include upgrade/sign-in action where applicable.
- Bad QA output: offer narrower examples.
- Generic failure: clear wording and retry hint.

- [ ] **Step 6: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 6: Move Chat CSS Into Dedicated File

**Files:**
- Create: `web/src/components/chat/chat.css`
- Modify: `web/src/index.css`
- Modify: `web/src/main.jsx`

- [ ] **Step 1: Import chat CSS**

Add to `web/src/main.jsx` after global CSS import:

```js
import "./components/chat/chat.css";
```

- [ ] **Step 2: Move chat selectors**

Move and rename the current chat selectors:

- `.composer-wrap` to `.chat-shell`
- `.composer` to `.chat-composer`
- `.composer-lead` to `.chat-composer__lead`
- `.composer-send` to `.chat-composer__send`
- `.composer-foot` to `.chat-footer`
- `.mode-toggle-row` to `.chat-mode-row`
- `.mode-toggle` to `.chat-mode`
- `.mode-btn` to `.chat-mode__button`
- `.composer-suggest` to `.chat-suggestions`
- `.suggest-chip` to `.chat-suggestion`
- `.asst-thread-card` to `.chat-thread-card`
- `.asst-thread` to `.chat-thread`
- `.asst-user` to `.chat-message--user`
- `.asst-reply` to `.chat-message--assistant`

Keep old selectors only temporarily if needed for a safe migration, then remove them once all JSX uses new names.

- [ ] **Step 3: Add state-of-the-art shell CSS**

Target CSS:

```css
:root {
  --chat-shell-width: min(780px, calc(100vw - 48px));
  --chat-radius: 18px;
  --chat-shadow: 0 18px 70px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --chat-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-shell {
  position: absolute;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 30;
  width: var(--chat-shell-width);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.chat-shell > * {
  pointer-events: auto;
}

.chat-composer {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 38px;
  align-items: end;
  gap: 10px;
  padding: 11px 10px 11px 14px;
  border: 1px solid color-mix(in srgb, var(--line-2) 72%, transparent);
  border-radius: var(--chat-radius);
  background: color-mix(in srgb, var(--bg-2) 88%, transparent);
  box-shadow: var(--chat-shadow);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition: border-color 180ms var(--chat-ease), background 180ms var(--chat-ease), transform 180ms var(--chat-ease);
}

.chat-composer:focus-within {
  border-color: color-mix(in srgb, var(--amber) 72%, var(--line-2));
  background: color-mix(in srgb, var(--bg-2) 94%, transparent);
}

.chat-composer textarea {
  min-height: 24px;
  max-height: 144px;
  padding: 2px 0;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--ink-0);
  font: 400 14px/1.55 var(--ff-sans);
}

.chat-composer__send {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: var(--bg-3);
  color: var(--ink-2);
  transition: transform 160ms var(--chat-ease), background 160ms var(--chat-ease), color 160ms var(--chat-ease);
}

.chat-composer__send[data-ready="true"] {
  background: var(--amber);
  color: var(--bg-0);
  border-color: var(--amber);
}

.chat-composer__send:active {
  transform: translateY(1px) scale(0.98);
}
```

- [ ] **Step 4: Add responsive CSS**

Required:

```css
@media (max-width: 900px) {
  .chat-shell {
    width: calc(100vw - 24px);
    bottom: max(12px, env(safe-area-inset-bottom));
  }

  .chat-thread-card {
    max-height: min(50vh, 460px);
  }
}

@media (max-width: 560px) {
  .chat-shell {
    width: calc(100vw - 16px);
    gap: 8px;
  }

  .chat-composer {
    grid-template-columns: 22px minmax(0, 1fr) 38px;
    border-radius: 16px;
  }

  .chat-composer textarea {
    font-size: 16px;
  }

  .chat-footer {
    display: none;
  }

  .chat-mode-row {
    align-self: stretch;
    justify-content: space-between;
  }

  .chat-suggestions {
    justify-content: flex-start;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding: 0 2px 2px;
  }
}
```

- [ ] **Step 5: Add reduced motion guard**

Required:

```css
@media (prefers-reduced-motion: reduce) {
  .chat-shell *,
  .chat-shell *::before,
  .chat-shell *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 6: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 7: Interaction Polish

**Files:**
- Modify: `web/src/components/chat/useComposerController.js`
- Modify: `web/src/components/chat/ChatThread.jsx`
- Modify: `web/src/components/chat/PromptInput.jsx`
- Modify: `web/src/components/chat/chat.css`

- [ ] **Step 1: Add accessible disabled send behavior**

Send button requirements:

- Disabled when input is empty or request is thinking.
- `aria-disabled` mirrors disabled state.
- `title` changes between `Send` and `Enter a prompt`.

- [ ] **Step 2: Add focus recovery**

After submit:

- Keep focus in textarea on desktop.
- On touch/mobile, keep focus only if the virtual keyboard is already open.
- Do not forcibly steal focus after suggestion click if browser behavior feels jarring.

- [ ] **Step 3: Add unread affordance**

When user scrolls up and new content arrives:

- Show small centered pill above composer: `New answer`.
- Clicking it scrolls the thread to bottom.
- It should not overlap the input.

- [ ] **Step 4: Add clear confirmation only when needed**

No modal. Keep clear immediate if thread has one or two messages.

If thread has more than two messages, first click changes the clear button label to `Confirm clear` for two seconds; second click clears.

- [ ] **Step 5: Run build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 8: Visual Verification

**Files:**
- Output: `/tmp/mapr-chat-after-desktop.png`
- Output: `/tmp/mapr-chat-after-mobile.png`
- Output: `/tmp/mapr-chat-after-thread.png`

- [ ] **Step 1: Start or confirm dev server**

If the server is already running on `127.0.0.1:5173`, use it. Otherwise run:

```bash
cd web && npm run dev -- --host 127.0.0.1
```

- [ ] **Step 2: Capture desktop empty state**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/mapr-chat-after-desktop.png --window-size=1440,1000 --virtual-time-budget=8000 http://127.0.0.1:5173/
```

Expected:

- Composer visible at bottom center.
- Suggestions visible and not clipped.
- Mode switch visible and not competing with prompt.
- Map controls do not overlap composer.

- [ ] **Step 3: Capture mobile empty state**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/mapr-chat-after-mobile.png --window-size=390,844 --virtual-time-budget=8000 http://127.0.0.1:5173/
```

Expected:

- Composer fits within viewport.
- Suggestions are horizontally scrollable or fit.
- Footer is hidden or compact.
- Input text is at least `16px`.

- [ ] **Step 4: Manually test one search path in the browser**

Use the in-app browser or Chrome:

1. Click Search mode.
2. Type `red-tier conflict events`.
3. Press Enter.
4. Verify result banner appears.
5. Verify assistant reply appears.
6. Verify evidence rows render and can expand.
7. Click clear.

Expected: no visual overlap, no console runtime error, map filter updates.

- [ ] **Step 5: Manually test one agent path**

If signed in and quota allows:

1. Click Agent mode.
2. Ask `Brief me on the last hour`.
3. Verify answer text, citations, and source tray render.

If signed out:

1. Click Agent mode.
2. Verify it routes to sign-in or presents gated copy without breaking Search mode.

- [ ] **Step 6: Capture thread state**

After generating a Search response, capture:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/mapr-chat-after-thread.png --window-size=1440,1000 --virtual-time-budget=8000 http://127.0.0.1:5173/
```

If the headless browser cannot reproduce app state, use the in-app browser screenshot instead.

## Task 9: Final Verification and Summary

**Files:**
- Read: `git diff -- web/src/components web/src/main.jsx web/src/index.css docs/superpowers/plans/2026-06-01-state-of-the-art-chat-ui.md`

- [ ] **Step 1: Run production build**

Run:

```bash
cd web && npm run build
```

Expected: exit 0.

- [ ] **Step 2: Inspect diff**

Run:

```bash
git diff -- web/src/components web/src/main.jsx web/src/index.css docs/superpowers/plans/2026-06-01-state-of-the-art-chat-ui.md
```

Expected:

- Diff only includes intended chat UI and plan changes.
- No unrelated deletions are reverted.
- `Composer` public props remain compatible with `MapPage`.

- [ ] **Step 3: Final acceptance checklist**

Verify:

- [ ] Composer is wider, softer, and more command-center-like.
- [ ] Agent/Search mode is quieter and clearer.
- [ ] Suggestions are grouped by user intent.
- [ ] Thread reads as a transcript.
- [ ] Evidence rows replace heavy card feel.
- [ ] Citations are still grounded and accessible.
- [ ] Keyboard interactions still work.
- [ ] Mobile layout does not clip or overlap.
- [ ] Reduced motion is respected.
- [ ] Build passes.

- [ ] **Step 4: Final response**

The final response must include:

- Summary of implementation.
- Files changed.
- Verification commands run and outcomes.
- Screenshot paths if generated.
- Residual risks or blockers.

## Task 10: Lean Spatial Context Addendum

**Reason:** The implementation scope expanded from an industry-standard chat surface to a chat/map interaction model that feels native to MAPR's FlatMap and Globe modes. A first pass added a separate spatial deck, but browser review showed that it duplicated existing map controls and made the UI too bulky. The final direction keeps map awareness but removes the extra deck.

**Files:**
- Modify: `web/src/pages/MapPage.jsx`
- Modify: `web/src/components/Composer.jsx`
- Modify: `web/src/components/chat/ComposerSurface.jsx`
- Modify: `web/src/components/chat/PromptInput.jsx`
- Modify: `web/src/components/chat/SuggestionRail.jsx`
- Modify: `web/src/components/chat/ChatThread.jsx`
- Modify: `web/src/components/chat/chat.css`

- [x] **Step 1: Pass spatial state into chat**

Pass projection mode, heat-layer state, active region, and active event from `MapPage` into `Composer`.

- [x] **Step 2: Use existing map controls for projection changes**

Do not duplicate FlatMap/Globe/Heat controls in the chat. The right-side map controls remain the single control surface for projection and layers.

- [x] **Step 3: Keep chat context-aware without adding controls**

Pass heat-layer state into chat so transcript context can mention it, but avoid adding a separate heat button inside the composer.

- [x] **Step 4: Make prompts projection-aware**

Change suggestions and placeholders based on FlatMap vs Globe context:

- FlatMap focuses on clusters, local spikes, and severity density.
- Globe focuses on spillover, cross-border pressure, maritime routes, and global projection.

- [x] **Step 5: Make the thread projection-aware**

Show FlatMap/Globe context in the thread header, and include focused region plus heat state when available.

- [x] **Step 6: Add restrained projection-aware styling**

Use warm amber for FlatMap and cyan for Globe on the composer focus, send action, assistant mark, and thread status only. Avoid ambient halos and extra panels.

- [x] **Step 7: Verify interaction path**

Use browser automation against `http://127.0.0.1:5173/`:

- FlatMap initial state renders and map controls show Flat map active.
- The bulky `chat-spatial-deck` is not present.
- Clicking Globe in the existing map controls switches the chat to Globe context.
- Mobile 390px layout has no horizontal overflow and stays above the app status bar.

## Risk Register

- **Blank headless screenshot risk:** Earlier headless Chrome attempts may render a blank page if runtime dependencies or Convex state are unavailable. Mitigation: use in-app browser verification and report the headless limitation.
- **No automated UI test runner:** `web/package.json` has no test script. Mitigation: use `npm run build`, manual browser checks, and screenshot checks.
- **Large existing dirty worktree:** Many unrelated files are deleted/untracked. Mitigation: touch only `web/src/components/chat`, `web/src/components/Composer.jsx`, `web/src/main.jsx`, `web/src/index.css`, and this plan.
- **Agent auth/quota state:** Agent mode depends on auth/quota. Mitigation: verify signed-out gating and Search mode at minimum; verify Agent if a signed-in session is available.
- **CSS global collision:** Existing selectors are global. Mitigation: use `chat-*` class namespace and move chat CSS into a dedicated file.

## Implementation Notes

- Keep all visible copy operational, not marketing-oriented.
- Use no emojis in UI, code, alt text, or final copy.
- Avoid adding a dependency until there is a concrete need.
- If a future task introduces `framer-motion` or an icon package, update `web/package.json` intentionally and document the install command.
- Use `apply_patch` for manual file edits.
- Keep comments rare and only where they clarify non-obvious state flow.
