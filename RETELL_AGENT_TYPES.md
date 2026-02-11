# Retell AI Agent Types — Research & Outcomes for Call Operator Software

A guide to Retell AI agent types and what each enables for the Triangle order management operator application.

---

## Overview

Retell AI offers several agent types that differ in **how they control conversation logic** and **what capabilities they provide**. For call operator software, you typically pair a **Phone (Voice) agent** with one of these logic types:

| Agent Type | Logic/Control Model | Best For |
|------------|---------------------|----------|
| **Single Prompt** | One comprehensive prompt drives all behavior | Simple, linear flows |
| **Multi-Prompt** | Tree of states, each with its own prompt | Phased, state-based flows |
| **Conversation Flow** | Node-based visual flows with conditional branching | Complex, structured IVR and multi-step scenarios |
| **Custom LLM** | Your own LLM via WebSocket replaces Retell's built-in logic | Compliance, custom models, full control |

---

## 1. Single Prompt Agent

### What It Is

A **single prompt agent** uses one comprehensive system prompt to define all agent behavior. The LLM follows instructions in that prompt and can call tools (functions) you configure. It's the simplest way to build an agent.

### Key Characteristics

- **One prompt** — All instructions, style, guardrails, and task logic in a single text block
- **Function calling** — Can define 1–5 tools; more than 5 becomes unreliable
- **Sectional prompts** — Retell recommends breaking the prompt into sections: Identity, Style Guardrails, Response Guideline, Task
- **Task as steps** — Write the task as numbered steps; add "wait for user response" when you need turn-taking
- **No built-in state machine** — The LLM infers state from context

### What You Can Have (Operator App)

| Capability | Supported |
|------------|-----------|
| Greet caller, identify by phone/ID | ✅ |
| Announce client name and ID | ✅ |
| Create upcoming order (Custom/Food/Boxes) | ✅ (1–3 tools) |
| Lookup client via tool | ✅ |
| Linear flow: greet → identify → create order → confirm | ✅ |
| Simple error handling in prompt | ✅ |
| Complex branching (e.g. Food vs Boxes vs Custom paths) | ⚠️ Becomes brittle |
| Call transfer to human | ✅ (if configured) |
| Many tools (>5) | ❌ Unreliable |

### When to Use

- **MVP** — Fastest to build and iterate
- **Simple flows** — 1–3 tools, linear conversation
- **Prompt ≤ ~1000 words** — Beyond that, consider Multi-Prompt or Conversation Flow

### Limitations at Scale

- **Behavioral drift** — Agent may deviate from instructions in edge cases
- **Function calling issues** — Unreliable tool usage with many functions
- **Maintenance** — Large prompts are hard to debug and update
- **Context confusion** — Agent can struggle to track conversation state

---

## 2. Multi-Prompt Agent

### What It Is

A **multi-prompt agent** organizes the conversation into a **tree of states**. Each state has:

- Its own **focused prompt**
- **State-specific functions** (only relevant tools in that state)
- **Transition logic** — Conditions to move to the next state (e.g. "if yes, transition to `schedule_tour`")
- **Context preservation** — Variables and information flow between states

### Key Characteristics

- **State-based design** — Break conversation into phases (e.g. Identification → Order Creation → Confirmation)
- **Focused prompts per state** — Each state has a clear, narrow purpose
- **Transitions in prompt** — e.g. "7. Ask if user is interested. If yes, transition to `schedule_tour`. If no, call `end_call`."
- **Better function control** — Tools available only when appropriate
- **Easier debugging** — Issues isolated to specific states

### What You Can Have (Operator App)

| Capability | Supported |
|------------|-----------|
| Phase 1: **Identification** — Lookup client, announce | ✅ |
| Phase 2: **Order Creation** — Create upcoming order | ✅ |
| Phase 3: **Confirmation** — Confirm and close | ✅ |
| Different tools per phase | ✅ |
| Predictable, phased behavior | ✅ |
| Team collaboration — Different owners per state | ✅ |
| Add new states without breaking existing ones | ✅ |
| IVR-style routing (press 1, press 2) | ❌ Use Conversation Flow |
| Call transfer, SMS, DTMF nodes | ❌ Use Conversation Flow |

