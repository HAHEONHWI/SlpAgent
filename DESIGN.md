# SLP Agent Design System

## 1. Direction

A calm clinical workbench built around the supplied SLP Agent v2 design. Warm cream canvas, sage actions, and restrained peach details carry the existing leaf logo into a readable AI workspace. The memorable moment is the three-panel therapist desk: conversation history, evidence-based AI dialogue, and drafts awaiting therapist review.

## 2. Color tokens

Tailwind color utilities are mapped in `frontend/src/index.css`; use the semantic utility names below rather than raw colors.

| Role | Utility | Value | Usage |
|---|---|---|---|
| Canvas | `slate-50` | `#faf7f2` | App background |
| Surface | `white` | `#ffffff` | Navigation, cards, composer |
| Nested surface | `slate-100` | `#f3eee6` | Hover, user message, selected row |
| Primary text | `slate-900` | `#2b2722` | Main copy |
| Secondary text | `slate-500` | `#6b6359` | Hints and metadata |
| Border | `slate-200` | `#ece5da` | Panel and control separation |
| Strong divider | `slate-300` | `#ddd3c5` | Emphasis and input borders |
| Sage accent | `indigo-600` | `#2f7f6c` | Primary action, active navigation, focus |
| Sage hover | `indigo-700` | `#286b5c` | Primary action hover |
| Draft | `amber-*` | warm amber ramp | Unapproved clinical drafts |
| Approved | `green-*` | green ramp | Confirmed status |
| Error | `red-*` | red ramp | Errors and destructive actions |
| Peach | design token only | `#f5b99a` | Small decorative accents; never status or action |

Dark mode is not implemented. Clinical status colors stay separate from the sage brand accent.

## 3. Typography

Use `Pretendard Variable`, `Pretendard`, Apple SD Gothic Neo, Noto Sans KR, then system sans-serif. Body and controls use 14px or larger; captions may use 12px for metadata. Markdown answers keep semantic headings, lists, tables, links, and code.

## 4. Layout and spacing

Use the 4px spacing scale. From the medium breakpoint, AI dialogue uses a 13rem conversation-history rail on the left and a flexible reading column. Wide desktop adds an 18rem therapist-review rail. History and transcript each own vertical scrolling within bounded panels so their headers remain visible. On mobile, history opens as a left overlay from an explicit toggle; selecting a conversation closes it. Review remains collapsible below wide desktop. Avoid horizontal overflow. The global navigation collapses to a horizontally scrollable menu on mobile.

The AI workspace fills the available viewport height below the global header at every breakpoint. Its grid grows inside a bounded flex column; history and dialogue panels have no fixed viewport percentage height or minimum height. Keep the composer visible and scroll the transcript independently. Collapsible clinical review is limited to 40dvh below wide desktop.

Panels use 16px corners, controls 10px corners, dialogs 20px, and pills fully rounded. Use warm, low-contrast shadows only where a raised surface clarifies hierarchy.

## 5. Reusable primitives and states

| Primitive | Anatomy | States |
|---|---|---|
| `Button` | Sage primary or quiet secondary action | Default, hover, focus-visible, disabled |
| `Card` | White surface, warm divider, soft shadow | Default, empty |
| `Input` / `Select` / `Textarea` | White field with visible focus ring | Default, focus-visible, disabled |
| `Badge` | Compact rounded status label | Neutral, draft, approved, error, sage |
| Conversation row | Title, child/general label, selected wash | Default, hover, selected, disabled |
| Dialogue mode | Knowledge Q&A by default; clinical context selected explicitly | Knowledge, clinical, disabled while sending |
| Chat message | Role label, readable body, optional file chips | User, assistant, loading |
| Markdown answer | Semantic headings, lists, tables, code; external links as text, images as labels, HTML disabled | Default, long content |
| Citation tag | Source, document, page, optional test code | Evidence, missing page |
| Attachment chip | Safe filename and remove action | Pending, sent, disabled |
| Proposal review card | Draft kind, editable payload, review actions | Waiting, editing, invalid, saved |

Every AI response remains an unapproved draft until a therapist reviews it. Show source labels and pages near the supported answer. Never present unsupported clinical claims or invented norms.

## 6. Motion, depth, and accessibility

Keep transitions short and respect `prefers-reduced-motion`. Use a warm tinted shadow rather than a hard gray outline for elevation. Preserve visible keyboard focus, semantic landmarks, labeled file controls, and reflow at 390px without horizontal page scrolling.
