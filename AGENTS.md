<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Kipu MVP Agent Instructions

## Product context

This project is **Kipu** (MVP): a conversational money assistant and
AI-powered financial wellness coach focused on helping users achieve one
main financial goal. **FinCoach** was the previous internal working name
for this codebase; use **Kipu** in all user-facing contexts. **Kipu X**
is reserved for business, legal, investor, and corporate contexts only.

The app is not a generic expense tracker, not a dashboard-first product,
and not a generic GPT wrapper. It is a personal financial coach that:
- remembers user context,
- tracks real financial movements,
- treats credit cards as debt,
- learns variable spending patterns,
- motivates users with a playful tone,
- helps users recover after inactivity,
- and guides them toward their main goal.

Before making product or architecture decisions, read:

- docs/PRODUCT_SPEC.md
- docs/TECHNICAL_SPEC.md

## Execution style
Work in small, testable steps.

Do not implement large unrelated features in a single change.
Do not add packages unless necessary.
Do not invent features outside the approved MVP scope.

## Architecture rules

The app must support multiple channels:
- internal web app,
- Telegram first,
- WhatsApp later.

Channel-specific code must stay separate from the financial engine.

The financial engine is the source of truth for calculations.

## AI rules

AI must never directly modify the database.

AI should output structured intents.
The financial engine validates and executes.

The AI interprets and communicates.
The code calculates and enforces rules.

## Financial rules

Credit cards are debt, not available money.

A credit card purchase creates:
- an expense,
- and a debt increase.

A credit card payment creates:
- a source account decrease,
- and a debt account decrease,
- but not a duplicated expense.

The system must support:
- multi-currency fields,
- split expenses,
- reimbursements,
- refunds,
- reversals,
- recurring expense matching,
- learned variable budgets,
- financial accuracy,
- flexible spending,
- goal feasibility,
- debt pressure.

## Database rules

All user-owned tables must have user_id.

Supabase Row Level Security must be enabled before inviting real users.

Never expose Supabase service role keys in frontend code.

For Supabase Auth, RLS, and Next.js App Router integration, use official Supabase docs as strict context.

## UI rules

The UI should be mobile-first.

The app should feel like financial wellness, not accounting software.

Tone should be:
- close,
- playful,
- clear,
- non-judgmental,
- financially responsible.

## Testing rules

After meaningful changes:
- run npm run lint,
- run npm run dev for UI changes,
- check git status,
- commit stable milestones.
