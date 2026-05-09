/**
 * Per-stage prompt library for Pedro's campaign workflow.
 *
 * Every prompt lives in its own builder file as a pure function that
 * takes typed args and returns a string. The component then chains:
 *
 *   const prompt = buildAnglesPrompt({ brief, researchContext, ... })
 *   const text = await callClaude(prompt, ...)
 *
 * Why this is structured this way:
 *  - Iterating on a prompt = open exactly one small file
 *  - A/B testing = swap the import or branch on a flag
 *  - Server-side reuse (a future batch generator) imports the same code
 *  - Pure functions = unit-testable without mounting the React tree
 *
 * The component is responsible for assembling context strings via the
 * helpers in ./context — these stay separate so they can be reused
 * across multiple builders without circular imports.
 */

export * from "./context"
export * from "./build-angles"
export * from "./build-script"
export * from "./build-creatives"
export * from "./build-lp"
export * from "./build-ad-copy"
