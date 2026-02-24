import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  isNull,
  isNotNull,
  and,
  or,
  not,
  sql,
  asc,
  desc,
  getTableColumns,
} from "drizzle-orm";
import type { PgTable, PgColumn, PgDatabase } from "drizzle-orm/pg-core";
import type {
  ParsedSelectItem,
  FilterNode,
  FilterCondition,
  LogicalFilter,
  OrderItem,
  PaginationParams,
  PreferParams,
} from "./parser/types.js";
import type { SchemaRegistry, TableMeta } from "./schema-registry.js";

export interface QueryResult {
  data: any[];
  totalCount?: number;
}

export interface SelectQueryOptions {
  table: string;
  select: ParsedSelectItem[];
  filters: FilterNode[];
  order: OrderItem[];
  pagination: PaginationParams;
  prefer: PreferParams;
}

export interface MutationOptions {
  table: string;
  filters: FilterNode[];
  prefer: PreferParams;
  body: any;
  onConflict?: string;
  columns?: string;
}

export class QueryBuilder {
  constructor(
    private registry: SchemaRegistry,
    private db: PgDatabase<any, any, any>
  ) {}

  async executeSelect(options: SelectQueryOptions): Promise<QueryResult> {
    const tableMeta = this.registry.getTable(options.table);
    if (!tableMeta) {
      throw new Error(`Table '${options.table}' not found in schema`);
    }

    const table = tableMeta.table;

    // Build column selection
    const selectedColumns = this.buildColumnSelection(
      options.select,
      tableMeta
    );

    // Build where clause
    const where = this.buildWhereClause(options.filters, tableMeta);

    // Build query
    let query = (this.db as any)
      .select(selectedColumns)
      .from(table)
      .$dynamic();

    if (where) {
      query = query.where(where);
    }

    // Apply ordering
    if (options.order.length > 0) {
      const orderClauses = options.order.map((o) => {
        const col = tableMeta.columns.get(o.column);
        if (!col) {
          throw new Error(
            `Column '${o.column}' not found in table '${options.table}'`
          );
        }
        const orderFn = o.direction === "desc" ? desc : asc;
        return orderFn(col.column);
      });
      query = query.orderBy(...orderClauses);
    }

    // Apply pagination
    if (options.pagination.limit !== undefined) {
      query = query.limit(options.pagination.limit);
    }
    if (options.pagination.offset !== undefined) {
      query = query.offset(options.pagination.offset);
    }

    const data = await query;

    // Handle count if requested
    let totalCount: number | undefined;
    if (options.prefer.count === "exact") {
      const countQuery = (this.db as any)
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .$dynamic();

      if (where) {
        countQuery.where(where);
      }

      const countResult = await countQuery;
      totalCount = countResult[0]?.count ?? 0;
    }

    // Handle embeddings
    const embeddings = options.select.filter(
      (s) => s.type === "embedding"
    );

    if (embeddings.length > 0 && data.length > 0) {
      await this.resolveEmbeddings(data, embeddings, tableMeta);
    }

    return { data, totalCount };
  }

  async executeInsert(options: MutationOptions): Promise<any[]> {
    const tableMeta = this.registry.getTable(options.table);
    if (!tableMeta) {
      throw new Error(`Table '${options.table}' not found in schema`);
    }

    const table = tableMeta.table;
    const rows = Array.isArray(options.body) ? options.body : [options.body];

    // Map JSON keys to column objects
    const mappedRows = rows.map((row) => this.mapInputToColumns(row, tableMeta));

    let query = (this.db as any).insert(table).values(mappedRows);

    // Handle upsert
    if (options.onConflict) {
      const conflictColumns = options.onConflict.split(",").map((c) => {
        const col = tableMeta.columns.get(c.trim());
        if (!col) {
          throw new Error(`Column '${c.trim()}' not found for on_conflict`);
        }
        return col.column;
      });

      // Build set clause for merge-duplicates
      if (options.prefer.resolution === "merge-duplicates") {
        const setCols: Record<string, any> = {};
        // Set all non-PK columns from the first row
        const inputKeys = Object.keys(mappedRows[0]);
        for (const key of inputKeys) {
          const colMeta = tableMeta.columns.get(key);
          if (colMeta && !colMeta.isPrimaryKey) {
            setCols[key] = sql`excluded.${sql.identifier(key)}`;
          }
        }

        query = query.onConflictDoUpdate({
          target: conflictColumns,
          set: setCols,
        });
      } else {
        query = query.onConflictDoNothing({
          target: conflictColumns,
        });
      }
    }

    if (options.prefer.return === "representation") {
      query = query.returning();
    }

    const result = await query;
    return result;
  }

