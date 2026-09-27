import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Course, RuleParams } from "@/lib/types";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const dishes = sqliteTable("dishes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  course: text("course").$type<Course>().notNull(), // usual course; a menu item may use it elsewhere
  category: text("category").notNull(),
  base: text("base"),
  protein: text("protein"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status").$type<"activo" | "nuevo" | "archivado">().notNull().default("activo"),
  price: real("price"), // price when served as an extra
  costPerPortion: real("cost_per_portion"), // manual override; null = computed from recipe
  defaultPortions: integer("default_portions"), // null = settings.defaultPortions
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
});

export const ingredients = sqliteTable("ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull().default("kg"), // unit for recipe/stock quantities
  storeSection: text("store_section").notNull().default("mercado"), // mercado | pollería | carnicería | pescadería | abarrotes
  pricePerUnit: real("price_per_unit"),
  stockQty: real("stock_qty").notNull().default(0), // what is in storage right now
  stockUpdatedAt: text("stock_updated_at"),
  alwaysCheckStock: integer("always_check_stock", { mode: "boolean" }).notNull().default(false),
});

export const recipeItems = sqliteTable(
  "recipe_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dishId: integer("dish_id").notNull().references(() => dishes.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
    qtyPerPortion: real("qty_per_portion").notNull().default(0), // in ingredients.unit
    fixedQty: real("fixed_qty").notNull().default(0), // per batch, independent of portions
    source: text("source").$type<"ai" | "manual" | "learned">().notNull().default("ai"),
    corrections: integer("corrections").notNull().default(0),
  },
  (t) => [uniqueIndex("recipe_dish_ingredient").on(t.dishId, t.ingredientId)],
);

export const menus = sqliteTable("menus", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(), // YYYY-MM-DD service date
  status: text("status").$type<"borrador" | "publicado">().notNull().default("borrador"),
  menuPrice: real("menu_price").notNull().default(13),
  source: text("source").$type<"historial" | "generado" | "manual">().notNull().default("generado"),
  reasoning: text("reasoning"), // generator explanation
  warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const menuItems = sqliteTable("menu_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  menuId: integer("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  dishId: integer("dish_id").references(() => dishes.id),
  name: text("name").notNull(), // display name (editable, defaults to dish name)
  course: text("course").$type<Course>().notNull(),
  price: real("price"), // extras only
  portions: integer("portions"),
  position: integer("position").notNull().default(0),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  reason: text("reason"),
});

export const shoppingLines = sqliteTable("shopping_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  menuId: integer("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").references(() => ingredients.id),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  needed: real("needed").notNull().default(0), // computed from recipes x portions
  inStock: real("in_stock").notNull().default(0),
  quantity: real("quantity").notNull().default(0), // what to buy (editable)
  suggested: real("suggested").notNull().default(0), // system value at last compute, to detect edits
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  source: text("source").$type<"calculado" | "manual" | "regla">().notNull().default("calculado"),
  note: text("note"),
  checked: integer("checked", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull().default(0),
});

export const corrections = sqliteTable("corrections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<"recipe" | "shopping" | "portions" | "stock" | "cost">().notNull(),
  dishId: integer("dish_id"),
  ingredientId: integer("ingredient_id"),
  menuId: integer("menu_id"),
  before: real("before"),
  after: real("after"),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now),
});

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  params: text("params", { mode: "json" }).$type<RuleParams>().notNull(),
  hard: integer("hard", { mode: "boolean" }).notNull().default(true),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

// Knowledge mined from the WhatsApp chat (read-only reference for the LLM / seeds)
export const shoppingNotes = sqliteTable("shopping_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(),
  serviceDate: text("service_date"),
  type: text("type").notNull(),
  dish: text("dish"),
  rule: text("rule"),
  items: text("items", { mode: "json" }).notNull(),
  raw: text("raw").notNull(),
});
