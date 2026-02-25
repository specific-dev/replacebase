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

    // Ensure FK/PK columns needed for embeddings are included
    const embeddings = options.select.filter((s) => s.type === "embedding");
    const extraFkColumns: string[] = [];
    for (const emb of embeddings) {
      if (emb.type !== "embedding") continue;
      const childMeta = this.registry.getTable(emb.name);
      if (!childMeta) continue;
      const fk = this.findForeignKey(tableMeta, childMeta, emb.hint);
      if (!fk) continue;
      if (fk.direction === "child-to-parent") {
        // Need parent's PK column
        if (!selectedColumns[fk.parentColumn]) {
          const col = tableMeta.columns.get(fk.parentColumn);
          if (col) {
            selectedColumns[fk.parentColumn] = col.column;
            extraFkColumns.push(fk.parentColumn);
          }
        }
      } else {
        // Need parent's FK column
        if (!selectedColumns[fk.childColumn]) {
          const col = tableMeta.columns.get(fk.childColumn);
          if (col) {
            selectedColumns[fk.childColumn] = col.column;
            extraFkColumns.push(fk.childColumn);
          }
        }
      }
    }

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
        const dir = o.direction === "desc" ? "DESC" : "ASC";
        const nullsClause = o.nulls === "first" ? "NULLS FIRST" : o.nulls === "last" ? "NULLS LAST" : "";
        if (nullsClause) {
          return sql`${col.column} ${sql.raw(dir)} ${sql.raw(nullsClause)}`;
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
    if (embeddings.length > 0 && data.length > 0) {
      await this.resolveEmbeddings(data, embeddings, tableMeta);
    }

    // Remove extra FK columns that were added for embedding joins
    if (extraFkColumns.length > 0) {
      for (const row of data) {
        for (const col of extraFkColumns) {
          delete row[col];
        }
      }
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

    // Handle upsert: if resolution is set, default onConflict to primary keys
    const onConflict = options.onConflict || (
      options.prefer.resolution ? tableMeta.primaryKeys.join(",") : undefined
    );

    if (onConflict) {
      const conflictColumns = onConflict.split(",").map((c) => {
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

    if (options.prefer.return === "representation" || options.prefer.count === "exact") {
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

    if (options.prefer.return === "representation" || options.prefer.count === "exact") {
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

    if (options.prefer.return === "representation" || options.prefer.count === "exact") {
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
      case "wfts":
        return sql`${column} @@ websearch_to_tsquery(${value})`;
      case "match":
        return sql`${column} ~ ${value}`;
      case "imatch":
        return sql`${column} ~* ${value}`;
      case "isdistinct":
        return sql`${column} IS DISTINCT FROM ${this.coerceValue(column, value)}`;
      case "nxl":
        return sql`NOT (${column} << ${value})`;
      case "nxr":
        return sql`NOT (${column} >> ${value})`;
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

  private buildEmbeddingColumns(
    emb: ParsedSelectItem & { type: "embedding" },
    tableMeta: TableMeta,
    requiredFkColumn?: string
  ): Record<string, any> {
    const columns: Record<string, any> = {};
    const hasStar = emb.columns.some((s) => s.type === "star");
    const hasOnlyEmbeddings = emb.columns.every((s) => s.type === "embedding");

    if (hasStar || emb.columns.length === 0 || hasOnlyEmbeddings) {
      // Select all columns using DB names as keys
      for (const [colName, colMeta] of tableMeta.columns) {
        columns[colName] = colMeta.column;
      }
    } else {
      for (const item of emb.columns) {
        if (item.type === "column") {
          const col = tableMeta.columns.get(item.name);
          if (col) {
            columns[item.alias || item.name] = col.column;
          }
        }
      }
      // Always include the FK column needed for joining
      if (requiredFkColumn && !columns[requiredFkColumn]) {
        const fkCol = tableMeta.columns.get(requiredFkColumn);
        if (fkCol) {
          columns[requiredFkColumn] = fkCol.column;
        }
      }
    }
    return columns;
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
        const parentIds = parentData.map((r) => r[fk.parentColumn]);
        const uniqueIds = [...new Set(parentIds)];

        const childCol = childMeta.columns.get(fk.childColumn);
        if (!childCol) {
          throw new Error(`Column '${fk.childColumn}' not found in '${emb.name}'`);
        }

        // Build column selection for the embedding (using DB names as keys)
        const selectCols = this.buildEmbeddingColumns(emb, childMeta, fk.childColumn);

        const childData = await (this.db as any)
          .select(selectCols)
          .from(childMeta.table)
          .where(inArray(childCol.column, uniqueIds));

        // Group by FK
        const grouped = new Map<string, any[]>();
        for (const child of childData) {
          const key = String(child[fk.childColumn]);
          if (!grouped.has(key)) grouped.set(key, []);
          // Remove the FK column from output if it wasn't explicitly selected
          const output = { ...child };
          grouped.get(key)!.push(output);
        }

        // Resolve nested embeddings
        const nestedEmbeddings = emb.columns.filter((s) => s.type === "embedding");
        if (nestedEmbeddings.length > 0) {
          const allChildren = Array.from(grouped.values()).flat();
          if (allChildren.length > 0) {
            await this.resolveEmbeddings(allChildren, nestedEmbeddings, childMeta);
          }
        }

        // Attach to parent rows
        for (const row of parentData) {
          const key = String(row[fk.parentColumn]);
          const children = grouped.get(key) || [];
          if (emb.spread) {
            if (children.length > 0) {
              Object.assign(row, children[0]);
            }
          } else {
            row[embeddingKey] = children;
          }
        }

        // Handle !inner: remove parent rows without children
        if (emb.inner) {
          for (let i = parentData.length - 1; i >= 0; i--) {
            if (
              !emb.spread &&
              (!parentData[i][embeddingKey] ||
                parentData[i][embeddingKey].length === 0)
            ) {
              parentData.splice(i, 1);
            }
          }
        }
      } else if (fk.direction === "many-to-many") {
        // Many-to-many via junction table
        const junctionMeta = fk.junctionTable!;
        const junctionParentCol = junctionMeta.columns.get(fk.junctionParentColumn!);
        const junctionChildCol = junctionMeta.columns.get(fk.junctionChildColumn!);
        if (!junctionParentCol || !junctionChildCol) {
          throw new Error(`Junction table columns not found`);
        }

        const parentIds = parentData.map((r) => r[fk.parentColumn]);
        const uniqueParentIds = [...new Set(parentIds)];

        // Query junction table
        const junctionData = await (this.db as any)
          .select({
            [fk.junctionParentColumn!]: junctionParentCol.column,
            [fk.junctionChildColumn!]: junctionChildCol.column,
          })
          .from(junctionMeta.table)
          .where(inArray(junctionParentCol.column, uniqueParentIds));

        if (junctionData.length === 0) {
          for (const row of parentData) {
            row[embeddingKey] = [];
          }
          continue;
        }

        // Query child table
        const childIds = [...new Set(junctionData.map((j: any) => j[fk.junctionChildColumn!]))];
        const childMeta2 = this.registry.getTable(emb.name)!;
        const childPkCol = childMeta2.columns.get(fk.childColumn);
        if (!childPkCol) {
          throw new Error(`Column '${fk.childColumn}' not found in '${emb.name}'`);
        }

        const selectCols = this.buildEmbeddingColumns(emb, childMeta2, fk.childColumn);

        const childData = await (this.db as any)
          .select(selectCols)
          .from(childMeta2.table)
          .where(inArray(childPkCol.column, childIds));

        // Resolve nested embeddings
        const nestedEmbeddings = emb.columns.filter((s) => s.type === "embedding");
        if (nestedEmbeddings.length > 0 && childData.length > 0) {
          await this.resolveEmbeddings(childData, nestedEmbeddings, childMeta2);
        }

        // Build child lookup map
        const childMap = new Map<string, any>();
        for (const child of childData) {
          childMap.set(String(child[fk.childColumn]), child);
        }

        // Group by parent via junction
        const parentToChildren = new Map<string, any[]>();
        for (const j of junctionData) {
          const parentKey = String(j[fk.junctionParentColumn!]);
          const childKey = String(j[fk.junctionChildColumn!]);
          const child = childMap.get(childKey);
          if (child) {
            if (!parentToChildren.has(parentKey)) parentToChildren.set(parentKey, []);
            parentToChildren.get(parentKey)!.push(child);
          }
        }

        for (const row of parentData) {
          const key = String(row[fk.parentColumn]);
          row[embeddingKey] = parentToChildren.get(key) || [];
        }

        if (emb.inner) {
          for (let i = parentData.length - 1; i >= 0; i--) {
            if (parentData[i][embeddingKey].length === 0) {
              parentData.splice(i, 1);
            }
          }
        }
      } else {
        // parent-to-child: parent references child (many-to-one / one-to-one)
        const foreignIds = parentData
          .map((r) => r[fk.childColumn])
          .filter((v) => v != null);
        const uniqueIds = [...new Set(foreignIds)];

        if (uniqueIds.length === 0) {
          for (const row of parentData) {
            row[embeddingKey] = null;
          }
          continue;
        }

        const pkCol = childMeta.columns.get(fk.parentColumn);
        if (!pkCol) {
          throw new Error(`Column '${fk.parentColumn}' not found in '${emb.name}'`);
        }

        // Build column selection for the embedding (using DB names as keys)
        const selectCols = this.buildEmbeddingColumns(emb, childMeta, fk.parentColumn);

        const childData = await (this.db as any)
          .select(selectCols)
          .from(childMeta.table)
          .where(inArray(pkCol.column, uniqueIds));

        // Resolve nested embeddings
        const nestedEmbeddings = emb.columns.filter((s) => s.type === "embedding");
        if (nestedEmbeddings.length > 0 && childData.length > 0) {
          await this.resolveEmbeddings(childData, nestedEmbeddings, childMeta);
        }

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
  ): {
    parentColumn: string;
    childColumn: string;
    direction: "child-to-parent" | "parent-to-child" | "many-to-many";
    junctionTable?: TableMeta;
    junctionParentColumn?: string;
    junctionChildColumn?: string;
  } | null {
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

    // Check for many-to-many via a junction table
    for (const [, junctionMeta] of this.registry.getAllTables()) {
      let parentFk: { columns: string[]; foreignColumns: string[] } | null = null;
      let childFk: { columns: string[]; foreignColumns: string[] } | null = null;

      for (const fk of junctionMeta.foreignKeys) {
        if (fk.foreignTable === parentMeta.name) {
          parentFk = fk;
        }
        if (fk.foreignTable === childMeta.name) {
          childFk = fk;
        }
      }

      if (parentFk && childFk) {
        return {
          parentColumn: parentFk.foreignColumns[0],
          childColumn: childFk.foreignColumns[0],
          direction: "many-to-many",
          junctionTable: junctionMeta,
          junctionParentColumn: parentFk.columns[0],
          junctionChildColumn: childFk.columns[0],
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