  async executeUpdate(options: MutationOptions): Promise<any[]> {
    const tableMeta = this.registry.getTable(options.table);
    if (!tableMeta) {
      throw new Error(`Table '${options.table}' not found in schema`);
    }

    const table = tableMeta.table;
    const where = this.buildWhereClause(options.filters, tableMeta);

    const mappedBody = this.mapInputToColumns(options.body, tableMeta);

    let query = (this.db as any).update(table).set(mappedBody).$dynamic();

    if (where) {
      query = query.where(where);
    }

    if (options.prefer.return === "representation") {
      query = query.returning();
    }

    const result = await query;
    return result;
  }

  async executeDelete(options: MutationOptions): Promise<any[]> {
    const tableMeta = this.registry.getTable(options.table);
    if (!tableMeta) {
      throw new Error(`Table '${options.table}' not found in schema`);
    }

    const table = tableMeta.table;
    const where = this.buildWhereClause(options.filters, tableMeta);

    let query = (this.db as any).delete(table).$dynamic();

    if (where) {
      query = query.where(where);
    }

    if (options.prefer.return === "representation") {
      query = query.returning();
    }

    const result = await query;
    return result;
  }

  private buildColumnSelection(
    select: ParsedSelectItem[],
    tableMeta: TableMeta
  ): Record<string, any> {
    const columns: Record<string, any> = {};

    const hasStar = select.some((s) => s.type === "star");

    if (hasStar) {
      // Select all columns, using DB column names as keys
      for (const [colName, colMeta] of tableMeta.columns) {
        columns[colName] = colMeta.column;
      }
      return columns;
    }

    // Only select specified columns
    for (const item of select) {
      if (item.type === "column") {
        const col = tableMeta.columns.get(item.name);
        if (!col) {
          throw new Error(
            `Column '${item.name}' not found in table '${tableMeta.name}'`
          );
        }
        const key = item.alias || item.name;
        if (item.cast) {
          columns[key] = sql`${col.column}::${sql.identifier(item.cast)}`;
        } else {
          columns[key] = col.column;
        }
      }
      // Embeddings are handled separately
    }

    // If only embeddings were selected, select all scalar columns
    if (Object.keys(columns).length === 0) {
      for (const [colName, colMeta] of tableMeta.columns) {
        columns[colName] = colMeta.column;
      }
    }

    return columns;
  }

  private buildWhereClause(
    filters: FilterNode[],
    tableMeta: TableMeta
  ): any | undefined {
    if (filters.length === 0) return undefined;

    const conditions = filters.map((f) =>
      this.filterNodeToCondition(f, tableMeta)
    );

    return conditions.length === 1 ? conditions[0] : and(...conditions);
  }

  private filterNodeToCondition(node: FilterNode, tableMeta: TableMeta): any {
    if (node.type === "logical") {
      return this.logicalFilterToCondition(node, tableMeta);
    }
    return this.filterConditionToDrizzle(node, tableMeta);
  }

  private logicalFilterToCondition(
    node: LogicalFilter,
    tableMeta: TableMeta
  ): any {
    const conditions = node.conditions.map((c) =>
      this.filterNodeToCondition(c, tableMeta)
    );

    const combined =
      node.operator === "or" ? or(...conditions) : and(...conditions);

    return node.negate ? not(combined!) : combined;
  }

