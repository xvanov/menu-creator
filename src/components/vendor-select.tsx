import type { SelectHTMLAttributes } from "react";
import { UNASSIGNED_VENDOR } from "@/lib/shopping/units";
import { Select } from "./ui";

/** Picks the vendor (proveedor) an ingredient is bought from. Keeps a current value that's no longer in the list. */
export function VendorSelect({ value, vendors, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { value: string; vendors: readonly string[] }) {
  const extra = value && value !== UNASSIGNED_VENDOR && !vendors.includes(value) ? [value] : [];
  return (
    <Select value={value} {...p}>
      {[...vendors, ...extra].map((v) => (
        <option key={v}>{v}</option>
      ))}
      <option>{UNASSIGNED_VENDOR}</option>
    </Select>
  );
}
