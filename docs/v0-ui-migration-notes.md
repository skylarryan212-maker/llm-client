# V0 UI migration notes

## Current production chat flow
- **Legacy UI entrypoint:** `app/page.tsx` exports `MainApp`, which renders the chat experience and is reused for `/codex` via `app/codex/page.tsx`.
- **State & rendering:** `MainApp` owns message state, composer input, attachments, and conversation/project selectors. It uses `ReactMarkdown` to render assistant replies and streams tokens into state while a response is in flight.
- **Data loading:** Conversations and messages are loaded from Supabase using the browser client in `lib/supabaseClient`. Conversation helpers live in `lib/conversations.ts` (e.g., `createConversationRecord`, `normalizeConversationMeta`).
- **Sending messages:** The send pipeline in `app/page.tsx` posts to `/api/chat` with the active conversation id, model settings from `lib/modelConfig`, and the selected agent id from `lib/agents`. The endpoint streams JSON lines containing tokens and metadata that are merged into local message state and later persisted back to Supabase.
- **Supporting routes:**
  - `/api/chat` streams assistant responses and returns metadata (model, search, citations, etc.).
  - `/api/conversations` returns the user’s conversation list.
  - `/api/messages` fetches message history for a given conversation.
  - `/api/image` and `/api/transcribe` handle image generation and audio transcription used by the composer in the legacy UI.

## V0 UI components
- **Layout & chrome:**
  - `components/v0/components/chat-sidebar.tsx` – sidebar with chat list and project stubs.
  - `components/v0/components/chat-header.tsx` – top bar with menu/actions.
  - `components/v0/components/settings-modal.tsx` – modal for preferences.
- **Chat surface:**
  - `components/v0/components/chat-message.tsx` and `components/v0/components/codex-chat-message.tsx` render user/assistant bubbles.
  - `components/v0/components/chat-composer.tsx` and `components/v0/components/codex-composer-large.tsx` provide the input area.
- **Shared UI primitives:** Located under `components/v0/components/ui/*` with utility helpers in `components/v0/lib/utils.ts`. A `ThemeProvider` wrapper lives in `components/v0/components/theme-provider.tsx` for `next-themes` integration.

## Shared utilities to reuse
- **Supabase access:** `lib/supabaseClient.ts` plus helpers in `lib/conversations.ts` for creating and normalizing conversations.
- **Chat metadata/types:** `lib/chatTypes.ts` defines attachment/source shapes reused by the `/api/chat` response metadata.
- **Model & agent configuration:** `lib/modelConfig.ts` and `lib/agents.ts` expose defaults and helpers for selecting the active model/agent that should be shared between the legacy and V0 UIs.
- **API surface:** The `/api/chat`, `/api/conversations`, and `/api/messages` routes already provide the backend expected by production and should be called from the V0 route to keep behavior aligned.

## Promotion notes
To promote the V0 UI later, swap the root page in `app/page.tsx` to render the V0 experience and move the legacy `MainApp` behind an alternate route (for example `/legacy`). Routing and providers should continue to rely on the shared Supabase helpers and `/api/chat` pipeline described above.