  private filterConditionToDrizzle(
    filter: FilterCondition,
    tableMeta: TableMeta
  ): any {
    const col = tableMeta.columns.get(filter.column);
    if (!col) {
      throw new Error(
        `Column '${filter.column}' not found in table '${tableMeta.name}'`
      );
    }

    let condition = this.applyOperator(col.column, filter.operator, filter.value);

    if (filter.negate) {
      condition = not(condition);
    }

    return condition;
  }

  private coerceValue(column: PgColumn, value: string): any {
    const dt = column.dataType;
    if (dt === "boolean") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    if (dt === "bigint") {
      return Number(value);
    }
    // For integer types, Drizzle uses "custom" or "string" but the columnType
    // contains the actual PG type. Check the column type for numeric types.
    const ct = column.columnType;
    if (ct === "PgInteger" || ct === "PgSmallInt" || ct === "PgBigInt53") {
      return Number(value);
    }
    return value;
  }

  private applyOperator(column: PgColumn, operator: string, value: string): any {
    switch (operator) {
      case "eq":
        return eq(column, this.coerceValue(column, value));
      case "neq":
        return ne(column, this.coerceValue(column, value));
      case "gt":
        return gt(column, this.coerceValue(column, value));
      case "gte":
        return gte(column, this.coerceValue(column, value));
      case "lt":
        return lt(column, this.coerceValue(column, value));
      case "lte":
        return lte(column, this.coerceValue(column, value));
      case "like":
        return like(column, value.replace(/\*/g, "%"));
      case "ilike":
        return ilike(column, value.replace(/\*/g, "%"));
      case "in": {
        // Parse "(val1,val2,val3)" format
        const inner = value.slice(1, -1); // Remove parens
        const values = this.parseInValues(inner);
        return inArray(column, values);
      }
      case "is":
        if (value === "null") return isNull(column);
        if (value === "true") return eq(column, sql`true`);
        if (value === "false") return eq(column, sql`false`);
        throw new Error(`Invalid is value: ${value}`);
      case "cs":
        return sql`${column} @> ${value}`;
      case "cd":
        return sql`${column} <@ ${value}`;
      case "ov":
        return sql`${column} && ${value}`;
      case "sl":
        return sql`${column} << ${value}`;
      case "sr":
        return sql`${column} >> ${value}`;
      case "adj":
        return sql`${column} -|- ${value}`;
      case "fts":
        return sql`${column} @@ to_tsquery(${value})`;
      case "plfts":
        return sql`${column} @@ plainto_tsquery(${value})`;
      case "phfts":
        return sql`${column} @@ phraseto_tsquery(${value})`;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }

  private parseInValues(input: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuote = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === '"' && !inQuote) {
        inQuote = true;
      } else if (char === '"' && inQuote) {
        inQuote = false;
      } else if (char === "," && !inQuote) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    if (current) {
      values.push(current);
    }

    return values;
  }

