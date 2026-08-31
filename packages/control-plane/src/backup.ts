import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyControlPlaneMigrations } from './schema.js';

export class BackupValidationError extends Error {
	readonly code = 'BACKUP_VALIDATION_FAILED';
}

function assertRegularDatabasePath(filePath: string, role: 'source' | 'target'): void {
	if (!filePath || !path.isAbsolute(filePath)) {
		throw new BackupValidationError(`${role} database path must be absolute`);
	}
	if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
		throw new BackupValidationError(`${role} database path must not be a symlink`);
	}
}

function assertIntegrity(db: Database.Database, label: string): void {
	const result = db.pragma('integrity_check', { simple: true }) as unknown;
	if (result !== 'ok') throw new BackupValidationError(`${label} integrity check failed`);
}

/**
 * The only supported backup primitive. better-sqlite3's online backup API
 * includes committed pages while writers are active and handles WAL state.
 */
export async function backupDatabase(
	db: Database.Database,
	destinationPath: string,
): Promise<void> {
	assertRegularDatabasePath(destinationPath, 'target');
	if (fs.existsSync(destinationPath)) {
		throw new BackupValidationError('refusing to overwrite an existing backup');
	}
	fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
	assertIntegrity(db, 'source');
	await db.backup(destinationPath);
	const backup = new Database(destinationPath, { readonly: true });
	try {
		assertIntegrity(backup, 'backup');
	} finally {
		backup.close();
	}
}

/** Restore only into a fresh, regular file; failures never create an empty DB. */
export async function restoreDatabase(
	backupPath: string,
	destinationPath: string,
): Promise<Database.Database> {
	assertRegularDatabasePath(backupPath, 'source');
	assertRegularDatabasePath(destinationPath, 'target');
	if (!fs.existsSync(backupPath)) throw new BackupValidationError('backup does not exist');
	if (fs.existsSync(destinationPath))
		throw new BackupValidationError('restore target must be fresh');
	const source = new Database(backupPath, { readonly: true });
	try {
		assertIntegrity(source, 'backup');
		fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
		try {
			await source.backup(destinationPath);
		} catch (error) {
			fs.rmSync(destinationPath, { force: true });
			throw new BackupValidationError(`restore failed: ${String(error)}`);
		}
		const restored = new Database(destinationPath);
		try {
			restored.pragma('foreign_keys = ON');
			applyControlPlaneMigrations(restored);
			assertIntegrity(restored, 'restored database');
			return restored;
		} catch (error) {
			restored.close();
			fs.rmSync(destinationPath, { force: true });
			throw new BackupValidationError(`restore validation failed: ${String(error)}`);
		}
	} finally {
		source.close();
	}
}
