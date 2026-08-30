# Backup and restore validation

The supported database backup path is SQLite's online backup operation against
the configured `POSITRON_DB_PATH`, followed by restore to a fresh location and
opening through the normal migration path. Production data was not used.
Automated realistic-fixture validation is pending before release closure.
