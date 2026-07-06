/**
 * TypeScript definitions for Juggler Shared Task Status Library
 */

declare const TaskStatus: {
    readonly EMPTY: '';
    readonly DONE: 'done';
    readonly CANCEL: 'cancel';
    readonly CANCELLED: 'cancelled';
    readonly SKIP: 'skip';
    readonly PAUSE: 'pause';
};

declare const TASK_STATUSES: readonly [
    '',
    'done',
    'cancel',
    'cancelled',
    'skip',
    'pause'
];

declare const TERMINAL_STATUSES: readonly [
    'done',
    'cancel',
    'cancelled',
    'skip',
    'pause',
    'missed'
];

declare const ACTIVE_STATUSES: readonly [''];

declare const STATUS_OPTIONS: readonly [
    '',
    'done',
    'cancel',
    'skip',
    'pause'
];

declare const CalHistoryStatus: {
    readonly SCHEDULED: 'SCHEDULED';
    readonly COMPLETED: 'COMPLETED';
    readonly MISSED: 'MISSED';
    readonly CANCELLED: 'CANCELLED';
};

declare const CAL_HISTORY_STATUSES: readonly [
    'SCHEDULED',
    'COMPLETED',
    'MISSED',
    'CANCELLED'
];

declare const CAL_HISTORY_TERMINAL_STATUSES: readonly [
    'COMPLETED',
    'MISSED',
    'CANCELLED'
];

declare function isValidTaskStatus(status: string | null | undefined): boolean;

declare function isTerminalStatus(status: string | null | undefined): boolean;

declare function isActiveStatus(status: string | null | undefined): boolean;

declare function getTaskStatusDisplayName(status: string): string;

declare function getTaskStatusDescription(status: string): string;

declare function isValidCalHistoryStatus(status: string | null | undefined): boolean;

declare function isCalHistoryTerminalStatus(status: string | null | undefined): boolean;

declare function isValidBooleanValue(value: number | null | undefined): boolean;

declare function validateStatusValue(status: string | null | undefined, context?: string): boolean;

declare function canTransition(currentStatus: string, newStatus: string): boolean;

export {
    TaskStatus,
    TASK_STATUSES,
    TERMINAL_STATUSES,
    ACTIVE_STATUSES,
    STATUS_OPTIONS,
    CalHistoryStatus,
    CAL_HISTORY_STATUSES,
    CAL_HISTORY_TERMINAL_STATUSES,
    isValidTaskStatus,
    isTerminalStatus,
    isActiveStatus,
    getTaskStatusDisplayName,
    getTaskStatusDescription,
    isValidCalHistoryStatus,
    isCalHistoryTerminalStatus,
    isValidBooleanValue,
    validateStatusValue,
    canTransition
};