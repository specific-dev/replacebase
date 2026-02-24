import {
  getTableName,
  getTableColumns,
  is,
  Table,
  sql,
} from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

export interface ColumnMeta {
  name: string;
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

    const columns = new Map<string, ColumnMeta>();
    const primaryKeys: string[] = [];

    for (const [_fieldName, col] of Object.entries(rawColumns)) {
      const pgCol = col as PgColumn;
      const colMeta: ColumnMeta = {
        name: pgCol.name,
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

    // Extract foreign keys from table config
    const foreignKeys: ForeignKeyMeta[] = [];
    const tableConfig = (table as any)[Table.Symbol.ExtraConfigColumns];

    // Use Drizzle's internal config to get foreign keys
    const fks = (table as any)[Symbol.for("drizzle:ForeignKeys")];

    const meta: TableMeta = {
      name: tableName,
      schema: (table as any)[Table.Symbol.Schema] as string | undefined,
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
