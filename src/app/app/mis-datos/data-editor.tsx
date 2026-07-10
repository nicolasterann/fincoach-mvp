"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveDataAction, deleteDataAction, addDataAction } from "./actions";

// S8 — generic "Mis datos" editor. One <DataSection> per onboarding table renders its
// rows (view), an inline edit form per row, a soft-delete button, and either an add form
// or a "add via chat" link. Field specs drive the inputs so every entity reuses the same
// component. Writes go through the three server actions; the page re-renders on redirect.

export type FieldType = "text" | "money" | "select" | "toggle" | "date";
export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
}
export interface RowSpec {
  id: string;
  title: string;
  subtitle?: string;
  values: Record<string, string>; // prefill for the edit form, keyed by field name
}
export interface SectionSpec {
  entity: string;
  anchor: string;
  title: string;
  hint?: string;
  rows: RowSpec[];
  editFields: FieldSpec[];
  addFields?: FieldSpec[];
  chatAddPrompt?: string; // shown when addFields is absent
  emptyText: string;
  deleteLabel: string; // "Cerrar cuenta", "Quitar", …
}

const inputCls =
  "w-full rounded-xl border border-line/10 bg-zinc-950 px-3 py-2 text-base text-zinc-50 outline-none focus:border-emerald-400/60";
const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-zinc-500";

function Field({ f, defaultValue }: { f: FieldSpec; defaultValue?: string }) {
  if (f.type === "toggle") {
    // Hidden "false" companion so an UNCHECKED box still submits a definite state —
    // otherwise the browser omits it and the server can't tell "off" from "unchanged",
    // making a toggle impossible to turn back off. bool() reads all values.
    return (
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="hidden" name={f.name} value="false" />
        <input type="checkbox" name={f.name} value="on" defaultChecked={defaultValue === "true"} className="h-4 w-4 accent-emerald-400" />
        {f.label}
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{f.label}</span>
      {f.type === "select" ? (
        <select name={f.name} defaultValue={defaultValue ?? ""} className={inputCls}>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={f.name}
          type={f.type === "date" ? "date" : "text"}
          inputMode={f.type === "money" ? "decimal" : undefined}
          defaultValue={defaultValue ?? ""}
          placeholder={f.placeholder}
          className={inputCls}
        />
      )}
    </label>
  );
}

function Row({ section, row }: { section: SectionSpec; row: RowSpec }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-xl border border-line/5 bg-zinc-950/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{row.title}</p>
          {row.subtitle && <p className="truncate text-xs text-zinc-500">{row.subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
        >
          {editing ? "Cancelar" : "Editar"}
        </button>
      </div>

      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          <form action={saveDataAction} className="flex flex-col gap-3">
            <input type="hidden" name="entity" value={section.entity} />
            <input type="hidden" name="id" value={row.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {section.editFields.map((f) => (
                <Field key={f.name} f={f} defaultValue={row.values[f.name]} />
              ))}
            </div>
            <SubmitButton
              pendingLabel="Guardando…"
              className="self-start rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-300"
            >
              Guardar cambios
            </SubmitButton>
          </form>
          <form
            action={deleteDataAction}
            onSubmit={(e) => {
              if (!confirm(`${section.deleteLabel}: "${row.title}". Esto no borra tu historial. ¿Seguro?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="entity" value={section.entity} />
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton pendingLabel="…" className="text-[11px] font-semibold text-rose-400 hover:text-rose-300">
              {section.deleteLabel}
            </SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}

function AddForm({ section }: { section: SectionSpec }) {
  const [open, setOpen] = useState(false);
  if (!section.addFields) {
    return (
      <Link
        href={`/app/chat?share=${encodeURIComponent(section.chatAddPrompt ?? "Quiero agregar algo")}`}
        className="mt-3 inline-block text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
      >
        Agregar por chat →
      </Link>
    );
  }
  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border border-emerald-400/40 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/10"
        >
          + Agregar
        </button>
      ) : (
        <form action={addDataAction} className="flex flex-col gap-3 rounded-xl border border-line/10 bg-zinc-950/40 p-3">
          <input type="hidden" name="entity" value={section.entity} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.addFields.map((f) => (
              <Field key={f.name} f={f} />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton
              pendingLabel="Agregando…"
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-300"
            >
              Agregar
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-300">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function DataSection({ section }: { section: SectionSpec }) {
  return (
    <section id={section.anchor} className="scroll-mt-20 rounded-2xl border border-line/5 bg-zinc-900 p-4">
      <p className="text-sm font-semibold text-zinc-100">{section.title}</p>
      {section.hint && <p className="mt-1 text-xs leading-5 text-zinc-500">{section.hint}</p>}
      {section.rows.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-zinc-500">{section.emptyText}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {section.rows.map((row) => (
            <Row key={row.id} section={section} row={row} />
          ))}
        </ul>
      )}
      <AddForm section={section} />
    </section>
  );
}
