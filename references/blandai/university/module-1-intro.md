# Module 1: Introduction to Bland

## Lesson 1: What Is Bland?

### Core Purpose
Bland is a platform for creating AI phone agents that automatically make and answer phone calls. Agents can perform tasks like customer service, lead engagement, and appointment booking during calls.

### Performance Characteristics
- Sub-second latency — conversations are free from pauses
- Large-scale deployment with no dropped calls and clear audio quality
- Detailed post-call analysis and observability

### Core Agent Capabilities
1. **Outbound calling** — sales, surveys, market research
2. **Inbound number setup** — receive calls via AI agents
3. **Live function calling** — integrate with external APIs and databases to take actions during calls
4. **JSON data extraction** — extract structured data from calls using analysis schemas
5. **Batch processing** — simultaneously send thousands of calls
6. **Custom agent fine-tuning** — use call recordings and transcripts to match company tone

### Configuration Flexibility
- Configure every aspect of the agent: voice settings, transfer scenarios, initial greetings
- Advanced call flows via Bland Conversational Pathways (enterprise-level complexity)

### Access Methods
Two interaction models:
- **Web portal** — browser-based dashboard (accessible after phone verification)
- **API** — direct HTTP requests (covered in later lessons)

---

## Lesson 2: Key Terms and Concepts

### Core Components

**Agents**
AI-driven voice entities that handle inbound/outbound calls. They execute prompts, run webhooks, and leverage knowledge bases for intelligent conversation.

**Nodes**
Individual building blocks within Conversational Pathways. Each node represents a logical step — asking questions, executing webhooks, or routing calls.

**Conversational Pathways**
"Intelligent flow-charts that your Agent can follow during a call." Provide dialogue control by instructing agents how to respond at specific conversation points and what action to take next based on user input.

### Call Management Terms

**Inbound Calls**
Calls received by Bland where a defined Agent answers automatically.

**Inbound & Outbound Numbers**
Provisioned phone numbers for call management. Purchasable through Bland or imported via Twilio integration.

**Batches**
Groups of calls executed together, typically uploaded as CSV files with phone numbers and metadata for campaign-scale operations.

### Integration & Data Handling Terms

**Webhooks**
APIs enabling external actions like appointment reservations or database lookups during calls.

**Post-Call Webhooks**
Callbacks triggered after each call to transmit transcripts, variables, and outcomes to external systems for analytics and CRM updates.

**Secrets**
Secure storage mechanism for API keys, tokens, and credentials — enables authenticated external system integration without hardcoding credentials in prompts.

**Prompt**
Written instructions defining agent behavior, speech patterns, and contextual interpretation.

---

## Lesson 3: Making Your First Call (Dashboard)

### Workflow Operations

**Simple Call Process (Dashboard)**
1. Navigate to dashboard
2. Access "Send Call"
3. Input phone number
4. Select premade prompt template
5. Choose voice option
6. Configure additional settings
7. Initiate call

**Pathway Creation from Template**
1. Open "Conversational Pathways" section
2. Select template (e.g., "Car Rental")
3. Provide name and description
4. Duplicate pathway
5. Test via chat dialog
6. Send call with phone number

**Voice Testing**
1. Access "Voices" section
2. Play available Bland voices, public voices, or cloned voices
3. Customize speech text via "Customize TTS Text" button
4. Select voice
5. Play preview

### Available Features
- Premade prompts with predefined AI personas (example: "Sarah" in Small Business template)
- Multiple voice options for selection
- Template library for conversational pathways
- Community pathway showcase access
- Direct agent testing via chat interface

### Interface Navigation
Core sidebar sections: "Send Call," "Conversational Pathways," "Voices"

### Key Concept: Conversational Pathways
Structures that "allow you to program different flows based on how the conversation is going" — function similarly to flowcharts for call management.

---

## Lesson 4: Bland Models and Architecture

### Call Processing Models

**Base Model**
- Default option for agent processing
- "Follows scripts/procedures most effectively"
- Supports all features: transfers, IVR navigation, custom tools
- Recommended for implementations requiring full capability access

**Turbo Model**
- Optimized for speed with minimal latency
- Excels at "sophisticated and nuanced conversations"
- Current limitations: no transfers, no IVR navigation, no custom tools
- Best for conversational realism over feature completeness

**Key Gotcha**: "Turbo is not always a better selection than Base" — model selection depends on specific use-case requirements. Don't assume faster = better.

### LLM Architecture: Three-Model Pipeline

Bland processes every call turn sequentially through three distinct language models:

1. **Speech-to-text** — converts user audio input to text
2. **Multiple LLMs process the transcript** (three model types below)
3. **Text-to-speech** — converts agent response back to audio

### The Three Model Types

| Model Type | Role |
|---|---|
| **Navigational Model** | Determines agent progression through nodes and pathway selection based on conversation state |
| **Conversational Model** | Generates spoken dialogue content — controls what the agent actually says |
| **Data Extraction Model** | Identifies and extracts specified variables from conversational pathways |

### Architecture Implication for Pizza Ordering
The three-model split means: navigation (which step of the order are we on?), conversation (what does the agent say to the restaurant?), and extraction (capturing order confirmation numbers, ETAs, etc.) are handled by separate specialized models. This is why Pathways give more precise control than simple prompts.
