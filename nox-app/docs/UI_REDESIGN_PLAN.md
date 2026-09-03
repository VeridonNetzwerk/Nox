# Nox UI Redesign Plan

Based on the reference image: a dark, rounded, glassmorphism AI assistant popup with a glowing orb at the bottom, media widgets, and compact action cards.

## 1. Design Language

- **Shape**: Heavy rounded corners (`rounded-3xl` / `rounded-[32px]`), pill-shaped buttons.
- **Color**: Near-black surface with subtle gradients; cyan/accent glow (`--nox-accent`) for active states.
- **Texture**: Glassmorphism via `backdrop-blur-xl`, `bg-white/5`, `border-white/10`, subtle drop shadows.
- **Typography**: Clean sans-serif, larger titles for AI messages, small muted labels for secondary text.
- **Orb**: Central, glowing, animated sphere at the bottom of the window (the “personality” of Nox). It pulses when listening/speaking and becomes the visual focus.
- **Layout**: Single floating panel that expands vertically, organized as stacked cards rather than a full-screen window.

## 2. Overall Window Structure

```
┌─────────────────────────────┐
│  Nox floating window        │
│  (rounded-3xl, backdrop)    │
│                             │
│  ┌───────────────────────┐  │
│  │ Conversation stream   │  │
│  │ (bubbles, tool cards) │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ Quick action widgets  │  │
│  │ (home, files, music…) │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ Media widget (TTS)    │  │
│  └───────────────────────┘  │
│                             │
│        ╭───────╮            │
│        │  Orb  │            │  ← wake word / tap to talk
│        ╰───────╯            │
└─────────────────────────────┘
```

## 3. Components to Build / Refactor

### 3.1 `NoxOrb`
- Central glowing sphere at the bottom of the main window.
- States:
  - `idle`: slow ambient pulse / floating animation
  - `listening`: ripples / expanding rings, color shift to cyan
  - `thinking`: faster rotation / chromatic shimmer
  - `speaking`: waveforms projected onto the orb surface
- Accepts clicks to trigger voice input (microphone) or open chat.
- Use CSS radial-gradient + box-shadow + SVG filters.

### 3.2 `ChatBubble`
- Replace current plain text stream with message bubbles.
- User bubbles: right-aligned, muted background.
- Assistant bubbles: left-aligned, transparent with subtle accent border.
- Streaming text animates token-by-token as today, but inside a bubble.
- Tool results (notes, context, files) render as compact cards inside the assistant bubble.

### 3.3 `QuickActions` (home-automation-style cards)
- Horizontal or vertical stack of cards like the reference image.
- Examples:
  - **Auto Context** – let Nox scan the current window/clipboard.
  - **Remember** – save a note from the last message.
  - **Files** – search local documents.
  - **Settings** – open compact settings panel.
- Each card: icon + label + optional toggle/status.
- Initially visible when idle, collapses when conversation is active.

### 3.4 `MediaWidget`
- Bottom card showing the currently playing TTS response or audio playback.
- Displays:
  - Voice name / language
  - Progress bar of spoken text
  - Play / pause / stop controls
- Styled like the reference music player (dark card, neon progress bar).
- Disappears when idle.

### 3.5 `CompactInput`
- Replace the full-width input bar with a centered, rounded pill.
- Inside the pill: text input + mic icon + send icon.
- Expands when focused.
- When not focused, the pill can shrink to just the mic icon near the Orb.

### 3.6 `SettingsPanel` refactor
- Convert the existing full-screen settings into a side sheet or bottom sheet.
- Use the same card/glass style as the main window.
- Group settings into collapsible sections.

### 3.7 `OnboardingWizard` refactor
- Keep the step logic but apply the new visual language:
  - rounded-3xl cards instead of rectangles
  - central orb at the welcome step
  - floating step indicators
  - compact language/voice dropdowns matching the new design

## 4. Tailwind CSS Additions

Add these utilities to `index.css` / `tailwind.config.js`:

```css
.glass-panel {
  @apply rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40;
}

.glass-card {
  @apply rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors;
}

.glow-orb {
  @apply rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_40px_rgba(6,182,212,0.5)];
}

.accent-text-gradient {
  @apply bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent;
}
```

## 5. Animation & Interaction

- Orb ambient float: `animate-bounce` variant or custom keyframe.
- Orb listening rings: CSS `@keyframes ripple` with expanding rings on click.
- Cards: `transition-all duration-200` on hover, scale 1.01.
- Input pill: `transition-all duration-300` width/height changes.
- TTS progress bar: smooth width animation synced to audio playback time.
- Chat bubbles: staggered `animate-slide-in` on new messages.

## 6. Responsive / Desktop Considerations

- The Electron window is a compact floating window (approx 400–500px wide).
- Keep vertical stacking so everything fits without horizontal scroll.
- Conversation area should scroll internally; widgets and orb stay fixed at the bottom.
- Max height: 80vh; when content exceeds height, only the conversation scrolls.

## 7. Implementation Order (suggested)

1. **CSS foundation**: add glass-panel, glow-orb, and animation keyframes.
2. **NoxOrb component**: standalone, state-driven, placed in `App.jsx`.
3. **ChatBubble + CompactInput**: replace current message stream and input bar.
4. **MediaWidget**: show/hide based on TTS state.
5. **QuickActions**: add idle-time cards, hide when conversation is active.
6. **SettingsPanel**: convert to side sheet using the same card style.
7. **OnboardingWizard**: apply the new visual language.
8. **Polish**: micro-interactions, reduced-motion support, dark/light variants.

## 8. Open Questions

- Should the window remain always-on-top / compact floating, or expand to a larger chat window?
- Which widgets should be hardcoded vs. generated by the AI/tools dynamically?
- Should the media widget show the spoken sentence text or only the audio title?
- Do we want the orb to be the primary interaction trigger (tap-to-talk) or remain a visual indicator?