  private async resolveEmbeddings(
    parentData: any[],
    embeddings: ParsedSelectItem[],
    parentMeta: TableMeta
  ): Promise<void> {
    for (const emb of embeddings) {
      if (emb.type !== "embedding") continue;

      const childMeta = this.registry.getTable(emb.name);
      if (!childMeta) {
        throw new Error(`Embedded table '${emb.name}' not found in schema`);
      }

      // Find the foreign key relationship
      const fk = this.findForeignKey(parentMeta, childMeta, emb.hint);

      if (!fk) {
        throw new Error(
          `No relationship found between '${parentMeta.name}' and '${emb.name}'`
        );
      }

      const embeddingKey = emb.alias || emb.name;

      if (fk.direction === "child-to-parent") {
        // Parent has many children (children reference parent)
        // Collect parent IDs
        const parentIds = parentData.map((r) => r[fk.parentColumn]);
        const uniqueIds = [...new Set(parentIds)];

        // Query children
        const childCol = childMeta.columns.get(fk.childColumn);
        if (!childCol) {
          throw new Error(`Column '${fk.childColumn}' not found in '${emb.name}'`);
        }

        const childData = await (this.db as any)
          .select()
          .from(childMeta.table)
          .where(inArray(childCol.column, uniqueIds));

        // Group by FK
        const grouped = new Map<string, any[]>();
        for (const child of childData) {
          const key = String(child[fk.childColumn]);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(child);
        }

        // Attach to parent rows
        for (const row of parentData) {
          const key = String(row[fk.parentColumn]);
          const children = grouped.get(key) || [];
          if (emb.spread) {
            // Spread: merge child fields into parent
            if (children.length > 0) {
              Object.assign(row, children[0]);
            }
          } else {
            row[embeddingKey] = children;
          }
        }

        // Handle !inner: remove parent rows without children
        if (emb.inner) {
          const toRemove: number[] = [];
          for (let i = parentData.length - 1; i >= 0; i--) {
            if (
              !emb.spread &&
              (!parentData[i][embeddingKey] ||
                parentData[i][embeddingKey].length === 0)
            ) {
              toRemove.push(i);
            }
          }
          for (const idx of toRemove) {
            parentData.splice(idx, 1);
          }
        }
      } else {
        // parent-to-child: parent references child (many-to-one / one-to-one)
        const parentCol = parentMeta.columns.get(fk.childColumn);
        if (!parentCol) {
          throw new Error(`Column '${fk.childColumn}' not found in '${parentMeta.name}'`);
        }

        const foreignIds = parentData
          .map((r) => r[fk.childColumn])
          .filter((v) => v != null);
        const uniqueIds = [...new Set(foreignIds)];

        if (uniqueIds.length === 0) {
          for (const row of parentData) {
            row[embeddingKey] = null;
          }
          return;
        }

        const pkCol = childMeta.columns.get(fk.parentColumn);
        if (!pkCol) {
          throw new Error(`Column '${fk.parentColumn}' not found in '${emb.name}'`);
        }

        const childData = await (this.db as any)
          .select()
          .from(childMeta.table)
          .where(inArray(pkCol.column, uniqueIds));

        const childMap = new Map<string, any>();
        for (const child of childData) {
          childMap.set(String(child[fk.parentColumn]), child);
        }

        for (const row of parentData) {
          const fkValue = row[fk.childColumn];
          const child = fkValue ? childMap.get(String(fkValue)) : null;
          if (emb.spread && child) {
            Object.assign(row, child);
          } else {
            row[embeddingKey] = child || null;
          }
        }
      }
    }
  }

  private findForeignKey(
    parentMeta: TableMeta,
    childMeta: TableMeta,
    hint?: string
  ): { parentColumn: string; childColumn: string; direction: "child-to-parent" | "parent-to-child" } | null {
    // Check if child has FK pointing to parent (one-to-many: parent has many children)
    for (const fk of childMeta.foreignKeys) {
      if (fk.foreignTable === parentMeta.name) {
        if (hint && !fk.columns.includes(hint) && !fk.foreignColumns.includes(hint)) {
          continue;
        }
        return {
          parentColumn: fk.foreignColumns[0],
          childColumn: fk.columns[0],
          direction: "child-to-parent",
        };
      }
    }

    // Check if parent has FK pointing to child (many-to-one: parent references child)
    for (const fk of parentMeta.foreignKeys) {
      if (fk.foreignTable === childMeta.name) {
        if (hint && !fk.columns.includes(hint) && !fk.foreignColumns.includes(hint)) {
          continue;
        }
        return {
          parentColumn: fk.foreignColumns[0],
          childColumn: fk.columns[0],
          direction: "parent-to-child",
        };
      }
    }

    return null;
  }

  private mapInputToColumns(
    input: Record<string, any>,
    tableMeta: TableMeta
  ): Record<string, any> {
    const mapped: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      // Look up by DB column name
      const col = tableMeta.columns.get(key);
      if (col) {
        // Use Drizzle field name as key for insert/update
        mapped[col.fieldName] = value;
      }
    }
    return mapped;
  }
}
