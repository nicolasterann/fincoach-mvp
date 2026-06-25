// Stage 22 — onboarding CSV template: generation + forgiving validating parser.
// Pure, zero-dependency (no xlsx/zip lib exists in the repo; CSV is the safe
// no-package path). A single sheet with a `tipo` column keeps it one file the
// user can open in Excel/Sheets, fill, and upload. The parser produces the same
// Wizard* item shapes the structured UI uses, plus per-row errors — so the
// import flows into the SAME review-before-save screen and never saves nonsense.

import type {
  AccountType,
  CurrencyCode,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
} from "@/types/financial";
import type { OnboardingGoalArchetype } from "./draft-types";
import type {
  WizardAccount,
  WizardDebt,
  WizardExpense,
  WizardGoal,
  WizardIncome,
} from "./wizard-model";

export const TEMPLATE_FILENAME = "plantilla-kipu.csv";

const HEADER = "tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo";

// Built with a UTF-8 BOM so Excel/Numbers open it with correct accents.
export function buildTemplateCsv(): string {
  const lines = [
    "# Plantilla de Kipu — llena tus datos y súbela en la app. Kipu la revisa antes de guardar.",
    "# Columnas: tipo, nombre, monto, moneda, categoria_o_tipo, frecuencia, dia, fecha_objetivo",
    "# tipo admite: cuenta | ingreso | gasto | deuda | meta",
    "#  • cuenta  -> nombre, monto = saldo aprox, moneda, categoria_o_tipo = banco | efectivo | billetera",
    "#  • ingreso -> nombre, monto, moneda, frecuencia = mensual | quincenal | semanal | anual, dia (1-31)",
    "#  • gasto   -> nombre, monto, moneda, categoria_o_tipo = vivienda|servicios|comida|transporte|suscripciones|salud|otro, frecuencia, dia",
    "#  • deuda   -> nombre, monto = lo que debes, moneda, categoria_o_tipo = tarjeta | prestamo | familiar | otra, dia = dia de pago",
    "#  • meta    -> nombre, monto = objetivo, moneda, fecha_objetivo = AAAA-MM-DD (opcional). Para solo ordenar tu mes: nombre \"Ordenar mi mes\" sin monto.",
    "# Las filas EJEMPLO se ignoran al subir; puedes borrarlas o dejarlas.",
    HEADER,
    "cuenta,EJEMPLO - Banco principal,1200,USD,banco,,,",
    "ingreso,EJEMPLO - Sueldo,1500,USD,,mensual,1,",
    "gasto,EJEMPLO - Arriendo,400,USD,vivienda,mensual,5,",
    "gasto,EJEMPLO - Internet,35,USD,servicios,mensual,10,",
    "deuda,EJEMPLO - Tarjeta Visa,800,USD,tarjeta,,15,",
    "meta,EJEMPLO - Fondo de emergencia,2000,USD,,,,2026-12-31",
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ── Parser ────────────────────────────────────────────────────────────────────

export interface ParsedTemplateRowError {
  row: number;
  message: string;
}

export interface ParsedTemplate {
  accounts: WizardAccount[];
  incomes: WizardIncome[];
  expenses: WizardExpense[];
  debts: WizardDebt[];
  goals: WizardGoal[];
  errors: ParsedTemplateRowError[];
  skipped: number;
  totalDataRows: number;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function norm(s: string): string {
  return stripAccents((s ?? "").trim().toLowerCase());
}

// Minimal RFC-4180-ish field splitter: handles quoted fields with commas/quotes.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function normalizeCurrency(raw: string, fallback: CurrencyCode): CurrencyCode {
  const c = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? (c as CurrencyCode) : fallback;
}

function mapAccountType(raw: string): AccountType {
  const v = norm(raw);
  if (v.startsWith("efect") || v === "cash") return "cash";
  if (v.startsWith("billet") || v.includes("paypal") || v.includes("wallet") || v.includes("mercado")) return "wallet";
  return "bank";
}

function mapDebtType(raw: string): DebtAccountType {
  const v = norm(raw);
  if (v.includes("tarjeta") || v.includes("visa") || v.includes("master") || v.includes("card")) return "credit_card";
  if (v.includes("prest") || v.includes("loan")) return "loan";
  if (v.includes("famil") || v.includes("persona") || v.includes("amigo")) return "family_debt";
  return "other_debt";
}

const CATEGORY_MAP: Record<string, FinancialCategory> = {
  vivienda: "housing", arriendo: "housing", renta: "housing", alquiler: "housing", casa: "housing", housing: "housing",
  servicios: "utilities", luz: "utilities", agua: "utilities", internet: "utilities", utilities: "utilities",
  comida: "food", food: "food", super: "food", mercado: "food",
  transporte: "transport", transport: "transport",
  suscripciones: "subscriptions", suscripcion: "subscriptions", subscriptions: "subscriptions",
  salud: "health", health: "health",
  educacion: "education", education: "education",
  deuda: "debt", debt: "debt",
  familia: "family", family: "family",
  entretenimiento: "entertainment", entertainment: "entertainment", ocio: "entertainment",
  compras: "shopping", shopping: "shopping",
  viajes: "travel", viaje: "travel", travel: "travel",
  ahorro: "savings", savings: "savings",
};
function mapCategory(raw: string): FinancialCategory {
  return CATEGORY_MAP[norm(raw)] ?? "other";
}

function mapFrequency(raw: string): PaymentFrequency {
  const v = norm(raw);
  if (v.startsWith("quincen") || v.includes("biweek") || v.includes("2 sem")) return "biweekly";
  if (v.startsWith("seman") || v.includes("week")) return "weekly";
  if (v.startsWith("anu") || v.includes("year") || v.includes("año")) return "yearly";
  return "monthly";
}

function isMoneyish(raw: string): boolean {
  return /[0-9]/.test(raw ?? "");
}

// We accept either the documented header order, or map by header names if the
// first non-comment line is a header. amount validation is delegated to the
// review step (parseMoney), but a clearly non-numeric monto is flagged here.
export function parseTemplateCsv(text: string): ParsedTemplate {
  const result: ParsedTemplate = {
    accounts: [], incomes: [], expenses: [], debts: [], goals: [],
    errors: [], skipped: 0, totalDataRows: 0,
  };
  const clean = (text ?? "").replace(/^﻿/, "");
  const rawLines = clean.split(/\r\n|\n|\r/);

  let counter = 0;
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const rowNum = idx + 1;
    if (!line.trim()) continue;
    if (line.trim().startsWith("#")) continue;

    const cells = splitCsvLine(line);
    const tipo = norm(cells[0] ?? "");
    if (!tipo || tipo === "tipo") continue; // header row
    const nombre = (cells[1] ?? "").trim();
    if (/^ejemplo/i.test(stripAccents(nombre))) continue; // skip example rows

    result.totalDataRows++;
    const monto = (cells[2] ?? "").trim();
    const moneda = normalizeCurrency(cells[3] ?? "", "USD");
    const catOrType = (cells[4] ?? "").trim();
    const frecuencia = (cells[5] ?? "").trim();
    const dia = (cells[6] ?? "").trim();
    const fecha = (cells[7] ?? "").trim();

    const id = `csv-${counter++}`;
    const montoInvalid = monto.length > 0 && !isMoneyish(monto);

    if (tipo === "cuenta") {
      if (!nombre) { result.errors.push({ row: rowNum, message: "La cuenta necesita un nombre." }); result.skipped++; continue; }
      if (montoInvalid) result.errors.push({ row: rowNum, message: `El saldo "${monto}" no es un número.` });
      result.accounts.push({
        id, name: nombre, type: mapAccountType(catOrType), balance: montoInvalid ? "" : monto,
        currency: moneda, liquidity: "liquid", isGoalAccount: false, isPrimary: false, returnRate: "",
      });
    } else if (tipo === "ingreso") {
      if (montoInvalid || !isMoneyish(monto)) { result.errors.push({ row: rowNum, message: `El ingreso "${nombre || "(sin nombre)"}" necesita un monto válido.` }); result.skipped++; continue; }
      result.incomes.push({
        id, name: nombre || "Ingreso", amount: monto, currency: moneda,
        frequency: mapFrequency(frecuencia), expectedDay: dia, isVariable: false,
        minAmount: "", maxAmount: "", destinationAccountId: "",
      });
    } else if (tipo === "gasto") {
      if (montoInvalid || !isMoneyish(monto)) { result.errors.push({ row: rowNum, message: `El gasto "${nombre || "(sin nombre)"}" necesita un monto válido.` }); result.skipped++; continue; }
      result.expenses.push({
        id, name: nombre || "Gasto fijo", amount: monto, currency: moneda, category: mapCategory(catOrType),
        frequency: mapFrequency(frecuencia), expectedDay: dia, isEssential: true, paymentSourceId: "",
      });
    } else if (tipo === "deuda") {
      if (montoInvalid) result.errors.push({ row: rowNum, message: `El monto de la deuda "${monto}" no es un número.` });
      if (!nombre && !isMoneyish(monto)) { result.errors.push({ row: rowNum, message: "La deuda necesita un nombre o un monto." }); result.skipped++; continue; }
      result.debts.push({
        id, name: nombre || "Deuda", type: mapDebtType(catOrType), balance: montoInvalid ? "" : monto,
        currentMonthPayment: "", minimumPayment: "", currency: moneda, dueDay: dia, cutoffDay: "",
        interestRate: "", defaultPaymentAccountId: "",
      });
    } else if (tipo === "meta") {
      // Require both "ordenar" AND "mes" so "comprar ordenador" (computer, in
      // Spanish) isn't misread as the amount-less "organize my month" goal.
      const n = norm(nombre);
      const archetype: OnboardingGoalArchetype = n.includes("ordenar") && n.includes("mes") ? "organize_month" : "specific_purchase";
      if (montoInvalid) result.errors.push({ row: rowNum, message: `El objetivo "${monto}" no es un número.` });
      if (archetype !== "organize_month" && !isMoneyish(monto)) {
        result.errors.push({ row: rowNum, message: `La meta "${nombre || "(sin nombre)"}" necesita un monto objetivo (o llámala "Ordenar mi mes").` });
        result.skipped++;
        continue;
      }
      result.goals.push({
        id, name: nombre || "Mi meta", archetype, targetAmount: montoInvalid ? "" : monto,
        currentAmount: "", currency: moneda, targetDate: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "",
      });
    } else {
      result.errors.push({ row: rowNum, message: `Tipo no reconocido: "${cells[0]}". Usa cuenta, ingreso, gasto, deuda o meta.` });
      result.skipped++;
    }
  }

  return result;
}
