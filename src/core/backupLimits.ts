// The multipart disk spool and browser file picker enforce the same quota.
// This does not increase the 32 MiB expanded project JSON stage budget.
export const MAX_RESTORE_ARCHIVE_MIB = 512
export const MAX_RESTORE_ARCHIVE_UPLOAD = MAX_RESTORE_ARCHIVE_MIB * 1024 * 1024