### When to Use

- **Moderate complexity** — More than 3 tools or multi-phase flows
- **Lead qualification pattern** — Qualify first, then act (e.g. identify → then create order)
- **Maintainability** — You want to debug and tune by state

### Example Structure for Operator

```
State 1: Identification
  - Prompt: Greet, lookup by phone or ask for ID, announce client
  - Tools: lookup_client only

State 2: Order Creation
  - Prompt: What type of order? Create upcoming order
  - Tools: create_upcoming_order only
  - Transition: from Identification when client identified

State 3: Confirmation
  - Prompt: Confirm order, thank, close
  - Tools: none or end_call
```

---

## 3. Conversation Flow Agent

### What It Is

A **conversation flow agent** uses a **node-based visual flow** made of:

- **Nodes** — Different types (conversation, function, SMS, call transfer, logic, end)
- **Edges** — Connections between nodes
- **Transition conditions** — Rules that determine when to move to the next node (prompt-based or equation-based)
- **Components** — Reusable sub-flows (e.g. "Verify Identity") shared across agents
- **Global settings** — Agent-wide prompt, voice, language
- **Flex Mode** (optional) — Compile flow into a single prompt for more flexible, single-prompt-like behavior within a flow structure

### Node Types

| Category | Node | Purpose |
|----------|------|---------|
| **Conversation** | Conversation Node | Handle dialogue and user interactions |
| | Extract DV Node | Extract and store dynamic variables |
| **Action** | Function Node | Execute custom functions and API calls |
| | SMS Node | Send SMS during the call |
| | MCP Node | Integrate with Model Context Protocol tools |
| **Call Control** | Call Transfer Node | Transfer to another phone number |
| | Transfer Agent Node | Transfer to another Retell agent |
| | Press Digit Node | Send DTMF tones (press digits) |
| | End Node | Terminate the call gracefully |
| **Logic** | Logic Split Node | Conditional branches based on variables |

### Key Benefits

- **Structured conversations** — Define exact paths and transitions
- **Predictable behavior** — Each node has specific logic and outcomes
- **Complex scenario handling** — Conditional branching, state management
- **Fine-tuning** — Node-specific examples and settings
- **Pricing control** — Different models per node; cost based on time spent in each node
- **Components** — Reuse sub-flows (e.g. "Collect Order Details") across agents

### What You Can Have (Operator App)

| Capability | Supported |
|------------|-----------|
| IVR: "Press 1 for order, 2 for support" | ✅ Press Digit + Logic Split |
| Branch by order type (Food vs Boxes vs Custom) | ✅ Logic Split Node |
| Call transfer to human operator | ✅ Call Transfer Node |
| Transfer to another agent (e.g. support agent) | ✅ Transfer Agent Node |
| Reusable "Identify Client" component | ✅ Components |
| Function nodes for lookup_client, create_upcoming_order | ✅ Function Node |
| SMS confirmation after order | ✅ SMS Node |
| End call gracefully | ✅ End Node |
| Node-specific LLM model (cheaper nodes for routing) | ✅ |
| Flex Mode — combine flow structure with single-prompt flexibility | ✅ |

### When to Use

- **Complex multi-step flows** — IVR, branching, handoffs
- **Call transfer** — Need to escalate to human or other agent
- **Reusable logic** — Same sub-flows in multiple agents
- **Cost optimization** — Different models for different parts of the call

### Flex Mode

Flex Mode combines Conversation Flow structure with Single Prompt flexibility:

- Flow is **compiled into one structured prompt** at runtime
- Agent navigates tasks **dynamically** (e.g. user completes multiple tasks at once)
- Can switch context and resume previous task without repeating
- **Limit:** Avoid >20 nodes; performance and hallucination risk increase

---

## 4. Custom LLM

### What It Is

