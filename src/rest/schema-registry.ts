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
}

export class SchemaRegistry {
  private tables = new Map<string, TableMeta>();

  constructor(schema: Record<string, unknown>) {
    this.registerSchema(schema);
  }

  private registerSchema(schema: Record<string, unknown>): void {
    for (const [_key, value] of Object.entries(schema)) {
      if (is(value, Table)) {
        const table = value as PgTable;
        this.registerTable(table);
      }
    }
  }

  private registerTable(table: PgTable): void {
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
}
