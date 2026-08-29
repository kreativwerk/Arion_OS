/** Whitelist: Welche Tabellen über die generische CRUD-API erreichbar sind
 *  und welche Spalten dabei geschrieben werden dürfen. */
export const TABLES: Record<string, { columns: string[]; orderBy?: string }> = {
  tasks: {
    columns: ["title", "notes", "horizon", "due_date", "recurrence", "project", "priority", "done", "completed_at", "source", "submitted_by", "accepted"],
    orderBy: "done ASC, due_date IS NULL, due_date ASC, priority ASC",
  },
  habits: { columns: ["name", "emoji", "target_per_week"] },
  clipboard_items: { columns: ["content", "label", "pinned"], orderBy: "pinned DESC, created_at DESC" },
  calendar_events: { columns: ["title", "date", "start_time", "end_time", "location", "notes", "source"], orderBy: "date ASC, start_time ASC" },
  knowledge_notes: { columns: ["title", "body", "scope", "partner", "tags", "updated_at"], orderBy: "updated_at DESC" },
  contracts: { columns: ["name", "provider", "category", "policy_number", "annual_cost", "start_date", "end_date", "cancel_period_days", "notes"], orderBy: "end_date ASC" },
  letters: { columns: ["subject", "sender", "received_date", "scanned_by", "status", "summary", "file_ref"], orderBy: "received_date DESC" },
  mail_accounts: { columns: ["label", "address", "active"] },
  mail_rules: { columns: ["kind", "value"] },
  mail_digest: { columns: ["account", "from_addr", "subject", "summary", "matched_rule", "important", "read"], orderBy: "received_at DESC" },
  watchers: { columns: ["name", "url", "hint", "interval_minutes", "last_checked", "active"] },
  watcher_events: { columns: ["watcher_id", "title", "detail", "seen"], orderBy: "created_at DESC" },
  slack_rules: { columns: ["person", "note"] },
  slack_notifications: { columns: ["from_person", "channel", "text", "important", "read"], orderBy: "created_at DESC" },
};
