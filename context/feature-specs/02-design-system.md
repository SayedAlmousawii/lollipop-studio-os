Read `AGENTS.md` before starting.

## Goal

Set up the UI/design system using shadcn/ui, Lucide icons, and shared utilities.

---

## Implementation

1. Install and initialize shadcn/ui

- Configure for Next.js + TypeScript + Tailwind
- Components path: src/components/ui
- Utils path: src/lib/utils

---

2. Create cn() helper

Create:

text src/lib/utils.ts 

Add class merge helper for Tailwind.

---

3. Install Lucide icons

Install:

text lucide-react 

---

4. Add base UI components

Install these shadcn components:

text button card dialog input label textarea select tabs badge table dropdown-menu separator sheet tooltip sonner 

---

5. Add design tokens

Set up colors from ui-context.md in Tailwind/global CSS.


---

## Rules

- Do NOT modify generated shadcn component files  


---

## Verify When Done

- [ ] shadcn/ui works
- [ ] cn() exists
- [ ] no errors
- [ ] app runs
- [ ] progress-tracker updated