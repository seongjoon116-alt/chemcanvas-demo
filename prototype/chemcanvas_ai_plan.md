# ChemCanvas AI — Project Context & Implementation Plan

## Overview

ChemCanvas AI is a natural-language-driven 3D chemistry education platform. Students type questions in plain Korean or English (e.g. "H-Br이 어떻게 첨가돼?"), and the system responds by rendering interactive 3D molecular models and animated reaction sequences in the browser. Molecular structure data is sourced exclusively from PubChem via MCP to ensure factual accuracy. The core design principle is **trustworthy interactivity**: every visual is grounded in real chemical data, and every element in the 3D scene is manipulable and queryable by the user.

**Target user:** High school and university chemistry students learning organic chemistry concepts (stereochemistry, reaction mechanisms, molecular geometry).

**Core design principle:** Real PubChem data → LLM-generated animation scenario → Three.js render. The LLM never invents molecular coordinates; it only orchestrates how verified data is visualized.

---

## Current Status

The project currently has:

1. **`pitch_demo.html`** — A self-contained static demo that hardcodes a single reaction: `(R)-3-chloro-1-butene + HBr → (2R,3R) product` via Markovnikov addition. This file demonstrates the intended UX and visual style but has no live AI or PubChem connection.
2. **Architecture diagram** (sequence diagram image) — Shows the intended 3-stage pipeline with 6 components.

The next step is to evolve the demo into a working system by replacing hardcoded molecule data and scripted chat responses with a live AI orchestrator and PubChem MCP integration.

---

## System Architecture

```
User (browser)
      ↓  natural language string (Korean/English)
Frontend — Web UI + Three.js (React or Vanilla JS)
      ↓  POST /api/query { userMessage, sessionId, currentMoleculeContext }
AI Orchestrator (Node.js or Python server)
      ↓  { userMessage, context } → system prompt + tool definitions
LLM (Claude claude-sonnet-4-20250514 via Anthropic API)
      ↓  tool_use: { tool: "get_molecule_3d", params: { name: "HBr" } }
PubChem MCP Server  ←→  PubChem REST API (external DB)
      ↓  SDF / JSON with 3D coordinates + properties
AI Orchestrator (receives tool result, sends back to LLM)
      ↓  LLM returns AnimationScenario JSON
Frontend
      ↓  Three.js renders atoms/bonds; GSAP animates reaction steps
User sees interactive 3D reaction, can rotate/hover/query further
```

---

## Component Descriptions

### 1. Frontend (`/frontend`)

**Technology:** Vanilla JS + Three.js + GSAP (as in current demo), or React if tab management requires state complexity.

**Responsibilities:**
- Renders the 3D scene using Three.js (atom spheres, bond cylinders, orbital lobes)
- Animates reaction sequences using GSAP timelines driven by `AnimationScenario` JSON from the server
- Displays AI chat panel (message history, suggestion buttons, text input)
- Handles orbit controls (drag to rotate, scroll to zoom)
- Hover tooltips: when cursor is over an atom mesh, show element symbol, formal charge, hybridization
- Multi-tab support: each browser tab maintains its own independent molecule context
- Sends user messages to `/api/query` and applies returned `AnimationScenario`

**Key files (current demo):**
- `pitch_demo.html` — monolithic demo; will be refactored into modules

---

### 2. AI Orchestrator (`/server`)

**Technology:** Node.js (Express) or Python (FastAPI)

**Responsibilities:**
- Receives user query + session context
- Constructs prompt for LLM with tool definitions (PubChem MCP tools)
- Manages multi-turn conversation history per `sessionId`
- Calls Anthropic API, handles `tool_use` responses by routing to PubChem MCP
- Returns final `AnimationScenario` JSON to frontend
- Persists session history to DB

---

### 3. LLM (Claude via Anthropic API)

**Model:** `claude-sonnet-4-20250514`

**Role in pipeline:**
- **Stage 1 — Intent Analysis:** Parses user's natural language, identifies reaction type (addition, substitution, elimination, etc.), determines which molecules are involved, decides which PubChem tools to call
- **Stage 3 — Scenario Generation:** Given verified PubChem 3D coordinates and properties, generates `AnimationScenario` JSON describing exactly how to animate the reaction

---

### 4. PubChem MCP Server

