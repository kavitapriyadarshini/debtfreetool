# Debt Free tool: prototype starter kit

Everything Cursor needs to build a working prototype that matches the requirements doc, and the steps to put it on Vercel.

| In this kit | What it's for |
| --- | --- |
| `docs/SPEC.md` | The requirements doc. Source of truth for screens, rules, states and acceptance criteria |
| `docs/ENGINE.md` | Exactly how every number is calculated |
| `docs/DATA.md` | Data dictionary for the demo dataset |
| `docs/user-flow.png` | The three-journey flow diagram |
| `data/` | 299 demo households, pipeline results, advisor cases, contact history (19 CSVs) |
| `reference/` | The Python that produced the data. The TypeScript engine must reproduce it |
| `.cursor/rules/debt-free.mdc` | Rules Cursor follows on every prompt |
| `PROMPTS.md` | 13 prompts to paste into Cursor, in order, each with a "Done when" check |
| `PROMPTS_FIXES.md` | Fix round 1: slow buttons, bottom action bar, plan source labels, "Not comparable" |
| `PROMPTS_FIXES_2.md` | Fix round 2: household tabs, scenarios table, compare selection, present mode, household PDF, alert dots |
| `PROMPTS_FIXES_3.md` | Fix round 3: one set of inputs per case, extras, invalid loans, unique names, compare 3 + today, where the money goes, interest rates |
| `PROMPTS_FIXES_4.md` | Fix round 4: scenarios table layout, one source per plan, visible tick boxes, fixed plan-rule strip |
| `PROMPTS_FIXES_5.md` | Fix round 5: "(edited data)" only with edits, suggestion never alerted, compare and present wording |

## What you need

- Node.js 20 or later (`node -v`)
- Cursor (cursor.com), signed in
- A GitHub account and a Vercel account (vercel.com, free Hobby plan is enough)
- Git

## Step 1: Create the project

In a terminal:

```
npx create-next-app@latest debt-free --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd debt-free
npx shadcn@latest init -d
```

## Step 2: Add the kit

Unzip this kit and copy its contents into the `debt-free` folder, so you have `debt-free/docs`, `debt-free/data`, `debt-free/reference`, `debt-free/.cursor/rules/debt-free.mdc`, `debt-free/PROMPTS.md`. (On macOS, `.cursor` is a hidden folder; copy it with `cp -R debt-free-starter/.cursor debt-free/` or press Cmd+Shift+. in Finder.)

Then commit:

```
git add -A
git commit -m "Add Debt Free spec, data and Cursor rules"
```

## Step 3: Open in Cursor

1. Open the `debt-free` folder in Cursor.
2. Check the rule is active: Cursor Settings → Rules should list `debt-free` as "Always".
3. Open the chat panel, choose **Agent** mode and the strongest model you have.

## Step 4: Run the prompts

Open `PROMPTS.md` and run prompts 1 to 13 in order, **one new chat per prompt**.

After each prompt:
1. Run `npm run typecheck && npm run test && npm run build`.
2. Run `npm run dev` and check the prompt's "Done when" in the browser at http://localhost:3000.
3. Read `docs/OPEN_QUESTIONS.md` if Cursor added to it.
4. Commit: `git add -A && git commit -m "Prompt N: <name>"`.

Prompt 2 matters most. Don't continue until every fixture test passes; that's what guarantees the numbers in the UI match the doc (H01: Yellow 15-year, 129 months, $127,511).

If Cursor drifts from the spec, paste this into the same chat:

```
This doesn't match @docs/SPEC.md. Re-read the relevant section, list every difference between it and what you built, then fix them. Don't change the spec.
```

## Step 5: Deploy to Vercel

1. Create an empty GitHub repository (no README), then:
   ```
   git remote add origin https://github.com/<you>/debt-free.git
   git branch -M main
   git push -u origin main
   ```
2. In Vercel: **Add New → Project → Import** the repository.
3. Settings: Framework preset **Next.js**; build command `npm run build`; output directory default; no environment variables.
4. Click **Deploy**. Every later `git push` redeploys automatically, and pull requests get preview links.

Alternative without GitHub: `npm i -g vercel`, then `vercel` (preview) and `vercel --prod`.

## Limits of this prototype (by design)

- **No backend or login.** Cases, edits and decisions are saved in the viewer's browser (localStorage). Each person who opens the link starts from the same demo seed and sees only their own changes. "Reset demo data" restores the seed.
- **The demo date is fixed at 14 Nov 2026** so waiting periods and ready dates match the data.
- **"Download PDF" uses the browser's print-to-PDF** for the one-pager.
- Everything listed under "Left out of v1" in `docs/SPEC.md` is not built.

## Demo walkthrough (to check the build)

1. As **Pamela Wilson**, open Opportunities: the Ready tab lists households never offered a plan or past their waiting period. On Waiting, H01 (Patel) shows ready from 4 Sep 2027. (The 16 sample households were all cased in this demo, so they sit on Waiting.)
2. Open H01 → workspace: the suggestion is HELOAN Yellow 15-year, 129 months, $127,511 interest, no payment alert.
3. Add a $5,000 one-off in April 2027 and watch the numbers update.
4. As **Tom Brennan**, find H11 on the Waiting tab (a plan was presented in this demo season; ready again 13 Jan 2027). Its nightly plan shows a red alert (+191%, $1,562 → $4,548). Try to recommend it: you must acknowledge the alert and give a reason. Build FastApp 3-year instead.
5. Present it, record "Agreed" as a servicing call, open the one-pager, and check H11's ready date moves to 12 months out (14 Nov 2027), because the plan includes a new loan.
6. Switch to **Manager** → Firm view: the funnel and agreed plans include H11.
