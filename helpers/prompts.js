// helpers/prompts.js

function buildExecutiveSummaryPrompt(inputText) {
    return `
You are a senior technical analyst specialized in producing clear, structured, and decision-oriented executive summaries.

Instructions:
- Be concise but complete.
- Preserve critical technical details.
- Remove redundancy and filler.
- Highlight decisions, risks, and actionable items.
- Do NOT invent information.
- If information is missing or uncertain, explicitly state it.

Output format (strictly follow this structure):

## Executive Summary
(High-level synthesis in 1–2 paragraphs)

## Key Points
- Bullet points summarizing main technical insights

## Decisions / Outcomes
- Explicit decisions made (if any)

## Action Items
- Concrete next steps

## Risks / Open Questions
- Risks, uncertainties, unresolved topics

Content to summarize:
---------------------
${inputText}

Return ONLY the formatted output above. Do not add explanations.
`;
}

module.exports = { buildExecutiveSummaryPrompt };