**Integration:** MCP (Model Context Protocol) — the LLM calls PubChem tools natively as `tool_use` blocks.

**Key tools used:**
- `get_compound_3d_conformer(name)` → SDF file with 3D atom coordinates
- `get_compound_properties(cid)` → molecular weight, formula, IUPAC name, charge
- `get_compound_by_smiles(smiles)` → lookup by SMILES string

**Why MCP matters:** The LLM cannot hallucinate molecular coordinates because it must retrieve them via tool call. The orchestrator verifies tool results before passing them back.

---

## Data Models

```typescript
// Sent from server to frontend after LLM completes
interface AnimationScenario {
  title: string;                    // e.g. "Markovnikov HBr Addition to (R)-3-chloro-1-butene"
  reactionType: string;             // e.g. "electrophilic_addition"
  molecules: MoleculeData[];        // all molecules involved
  steps: AnimationStep[];           // ordered sequence of animation events
  product?: MoleculeData;           // final product if reaction completes
}

interface MoleculeData {
  pubchemCid: number;
  name: string;
  iupacName: string;
  formula: string;
  atoms: Atom3D[];
  bonds: Bond[];
}

interface Atom3D {
  id: string;                       // e.g. "C1", "Br_ion"
  element: string;                  // "C" | "H" | "O" | "N" | "Cl" | "Br" | ...
  position: { x: number; y: number; z: number };  // Angstroms from PubChem
  formalCharge?: number;
  hybridization?: "sp" | "sp2" | "sp3";
  label?: string;                   // display label, e.g. "CH₃"
}

interface Bond {
  atom1Id: string;
  atom2Id: string;
  order: 1 | 2 | 3;                // single, double, triple
}

interface AnimationStep {
  stepId: number;
  type: AnimationStepType;
  description: string;              // Korean text shown in chat, e.g. "Br⁻ 이온이 빈 p-오비탈로 접근합니다"
  duration: number;                 // milliseconds
  targets: AnimationTarget[];       // what moves/appears/disappears
}

type AnimationStepType =
  | "approach"          // reagent moves toward molecule
  | "bond_break"        // bond disappears with animation
  | "bond_form"         // new bond appears
  | "rotate_view"       // camera moves to new angle (e.g. Newman projection)
  | "highlight"         // atom/bond glows to draw attention
  | "inversion"         // umbrella inversion (Walden inversion)
  | "show_orbital"      // p-orbital lobe appears
  | "hide_orbital"      // p-orbital lobe disappears
  | "label_show";       // badge/label fades in (e.g. "(2R,3R)")

interface AnimationTarget {
  atomId?: string;
  bondId?: string;
  property: "position" | "visible" | "scale" | "camera" | "opacity";
  to: unknown;                      // value depends on property type
  ease?: string;                    // GSAP ease string, e.g. "power2.inOut"
}

// Sent from frontend to server
interface QueryRequest {
  sessionId: string;
  userMessage: string;
  currentMoleculeContext?: {        // what's currently on screen
    molecules: string[];            // molecule names
    reactionStep: number;
  };
}

// Stored per session
interface SessionState {
  sessionId: string;
  history: { role: "user" | "assistant"; content: string }[];
  currentScenario?: AnimationScenario;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Current Demo — `pitch_demo.html` — Detailed Breakdown

### What it demonstrates

The demo is a **static, hardcoded** single-page application showing one specific moment in a reaction: the carbocation intermediate of `(R)-3-chloro-1-butene` after H⁺ addition, with three interactive demo prompts.

### Layout

```
┌─────────────────────────────────────┬──────────────────────┐
│  3D Viewer Pane (flex: 7)           │  AI Chat Pane        │
│                                     │  (flex: 3, min 380px)│
│  Three.js canvas                    │                      │
│  ┌─ header overlay (top-left)       │  Chat header         │
│  └─ legend (bottom-left, glass)     │  Message history     │
│  result-badge (top-right, glass)    │  Suggestion buttons  │
│                                     │  Input (disabled)    │
└─────────────────────────────────────┴──────────────────────┘
```

### 3D Scene Construction

**Atom rendering:**
- `SphereGeometry(radius, 64, 64)` + `MeshLambertMaterial`
- Radii: `{ H: 0.3, C: 0.6, Cl: 0.9, Br: 1.0, CH3: 0.9 }` (not to CPK scale — optimized for clarity)
- Colors: `{ C: #222222, H: #ffffff, Cl: #00d82c, Br: #ff00ff, CH3: #00d2ff }`

**Bond rendering:**
- `CylinderGeometry(0.12, 0.12, 1.0, 32)` scaled and rotated to span between atom positions
- `dynamicBonds[]` array: bonds tracked by `{ mesh, p1 (static Vector3), p2Obj (live atom mesh) }` — updated every frame so bonds stretch in real time during animation

**p-Orbital visualization:**
- Two elongated spheres (`SphereGeometry(0.6).scale(1, 2, 1)`) positioned at `±1.2` on Y axis from C2
- Transparent blue (`opacity: 0.4`, `emissiveIntensity: 0.5`)
- Disappear (`scale → 0`) when Br⁻ attacks and bond forms

**Lighting:**
- `AmbientLight(0xffffff, 0.7)`
- `HemisphereLight(sky, ground, 0.5)`
- `DirectionalLight` at `(10, 15, 10)` with shadow map `2048×2048`
- `PointLight(blue, 0.8)` at `(-10, -10, -10)` for backlight glow

**Camera & Controls:**
- `PerspectiveCamera(fov: 60)` starting at `(6, 4, 8)`
- `OrbitControls` with damping (`dampingFactor: 0.05`)
- Gentle idle rotation: `molecule.rotation.y = sin(time * 0.001) * 0.2` when not in Newman view

### Hardcoded Molecule Coordinates (C2 Carbocation)

```javascript
// C3 (back carbon, tetrahedral, carries Cl)
C3:    (0,    0,    -1.5)
C3_Cl: (1.5,  0.5,  -2.5)  // Cl substituent
C3_H:  (-1.2, 0.8,  -2.5)  // H substituent
C3_Me: (0,    -1.8, -2.5)  // CH3 substituent

// C2 (front carbon, sp2 carbocation, has empty p-orbital)
C2:    (0,    0,     1.5)
C2_Me: (1.56, 0,     2.4)  // CH3 substituent (120°)
C2_H:  (-1.56, 0,    2.4)  // H substituent (120°)
// p-orbital lobes at C2 ± (0, 1.2, 0)

// Br- ion (hidden initially, appears for demo-2)
Br_start: (-4, 6, 1.5)  → attacks from top-left (low steric hindrance side)
Br_final:  (0,  1.697, 2.1)
```

### Three Demo Interactions

**Demo 1 — Newman Projection:**
- User clicks "뉴먼 투영도 각도로 돌려서 입체 장애 보여줘"
- GSAP animates camera to `(0, 0, 10)` — looking straight down C2→C3 bond axis
- Chat explains why Cl blocks the right side

**Demo 2 — Br⁻ Attack Simulation:**
- Br⁻ ion appears at `(-4, 6, 1.5)` (top-left, away from Cl steric bulk)
- GSAP timeline:
  1. Br⁻ approaches to `(-1.5, 3.0, 1.5)` (1.5s)
  2. At "attack" label (simultaneous):
     - Bond created dynamically between C2 and Br⁻
     - Br⁻ plunges to final position `(0, 1.697, 2.1)`
     - p-orbital group scales to 0
     - C2_Me inverts to `(1.47, -0.85, 2.1)`
     - C2_H inverts to `(-1.47, -0.85, 2.1)`
  3. Result badge `(2R,3R)` fades in
- This simulates **Walden inversion** / backside attack (anti-addition)

**Demo 3 — Reset:**
- Restores all atom positions, hides Br⁻, restores p-orbital, removes Br bond from `dynamicBonds`, resets camera

### Chat UI (Static)

- Initial AI message hardcoded in HTML
- `addMessage(text, sender)` appends `<div class="message ai|user">` to `#chat-messages`
- `showTyping()` / `removeTyping()` simulate AI "thinking" with CSS dot animation
- Input field and send button are **disabled** (demo only)
- Suggestion buttons trigger `setTimeout` delays to simulate AI response latency (1200ms–1500ms)

### Visual Design System

- **Color palette:** White background, `#333333` text, `#339af0` blue accent, `#ff00ff` magenta for Br/product
- **Glassmorphism:** `.glass { background: rgba(255,255,255,0.7); backdrop-filter: blur(12px); border: 1px solid rgba(0,0,0,0.05) }`
- **Font:** Pretendard (Google Fonts CDN)
- **Border radius:** 10–14px throughout

---

## Phase Overview

| Phase | Name | Depends on | Testable standalone? |
|-------|------|------------|----------------------|
| 1 | Static demo refactor + scene engine | — | Yes |
| 2 | AI Orchestrator + Anthropic API | Phase 1 | Yes |
| 3 | PubChem MCP integration | Phase 2 | Yes |
| 4 | Session persistence + multi-tab UX | Phase 3 | Yes |

---

## Phase 1 — Static Demo Refactor + Scene Engine

### 1-1. Goal

Refactor `pitch_demo.html` into a modular codebase where the 3D scene is driven by an `AnimationScenario` JSON object, not hardcoded coordinates. After Phase 1, any valid `AnimationScenario` JSON pasted into a test harness should produce the correct 3D scene and animation without touching scene logic.

### 1-2. Components

**File:** `frontend/src/scene/SceneManager.js`

**Purpose:** Owns the Three.js scene, camera, renderer, and controls. Exposes methods to build and animate molecules from data.

**Inputs:**
- `init(canvasEl: HTMLCanvasElement): void`
- `loadScenario(scenario: AnimationScenario): void`
- `playStep(stepId: number): Promise<void>`
- `resetScene(): void`

**Output:** Side effects on the Three.js canvas. Returns `Promise<void>` for `playStep` (resolves when GSAP timeline completes).

**Behavior:**
- `loadScenario` clears the scene, creates atom meshes and bond cylinders from `scenario.molecules[].atoms` and `.bonds`
- Atom radii and colors mapped from element symbol (extend current demo's lookup tables)
- Bond rendering uses the existing `dynamicBonds` update pattern (track live atom positions each frame)
- `playStep(stepId)` reads `scenario.steps[stepId].targets` and builds a GSAP timeline, then resolves
- Hover tooltip: `raycaster` on `mousemove`; finds intersected atom mesh, emits `atomHover(atomId)` custom event

**File:** `frontend/src/scene/AtomFactory.js`

**Purpose:** Creates Three.js mesh for a given `Atom3D`.

**Inputs:** `atom: Atom3D, scene: THREE.Group`

**Output:** `THREE.Mesh` added to group, returns mesh reference.

**File:** `frontend/src/scene/BondFactory.js`

**Purpose:** Creates cylinder mesh between two atom positions.

**Inputs:** `atom1: THREE.Mesh, atom2: THREE.Mesh, order: 1|2|3`

**Output:** `{ mesh: THREE.Mesh, update(): void }` — `update()` repositions and rescales the cylinder each frame.

**File:** `frontend/src/chat/ChatPanel.js`

**Purpose:** Manages the right-side chat UI. Decoupled from scene logic.

**Inputs:**
- `addMessage(text: string, sender: "ai" | "user"): void`
- `showTyping(): void`
- `removeTyping(): void`
- `setSuggestions(prompts: string[]): void`
- `onSend: (message: string) => void` — callback registered by parent

**Output:** DOM mutations only.

### 1-3. Data Flow

```
AnimationScenario JSON (hardcoded for Phase 1)
    ↓ SceneManager.loadScenario()
THREE.js scene populated with atom/bond meshes
    ↓ User clicks suggestion button
ChatPanel emits user message
    ↓ App.js looks up demo step → calls SceneManager.playStep(stepId)
GSAP timeline executes → scene animates
    ↓ Promise resolves
ChatPanel.addMessage(step.description, "ai")
```

### 1-4. Environment and Dependencies

**File:** `package.json`

```json
{
  "dependencies": {
    "three": "^0.160.0",
    "gsap": "^3.12.2"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

No backend in Phase 1. Run with `vite dev`.

### 1-5. Test Cases

| # | Input | Expected output | Pass condition |
|---|-------|-----------------|----------------|
| 1 | Load `AnimationScenario` with 3 atoms (C, H, Cl) and 2 bonds | 3 spheres and 2 cylinders visible in scene | `scene.children.length === 5` |
| 2 | `playStep(0)` with `type: "rotate_view"` target camera to `(0,0,10)` | Camera moves to `(0,0,10)` over `duration` ms | After promise resolves, `camera.position.z ≈ 10` |
| 3 | `playStep(1)` with `type: "approach"` moving Br atom from `(-4,6,1.5)` to `(0,1.7,2.1)` | Br mesh position changes | After promise resolves, `brMesh.position.y ≈ 1.7` |
| 4 | Hover over C atom mesh | `atomHover` custom event fired with `atomId: "C2"` | Event listener receives correct atomId |
| 5 | `resetScene()` after playStep | Scene returns to initial atom positions | All atom positions match original `AnimationScenario` values |

---

## Phase 2 — AI Orchestrator + Anthropic API

### 2-1. Goal

Replace the hardcoded demo interactions with a live LLM that receives user messages and returns `AnimationScenario` JSON. PubChem is **mocked** in this phase (static fixture data); the goal is to validate the prompt → structured JSON pipeline end-to-end.

### 2-2. Components

**File:** `server/orchestrator.js` (or `orchestrator.py`)

**Purpose:** Express/FastAPI endpoint that takes a user query, calls Claude, and returns `AnimationScenario`.

**Endpoint:** `POST /api/query`

**Request body:** `QueryRequest` (see Data Models)

**Response body:** `{ scenario: AnimationScenario, chatMessage: string }`

**Behavior:**
- Maintain conversation history per `sessionId` in memory (Map/dict, no DB yet)
- System prompt instructs Claude to: (1) identify molecules, (2) call `get_molecule_3d` tool (mocked), (3) return `AnimationScenario` as JSON in a `<scenario>` XML tag
- Parse `<scenario>...</scenario>` from LLM response text
- If LLM returns `tool_use` block for `get_molecule_3d`, return mock fixture for that molecule name
- Validate returned JSON against `AnimationScenario` schema before sending to client

**File:** `server/prompts/system.txt`

```
You are ChemCanvas AI, a chemistry education assistant that generates 3D molecular animation scenarios.

When a user asks about a molecule or reaction:
1. Identify all molecules involved
2. Call get_molecule_3d for each molecule to retrieve real 3D coordinates
3. Generate an AnimationScenario JSON describing how to visualize the answer
4. Return the scenario inside <scenario>...</scenario> tags
5. Also provide a plain Korean explanation of what the animation shows

The AnimationScenario must conform exactly to this TypeScript interface:
[insert AnimationScenario interface here]

Rules:
- NEVER invent atom coordinates. Always use coordinates from get_molecule_3d tool results.
- Animation steps must reference atomIds that exist in the molecule data.
- Descriptions must be in Korean.
- Camera rotate_view steps use Three.js world coordinates.
```

**File:** `server/mocks/pubchem.js`

**Purpose:** Returns fixture `MoleculeData` for known molecule names during Phase 2.

```javascript
const FIXTURES = {
  "HBr": { pubchemCid: 260, name: "HBr", atoms: [...], bonds: [...] },
  "(R)-3-chloro-1-butene": { ... }  // extracted from pitch_demo.html coordinates
};
export function getMolecule3D(name) { return FIXTURES[name] ?? null; }
```

### 2-3. Integration Points

- Frontend `ChatPanel.onSend` → `POST /api/query` → returns `{ scenario, chatMessage }`
- Frontend passes `scenario` to `SceneManager.loadScenario()` (Phase 1 interface)
- Frontend calls `SceneManager.playStep()` for each step in sequence
- Frontend calls `ChatPanel.addMessage(step.description, "ai")` as each step resolves

### 2-4. Test Cases

| # | Input | Expected output | Pass condition |
|---|-------|-----------------|----------------|
| 1 | `POST /api/query` with `userMessage: "HBr이 어떻게 첨가돼?"` | Response contains valid `AnimationScenario` JSON | JSON parses without error; `scenario.molecules.length >= 1` |
| 2 | Same session, follow-up message "Br- 공격 시뮬레이션 해" | History maintained; LLM references prior context | Response references carbocation intermediate |
| 3 | LLM calls `get_molecule_3d("HBr")` tool | Mock fixture returned; no real HTTP call | `atoms` array has H and Br with valid positions |
| 4 | LLM returns malformed JSON in `<scenario>` tags | Server returns 400 with error message | Client displays "분석 실패" message, no crash |
| 5 | Unknown molecule "xyzabc123" | Mock returns null; LLM notified | LLM responds with "해당 분자를 찾을 수 없습니다" |

---

## Phase 3 — PubChem MCP Integration

### 3-1. Goal

Replace mock fixture data with live PubChem MCP calls so the system handles any molecule the user asks about.

> Full design to be completed before Phase 3 begins. Will cover:
> - PubChem MCP server setup and authentication
> - SDF → `MoleculeData` coordinate parsing (handle different conformer formats)
> - Coordinate normalization (center molecule at origin, scale to Three.js units)
> - Caching layer (don't re-fetch same CID within session)
> - Error handling: molecule not in PubChem, no 3D conformer available
> - Fallback: if no 3D conformer, generate approximate geometry from SMILES bond table

---

## Phase 4 — Session Persistence + Multi-tab UX

> Full design to be completed before Phase 4 begins. Will cover:
> - DB choice for session persistence (SQLite for local dev, Postgres for production)
> - Session list sidebar: user can see and restore past reaction sessions
> - Multi-tab architecture: each tab gets its own `sessionId`, tabs listed in sidebar
> - Tab naming: auto-named from reaction (e.g. "HBr + (R)-3-chloro-1-butene")
> - History export: save session as JSON or shareable link

---

## File Structure (Target after Phase 2)

```
chemcanvas-ai/
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── App.js                  # top-level orchestration
│   │   ├── scene/
│   │   │   ├── SceneManager.js
│   │   │   ├── AtomFactory.js
│   │   │   └── BondFactory.js
│   │   ├── chat/
│   │   │   └── ChatPanel.js
│   │   └── api/
│   │       └── client.js           # fetch wrapper for /api/query
│   └── package.json
├── server/
│   ├── index.js                    # Express app
│   ├── orchestrator.js             # main query handler
│   ├── prompts/
│   │   └── system.txt
│   ├── mocks/
│   │   └── pubchem.js              # Phase 2 fixtures
│   └── package.json
├── shared/
│   └── types.ts                    # AnimationScenario interfaces (shared)
└── pitch_demo.html                 # original demo, kept for reference
```

---

## Launch Instructions

```bash
# Install
cd frontend && npm install
cd ../server && npm install

# Configure (server/.env)
ANTHROPIC_API_KEY=your_key_here

# Run server (Phase 2+)
cd server && node index.js          # runs on :3001

# Run frontend dev server
cd frontend && npm run dev          # runs on :5173, proxies /api → :3001
```

---

## Open Questions

| Question | Impact | Resolve by |
|----------|--------|------------|
| React vs Vanilla JS for frontend | Multi-tab state management complexity | Phase 1 start |
| Node.js vs Python for server | Team preference; Python has better chemistry libs (RDKit) | Phase 1 start |
| PubChem MCP vs direct REST API | MCP is cleaner for LLM tool_use; REST gives more control | Phase 3 start |
| Coordinate scaling from Angstroms to Three.js units | Affects all atom positions | Phase 3 |
| Authentication / user accounts | Required for persistent history | Phase 4 |

---

## Key Design Decisions & Rationale

**Why AnimationScenario JSON as the interface?**
The LLM output is structured JSON, not code. This means the frontend scene engine is deterministic — it only executes validated JSON, never arbitrary LLM-generated JavaScript. This prevents hallucinated coordinates from crashing the renderer and makes the LLM's output auditable.

**Why PubChem MCP instead of asking the LLM for coordinates?**
LLMs cannot reliably produce accurate bond lengths, angles, or 3D conformer geometry. PubChem has experimentally verified or quantum-chemistry-computed 3D conformers for most common molecules. The MCP integration makes trustworthiness structural, not a matter of prompting.

**Why GSAP for animation instead of Three.js's built-in animation system?**
GSAP timelines with labeled synchronization points (`.addLabel("attack")`) make it straightforward to coordinate simultaneous multi-object animations (Br⁻ approach + orbital disappearance + umbrella inversion all at once). The demo already validates this pattern works well.

**Why keep `dynamicBonds` updated every frame?**
Bonds between atoms that move during animation must stay geometrically correct (correct length, correct direction). Computing bond geometry from live atom positions every render frame is simpler and more robust than trying to animate cylinder scale and rotation separately with GSAP.
