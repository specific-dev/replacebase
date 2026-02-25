import {
  getTableName,
  getTableColumns,
  is,
  Table,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

export interface ColumnMeta {
  name: string;
  fieldName: string; // Drizzle JS field name (camelCase)
  dataType: string;
  columnType: string;
  notNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  column: PgColumn;
}

export interface ForeignKeyMeta {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
}

export interface TableMeta {
  name: string;
  schema: string | undefined;
  columns: Map<string, ColumnMeta>;
  primaryKeys: string[];
  foreignKeys: ForeignKeyMeta[];
  table: PgTable;
  isView: boolean;
}

export class SchemaRegistry {
  private tables = new Map<string, TableMeta>();

  constructor(schema: Record<string, unknown>, externalForeignKeys?: Map<string, ForeignKeyMeta[]>, views?: Set<string>) {
    this.registerSchema(schema, views);
    if (externalForeignKeys) {
      this.injectForeignKeys(externalForeignKeys);
    }
  }

  private registerSchema(schema: Record<string, unknown>, views?: Set<string>): void {
    for (const [_key, value] of Object.entries(schema)) {
      if (is(value, Table)) {
        const table = value as PgTable;
        const tableName = getTableName(table);
        this.registerTable(table, views?.has(tableName) ?? false);
      }
    }
  }

  private registerTable(table: PgTable, isView: boolean = false): void {
    const tableName = getTableName(table);
    const rawColumns = getTableColumns(table);
    const config = getTableConfig(table);

    const columns = new Map<string, ColumnMeta>();
    const primaryKeys: string[] = [];

    for (const [fieldName, col] of Object.entries(rawColumns)) {
      const pgCol = col as PgColumn;
      const colMeta: ColumnMeta = {
        name: pgCol.name,
        fieldName,
        dataType: pgCol.dataType,
        columnType: pgCol.columnType,
        notNull: pgCol.notNull,
        hasDefault: pgCol.hasDefault,
        isPrimaryKey: pgCol.primary,
        column: pgCol,
      };
      columns.set(pgCol.name, colMeta);
      if (pgCol.primary) {
        primaryKeys.push(pgCol.name);
      }
    }

    // Extract foreign keys using getTableConfig
    const foreignKeys: ForeignKeyMeta[] = [];
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      foreignKeys.push({
        columns: ref.columns.map((c) => c.name),
        foreignTable: getTableName(ref.foreignTable),
        foreignColumns: ref.foreignColumns.map((c) => c.name),
      });
    }

    const meta: TableMeta = {
      name: tableName,
      schema: config.schema,
      columns,
      primaryKeys,
      foreignKeys,
      table,
      isView,
    };

    this.tables.set(tableName, meta);
  }

  getTable(name: string): TableMeta | undefined {
    return this.tables.get(name);
  }

  getAllTables(): Map<string, TableMeta> {
    return this.tables;
  }

  hasTable(name: string): boolean {
    return this.tables.has(name);
  }

  /**
   * Inject foreign key metadata from database introspection.
   * Used when tables are built dynamically and don't have Drizzle .references() set.
   * Keyed by table name to avoid ambiguity when multiple tables share column names.
   */
  private injectForeignKeys(foreignKeysByTable: Map<string, ForeignKeyMeta[]>): void {
    for (const [tableName, fks] of foreignKeysByTable) {
      const meta = this.tables.get(tableName);
      if (!meta) continue;

      for (const fk of fks) {
        const exists = meta.foreignKeys.some(
          (existing) =>
            existing.foreignTable === fk.foreignTable &&
            existing.columns.join(",") === fk.columns.join(",")
        );
        if (!exists) {
          meta.foreignKeys.push(fk);
        }
      }
    }
  }
}
