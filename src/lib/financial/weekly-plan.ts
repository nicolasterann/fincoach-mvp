import { roundMoney } from "@/lib/financial/money";

export interface WeeklyPlanInput {
  flexibleSpending: number;
  baseCurrency: string;
  now?: Date;
}

export interface WeeklyPlanResult {
  weeklyAvailable: number;
  daysRemainingInWeek: number;
  dailySuggestedLimit: number;
  baseCurrency: string;
  status: "healthy" | "tight" | "negative";
}

export function calculateWeeklyPlan(input: WeeklyPlanInput): WeeklyPlanResult {
  const now = input.now ?? new Date();
  const dayOfWeek = now.getDay(); // Sunday = 0, Monday = 1, Saturday = 6
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  const daysRemainingInWeek = daysUntilSunday + 1; // includes today

  const weeklyAvailable = roundMoney(input.flexibleSpending);
  const safeWeeklyAvailable = Math.max(weeklyAvailable, 0);

  const dailySuggestedLimit = roundMoney(
    safeWeeklyAvailable / daysRemainingInWeek,
  );

  const status =
    weeklyAvailable < 0 ? "negative" : weeklyAvailable <= 20 ? "tight" : "healthy";

  return {
    weeklyAvailable,
    daysRemainingInWeek,
    dailySuggestedLimit,
    baseCurrency: input.baseCurrency,
    status,
  };
}
