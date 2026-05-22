// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect — Postgres schema inspector.
// Connects to the monitored service's database using DATABASE_URL and reads
// table/column metadata from information_schema + pg_stat_user_tables.
// Only runs every N probe cycles (controlled by the caller) since schema
// rarely changes.

package collect

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

const dbQueryTimeout = 10 * time.Second

// ── Types ─────────────────────────────────────────────────────────────────────

type DBColumn struct {
	Name       string `json:"name"`
	DataType   string `json:"data_type"`
	Nullable   bool   `json:"nullable"`
	HasDefault bool   `json:"has_default"`
	IsPK       bool   `json:"is_pk,omitempty"`
}

type DBTable struct {
	Name      string     `json:"name"`
	RowEst    int64      `json:"row_est"`    // live tuple estimate from pg_stat
	SizeBytes int64      `json:"size_bytes"` // total relation size incl. indexes
	Columns   []DBColumn `json:"columns"`
}

type DatabaseInfo struct {
	Connected   bool      `json:"connected"`
	Version     string    `json:"version,omitempty"`
	DBName      string    `json:"db_name,omitempty"`
	SizeBytes   int64     `json:"size_bytes"`
	Tables      []DBTable `json:"tables"`
	Error       string    `json:"error,omitempty"`
	CollectedAt string    `json:"collected_at"`
}

// ── Collector ─────────────────────────────────────────────────────────────────

// CollectDatabase connects to dbURL (postgres://…) and returns schema metadata.
// Returns an empty DatabaseInfo (Connected=false) if dbURL is blank.
func CollectDatabase(dbURL string) DatabaseInfo {
	ts := time.Now().UTC().Format(time.RFC3339)
	if dbURL == "" {
		return DatabaseInfo{CollectedAt: ts}
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return DatabaseInfo{Error: fmt.Sprintf("open: %v", err), CollectedAt: ts}
	}
	defer db.Close()
	db.SetConnMaxLifetime(dbQueryTimeout)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return DatabaseInfo{Error: fmt.Sprintf("connect: %v", err), CollectedAt: ts}
	}

	info := DatabaseInfo{Connected: true, CollectedAt: ts}

	// ── Version, current DB name, overall size ────────────────────────────────
	_ = db.QueryRowContext(ctx,
		"SELECT version(), current_database(), pg_database_size(current_database())",
	).Scan(&info.Version, &info.DBName, &info.SizeBytes)

	// ── Table list with row estimates and sizes ───────────────────────────────
	tableRows, err := db.QueryContext(ctx, `
		SELECT
			c.relname                                        AS table_name,
			COALESCE(s.n_live_tup, 0)                       AS row_est,
			COALESCE(pg_total_relation_size(c.oid), 0)      AS size_bytes
		FROM   pg_class c
		JOIN   pg_namespace n ON n.oid = c.relnamespace
		LEFT   JOIN pg_stat_user_tables s
			ON s.relname = c.relname AND s.schemaname = n.nspname
		WHERE  c.relkind = 'r'
		AND    n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER  BY size_bytes DESC
		LIMIT  80
	`)
	if err != nil {
		info.Error = fmt.Sprintf("tables: %v", err)
		return info
	}
	defer tableRows.Close()

	for tableRows.Next() {
		var t DBTable
		if err := tableRows.Scan(&t.Name, &t.RowEst, &t.SizeBytes); err != nil {
			continue
		}
		info.Tables = append(info.Tables, t)
	}
	tableRows.Close()

	// ── Primary-key set per table ─────────────────────────────────────────────
	pkMap := map[string]map[string]bool{}
	pkRows, err := db.QueryContext(ctx, `
		SELECT kcu.table_name, kcu.column_name
		FROM   information_schema.key_column_usage   kcu
		JOIN   information_schema.table_constraints  tc
			ON  tc.constraint_name = kcu.constraint_name
			AND tc.table_schema    = kcu.table_schema
		WHERE  tc.constraint_type = 'PRIMARY KEY'
		AND    kcu.table_schema NOT IN ('pg_catalog','information_schema')
	`)
	if err == nil {
		for pkRows.Next() {
			var tbl, col string
			if pkRows.Scan(&tbl, &col) == nil {
				if pkMap[tbl] == nil {
					pkMap[tbl] = map[string]bool{}
				}
				pkMap[tbl][col] = true
			}
		}
		pkRows.Close()
	}

	// ── Columns for every table ───────────────────────────────────────────────
	for i, t := range info.Tables {
		colRows, err := db.QueryContext(ctx, `
			SELECT
				column_name,
				data_type,
				is_nullable = 'YES',
				column_default IS NOT NULL
			FROM   information_schema.columns
			WHERE  table_name   = $1
			AND    table_schema NOT IN ('pg_catalog','information_schema')
			ORDER  BY ordinal_position
		`, t.Name)
		if err != nil {
			continue
		}
		for colRows.Next() {
			var c DBColumn
			if err := colRows.Scan(&c.Name, &c.DataType, &c.Nullable, &c.HasDefault); err != nil {
				continue
			}
			if pkMap[t.Name][c.Name] {
				c.IsPK = true
			}
			info.Tables[i].Columns = append(info.Tables[i].Columns, c)
		}
		colRows.Close()
	}

	return info
}