**Custom LLM** integration lets you **replace Retell's built-in LLM** with your own. You run a **WebSocket server** that:

1. Receives transcript and `interaction_type` from Retell
2. Generates responses using your LLM (OpenAI, Azure OpenAI, Claude, etc.)
3. Sends responses back to Retell
4. Optionally implements function calling yourself

Retell handles: telephony, ASR, TTS, audio streaming, session management. Your server handles: all LLM logic.

### Key Characteristics

- **Full control** — Your prompts, your model, your logic
- **Compliance** — Data never leaves your stack; use on-prem or private models
- **Custom models** — Any LLM that fits the WebSocket protocol
- **No built-in tools** — You implement function calling yourself
- **Lower-level** — Retell recommends using Single Prompt, Multi-Prompt, or Conversation Flow **when possible**

### What You Can Have (Operator App)

| Capability | Supported |
|------------|-----------|
| Any model (OpenAI, Azure, Claude, on-prem, etc.) | ✅ |
| Full control over prompts and behavior | ✅ |
| Compliance (HIPAA, SOC2, data residency) | ✅ |
| Custom RAG, internal state, dynamic prompts | ✅ |
| Function calling (lookup_client, create_upcoming_order) | ✅ (you implement) |
| All Retell telephony features (voice, transfer, etc.) | ✅ |
| Built-in Retell tools and components | ❌ You build everything |

### When to Use

- **Compliance** — Must use a specific model or keep data in-house
- **Custom use case** — Retell frameworks don't fit your needs
- **Existing LLM stack** — You already have a preferred LLM pipeline

### Integration Flow

1. Phone call starts → Retell establishes audio WebSocket
2. Retell connects to your `llm_websocket_url`
3. For `interaction_type: "response_required"` → you send response
4. For `interaction_type: "update_only"` → live transcript update (optional)
5. You stream content; Retell handles TTS and audio

---

## Summary: Agent Type vs Outcome

| Agent Type | Primary Outcome for Operator App |
|------------|----------------------------------|
| **Single Prompt** | Simple MVP: answer → identify → create order. Fast to build, 1–3 tools. |
| **Multi-Prompt** | Phased flow: Identification → Order Creation → Confirmation. Better maintainability, state-specific tools. |
| **Conversation Flow** | IVR, branching by order type, call transfer, reusable components, SMS, DTMF. |
| **Custom LLM** | Full control, compliance, custom models. You build all logic and tools. |

---

## Recommendation for Operator App

### Phase 1 (MVP)

- **Single Prompt** — Fastest path
- Tools: `lookup_client`, `create_upcoming_order`
- Flow: greet → identify → create order (Custom only) → confirm

### Phase 2 (More order types / reliability)

- **Multi-Prompt** — States: Identification → Order Creation → Confirmation
- Or **Conversation Flow** — If you add IVR, branching, or human transfer

### Phase 3 (Optional)

- **Chat Agent** — Web widget or chat API for text-based self-service
- **Custom LLM** — Only if compliance or custom model requirements arise

---

## Quick Reference

| If you need… | Choose… |
|--------------|---------|
| Fast MVP, 1–3 tools | Single Prompt |
| Phased flow, easier debugging | Multi-Prompt |
| IVR, branching, call transfer, SMS | Conversation Flow |
| Compliance, custom model, full control | Custom LLM |
| Text channel alongside phone | Chat Agent (separate) |

---

## References

- [Retell Introduction](https://docs.retellai.com/general/introduction)
- [Single/Multi Prompt Overview](https://docs.retellai.com/build/single-multi-prompt/prompt-overview)
- [Conversation Flow Overview](https://docs.retellai.com/build/conversation-flow/overview)
- [Node Overview](https://docs.retellai.com/build/conversation-flow/node)
- [Custom LLM Overview](https://docs.retellai.com/integrate-llm/overview)
- [Flex Mode](https://docs.retellai.com/build/conversation-flow/flex-mode)
- [Create Chat Agent](https://docs.retellai.com/build/create-chat-agent)
