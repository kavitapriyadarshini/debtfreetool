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
3. Use these settings and leave everything else at the default:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | Next.js |
   | Root Directory | `./` |
   | Node.js Version | 20.x |
   | Install Command | `npm install` |
   | Build Command | `npm run build` |
   | Output Directory | leave blank |
   | Environment Variables | none |

   `npm run build` runs `prebuild` first (`npm run data`), which writes `src/data/*.json` from the CSVs. The app imports that JSON, so the deployed functions do not read the filesystem.
4. Click **Deploy**. Every later `git push` redeploys automatically, and pull requests get preview links.

Alternative without GitHub: `npm i -g vercel`, then `vercel` (preview) and `vercel --prod`. Same build command. Do not set environment variables.

## Limits of this prototype (by design)

- **No backend or login.** Cases, edits and decisions are saved in the viewer's browser (localStorage). Each person who opens the link starts from the same demo seed and sees only their own changes. "Reset demo data" restores the seed.
- **The demo date is fixed at 14 Nov 2026** so waiting periods and ready dates match the data.
- **"Download PDF" uses the browser's print-to-PDF** for the one-pager.
- Everything listed under "Left out of v1" in `docs/SPEC.md` is not built.

## Demo walkthrough

The app opens as Pamela Wilson on Opportunities, Ready to contact. Demo date is 14 Nov 2026. Use **Reset demo data** if a previous session changed the seed.

1. Open the **Waiting** tab. Patel, Raj and Anita (H01) shows HELOAN Yellow, no payment alert, case Agreed, and ready from 4 Sep 2027.
2. Open H01 and choose **Continue case**. The workspace already lists the current path (240 months, $230,358), avalanche, snowball, and every eligible HELOAN Yellow and Pink term. Yellow 10-year and 15-year are both 129 months and $127,511.
3. Tick **HELOAN Yellow 15-year** and choose **Compare**. Avalanche and snowball sit beside the loan. The suggestion is HELOAN Yellow 15-year: "5 months sooner and $18,200 less interest than paying smarter without a loan. Secured on your home."
4. Open **Present**. Today is Nov 2046 and $230,358. Your plan (HELOAN Yellow 15-yr + extras) is May 2037, $122,648, $107,710 less, 114 months sooner, and secured on the home.
5. Choose **Agreed**, set the channel to **Servicing call**, and save. The one-page summary opens. Back on the household, the waiting banner reads ready from 14 Nov 2027, and case history shows the contact, the agreement, and the frozen snapshot.
6. Switch the user to **Tom Brennan**. On Waiting, Moore, Andre and Tasha (H11) shows FastApp with a red alert: **+191%, $1,562 → $4,548**. Open the workspace: FastApp 1-year is still listed, marked Red · +191%. Comparing it and choosing **Mark as recommended** asks you to acknowledge that alert and give a reason before it can be saved.
