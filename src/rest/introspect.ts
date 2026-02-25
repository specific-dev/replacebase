import {
  pgTable,
  pgSchema,
  text,
  integer,
  bigint,
  smallint,
  boolean,
  uuid,
  timestamp,
  date,
  time,
  json,
  jsonb,
  real,
  doublePrecision,
  numeric,
  varchar,
  char,
  serial,
  smallserial,
  bigserial,
  inet,
  cidr,
  macaddr,
  macaddr8,
  interval,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import type { PgTable, PgColumnBuilderBase } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ForeignKeyMeta } from "./schema-registry";

interface IntrospectedColumn {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  hasDefault: boolean;
  isArray: boolean;
  characterMaxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
}

interface IntrospectedTable {
  name: string;
  schema: string;
  columns: IntrospectedColumn[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyMeta[];
}

export interface IntrospectionResult {
  tables: Record<string, PgTable>;
  foreignKeys: Map<string, ForeignKeyMeta[]>;
}

export async function introspectDatabase(
  db: PgDatabase<any, any, any>,
  schemas: string[] = ["public"]
): Promise<IntrospectionResult> {
  const tables = await discoverTables(db, schemas);
  const drizzleTables = buildDrizzleSchema(tables);

  // Collect foreign keys keyed by source table name
  const foreignKeysByTable = new Map<string, ForeignKeyMeta[]>();
  for (const table of tables) {
    if (table.foreignKeys.length > 0) {
      foreignKeysByTable.set(table.name, table.foreignKeys);
    }
  }

  return { tables: drizzleTables, foreignKeys: foreignKeysByTable };
}

async function discoverTables(
  db: PgDatabase<any, any, any>,
  schemas: string[]
): Promise<IntrospectedTable[]> {
  // Build schema filter: table_schema IN ('public', 'other', ...)
  // Using IN with individual params instead of ANY(array) for PGlite compat
  const schemaFilter = sql.join(
    schemas.map((s) => sql`${s}`),
    sql`, `
  );

  // Query all tables
  const tablesResult = await (db as any).execute(sql`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN (${schemaFilter})
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `);
  const tableRows = normalizeRows(tablesResult);

  // Query all columns
  const columnsResult = await (db as any).execute(sql`
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
    FROM information_schema.columns
    WHERE table_schema IN (${schemaFilter})
    ORDER BY table_schema, table_name, ordinal_position
  `);
  const columnRows = normalizeRows(columnsResult);

  // Query primary keys
  const pkResult = await (db as any).execute(sql`
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema IN (${schemaFilter})
    ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
  `);
  const pkRows = normalizeRows(pkResult);

  // Query foreign keys
  const fkResult = await (db as any).execute(sql`
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema IN (${schemaFilter})
    ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
  `);
  const fkRows = normalizeRows(fkResult);

  // Build structured metadata
  const tables: IntrospectedTable[] = [];

  for (const tableRow of tableRows) {
    const schema = tableRow.table_schema;
    const name = tableRow.table_name;

    const columns: IntrospectedColumn[] = columnRows
      .filter(
        (c: any) => c.table_schema === schema && c.table_name === name
      )
      .map((c: any) => ({
        name: c.column_name,
        dataType: c.data_type,
        udtName: c.udt_name,
        isNullable: c.is_nullable === "YES",
        hasDefault: c.column_default !== null && c.column_default !== undefined,
        isArray: c.data_type === "ARRAY",
        characterMaxLength: c.character_maximum_length
          ? Number(c.character_maximum_length)
          : null,
        numericPrecision: c.numeric_precision
          ? Number(c.numeric_precision)
          : null,
        numericScale: c.numeric_scale !== null && c.numeric_scale !== undefined
          ? Number(c.numeric_scale)
          : null,
      }));

    const primaryKeys = pkRows
      .filter(
        (pk: any) => pk.table_schema === schema && pk.table_name === name
      )
      .map((pk: any) => pk.column_name);

    // Group FK columns by constraint (multi-column FKs)
    const fkForTable = fkRows.filter(
      (fk: any) => fk.table_schema === schema && fk.table_name === name
    );
    const foreignKeys: ForeignKeyMeta[] = [];
    // Each row is one column of the FK — group them
    const fkMap = new Map<string, ForeignKeyMeta>();
    for (const fk of fkForTable) {
      const key = `${fk.column_name}->${fk.foreign_table_name}.${fk.foreign_column_name}`;
      // Simple: each FK row from information_schema with single-column FKs
      // For multi-column FKs we'd need constraint_name grouping, but this works
      // for the common case
      if (!fkMap.has(key)) {
        fkMap.set(key, {
          columns: [fk.column_name],
          foreignTable: fk.foreign_table_name,
          foreignColumns: [fk.foreign_column_name],
        });
      }
    }
    foreignKeys.push(...fkMap.values());

    tables.push({ name, schema, columns, primaryKeys, foreignKeys });
  }

  return tables;
}

function buildDrizzleSchema(
  tables: IntrospectedTable[]
): Record<string, PgTable> {
  const result: Record<string, PgTable> = {};

  for (const table of tables) {
    const columns: Record<string, any> = {};

    for (const col of table.columns) {
      let builder = mapColumnType(col);

      if (!col.isNullable) {
        builder = builder.notNull();
      }

      if (col.hasDefault) {
        // Mark as having a default without specifying the value —
        // Drizzle just needs to know it can be omitted on insert
        builder = builder.default(sql`DEFAULT`);
      }

      if (
        table.primaryKeys.length === 1 &&
        table.primaryKeys[0] === col.name
      ) {
        builder = builder.primaryKey();
      }

      columns[col.name] = builder;
    }

    // Handle composite primary keys
    const extraConfig =
      table.primaryKeys.length > 1
        ? (t: any) => [
            primaryKey({
              columns: table.primaryKeys.map((pk) => t[pk]),
            }),
          ]
        : undefined;

    if (table.schema === "public") {
      result[table.name] = extraConfig
        ? pgTable(table.name, columns, extraConfig)
        : pgTable(table.name, columns);
    } else {
      const schema = pgSchema(table.schema);
      result[table.name] = extraConfig
        ? schema.table(table.name, columns, extraConfig)
        : schema.table(table.name, columns);
    }
  }

  return result;
}

const fallbackType = customType<{ data: unknown }>({
  dataType() {
    return "text";
  },
});

function mapColumnType(col: IntrospectedColumn): any {
  // Handle array columns — use the base element type with .array()
  if (col.isArray) {
    const baseCol: IntrospectedColumn = {
      ...col,
      isArray: false,
      // Strip leading underscore from udt_name for array types (e.g. _text -> text)
      udtName: col.udtName.startsWith("_")
        ? col.udtName.slice(1)
        : col.udtName,
      dataType: col.udtName.startsWith("_")
        ? col.udtName.slice(1)
        : col.dataType,
    };
    const baseBuilder = mapColumnType(baseCol);
    return baseBuilder.array();
  }

  const udtName = col.udtName;

  switch (udtName) {
    case "text":
      return text(col.name);
    case "varchar":
    case "bpchar": // char(n) shows as bpchar in udt_name
      if (col.characterMaxLength) {
        return col.udtName === "bpchar"
          ? char(col.name, { length: col.characterMaxLength })
          : varchar(col.name, { length: col.characterMaxLength });
      }
      return col.udtName === "bpchar" ? char(col.name) : varchar(col.name);
    case "int4":
    case "int":
    case "integer":
      return integer(col.name);
    case "int2":
    case "smallint":
      return smallint(col.name);
    case "int8":
    case "bigint":
      return bigint(col.name, { mode: "number" });
    case "serial":
      return serial(col.name);
    case "smallserial":
      return smallserial(col.name);
    case "bigserial":
      return bigserial(col.name, { mode: "number" });
    case "bool":
    case "boolean":
      return boolean(col.name);
    case "uuid":
      return uuid(col.name);
    case "timestamp":
      return timestamp(col.name, { withTimezone: false });
    case "timestamptz":
      return timestamp(col.name, { withTimezone: true });
    case "date":
      return date(col.name);
    case "time":
      return time(col.name, { withTimezone: false });
    case "timetz":
      return time(col.name, { withTimezone: true });
    case "interval":
      return interval(col.name);
    case "json":
      return json(col.name);
    case "jsonb":
      return jsonb(col.name);
    case "float4":
    case "real":
      return real(col.name);
    case "float8":
    case "double precision":
      return doublePrecision(col.name);
    case "numeric":
    case "decimal":
      return numeric(col.name, {
        precision: col.numericPrecision ?? undefined,
        scale: col.numericScale ?? undefined,
      });
    case "inet":
      return inet(col.name);
    case "cidr":
      return cidr(col.name);
    case "macaddr":
      return macaddr(col.name);
    case "macaddr8":
      return macaddr8(col.name);
    default:
      // Fallback for enums, tsvector, etc.
      return customType<{ data: unknown }>({
        dataType() {
          return udtName;
        },
      })(col.name);
  }
}

/** Normalize query results — PGlite returns { rows }, postgres.js returns array */
function normalizeRows(result: any): any[] {
  return Array.isArray(result) ? result : result.rows || [];
}
