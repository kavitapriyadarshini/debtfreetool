import { households } from "./data";

export type Advisor = {
  name: string;
  branch: string;
};

/** The five advisors, in the order they first appear in the source data. */
export function listAdvisors(): Advisor[] {
  const advisors: Advisor[] = [];
  const seen = new Set<string>();
  for (const household of households) {
    if (seen.has(household.advisor)) continue;
    seen.add(household.advisor);
    advisors.push({ name: household.advisor, branch: household.branch });
  }
  return advisors;
}

export type DemoUser =
  | { role: "advisor"; name: string; branch: string }
  | { role: "manager"; name: "Manager" };

export const MANAGER: DemoUser = { role: "manager", name: "Manager" };

export function defaultUser(): DemoUser {
  const advisor = listAdvisors().find((person) => person.name === "Pamela Wilson") ?? listAdvisors()[0];
  if (!advisor) return MANAGER;
  return { role: "advisor", name: advisor.name, branch: advisor.branch };
}

export function userKey(user: DemoUser): string {
  return user.role === "manager" ? "manager" : user.name;
}
